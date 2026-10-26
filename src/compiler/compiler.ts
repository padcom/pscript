// Single-pass compiler from AST to bytecode (§5.5).
import { PScriptSyntaxError, formatExcerpt } from '@/errors'
import type {
  AssignmentExpression,
  AssignmentPattern,
  BinaryExpression,
  BlockStatement,
  BreakStatement,
  CallExpression,
  ConditionalExpression,
  ContinueStatement,
  Expression,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  IfStatement,
  Literal,
  LogicalExpression,
  NewExpression,
  Node,
  Pattern,
  Program,
  ReturnStatement,
  SourceLocation,
  Statement,
  UnaryExpression,
  UpdateExpression,
  VariableDeclaration,
  WhileStatement,
} from '@/parser/ast'
import type { FunctionNode } from '@/parser/ast-builders'
import { parse } from '@/parser/parse'
import type { CompiledScript, FunctionProto } from './function-proto'
import { GlobalFlags, Op } from './opcodes'
import { ProtoBuilder } from './proto-builder'
import { Scope, type Binding, type BindingKind } from './scope'
import { arityError, signatureOf, type Signature } from './signature'

/**
 * Options of `compile()`.
 */
export interface CompileOptions {
  /** file name used in error messages */
  fileName?: string
}

function paramName(param: Pattern): Identifier {
  if (param.type === 'Identifier') return param

  return param.type === 'AssignmentPattern' ? param.left : param.argument
}

// A `const` bound directly to a function expression has a compile-time signature (D38).
function constSignature(kind: BindingKind, id: Identifier, init: Expression | null): Signature | undefined {
  return kind === 'const' && init?.type === 'FunctionExpression' ? signatureOf(id.name, init.params) : undefined
}

/** Slot of the completion value in the script's top environment (§4.4.10). */
const COMPLETION_SLOT = 0

const ARITHMETIC_OPS: Partial<Record<string, Op>> = {
  '+': Op.ADD,
  '-': Op.SUB,
  '*': Op.MUL,
  '/': Op.DIV,
  '%': Op.MOD,
  '**': Op.POW,
}

const BINARY_OPS: Record<BinaryExpression['operator'], Op> = {
  '+': Op.ADD,
  '-': Op.SUB,
  '*': Op.MUL,
  '/': Op.DIV,
  '%': Op.MOD,
  '**': Op.POW,
  '==': Op.EQ,
  '!=': Op.NE,
  '<': Op.LT,
  '<=': Op.LE,
  '>': Op.GT,
  '>=': Op.GE,
  'instanceof': Op.INSTANCEOF,
  'in': Op.IN,
}

const UNARY_OPS: Record<UnaryExpression['operator'], Op> = {
  '!': Op.NOT,
  '-': Op.NEG,
  '+': Op.POS,
  'typeof': Op.TYPEOF,
}

/** Short-circuit jumps of `&&`, `||`, `??` and their assignment forms. */
const LOGICAL_JUMPS: Record<string, Op> = {
  '&&': Op.AND_JUMP,
  '||': Op.OR_JUMP,
  '??': Op.NULLISH_JUMP,
}

type Handler<T> = (compiler: Compiler, node: T) => void

const EXPRESSIONS: { [K in Expression['type']]?: Handler<Extract<Expression, { type: K }>> } = {
  Literal: (c, node) => c.literal(node),
  Identifier: (c, node) => c.identifier(node),
  UnaryExpression: (c, node) => c.unary(node),
  BinaryExpression: (c, node) => c.binary(node),
  CallExpression: (c, node) => c.call(node),
  AssignmentExpression: (c, node) => c.assignment(node),
  LogicalExpression: (c, node) => c.logical(node),
  ConditionalExpression: (c, node) => c.conditional(node),
  UpdateExpression: (c, node) => c.update(node),
  FunctionExpression: (c, node) => c.functionExpression(node),
  ThisExpression: c => c.out.emit(Op.THIS),
  NewExpression: (c, node) => c.newExpression(node),
}

const STATEMENTS: { [K in Statement['type']]?: Handler<Extract<Statement, { type: K }>> } = {
  ExpressionStatement: (c, node) => c.expressionStatement(node.expression),
  VariableDeclaration: (c, node) => c.variableDeclaration(node),
  BlockStatement: (c, node) => c.block(node),
  IfStatement: (c, node) => c.ifStatement(node),
  WhileStatement: (c, node) => c.whileStatement(node),
  ForStatement: (c, node) => c.forStatement(node),
  BreakStatement: (c, node) => c.jump(node, 'breaks'),
  ContinueStatement: (c, node) => c.jump(node, 'continues'),
  ReturnStatement: (c, node) => c.returnStatement(node),
  FunctionDeclaration: () => {}, // hoisted to the start of its scope
  EmptyStatement: () => {},
}

/**
 * An enclosing loop: pending `break` / `continue` jumps.
 */
interface Loop {
  /** operands of `break` jumps, patched to the loop exit */
  breaks: number[]
  /** operands of `continue` jumps, patched to the continue target */
  continues: number[]
  /** environment depth that `break` / `continue` unwind to */
  envDepth: number
}

/**
 * State of the function (or script) being compiled.
 */
interface FunctionContext {
  /** code being generated */
  out: ProtoBuilder
  /** innermost scope */
  scope: Scope
  /** enclosing loops (they never cross function boundaries) */
  loops: Loop[]
  /** completion value (§4.4.10): tracked in top-level script code only, never in function bodies */
  tracksCompletion: boolean
}

class Compiler {
  private fn: FunctionContext = {
    out: new ProtoBuilder({ name: '', kind: 'script' }),
    scope: new Scope(null, 'script'),
    loops: [],
    tracksCompletion: true,
  }

  constructor(private source: string | undefined, private fileName: string | undefined) {}

  get out(): ProtoBuilder {
    return this.fn.out
  }

  private get scope(): Scope {
    return this.fn.scope
  }

  private set scope(scope: Scope) {
    this.fn.scope = scope
  }

  private get loops(): Loop[] {
    return this.fn.loops
  }

  private get tracksCompletion(): boolean {
    return this.fn.tracksCompletion
  }

  script(program: Program): CompiledScript {
    const { out } = this
    const body = program.body as Statement[]

    this.declare(body, this.scope)

    for (const binding of this.scope.bindings.values()) {
      out.emit(Op.DECLARE_GLOBAL, out.constant(binding.name), binding.kind === 'let' ? GlobalFlags.None : GlobalFlags.Const)
    }
    out.scopeSize = 1
    out.emit(Op.UNDEFINED)
    out.emit(Op.INIT, 0, COMPLETION_SLOT)
    this.hoistFunctions(body)
    this.statements(body)
    out.emit(Op.LOAD, 0, COMPLETION_SLOT)
    out.emit(Op.HALT)

    return { main: out.build(), source: this.source, fileName: this.fileName }
  }

  // ---------------------------------------------------------------------------
  // Scopes

  // Pre-scan of a statement list: collects its lexical declarations (§5.5).
  private declare(body: Statement[], scope: Scope) {
    for (const statement of body) {
      if (statement.type === 'VariableDeclaration') this.declareVariables(statement, scope)
      if (statement.type === 'FunctionDeclaration') this.declareFunction(statement, scope)
    }
  }

  private declareFunction({ id, params }: FunctionDeclaration, scope: Scope) {
    this.declareName(scope, id, 'function', signatureOf(id.name, params))
  }

  private declareVariables(node: VariableDeclaration, scope: Scope) {
    for (const { id, init } of node.declarations) this.declareName(scope, id, node.kind, constSignature(node.kind, id, init))
  }

  private declareName(scope: Scope, id: Identifier, kind: BindingKind, signature?: Signature) {
    if (!scope.declare(id.name, kind, signature)) throw this.error(`Identifier '${id.name}' has already been declared`, id.loc)
  }

  // Function declarations are initialised at the start of their scope, so mutual recursion works (§4.4.4).
  private hoistFunctions(body: Statement[]) {
    for (const statement of body) {
      if (statement.type !== 'FunctionDeclaration') continue
      this.closure(this.functionProto(statement, statement.id.name))
      this.initialize(statement.id.name)
    }
  }

  private load(name: string, loc: SourceLocation) {
    const resolution = this.scope.resolve(name)

    this.out.mark(loc)

    if (resolution.where === 'lexical') this.lexical(Op.LOAD, name, resolution)
    else this.out.emit(Op.LOAD_GLOBAL, this.out.constant(name))
  }

  private store(name: string, loc: SourceLocation) {
    const resolution = this.scope.resolve(name)
    if (resolution.where !== 'global') this.checkAssignable(resolution.binding, loc)

    this.out.mark(loc)

    if (resolution.where === 'lexical') this.lexical(Op.STORE, name, resolution)
    else this.out.emit(Op.STORE_GLOBAL, this.out.constant(name))
  }

  private checkAssignable({ name, kind }: Binding, loc: SourceLocation) {
    if (kind === 'const') throw this.error(`Assignment to constant variable '${name}'`, loc)
    if (kind === 'function') throw this.error(`Cannot assign to function '${name}': function declarations are constant`, loc)
  }

  // Initialises a binding declared in the current scope.
  private initialize(name: string) {
    const resolution = this.scope.resolve(name)

    if (resolution.where === 'lexical') this.lexical(Op.INIT, name, resolution)
    else this.out.emit(Op.INIT_GLOBAL, this.out.constant(name))
  }

  private lexical(op: Op, name: string, { depth, slot }: { depth: number, slot: number }) {
    this.out.nameNext(name)
    this.out.emit(op, depth, slot)
  }

  // ---------------------------------------------------------------------------
  // Statements

  statements(body: Statement[]) {
    for (const statement of body) this.statement(statement)
  }

  statement(node: Statement) {
    const handler = STATEMENTS[node.type] as Handler<Statement> | undefined
    if (!handler) throw this.unsupported(node)
    handler(this, node)
  }

  expressionStatement(expression: Expression) {
    this.expression(expression)

    if (this.tracksCompletion) this.expressionStatementTail()
    else this.out.emit(Op.POP)
  }

  // `if`, loops and `try` set the completion value to undefined on entry (§4.4.10).
  private resetCompletion() {
    if (!this.tracksCompletion) return
    this.out.emit(Op.UNDEFINED)
    this.expressionStatementTail()
  }

  private expressionStatementTail() {
    this.out.emit(Op.STORE, this.scope.envDepth, COMPLETION_SLOT)
    this.out.emit(Op.POP)
  }

  ifStatement(node: IfStatement) {
    this.resetCompletion()
    this.expression(node.test)
    const otherwise = this.out.emitJump(Op.JUMP_IF_FALSE)

    this.statement(node.consequent)

    if (!node.alternate) {
      this.out.patch(otherwise)

      return
    }
    const end = this.out.emitJump(Op.JUMP)

    this.out.patch(otherwise)
    this.statement(node.alternate)
    this.out.patch(end)
  }

  whileStatement(node: WhileStatement) {
    this.resetCompletion()
    const top = this.out.code.length

    this.expression(node.test)
    const exit = this.out.emitJump(Op.JUMP_IF_FALSE)
    const loop = this.loopBody(node.body)

    this.endLoop(loop, top, top)
    this.out.patch(exit)
    this.patchAll(loop.breaks)
  }

  // for-let: init env → loop: test, body, COPY_ENV, update (§5.5).
  forStatement(node: ForStatement) {
    this.resetCompletion()
    const outer = this.scope
    const head = this.forHead(node)

    this.forLoop(node, head.hasEnv)
    this.scope = outer

    if (head.hasEnv) this.out.emit(Op.POP_ENV)
  }

  private forHead({ init }: ForStatement): Scope {
    const head = new Scope(this.scope, 'block')

    if (init?.type === 'VariableDeclaration') this.declareVariables(init, head)
    this.enterScope(head)
    this.forInit(init)

    return head
  }

  // Makes `scope` current, with an environment when it declares something.
  private enterScope(scope: Scope) {
    if (scope.hasEnv) this.out.emit(Op.PUSH_ENV, scope.bindings.size)
    this.scope = scope
  }

  private forInit(init: ForStatement['init']) {
    if (init?.type === 'VariableDeclaration') this.variableDeclaration(init)
    else if (init) this.discard(init)
  }

  private forLoop(node: ForStatement, perIterationEnv: boolean) {
    const top = this.out.code.length
    const exit = node.test ? this.condition(node.test) : -1
    const loop = this.loopBody(node.body)
    const next = this.out.code.length

    if (perIterationEnv) this.out.emit(Op.COPY_ENV)
    this.optionalDiscard(node.update)
    this.endLoop(loop, top, next)
    this.patchAll(exit < 0 ? loop.breaks : [exit, ...loop.breaks])
  }

  private condition(test: Expression): number {
    this.expression(test)

    return this.out.emitJump(Op.JUMP_IF_FALSE)
  }

  private optionalDiscard(expression: Expression | null) {
    if (expression) this.discard(expression)
  }

  private discard(expression: Expression) {
    this.expression(expression)
    this.out.emit(Op.POP)
  }

  private loopBody(body: Statement): Loop {
    const loop: Loop = { breaks: [], continues: [], envDepth: this.scope.envDepth }

    this.loops.push(loop)
    this.statement(body)
    this.loops.pop()

    return loop
  }

  private endLoop(loop: Loop, top: number, next: number) {
    this.out.patch(this.out.emitJump(Op.JUMP), top)
    this.patchAll(loop.continues, next)
  }

  private patchAll(operands: number[], target = this.out.code.length) {
    for (const operand of operands) this.out.patch(operand, target)
  }

  // break / continue: unwind block environments down to the loop's, then jump (§5.5).
  jump(node: BreakStatement | ContinueStatement, list: 'breaks' | 'continues') {
    const loop = this.loops.at(-1)
    if (!loop) throw this.error(`Illegal ${list === 'breaks' ? 'break' : 'continue'} statement`, node.loc)

    for (let depth = this.scope.envDepth; depth > loop.envDepth; depth--) this.out.emit(Op.POP_ENV)
    loop[list].push(this.out.emitJump(Op.JUMP))
  }

  variableDeclaration(node: VariableDeclaration) {
    for (const { id, init } of node.declarations) {
      if (init) this.namedExpression(init, id.name)
      else this.out.emit(Op.NULL) // `let x` starts as null (D37)
      this.initialize(id.name)
    }
  }

  // `let f = function () {}` names the function `f`, as in JS.
  private namedExpression(node: Expression, name: string) {
    if (node.type === 'FunctionExpression') this.functionExpression(node, name)
    else this.expression(node)
  }

  block(node: BlockStatement) {
    const outer = this.scope
    const scope = new Scope(outer, 'block')

    this.declare(node.body, scope)
    this.enterScope(scope)
    this.hoistFunctions(node.body)
    this.statements(node.body)
    this.scope = outer

    if (scope.hasEnv) this.out.emit(Op.POP_ENV)
  }

  // ---------------------------------------------------------------------------
  // Expressions

  expression(node: Expression) {
    const handler = EXPRESSIONS[node.type] as Handler<Expression> | undefined
    if (!handler) throw this.unsupported(node)
    handler(this, node)
  }

  literal(node: Literal) {
    const { value } = node
    if (value === null) this.out.emit(Op.NULL)
    else if (typeof value === 'boolean') this.out.emit(value ? Op.TRUE : Op.FALSE)
    else this.out.emit(Op.CONST, this.out.constant(value))
  }

  identifier(node: Identifier) {
    if (node.name === 'undefined') this.out.emit(Op.UNDEFINED)
    else this.load(node.name, node.loc)
  }

  unary(node: UnaryExpression) {
    const { argument } = node
    if (node.operator === 'typeof' && this.isGlobalName(argument)) {
      this.out.emit(Op.TYPEOF_GLOBAL, this.out.constant(argument.name))

      return
    }
    this.expression(argument)
    this.out.mark(node.loc)
    this.out.emit(UNARY_OPS[node.operator])
  }

  // `typeof x` of a name that is not lexical must not throw when it is undeclared.
  private isGlobalName(node: Expression): node is Identifier {
    return node.type === 'Identifier' && node.name !== 'undefined' && this.scope.resolve(node.name).where !== 'lexical'
  }

  binary(node: BinaryExpression) {
    this.expression(node.left)
    this.expression(node.right)
    this.out.mark(node.loc)
    this.out.emit(BINARY_OPS[node.operator])
  }

  logical(node: LogicalExpression) {
    this.expression(node.left)
    const end = this.out.emitJump(LOGICAL_JUMPS[node.operator])

    this.expression(node.right)
    this.out.patch(end)
  }

  conditional(node: ConditionalExpression) {
    this.expression(node.test)
    const otherwise = this.out.emitJump(Op.JUMP_IF_FALSE)

    this.expression(node.consequent)
    const end = this.out.emitJump(Op.JUMP)

    this.out.patch(otherwise)
    this.expression(node.alternate)
    this.out.patch(end)
  }

  // `++x`: LOAD POS INC STORE; `x++`: LOAD POS DUP INC STORE POP (leaves the old number).
  update(node: UpdateExpression) {
    const { argument, prefix } = node
    if (argument.type !== 'Identifier') throw this.unsupported(argument)

    this.expression(argument)
    this.out.mark(node.loc)
    this.out.emit(Op.POS)

    if (prefix) this.increment(node, argument)
    else this.postIncrement(node, argument)
  }

  private increment({ operator }: UpdateExpression, target: Identifier) {
    this.out.emit(operator === '++' ? Op.INC : Op.DEC)
    this.store(target.name, target.loc)
  }

  private postIncrement(node: UpdateExpression, target: Identifier) {
    this.out.emit(Op.DUP)
    this.increment(node, target)
    this.out.emit(Op.POP)
  }

  call(node: CallExpression) {
    if (node.callee.type === 'Super') throw this.unsupported(node)
    this.checkArity(node.callee, node.arguments.length, node.loc)
    this.expression(node.callee)

    for (const argument of node.arguments) this.expression(argument)
    this.out.mark(node.loc)
    this.out.emit(Op.CALL, node.arguments.length)
  }

  assignment(node: AssignmentExpression) {
    const { left, right, operator } = node
    if (left.type !== 'Identifier') throw this.unsupported(left)

    const base = operator.slice(0, -1)
    if (base in LOGICAL_JUMPS) {
      this.logicalAssignment(left, right, LOGICAL_JUMPS[base])

      return
    }
    if (operator === '=') this.expression(right)
    else this.compoundValue(node, ARITHMETIC_OPS[base] as Op)
    this.store(left.name, left.loc)
  }

  private compoundValue({ left, right, loc }: AssignmentExpression, op: Op) {
    this.expression(left)
    this.expression(right)
    this.out.mark(loc)
    this.out.emit(op)
  }

  // `a ||= b` assigns only when needed (§5.5).
  private logicalAssignment(left: Identifier, right: Expression, jump: Op) {
    this.expression(left)
    const end = this.out.emitJump(jump)

    this.expression(right)
    this.store(left.name, left.loc)
    this.out.patch(end)
  }

  // Compile-time arity check when the callee is a known function (D38, §4.4.13).
  private checkArity(callee: Expression, argc: number, loc: SourceLocation) {
    const signature = callee.type === 'Identifier' ? this.knownSignature(callee.name) : undefined
    const problem = signature && arityError(signature, argc)
    if (problem) throw this.error(problem, loc)
  }

  private knownSignature(name: string): Signature | undefined {
    const resolution = this.scope.resolve(name)

    return resolution.where === 'global' ? undefined : resolution.binding.signature
  }

  newExpression(node: NewExpression) {
    this.expression(node.callee)

    for (const argument of node.arguments) this.expression(argument)
    this.out.mark(node.loc)
    this.out.emit(Op.NEW, node.arguments.length)
  }

  // ---------------------------------------------------------------------------
  // Functions

  returnStatement(node: ReturnStatement) {
    if (this.tracksCompletion) throw this.error('Illegal return statement', node.loc)
    if (node.argument) this.expression(node.argument)
    else this.out.emit(Op.NULL) // bare return gives null (D37)
    this.out.emit(Op.RETURN)
  }

  functionExpression(node: FunctionExpression, name = '') {
    if (node.id) this.namedFunctionExpression(node, node.id)
    else this.closure(this.functionProto(node, name))
  }

  // The name of a named function expression is a constant binding visible only inside it.
  private namedFunctionExpression(node: FunctionExpression, id: Identifier) {
    const outer = this.scope
    const scope = new Scope(outer, 'block')

    this.declareName(scope, id, 'function', signatureOf(id.name, node.params))
    this.enterScope(scope)
    this.closure(this.functionProto(node, id.name))
    this.out.emit(Op.DUP)
    this.initialize(id.name)
    this.scope = outer
    this.out.emit(Op.POP_ENV)
  }

  private closure(proto: FunctionProto) {
    this.out.emit(Op.CLOSURE, this.out.constant(proto))
  }

  private functionProto(node: FunctionNode, name: string): FunctionProto {
    const outer = this.fn
    const scope = new Scope(outer.scope, 'function')

    this.fn = { out: new ProtoBuilder({ name, kind: 'function' }), scope, loops: [], tracksCompletion: false }

    try {
      return this.functionBody(node, signatureOf(name, node.params))
    } finally {
      this.fn = outer
    }
  }

  // Function env layout: parameters (rest last), then the body's top-level declarations.
  private functionBody({ params, body }: FunctionNode, signature: Signature): FunctionProto {
    for (const param of params) this.declareName(this.scope, paramName(param), 'let')
    this.declare(body.body, this.scope)
    this.defaults(params)
    this.hoistFunctions(body.body)
    this.statements(body.body)
    this.out.emit(Op.NULL) // falling off the end returns null (D37)
    this.out.emit(Op.RETURN)
    this.out.scopeSize = this.scope.bindings.size

    const { text, required, optional, hasRest } = signature

    return { ...this.out.build(), paramCount: required + optional, length: required, hasRest, signature: text }
  }

  // Default values are evaluated at call time, left to right, only for omitted arguments (D38).
  private defaults(params: Pattern[]) {
    params.forEach(param => {
      if (param.type === 'AssignmentPattern') this.defaultValue(param)
    })
  }

  private defaultValue({ left, right }: AssignmentPattern) {
    const resolution = this.scope.resolve(left.name) as { slot: number }
    const skip = this.out.emit(Op.JUMP_IF_ARG, resolution.slot, -1) + 2

    this.expression(right)
    this.initialize(left.name)
    this.out.patch(skip)
  }

  // ---------------------------------------------------------------------------
  // Errors

  error(reason: string, { start: { line, column } }: SourceLocation): PScriptSyntaxError {
    const excerpt = this.source === undefined ? undefined : formatExcerpt(this.source, line, column)

    return new PScriptSyntaxError(reason, { fileName: this.fileName, line, column, excerpt })
  }

  unsupported(node: Node): PScriptSyntaxError {
    return this.error(`${'operator' in node ? `'${node.operator}'` : node.type} is not supported yet`, node.loc)
  }
}

/**
 * Compiles a script.
 *
 * @param source source text or a parsed program
 * @param options file name
 * @returns the compiled script
 * @throws {PScriptSyntaxError} on syntax errors
 */
export function compile(source: string | Program, options: CompileOptions = {}): CompiledScript {
  const program = typeof source === 'string' ? parse(source, { fileName: options.fileName }) : source
  const text = typeof source === 'string' ? source : undefined

  return new Compiler(text, options.fileName).script(program)
}

// Single-pass compiler from AST to bytecode (§5.5).
import { PScriptSyntaxError, formatExcerpt } from '@/errors'
import type {
  AssignmentExpression,
  BinaryExpression,
  BlockStatement,
  BreakStatement,
  CallExpression,
  ConditionalExpression,
  ContinueStatement,
  Expression,
  ForStatement,
  Identifier,
  IfStatement,
  Literal,
  LogicalExpression,
  Node,
  Program,
  SourceLocation,
  Statement,
  UnaryExpression,
  UpdateExpression,
  VariableDeclaration,
  WhileStatement,
} from '@/parser/ast'
import { parse } from '@/parser/parse'
import type { CompiledScript } from './function-proto'
import { GlobalFlags, Op } from './opcodes'
import { ProtoBuilder } from './proto-builder'
import { Scope } from './scope'

/**
 * Options of `compile()`.
 */
export interface CompileOptions {
  /** file name used in error messages */
  fileName?: string
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

class Compiler {
  readonly out = new ProtoBuilder({ name: '', kind: 'script' })
  private scope = new Scope(null, 'script')
  private loops: Loop[] = []
  // Completion value (§4.4.10) is tracked in top-level script code only, never in function bodies.
  private tracksCompletion = true

  constructor(private source: string | undefined, private fileName: string | undefined) {}

  script(program: Program): CompiledScript {
    const { out } = this
    const body = program.body as Statement[]

    this.declare(body, this.scope)

    for (const binding of this.scope.bindings.values()) {
      out.emit(Op.DECLARE_GLOBAL, out.constant(binding.name), binding.kind === 'const' ? GlobalFlags.Const : GlobalFlags.None)
    }
    out.scopeSize = 1
    out.emit(Op.UNDEFINED)
    out.emit(Op.INIT, 0, COMPLETION_SLOT)
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
    }
  }

  private declareVariables(node: VariableDeclaration, scope: Scope) {
    for (const { id } of node.declarations) {
      if (!scope.declare(id.name, node.kind)) throw this.error(`Identifier '${id.name}' has already been declared`, id.loc)
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
    if (resolution.where !== 'global' && resolution.binding.kind === 'const') {
      throw this.error(`Assignment to constant variable '${name}'`, loc)
    }

    this.out.mark(loc)

    if (resolution.where === 'lexical') this.lexical(Op.STORE, name, resolution)
    else this.out.emit(Op.STORE_GLOBAL, this.out.constant(name))
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
      if (init) this.expression(init)
      else this.out.emit(Op.NULL) // `let x` starts as null (D37)
      this.initialize(id.name)
    }
  }

  block(node: BlockStatement) {
    const outer = this.scope
    const scope = new Scope(outer, 'block')

    this.declare(node.body, scope)

    if (scope.hasEnv) this.out.emit(Op.PUSH_ENV, scope.bindings.size)
    this.scope = scope
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

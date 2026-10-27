// Single-pass compiler from AST to bytecode (§5.5).
import { PScriptSyntaxError, formatExcerpt } from '@/errors'
import type {
  ArrayExpression,
  ArrowFunctionExpression,
  AssignmentExpression,
  AssignmentPattern,
  BinaryExpression,
  BlockStatement,
  BreakStatement,
  CatchClause,
  ClassDeclaration,
  ClassExpression,
  CallExpression,
  ConditionalExpression,
  ContinueStatement,
  Expression,
  ForOfStatement,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  IfStatement,
  Literal,
  LogicalExpression,
  MemberExpression,
  MethodDefinition,
  NewExpression,
  Node,
  ObjectExpression,
  Pattern,
  Program,
  Property,
  PropertyDefinition,
  ReturnStatement,
  SourceLocation,
  Statement,
  TemplateLiteral,
  ThisExpression,
  ThrowStatement,
  TryStatement,
  UnaryExpression,
  UpdateExpression,
  VariableDeclaration,
  WhileStatement,
} from '@/parser/ast'
import type { FunctionNode } from '@/parser/ast-builders'
import { parse } from '@/parser/parse'
import { classInfoOf, hasMember, keyName, type ClassInfo } from './class-info'
import type {
  ClassFieldTemplate,
  ClassMemberRef,
  ClassMethodTemplate,
  ClassTemplate,
  CompiledScript,
  FunctionKind,
  FunctionProto,
} from './function-proto'
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

function fieldTemplate({ key, access, static: isStatic, override, final, loc }: PropertyDefinition): ClassFieldTemplate {
  return { key: keyName(key), access, isStatic, override, final, loc }
}

function isFunction(node: Expression | null): node is FunctionExpression | ArrowFunctionExpression {
  return node?.type === 'FunctionExpression' || node?.type === 'ArrowFunctionExpression'
}

// A `const` bound directly to a function expression has a compile-time signature (D38).
function constSignature(kind: BindingKind, id: Identifier, init: Expression | null): Signature | undefined {
  return kind === 'const' && isFunction(init) ? signatureOf(id.name, init.params) : undefined
}

type AnyFunction = FunctionNode | ArrowFunctionExpression

type ClassNode = ClassDeclaration | ClassExpression

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
  ArrowFunctionExpression: (c, node) => c.closure(c.functionProto(node, '')),
  ThisExpression: (c, node) => c.thisExpression(node),
  NewExpression: (c, node) => c.newExpression(node),
  MemberExpression: (c, node) => c.member(node),
  ObjectExpression: (c, node) => c.object(node),
  ArrayExpression: (c, node) => c.array(node),
  TemplateLiteral: (c, node) => c.template(node),
  ClassExpression: (c, node) => c.classExpression(node),
}

/**
 * An assignment target (§5.5): what `prepare` pushes stays on the stack for `get` and `set`.
 */
interface Reference {
  /** values pushed by `prepare`: 0 for a name, 1 for `o.k` (o), 2 for `o[k]` (o, k) */
  baseSize: number
  /** pushes the base values */
  prepare: () => void
  /** base → value */
  get: () => void
  /** base value → value */
  set: () => void
}

/** Proto kinds of class members and object-literal accessors. */
const PROTO_KINDS: Record<string, FunctionKind> = { method: 'method', get: 'getter', set: 'setter' }

const DEFINE_OPS: Record<Property['kind'], Op> = { init: Op.DEFINE_PROP, get: Op.DEFINE_GETTER, set: Op.DEFINE_SETTER }

/** Indexed by `Reference.baseSize` (1 or 2). */
const DUPLICATE_BASE: Record<number, Op> = { 1: Op.DUP, 2: Op.DUP2 }
const ROTATE_BELOW_BASE: Record<number, Op> = { 1: Op.ROT3, 2: Op.ROT4 }
const DROP_BASE: Record<number, Op[]> = { 1: [Op.SWAP, Op.POP], 2: [Op.ROT3, Op.POP, Op.POP] }

const STATEMENTS: { [K in Statement['type']]?: Handler<Extract<Statement, { type: K }>> } = {
  ExpressionStatement: (c, node) => c.expressionStatement(node.expression),
  VariableDeclaration: (c, node) => c.variableDeclaration(node),
  BlockStatement: (c, node) => c.block(node),
  IfStatement: (c, node) => c.ifStatement(node),
  WhileStatement: (c, node) => c.whileStatement(node),
  ForStatement: (c, node) => c.forStatement(node),
  ForOfStatement: (c, node) => c.forOfStatement(node),
  BreakStatement: (c, node) => c.jump(node, 'breaks'),
  ContinueStatement: (c, node) => c.jump(node, 'continues'),
  ReturnStatement: (c, node) => c.returnStatement(node),
  ClassDeclaration: (c, node) => c.classDeclaration(node),
  ThrowStatement: (c, node) => c.throwStatement(node),
  TryStatement: (c, node) => c.tryStatement(node),
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
  /** handler regions active outside the loop (`break` / `continue` leave the ones above) */
  regionDepth: number
  /** values the loop itself keeps on the stack (a for-of iterator); others are dropped by `break` / `continue` */
  stackItems: number
}

/**
 * A `try` block (or the `catch` block of a `try … finally`) whose VM handler is active (§5.6.5).
 */
interface HandlerRegion {
  /** the `finally` block to run when control leaves the region by break / continue / return */
  finalizer: BlockStatement | null
  /** scope of the `try` statement (the finally block is compiled in it) */
  scope: Scope
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
  /** enclosing function (null for the script) */
  parent: FunctionContext | null
  /** compiling an arrow function: `this` is lexical */
  isArrow: boolean
  /** an arrow (or an arrow nested in it) reads `this`, so its closure must capture it */
  usesThis: boolean
  /** active handler regions, innermost last */
  regions: HandlerRegion[]
  /** values the compiler keeps on the stack across statements (for-of iterators, finally records) */
  stackItems: number
  /** the class body this code belongs to (methods, constructor, initialisers and arrows inside them) */
  classContext: ClassContext | null
  /** compiling a constructor (its own body, not arrows inside it) */
  isConstructor: boolean
  /** `super(...)` is allowed: a derived constructor, or an arrow inside one */
  superCall: boolean
}

/**
 * The class a piece of code belongs to (§4.5.9).
 */
interface ClassContext {
  /** what the compiler knows about the class */
  info: ClassInfo
  /** static context (`this` is the class) */
  isStatic: boolean
  /** unproven `this.x` references, checked by CLASS */
  memberRefs: ClassMemberRef[]
}

/**
 * Class-related settings for a function being compiled.
 */
interface FunctionOptions {
  /** the class the function belongs to */
  classContext?: ClassContext | null
  /** a constructor */
  isConstructor?: boolean
  /** a derived constructor (`super(...)` allowed) */
  superCall?: boolean
}

// Arrows read the `this` of the enclosing function: mark the arrow and every arrow around it up to that function.
function markArrowsUsingThis(fn: FunctionContext | null) {
  for (let context = fn; context?.isArrow; context = context.parent) context.usesThis = true
}

/** Pre-scan (§5.5): the lexical declarations of a statement list. Classes are constant bindings. */
const DECLARATIONS: Partial<Record<Statement['type'], (c: Compiler, node: any, scope: Scope) => void>> = {
  VariableDeclaration: (c, node, scope) => c.declareVariables(node, scope),
  FunctionDeclaration: (c, node, scope) => c.declareFunction(node, scope),
  ClassDeclaration: (c, node: ClassDeclaration, scope) => c.declareName(scope, node.id, 'const'),
}

class Compiler {
  private fn: FunctionContext = {
    out: new ProtoBuilder({ name: '', kind: 'script' }),
    scope: new Scope(null, 'script'),
    loops: [],
    tracksCompletion: true,
    parent: null,
    isArrow: false,
    usesThis: false,
    regions: [],
    stackItems: 0,
    classContext: null,
    isConstructor: false,
    superCall: false,
  }

  /** compile-time knowledge of class declarations, by binding (§4.5.9) */
  private classInfos = new Map<Binding, ClassInfo>()

  /** classes whose bodies lexically enclose the code being compiled, innermost last (§4.5.3) */
  private enclosingClasses: ClassInfo[] = []

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
    for (const statement of body) DECLARATIONS[statement.type]?.(this, statement, scope)
  }

  declareFunction({ id, params }: FunctionDeclaration, scope: Scope) {
    this.declareName(scope, id, 'function', signatureOf(id.name, params))
  }

  declareVariables(node: VariableDeclaration, scope: Scope) {
    for (const { id, init } of node.declarations) this.declareName(scope, id, node.kind, constSignature(node.kind, id, init))
  }

  declareName(scope: Scope, id: Identifier, kind: BindingKind, signature?: Signature) {
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

  // for-of (§5.5): GET_ITER; top: ITER_NEXT done; [PUSH_ENV 1] bind; body; next: [POP_ENV] JUMP top;
  // break: [POP_ENV] POP (the iterator); done: (ITER_NEXT already popped it).
  forOfStatement(node: ForOfStatement) {
    this.resetCompletion()
    this.expression(node.right)
    this.emitAt(node.right.loc, Op.GET_ITER)
    const top = this.out.code.length
    const done = this.out.emitJump(Op.ITER_NEXT)
    const outer = this.scope
    const iteration = this.bindIterationValue(node.left)

    this.fn.stackItems++ // the iterator
    const loop = this.loopBody(node.body)

    this.fn.stackItems--

    this.scope = outer
    this.patchAll(loop.continues)

    if (iteration.hasEnv) this.out.emit(Op.POP_ENV)
    this.out.patch(this.out.emitJump(Op.JUMP), top)
    this.patchAll(loop.breaks)

    if (iteration.hasEnv) this.out.emit(Op.POP_ENV)
    this.out.emit(Op.POP)
    this.out.patch(done)
  }

  // `let x` / `const x` get a fresh binding per iteration; a bare name is assigned.
  private bindIterationValue(left: ForOfStatement['left']): Scope {
    const scope = new Scope(this.scope, 'block')

    if (left.type === 'Identifier') {
      this.store(left.name, left.loc)
      this.out.emit(Op.POP)

      return scope
    }
    this.declareVariables(left, scope)
    this.enterScope(scope)
    this.initialize(left.declarations[0].id.name)

    return scope
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
    const { regions, stackItems } = this.fn
    const loop: Loop = { breaks: [], continues: [], envDepth: this.scope.envDepth, regionDepth: regions.length, stackItems }

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
  // break / continue (§5.5): drop extra stack values, leave the handler regions inside the loop
  // (running their finally blocks), unwind block environments, then jump.
  jump(node: BreakStatement | ContinueStatement, list: 'breaks' | 'continues') {
    const loop = this.loops.at(-1)
    if (!loop) throw this.error(`Illegal ${list === 'breaks' ? 'break' : 'continue'} statement`, node.loc)

    for (let n = this.fn.stackItems; n > loop.stackItems; n--) this.out.emit(Op.POP)

    const depth = this.leaveRegions(loop.regionDepth)

    this.popEnvs(depth, loop.envDepth)
    loop[list].push(this.out.emitJump(Op.JUMP))
  }

  private popEnvs(from: number, to: number) {
    for (let depth = from; depth > to; depth--) this.out.emit(Op.POP_ENV)
  }

  // Leaves the handler regions above `downTo`: pops their handlers and inlines their finally blocks.
  // Returns the environment depth reached.
  private leaveRegions(downTo: number): number {
    const { regions } = this.fn
    let depth = this.scope.envDepth

    for (let i = regions.length - 1; i >= downTo; i--) {
      this.popEnvs(depth, regions[i].scope.envDepth)
      depth = regions[i].scope.envDepth
      this.out.emit(Op.END_TRY)
      this.inlineFinalizer(i)
    }

    return depth
  }

  private inlineFinalizer(index: number) {
    const { regions } = this.fn
    const { finalizer, scope } = regions[index]
    if (!finalizer) return

    const outer = this.scope

    this.fn.regions = regions.slice(0, index)
    this.scope = scope
    this.finallyBlock(finalizer)
    this.scope = outer
    this.fn.regions = regions
  }

  // ---------------------------------------------------------------------------
  // Classes (§4.5)

  classDeclaration(node: ClassDeclaration) {
    this.compileClass(node, node.id.name)
    this.initialize(node.id.name)
    const resolution = this.scope.resolve(node.id.name)

    if (resolution.where !== 'global') this.classInfos.set(resolution.binding, this.lastClassInfo as ClassInfo)
  }

  classExpression(node: ClassExpression, name = '') {
    this.compileClass(node, node.id?.name ?? name)
  }

  private lastClassInfo: ClassInfo | null = null

  // <superclass> CLASS k; a named class gets a one-slot environment holding its name (set by CLASS).
  private compileClass(node: ClassNode, name: string) {
    const info = classInfoOf(node, name, this.knownSuperClass(node))
    const outer = this.scope
    const named = Boolean(node.id)

    this.lastClassInfo = info

    if (named) this.enterClassScope(node.id as Identifier, info)
    const template = this.classTemplate(node, info)

    if (node.superClass) this.expression(node.superClass)
    this.emitAt(node.loc, Op.CLASS, this.out.constant(template))

    if (!named) return
    this.scope = outer
    this.out.emit(Op.POP_ENV)
  }

  private enterClassScope(id: Identifier, info: ClassInfo) {
    const scope = new Scope(this.scope, 'block')
    const binding = scope.declare(id.name, 'const') as Binding

    this.classInfos.set(binding, info)
    this.enterScope(scope)
  }

  // null: no superclass; undefined: a superclass the compiler cannot see.
  private knownSuperClass({ superClass }: ClassNode): ClassInfo | null | undefined {
    if (!superClass) return null

    return superClass.type === 'Identifier' ? this.classNamed(superClass.name) : undefined
  }

  // The class a name refers to, when it is a class declaration the compiler knows.
  private classNamed(name: string): ClassInfo | undefined {
    const resolution = this.scope.resolve(name)

    return resolution.where === 'global' ? undefined : this.classInfos.get(resolution.binding)
  }

  private classTemplate(node: ClassNode, info: ClassInfo): ClassTemplate {
    this.enclosingClasses.push(info)

    try {
      return this.classBody(node, info)
    } finally {
      this.enclosingClasses.pop()
    }
  }

  private classBody(node: ClassNode, info: ClassInfo): ClassTemplate {
    const members = node.body.body
    const memberRefs: ClassMemberRef[] = []
    const context = (isStatic: boolean): ClassContext => ({ info, isStatic, memberRefs })
    const methods = members.filter((m): m is MethodDefinition => m.type === 'MethodDefinition')
    const fields = members.filter((m): m is PropertyDefinition => m.type === 'PropertyDefinition')
    const constructorNode = methods.find(method => method.kind === 'constructor')

    return {
      name: info.name,
      hasSuper: node.superClass !== null,
      constructor: constructorNode ? this.constructorProto(constructorNode, node.superClass !== null, context(false)) : null,
      instanceFieldInit: this.initializerProto(fields.filter(f => !f.static), 'fieldInit', context(false)),
      staticInit: this.initializerProto(fields.filter(f => f.static), 'staticInit', context(true)),
      isFinal: node.final,
      methods: methods.filter(m => m.kind !== 'constructor').map(method => this.methodTemplate(method, context(method.static))),
      memberRefs,
      fields: fields.map(fieldTemplate),
      interfaceCount: 0,
      implicitNames: [],
      bindsName: node.id !== null,
    }
  }

  private constructorProto(node: MethodDefinition, derived: boolean, classContext: ClassContext): FunctionProto {
    const kind = derived ? 'derivedConstructor' : 'constructor'

    return this.functionProto(node.value, classContext.info.name, kind, { classContext, isConstructor: true, superCall: derived })
  }

  private methodTemplate(node: MethodDefinition, classContext: ClassContext): ClassMethodTemplate {
    const key = keyName(node.key)
    const kind = node.kind as ClassMethodTemplate['kind']
    const proto = this.functionProto(node.value, key, PROTO_KINDS[kind], { classContext })

    return {
      key,
      kind,
      access: node.access,
      isStatic: node.static,
      protoIndex: this.out.constant(proto),
      override: node.override,
      final: node.final,
      loc: node.loc,
    }
  }

  // Field initialisers run with `this` = the instance (or the class for statics): THIS <value> DEFINE_PROP k POP …
  private initializerProto(fields: PropertyDefinition[], kind: FunctionKind, classContext: ClassContext): FunctionProto | null {
    if (fields.length === 0) return null

    const outer = this.fn

    this.fn = this.functionContext(new ProtoBuilder({ name: '<initializer>', kind }), false, { classContext })

    try {
      for (const field of fields) this.fieldInitializer(field)
      this.out.emit(Op.NULL)
      this.out.emit(Op.RETURN)
      this.out.scopeSize = this.scope.bindings.size

      return this.out.build()
    } finally {
      this.fn = outer
    }
  }

  // Private fields are stored under the class's private key: SET_PROP_PRIV 0 k.
  private fieldInitializer({ key, value, loc, access }: PropertyDefinition) {
    const name = keyName(key)

    this.out.emit(Op.THIS)

    if (value) this.namedExpression(value, name)
    else this.out.emit(Op.NULL) // fields without initialiser start as null (D37)
    if (access === 'private') this.emitAt(loc, Op.SET_PROP_PRIV, 0, this.out.constant(name))
    else this.emitAt(loc, Op.DEFINE_PROP, this.out.constant(name))
    this.out.emit(Op.POP)
  }

  // How many classes out from the home class the innermost class declaring `name` private is, or -1 (§5.4).
  private privateDepth(name: string): number {
    const index = this.enclosingClasses.findLastIndex(info => info.privates.has(name))

    return index < 0 ? -1 : this.enclosingClasses.length - 1 - index
  }

  // GET_PROP k, or GET_PROP_PRIV depth k when an enclosing class declares `name` private (K16).
  private emitGetProp(loc: SourceLocation, name: string) {
    this.emitProp(loc, name, Op.GET_PROP, Op.GET_PROP_PRIV)
  }

  private emitSetProp(loc: SourceLocation, name: string) {
    this.emitProp(loc, name, Op.SET_PROP, Op.SET_PROP_PRIV)
  }

  private emitProp(loc: SourceLocation, name: string, op: Op, privateOp: Op) {
    const depth = this.privateDepth(name)
    const k = this.out.constant(name)

    if (depth < 0) this.emitAt(loc, op, k)
    else this.emitAt(loc, privateOp, depth, k)
  }

  // `this.x` / `C.x` with a name the class chain does not declare (D36): SyntaxError when the chain is
  // visible, otherwise recorded for the CLASS instruction (this.x only).
  private checkMember({ object, property, computed, loc }: MemberExpression, use: ClassMemberRef['kind']) {
    if (computed) return

    const { name } = property as Identifier

    if (object.type === 'ThisExpression') this.checkThisMember(name, use, loc)
    else if (object.type === 'Identifier') this.checkStaticMember(object.name, name, loc)
  }

  private checkThisMember(name: string, kind: ClassMemberRef['kind'], loc: SourceLocation) {
    const context = this.fn.classContext
    if (!context || hasMember(context.info, name, context.isStatic)) return
    if (context.info.visible) throw this.error(`Class '${context.info.name}' has no member '${name}'`, loc)
    context.memberRefs.push({ name, isStatic: context.isStatic, kind, loc })
  }

  private checkStaticMember(className: string, name: string, loc: SourceLocation) {
    const info = this.classNamed(className)

    if (info?.visible && !hasMember(info, name, true)) throw this.error(`Class '${info.name}' has no member '${name}'`, loc)
  }

  // `super(...)` in a derived constructor (or an arrow inside one): SUPER_CALL argc → this.
  private superCall(node: CallExpression) {
    if (!this.fn.superCall) throw this.error("'super' keyword unexpected here", node.callee.loc)
    for (const argument of node.arguments) this.expression(argument)
    this.emitAt(node.loc, Op.SUPER_CALL, node.arguments.length)
  }

  private requireSuperProperty(loc: SourceLocation) {
    if (!this.fn.classContext) throw this.error("'super' keyword unexpected here", loc)
  }

  // `super.x` / `super[k]`: read-only lookups on the superclass (GET_SUPER / GET_SUPER_INDEX).
  private superReference(target: MemberExpression): Reference {
    this.requireSuperProperty(target.loc)

    return {
      baseSize: 0,
      prepare: () => {},
      get: () => this.superGet(target),
      set: () => {
        throw this.error("Assignment to 'super' properties is not supported", target.loc)
      },
    }
  }

  private superGet({ property, computed, loc }: MemberExpression) {
    if (!computed) {
      this.emitAt(loc, Op.GET_SUPER, this.out.constant((property as Identifier).name))

      return
    }
    this.expression(property)
    this.emitAt(loc, Op.GET_SUPER_INDEX)
  }

  // `super.m(x)` → THIS GET_SUPER m <x> CALL_METHOD 1 (§5.5).
  private superMethodCallee(callee: MemberExpression) {
    this.requireSuperProperty(callee.loc)
    this.out.emit(Op.THIS)
    this.superGet(callee)
  }

  // ---------------------------------------------------------------------------
  // Exceptions (§4.4.9, §5.6.5)

  throwStatement(node: ThrowStatement) {
    this.expression(node.argument)
    this.emitAt(node.loc, Op.THROW)
  }

  tryStatement(node: TryStatement) {
    this.resetCompletion()

    if (node.finalizer) this.tryFinally(node, node.finalizer)
    else this.tryCatch(node.block, node.handler as CatchClause)
  }

  // TRY catch -1; <block>; END_TRY; JUMP end; catch: <bind exception> <catch block>; end:
  private tryCatch(block: BlockStatement, handler: CatchClause) {
    const tryAt = this.out.emit(Op.TRY, -1, -1)

    this.inRegion({ finalizer: null, scope: this.scope }, () => this.block(block))
    this.out.emit(Op.END_TRY)
    const end = this.out.emitJump(Op.JUMP)

    this.out.patch(tryAt + 1)
    this.catchClause(handler)
    this.out.patch(end)
  }

  // TRY -1 finally; <block or try-catch>; END_TRY; ENTER_FINALLY; finally: <finally block> END_FINALLY
  private tryFinally(node: TryStatement, finalizer: BlockStatement) {
    const tryAt = this.out.emit(Op.TRY, -1, -1)
    const { handler } = node

    this.inRegion({ finalizer, scope: this.scope }, () => {
      if (handler) this.tryCatch(node.block, handler)
      else this.block(node.block)
    })
    this.out.emit(Op.END_TRY)
    this.out.emit(Op.ENTER_FINALLY)
    this.out.patch(tryAt + 2)
    this.fn.stackItems++ // the completion record
    this.finallyBlock(finalizer)
    this.fn.stackItems--
    this.out.emit(Op.END_FINALLY)
  }

  private inRegion(region: HandlerRegion, body: () => void) {
    this.fn.regions.push(region)
    body()
    this.fn.regions.pop()
  }

  // The exception is on the stack: bind it (in the catch block's scope) or drop it.
  private catchClause({ param, body }: CatchClause) {
    const outer = this.scope
    const scope = new Scope(outer, 'block')

    if (param) this.declareName(scope, param, 'let')
    this.declare(body.body, scope)
    this.enterScope(scope)

    if (param) this.initialize(param.name)
    else this.out.emit(Op.POP)
    this.hoistFunctions(body.body)
    this.statements(body.body)
    this.scope = outer

    if (scope.hasEnv) this.out.emit(Op.POP_ENV)
  }

  // A finally block does not change the completion value (§4.4.10): save it before, restore it after.
  private finallyBlock(block: BlockStatement) {
    if (!this.tracksCompletion) {
      this.block(block)

      return
    }
    this.out.emit(Op.LOAD, this.scope.envDepth, COMPLETION_SLOT)
    this.fn.stackItems++
    this.block(block)
    this.fn.stackItems--
    this.out.emit(Op.STORE, this.scope.envDepth, COMPLETION_SLOT)
    this.out.emit(Op.POP)
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
    else if (node.type === 'ArrowFunctionExpression') this.closure(this.functionProto(node, name))
    else if (node.type === 'ClassExpression') this.classExpression(node, name)
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

  // `a ||= b` assigns only when needed (§5.5).

  call(node: CallExpression) {
    const { callee } = node
    if (callee.type === 'Super') {
      this.superCall(node)

      return
    }
    this.checkArity(callee, node.arguments.length, node.loc)

    const isMethod = this.callee(callee)

    for (const argument of node.arguments) this.expression(argument)
    this.emitAt(node.loc, isMethod ? Op.CALL_METHOD : Op.CALL, node.arguments.length)
  }

  // Pushes the function (and, for `o.m()`, the receiver below it); returns whether it is a method call.
  private callee(callee: Expression): boolean {
    if (callee.type !== 'MemberExpression') {
      this.expression(callee)

      return false
    }
    this.methodCallee(callee)

    return true
  }

  // `o.m(x)` → <o> DUP GET_PROP m <x> CALL_METHOD 1: the receiver stays below the function (§5.5).
  private methodCallee(callee: MemberExpression) {
    const { object, property, computed, loc } = callee

    if (object.type === 'Super') {
      this.superMethodCallee(callee)

      return
    }
    this.checkMember(callee, 'call')
    this.expression(object)
    this.out.emit(Op.DUP)

    if (computed) {
      this.expression(property)
      this.emitAt(loc, Op.GET_INDEX)
    } else this.emitGetProp(loc, (property as Identifier).name)
  }

  member(node: MemberExpression) {
    const reference = this.reference(node)

    reference.prepare()
    reference.get()
  }

  // `a${x}b` → CONST 'a'; <x> TO_STRING; CONST 'b'; CONCAT 3 — empty text parts are skipped (§4.1.8).
  template(node: TemplateLiteral) {
    let parts = 0

    node.quasis.forEach((quasi, i) => {
      parts += this.templateText(quasi.value.cooked)

      if (i < node.expressions.length) parts += this.substitution(node.expressions[i])
    })

    if (parts === 0) this.out.emit(Op.CONST, this.out.constant(''))
    else if (parts > 1) this.out.emit(Op.CONCAT, parts)
  }

  private templateText(text: string): number {
    if (text === '') return 0
    this.out.emit(Op.CONST, this.out.constant(text))

    return 1
  }

  // ToString that calls toString() and never throws for being an object (unlike `+`, D5).
  private substitution(expression: Expression): number {
    this.expression(expression)
    this.emitAt(expression.loc, Op.TO_STRING)

    return 1
  }

  array(node: ArrayExpression) {
    for (const element of node.elements) this.expression(element)
    this.out.emit(Op.ARRAY, node.elements.length)
  }

  object(node: ObjectExpression) {
    this.out.emit(Op.OBJECT)

    for (const property of node.properties) this.property(property)
  }

  // `key: value` / `m() {}` → DEFINE_PROP; `get k() {}` / `set k(v) {}` → DEFINE_GETTER / DEFINE_SETTER (own accessors, R18).
  private property({ key, value, method, kind, loc }: Property) {
    const name = keyName(key as Identifier | Literal)

    if (kind !== 'init') this.closure(this.functionProto(value as FunctionExpression, name, PROTO_KINDS[kind]))
    else if (method) this.closure(this.functionProto(value as FunctionExpression, name, 'method'))
    else this.namedExpression(value, name)
    this.emitAt(loc, DEFINE_OPS[kind], this.out.constant(name))
  }

  // ---------------------------------------------------------------------------
  // Assignment targets

  // An assignment target: a name, `o.k` (the object stays on the stack) or `o[k]` (object and key stay).
  private reference(target: Identifier | MemberExpression, use: ClassMemberRef['kind'] = 'read'): Reference {
    return target.type === 'Identifier' ? this.nameReference(target) : this.memberReference(target, use)
  }

  private memberReference(target: MemberExpression, use: ClassMemberRef['kind']): Reference {
    if (target.object.type === 'Super') return this.superReference(target)
    this.checkMember(target, use)

    return target.computed ? this.indexReference(target, target.object) : this.propertyReference(target, target.object)
  }

  private nameReference({ name, loc }: Identifier): Reference {
    return { baseSize: 0, prepare: () => {}, get: () => this.load(name, loc), set: () => this.store(name, loc) }
  }

  private propertyReference({ property, loc }: MemberExpression, object: Expression): Reference {
    const { name } = property as Identifier

    return {
      baseSize: 1,
      prepare: () => this.expression(object),
      get: () => this.emitGetProp(loc, name),
      set: () => this.emitSetProp(loc, name),
    }
  }

  private indexReference({ property, loc }: MemberExpression, object: Expression): Reference {
    return {
      baseSize: 2,
      prepare: () => {
        this.expression(object)
        this.expression(property)
      },
      get: () => this.emitAt(loc, Op.GET_INDEX),
      set: () => this.emitAt(loc, Op.SET_INDEX),
    }
  }

  private emitAt(loc: SourceLocation, op: Op, ...operands: number[]) {
    this.out.mark(loc)
    this.out.emit(op, ...operands)
  }

  // Duplicates the target's base values so that reading the target keeps them for the write.
  private dupBase({ baseSize }: Reference) {
    if (baseSize > 0) this.out.emit(DUPLICATE_BASE[baseSize])
  }

  assignment(node: AssignmentExpression) {
    const { left, right, operator } = node
    const reference = this.reference(left, 'write')
    const base = operator.slice(0, -1)

    if (base in LOGICAL_JUMPS) this.logicalAssignment(reference, right, LOGICAL_JUMPS[base])
    else this.plainAssignment(node, reference)
  }

  private plainAssignment({ left, right, operator, loc }: AssignmentExpression, reference: Reference) {
    reference.prepare()

    if (operator === '=') this.namedExpression(right, left.type === 'Identifier' ? left.name : '')
    else this.compoundValue(reference, right, ARITHMETIC_OPS[operator.slice(0, -1)] as Op, loc)
    reference.set()
  }

  private compoundValue(reference: Reference, right: Expression, op: Op, loc: SourceLocation) {
    this.dupBase(reference)
    reference.get()
    this.expression(right)
    this.emitAt(loc, op)
  }

  // `a ||= b` assigns only when needed (§5.5); when it does not, the target's base values are dropped.
  private logicalAssignment(reference: Reference, right: Expression, jump: Op) {
    reference.prepare()
    this.dupBase(reference)
    reference.get()
    const skip = this.out.emitJump(jump)

    this.expression(right)
    reference.set()

    if (reference.baseSize === 0) {
      this.out.patch(skip)

      return
    }
    const end = this.out.emitJump(Op.JUMP)

    this.out.patch(skip)

    for (const op of DROP_BASE[reference.baseSize]) this.out.emit(op)
    this.out.patch(end)
  }

  // `++x`: <target> POS INC <set>; `x++` additionally keeps the old number below the base (DUP, ROT3/ROT4).
  update(node: UpdateExpression) {
    const reference = this.reference(node.argument, 'write')
    const step = node.operator === '++' ? Op.INC : Op.DEC

    reference.prepare()
    this.dupBase(reference)
    reference.get()
    this.emitAt(node.loc, Op.POS)

    if (node.prefix) this.out.emit(step)
    else this.keepOldValue(reference, step)
    reference.set()

    if (!node.prefix) this.out.emit(Op.POP)
  }

  private keepOldValue({ baseSize }: Reference, step: Op) {
    this.out.emit(Op.DUP)

    if (baseSize > 0) this.out.emit(ROTATE_BELOW_BASE[baseSize])
    this.out.emit(step)
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

  // The value is computed first, then enclosing finally blocks run (inlined), then RETURN (§4.4.9).
  returnStatement(node: ReturnStatement) {
    if (this.tracksCompletion) throw this.error('Illegal return statement', node.loc)
    this.returnValue(node)
    this.fn.stackItems++
    this.leaveRegions(0)
    this.fn.stackItems--
    this.out.emit(Op.RETURN)
  }

  // The returned value: the argument, null for a bare return (D37), `this` in constructors (which cannot return a value, D27).
  private returnValue({ argument, loc }: ReturnStatement) {
    if (!argument) {
      this.out.emit(this.fn.isConstructor ? Op.THIS : Op.NULL)

      return
    }
    if (this.fn.isConstructor) throw this.error('Constructors cannot return a value', loc)
    this.expression(argument)
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

  // `this` is dynamic in functions and lexical in arrows (§4.4.5).
  thisExpression(node: ThisExpression) {
    markArrowsUsingThis(this.fn)
    this.emitAt(node.loc, Op.THIS)
  }

  closure(proto: FunctionProto) {
    this.out.emit(Op.CLOSURE, this.out.constant(proto))
  }

  functionProto(node: AnyFunction, name: string, kind?: FunctionKind, options: FunctionOptions = {}): FunctionProto {
    const outer = this.fn
    const isArrow = node.type === 'ArrowFunctionExpression'

    this.fn = this.functionContext(new ProtoBuilder({ name, kind: kind ?? (isArrow ? 'arrow' : 'function') }), isArrow, options)

    try {
      return this.functionBody(node, signatureOf(name, node.params))
    } finally {
      this.fn = outer
    }
  }

  // Arrows keep the class context and `super(...)` permission of their surroundings (lexical `this`/`super`).
  private functionContext(out: ProtoBuilder, isArrow: boolean, options: FunctionOptions): FunctionContext {
    const outer = this.fn
    const inherited = isArrow ? { classContext: outer.classContext, superCall: outer.superCall } : {}

    return {
      out,
      scope: new Scope(outer.scope, 'function'),
      loops: [],
      tracksCompletion: false,
      parent: outer,
      isArrow,
      usesThis: false,
      regions: [],
      stackItems: 0,
      classContext: null,
      isConstructor: false,
      superCall: false,
      ...inherited,
      ...options,
    }
  }

  // Function env layout: parameters (rest last), then the body's top-level declarations.
  private functionBody({ params, body }: AnyFunction, signature: Signature): FunctionProto {
    for (const param of params) this.declareName(this.scope, paramName(param), 'let')
    this.defaults(params)

    if (body.type === 'BlockStatement') this.blockBody(body)
    else this.expressionBody(body)
    this.out.scopeSize = this.scope.bindings.size

    const { text, required, optional, hasRest } = signature
    const proto = this.out.build()

    return { ...proto, paramCount: required + optional, length: required, hasRest, signature: text, usesThis: this.fn.usesThis }
  }

  private blockBody({ body }: BlockStatement) {
    this.declare(body, this.scope)
    this.hoistFunctions(body)
    this.statements(body)
    this.out.emit(this.fn.isConstructor ? Op.THIS : Op.NULL) // falling off the end returns null (D37); constructors `this`
    this.out.emit(Op.RETURN)
  }

  // `x => expr`: the expression is the result.
  private expressionBody(body: Expression) {
    this.expression(body)
    this.out.emit(Op.RETURN)
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

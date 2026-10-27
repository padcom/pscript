// Single-pass compiler from AST to bytecode (§5.5).
import { PScriptSyntaxError, formatExcerpt } from '@/errors'
import type {
  ArrayExpression,
  ArrayPattern,
  ArrowFunctionExpression,
  AssignmentExpression,
  AssignmentPattern,
  AssignmentProperty,
  BinaryExpression,
  BindingPattern,
  BlockStatement,
  BreakStatement,
  CatchClause,
  ClassDeclaration,
  ClassExpression,
  CallExpression,
  ConditionalExpression,
  ContinueStatement,
  DoWhileStatement,
  Expression,
  ForOfStatement,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  ExportNamedDeclaration,
  Identifier,
  ModuleDeclaration,
  ImportDeclaration,
  InterfaceDeclaration,
  IfStatement,
  Literal,
  LogicalExpression,
  MemberExpression,
  MethodDefinition,
  NewExpression,
  Node,
  ObjectExpression,
  ObjectPattern,
  Pattern,
  PatternElement,
  PatternTarget,
  Program,
  Property,
  PropertyDefinition,
  RestElement,
  ReturnStatement,
  SourceLocation,
  Statement,
  SwitchCase,
  SwitchStatement,
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
import { stdlibGlobalNames } from '@/stdlib'
import { canFold, createsClosure } from './closures'
import { classInfoOf, hasMember, keyName, type ClassInfo } from './class-info'
import { ambiguityMessage, implicitIndex, memberCandidate, outerDescription, type ClassRecord } from './implicit-names'
import { interfaceTemplate } from './interfaces'
import { ModuleTables } from './module-tables'
import type { CompiledModule, HoistedFunction } from '@/modules/module-record'
import type {
  ClassFieldTemplate,
  ClassMemberRef,
  ClassMethodTemplate,
  ClassTemplate,
  CompiledScript,
  FunctionKind,
  FunctionProto,
  ImplicitName,
} from './function-proto'
import { GlobalFlags, Op } from './opcodes'
import { ProtoBuilder } from './proto-builder'
import { Scope, type Binding, type BindingKind, type Resolution } from './scope'
import { arityError, namedArgumentError, signatureOf, type Signature } from './signature'
import { boundNames } from '@/parser/patterns'

/**
 * Options of `compile()`.
 */
export interface CompileOptions {
  /** file name used in error messages */
  fileName?: string
}

// The target of a parameter: its name, or the pattern that destructures it (D40).
function paramTarget(param: Pattern): PatternTarget {
  if (param.type === 'RestElement') return param.argument

  return param.type === 'AssignmentPattern' ? param.left : param
}

// A parameter's slot: the parameter's name, or a hidden name holding the argument a pattern destructures (D40).
function paramSlot(param: Pattern, index: number): Identifier {
  const target = paramTarget(param)

  return target.type === 'Identifier' ? target : { type: 'Identifier', name: `%param${index}`, loc: param.loc }
}

// The strict named-parameter check of an object pattern (D40): the keys it accepts and the path of nested patterns.
function strictKeys(node: ObjectPattern, path: string): string | null {
  if (node.properties.some(property => property.type === 'RestElement')) return null

  return JSON.stringify({ keys: node.properties.map(property => keyName((property as AssignmentProperty).key)), path })
}

function fieldTemplate({ key, access, static: isStatic, override, final, loc }: PropertyDefinition): ClassFieldTemplate {
  return { key: keyName(key), access, isStatic, override, final, loc }
}

function isFunction(node: Expression | null): node is FunctionExpression | ArrowFunctionExpression {
  return node?.type === 'FunctionExpression' || node?.type === 'ArrowFunctionExpression'
}

// A `const` bound directly to a function expression has a compile-time signature (D38).
function constSignature(kind: BindingKind, id: BindingPattern, init: Expression | null): Signature | undefined {
  return kind === 'const' && id.type === 'Identifier' && isFunction(init) ? signatureOf(id.name, init.params) : undefined
}

type AnyFunction = FunctionNode | ArrowFunctionExpression

type ClassNode = ClassDeclaration | ClassExpression

// Where a bare name that is not a member is found: an enclosing environment, a module import, or by name (script
// bindings, globals).
function outerKind(resolution: Resolution): ImplicitName['outer'] {
  if (resolution.where !== 'lexical') return 'global'

  return resolution.binding.kind === 'import' ? 'import' : 'lexical'
}

// The fallback operands of LOAD/STORE/CALL_IMPLICIT: `depth slot`, `i 0` (import) or `k 0` (by name).
function fallbackOperands(resolution: Resolution, constant: (name: string) => number, name: string): number[] {
  if (resolution.where !== 'lexical') return [constant(name), 0]

  const { importIndex } = resolution.binding

  return importIndex === undefined ? [resolution.depth, resolution.slot] : [importIndex, 0]
}

/** Statements and, at the top level of modules, import/export declarations. */
type TopLevel = Statement | ModuleDeclaration

// A top-level statement, or the declaration an `export` wraps.
function exportedDeclaration(node: TopLevel): TopLevel | null {
  return node.type === 'ExportNamedDeclaration' ? node.declaration : node
}

// The names an exported declaration binds.
function declaredNames(declaration: NonNullable<ExportNamedDeclaration['declaration']>): Identifier[] {
  if (declaration.type !== 'VariableDeclaration') return [declaration.id]

  return declaration.declarations.flatMap(({ id }) => boundNames(id))
}

function bindingOf(resolution: Resolution): Binding | undefined {
  return resolution.where === 'global' ? undefined : resolution.binding
}

/** Statements that declare bindings with a TDZ. */
const LEXICAL_DECLARATIONS = new Set<Statement['type']>(['VariableDeclaration', 'ClassDeclaration', 'InterfaceDeclaration'])

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
  'void': Op.POP, // followed by UNDEFINED
  'delete': Op.DELETE_PROP, // see deleteExpression
}

/** Unary operators with their own code; a handler returns false to fall back to the plain form. */
const SPECIAL_UNARY: Partial<Record<UnaryExpression['operator'], (c: Compiler, node: UnaryExpression) => boolean>> = {
  typeof: (c, node) => c.typeofGlobal(node),
  delete: (c, node) => {
    c.deleteExpression(node.argument as MemberExpression, node.loc)

    return true
  },
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

/** Binding a pattern: declarations and parameters initialise bindings, assignments store. */
type BindMode = 'init' | 'assign'

type PatternHandler<T> = (c: Compiler, node: T, mode: BindMode, named: string | null) => void

type PatternPart = PatternElement | RestElement

const PATTERN_TARGETS: { [K in PatternPart['type']]: PatternHandler<Extract<PatternPart, { type: K }>> } = {
  Identifier: (c, node, mode) => c.bindName(node, mode),
  MemberExpression: (c, node) => c.bindMember(node),
  AssignmentPattern: (c, node, mode, named) => c.bindDefault(node, mode, named),
  ObjectPattern: (c, node, mode, named) => c.bindObject(node, mode, named),
  ArrayPattern: (c, node, mode, named) => c.bindArray(node, mode, named),
  RestElement: (c, node, mode) => c.bindName(node.argument, mode),
}

/** Proto kinds of class members and object-literal accessors. */
const PROTO_KINDS: Record<string, FunctionKind> = { method: 'method', get: 'getter', set: 'setter' }

const DEFINE_OPS: Record<Property['kind'], Op> = { init: Op.DEFINE_PROP, get: Op.DEFINE_GETTER, set: Op.DEFINE_SETTER }

/** Indexed by `Reference.baseSize` (1 or 2). */
const DUPLICATE_BASE: Record<number, Op> = { 1: Op.DUP, 2: Op.DUP2 }
const ROTATE_BELOW_BASE: Record<number, Op> = { 1: Op.ROT3, 2: Op.ROT4 }
const DROP_BASE: Record<number, Op[]> = { 1: [Op.SWAP, Op.POP], 2: [Op.ROT3, Op.POP, Op.POP] }

const STATEMENTS: { [K in TopLevel['type']]?: Handler<Extract<TopLevel, { type: K }>> } = {
  ExpressionStatement: (c, node) => c.expressionStatement(node.expression),
  VariableDeclaration: (c, node) => c.variableDeclaration(node),
  BlockStatement: (c, node) => c.block(node),
  IfStatement: (c, node) => c.ifStatement(node),
  WhileStatement: (c, node) => c.whileStatement(node),
  DoWhileStatement: (c, node) => c.doWhileStatement(node),
  SwitchStatement: (c, node) => c.switchStatement(node),
  ForStatement: (c, node) => c.forStatement(node),
  ForOfStatement: (c, node) => c.forOfStatement(node),
  BreakStatement: (c, node) => c.jump(node, 'breaks'),
  ContinueStatement: (c, node) => c.jump(node, 'continues'),
  ReturnStatement: (c, node) => c.returnStatement(node),
  ClassDeclaration: (c, node) => c.classDeclaration(node),
  InterfaceDeclaration: (c, node) => c.interfaceDeclaration(node),
  ThrowStatement: (c, node) => c.throwStatement(node),
  TryStatement: (c, node) => c.tryStatement(node),
  FunctionDeclaration: () => {}, // hoisted to the start of its scope
  ImportDeclaration: () => {}, // bindings are created when the module is linked
  ExportNamedDeclaration: (c, node) => c.exportDeclaration(node),
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
  /** a `switch`: `break` leaves it, `continue` belongs to an enclosing loop */
  isSwitch: boolean
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

/** Pre-scan (§5.5): the lexical declarations of a statement list. Classes are constant bindings, interfaces `let` (§4.5.7). */
const DECLARATIONS: Partial<Record<TopLevel['type'], (c: Compiler, node: any, scope: Scope) => void>> = {
  VariableDeclaration: (c, node, scope) => c.declareVariables(node, scope),
  FunctionDeclaration: (c, node, scope) => c.declareFunction(node, scope),
  ClassDeclaration: (c, node: ClassDeclaration, scope) => c.declareName(scope, node.id, 'const'),
  InterfaceDeclaration: (c, node: InterfaceDeclaration, scope) => c.declareName(scope, node.id, 'let'),
  ImportDeclaration: (c, node: ImportDeclaration, scope) => c.declareImports(node, scope),
  ExportNamedDeclaration: (c, node: ExportNamedDeclaration, scope) => c.declareExport(node, scope),
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

  /** classes whose bodies lexically enclose the code being compiled, innermost last (§4.5.3, §4.5.8) */
  private enclosingClasses: ClassRecord[] = []

  constructor(private source: string | undefined, private fileName: string | undefined, goal: 'script' | 'module' = 'script') {
    if (goal === 'module') {
      const out = new ProtoBuilder({ name: '', kind: 'module' })

      this.fn = { ...this.fn, out, scope: new Scope(null, 'function'), tracksCompletion: false }
    }
  }

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
    out.emit(Op.UNDEFINED)
    out.emit(Op.INIT, 0, COMPLETION_SLOT)
    this.hoistFunctions(body)
    this.statements(body)
    out.emit(Op.LOAD, 0, COMPLETION_SLOT)
    out.emit(Op.HALT)
    out.scopeSize = this.scope.slotCount

    return { main: out.build(), source: this.source, fileName: this.fileName }
  }

  // Module goal (§5.5): top-level bindings live in the module's top environment; imports are read through cells;
  // function declarations are initialised when the module is linked (hoistedFunctions), not by the body.
  module(program: Program, id: string): CompiledModule {
    const { out } = this
    const body = program.body as TopLevel[]

    this.moduleTables = new ModuleTables((reason, loc) => this.error(reason, loc))
    this.declare(body as Statement[], this.scope)

    const hoistedFunctions = this.moduleFunctions(body)

    this.statements(body as Statement[])
    this.exportLists(body)
    out.emit(Op.UNDEFINED)
    out.emit(Op.HALT)
    out.scopeSize = this.scope.slotCount

    const { requests, imports, localExports, indirectExports } = this.moduleTables

    return { id, main: out.build(), requests, imports, localExports, indirectExports, hoistedFunctions, source: this.source }
  }

  private moduleTables: ModuleTables | null = null

  private moduleFunctions(body: TopLevel[]): HoistedFunction[] {
    return body.map(exportedDeclaration).filter(node => node?.type === 'FunctionDeclaration').map(node => {
      const { id } = node as FunctionDeclaration
      const proto = this.out.constant(this.functionProto(node as FunctionDeclaration, id.name))

      return { slot: (this.scope.bindings.get(id.name) as Binding).slot, proto }
    })
  }

  declareImports(node: ImportDeclaration, scope: Scope) {
    const tables = this.moduleTables as ModuleTables
    const first = tables.imports.length

    tables.addImports(node).forEach(({ localName }, i) => {
      const binding = scope.declare(localName, 'import')
      if (!binding) throw this.error(`Identifier '${localName}' has already been declared`, node.specifiers[i].local.loc)
      binding.importIndex = first + i
    })
  }

  declareExport(node: ExportNamedDeclaration, scope: Scope) {
    if (node.declaration) DECLARATIONS[node.declaration.type]?.(this, node.declaration, scope)
  }

  exportDeclaration({ declaration }: ExportNamedDeclaration) {
    if (declaration && declaration.type !== 'FunctionDeclaration') this.statement(declaration)
  }

  // Export tables are built once every top-level binding is known (`export { a }` may precede `let a`).
  private exportLists(body: TopLevel[]) {
    const tables = this.moduleTables as ModuleTables
    const lookup = (name: string) => this.scope.bindings.get(name)

    for (const node of body) {
      if (node.type === 'ExportNamedDeclaration') this.exportEntries(tables, node, lookup)
    }
  }

  private exportEntries(tables: ModuleTables, node: ExportNamedDeclaration, lookup: (name: string) => Binding | undefined) {
    const { declaration } = node

    if (node.source) tables.addReexports(node)
    else if (declaration) declaredNames(declaration).forEach(id => tables.addLocal(id.name, lookup(id.name) as Binding, id.loc))
    else tables.addList(node.specifiers, lookup)
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
    for (const { id, init } of node.declarations) {
      const signature = constSignature(node.kind, id, init)

      for (const name of boundNames(id)) this.declareName(scope, name, node.kind, signature)
    }
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

    if (this.implicit(Op.LOAD_IMPLICIT, name, loc)) return

    if (resolution.where === 'lexical') this.loadLexical(name, resolution)
    else this.out.emit(Op.LOAD_GLOBAL, this.out.constant(name))
  }

  // Imports are live views of the exporter's binding: LOAD_IMPORT i (§5.6.8).
  private loadLexical(name: string, resolution: Extract<Resolution, { where: 'lexical' }>) {
    const { importIndex } = resolution.binding

    if (importIndex === undefined) this.lexical(Op.LOAD, name, resolution)
    else this.out.emit(Op.LOAD_IMPORT, importIndex)
  }

  private store(name: string, loc: SourceLocation) {
    const resolution = this.scope.resolve(name)
    if (resolution.where !== 'global') this.checkAssignable(resolution.binding, loc)

    this.out.mark(loc)

    if (this.implicit(Op.STORE_IMPLICIT, name, loc)) return

    if (resolution.where === 'lexical') this.lexical(Op.STORE, name, resolution)
    else this.out.emit(Op.STORE_GLOBAL, this.out.constant(name))
  }

  // A bare name in a class body that may be a member (§4.5.8): LOAD/STORE/CALL_IMPLICIT i [argc] fallbackA fallbackB.
  private implicit(op: Op, name: string, loc: SourceLocation, argc?: number): boolean {
    const index = this.implicitName(name, loc)
    if (index === null) return false

    const fallback = fallbackOperands(this.scope.resolve(name), value => this.out.constant(value), name)

    this.out.nameNext(name)
    this.out.emit(op, index, ...(argc === undefined ? [] : [argc]), ...fallback)

    return true
  }

  // The index of a bare name in the innermost class's implicit names, or null when it is a local binding or
  // provably not a member. Own member + outside definition is the strict rule's compile-time error.
  private implicitName(name: string, loc: SourceLocation): number | null {
    const record = this.enclosingClasses.at(-1)

    return record ? this.implicitIn(record, name, loc) : null
  }

  private implicitIn(record: ClassRecord, name: string, loc: SourceLocation): number | null {
    const outside = record.scope.resolve(name)
    if (bindingOf(this.scope.resolve(name)) !== bindingOf(outside)) return null

    const candidate = memberCandidate(record, name)
    if (candidate === 'none') return null
    if (candidate === 'own') this.checkUnambiguous(record, outside, name, loc)

    return implicitIndex(record, name, outerKind(outside), loc)
  }

  private checkUnambiguous(record: ClassRecord, outside: Resolution, name: string, loc: SourceLocation) {
    if (outside.where === 'global' && !stdlibGlobalNames().has(name)) return

    throw this.error(ambiguityMessage(record.info.name, name, outerDescription(bindingOf(outside))), loc)
  }

  private checkAssignable({ name, kind }: Binding, loc: SourceLocation) {
    if (kind === 'const') throw this.error(`Assignment to constant variable '${name}'`, loc)
    if (kind === 'import') throw this.error(`Cannot assign to import '${name}'`, loc)
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
    if (this.tracksCompletion) {
      this.expression(expression)
      this.expressionStatementTail()
    } else this.discard(expression)
  }

  // `if`, loops and `try` set the completion value to undefined on entry (§4.4.10).
  private resetCompletion() {
    if (!this.tracksCompletion) return
    this.out.emit(Op.UNDEFINED)
    this.expressionStatementTail()
  }

  private expressionStatementTail() {
    this.out.emit(Op.STORE, this.scope.envDepth, COMPLETION_SLOT)
    this.out.emitPop()
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

  // top: <body>; next: <test> JUMP_IF_TRUE top; break:
  doWhileStatement(node: DoWhileStatement) {
    this.resetCompletion()
    const top = this.out.code.length
    const loop = this.loopBody(node.body)

    this.patchAll(loop.continues)
    this.expression(node.test)
    this.out.patch(this.out.emitJump(Op.JUMP_IF_TRUE), top)
    this.patchAll(loop.breaks)
  }

  // <discriminant> [PUSH_ENV]; per case: DUP <test> EQ JUMP_IF_TRUE body_i; JUMP default|end;
  // body_0 … body_n (falling through); end (and break): [POP_ENV] POP. The clauses share one block scope (as in JS).
  switchStatement(node: SwitchStatement) {
    this.resetCompletion()
    this.expression(node.discriminant)
    this.fn.stackItems++ // the discriminant

    const outer = this.scope
    const statements = node.cases.flatMap(clause => clause.consequent)
    const scope = this.switchScope(node, statements)

    this.declare(statements, scope)
    this.enterScope(scope)
    this.hoistFunctions(statements)
    const bodies = node.cases.map(clause => this.caseTest(clause))
    const otherwise = this.out.emitJump(Op.JUMP)
    const loop = this.breakable(true, () => node.cases.forEach((clause, i) => this.caseBody(clause, bodies[i], otherwise)))

    if (!node.cases.some(clause => clause.test === null)) this.out.patch(otherwise)
    this.patchAll(loop.breaks)
    this.scope = outer

    if (scope.hasEnv) this.out.emit(Op.POP_ENV)
    this.fn.stackItems--
    this.out.emit(Op.POP)
  }

  // Jumping between clauses can skip a declaration, so a scope that declares anything keeps its own environment
  // (fresh TDZ slots each time the switch runs).
  private switchScope(node: SwitchStatement, statements: Statement[]): Scope {
    const scope = new Scope(this.scope, 'block')
    const declares = statements.some(({ type }) => LEXICAL_DECLARATIONS.has(type))

    if (!declares && canFold(node, statements)) scope.fold()

    return scope
  }

  // DUP <test> EQ JUMP_IF_TRUE → the clause's body (patched later); -1 for `default`.
  private caseTest({ test, loc }: SwitchCase): number {
    if (!test) return -1

    this.out.emit(Op.DUP)
    this.expression(test)
    this.out.mark(loc)
    this.out.emit(Op.EQ)

    return this.out.emitJump(Op.JUMP_IF_TRUE)
  }

  private caseBody({ test, consequent }: SwitchCase, jump: number, otherwise: number) {
    this.out.patch(test ? jump : otherwise)
    this.statements(consequent)
  }

  // for-let: init env → loop: test, body, COPY_ENV, update (§5.5).
  forStatement(node: ForStatement) {
    this.resetCompletion()
    const outer = this.scope
    const head = this.forHead(node)

    // a head with an environment has closures in the loop (else it is folded): each iteration gets a copy
    this.forLoop(node, head.hasEnv)
    this.scope = outer

    if (head.hasEnv) this.out.emit(Op.POP_ENV)
  }

  private forHead(node: ForStatement): Scope {
    const { init } = node
    const head = new Scope(this.scope, 'block')

    if (init?.type === 'VariableDeclaration') {
      if (canFold(node, [init])) head.fold()
      this.declareVariables(init, head)
    }
    this.enterScope(head)
    this.forInit(init)

    return head
  }

  // Makes `scope` current, with an environment when it declares something.
  private enterScope(scope: Scope) {
    // blocks folded into this one add slots later (K9)
    if (scope.hasEnv) this.out.defer(this.out.emit(Op.PUSH_ENV, 0) + 1, () => scope.slotCount)
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
    const iteration = this.bindIterationValue(node.left, node.body)

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

  // `let x` / `const { a }` get fresh bindings per iteration; other targets are assigned (D40).
  // The bindings are initialised before the body runs, so only a closure in the body needs a fresh environment.
  private bindIterationValue(left: ForOfStatement['left'], body: Statement): Scope {
    const scope = new Scope(this.scope, 'block')

    if (!createsClosure(body)) scope.fold()

    if (left.type !== 'VariableDeclaration') {
      this.bindTarget(left, 'assign', null)

      return scope
    }
    this.declareVariables(left, scope)
    this.enterScope(scope)
    this.bindTarget(left.declarations[0].id, 'init', null)

    return scope
  }

  private condition(test: Expression): number {
    this.expression(test)

    return this.out.emitJump(Op.JUMP_IF_FALSE)
  }

  private optionalDiscard(expression: Expression | null) {
    if (expression) this.discard(expression)
  }

  // An unused `x++` is compiled as `++x`, which does not keep the old value (or as one INCREMENT).
  private discard(expression: Expression) {
    if (expression.type === 'UpdateExpression' && this.incrementBinding(expression)) return

    this.expression(expression.type === 'UpdateExpression' ? { ...expression, prefix: true } : expression)
    this.out.emitPop()
  }

  // An unused `x++` / `x--` of a binding in an environment: INCREMENT depth slot ±1. Only the postfix form, which
  // starts where its binding does, so that errors keep the location LOAD and POS reported.
  private incrementBinding({ argument, operator, prefix, loc }: UpdateExpression): boolean {
    const target = prefix ? null : this.incrementTarget(argument)
    if (!target) return false

    this.checkAssignable(target.binding, argument.loc)
    this.out.mark(loc)
    this.out.nameNext(target.binding.name)
    this.out.emit(Op.INCREMENT, target.depth, target.slot, operator === '++' ? 1 : -1)

    return true
  }

  // A lexical binding that is not possibly a class member (§4.5.8); imports are rejected by checkAssignable.
  private incrementTarget(argument: UpdateExpression['argument']): Extract<Resolution, { where: 'lexical' }> | null {
    if (argument.type !== 'Identifier') return null

    const resolution = this.scope.resolve(argument.name)
    if (resolution.where !== 'lexical') return null

    return this.implicitName(argument.name, argument.loc) === null ? resolution : null
  }

  private loopBody(body: Statement): Loop {
    return this.breakable(false, () => this.statement(body))
  }

  private breakable(isSwitch: boolean, body: () => void): Loop {
    const { regions, stackItems } = this.fn
    const { envDepth } = this.scope
    const loop: Loop = { breaks: [], continues: [], envDepth, regionDepth: regions.length, stackItems, isSwitch }

    this.loops.push(loop)
    body()
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
    const loop = this.jumpTarget(list)
    if (!loop) throw this.error(`Illegal ${list === 'breaks' ? 'break' : 'continue'} statement`, node.loc)

    for (let n = this.fn.stackItems; n > loop.stackItems; n--) this.out.emit(Op.POP)

    const depth = this.leaveRegions(loop.regionDepth)

    this.popEnvs(depth, loop.envDepth)
    loop[list].push(this.out.emitJump(Op.JUMP))
  }

  private jumpTarget(list: 'breaks' | 'continues'): Loop | undefined {
    return list === 'breaks' ? this.loops.at(-1) : this.loops.findLast(({ isSwitch }) => !isSwitch)
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

  // <parent 1> … <parent n> INTERFACE k n, then the binding is initialised (TDZ until then, like `let`).
  interfaceDeclaration(node: InterfaceDeclaration) {
    for (const parent of node.extends) this.expression(parent)
    this.emitAt(node.loc, Op.INTERFACE, this.out.constant(interfaceTemplate(node)), node.extends.length)
    this.initialize(node.id.name)
  }

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

    this.classOperands(node)
    this.emitAt(node.loc, Op.CLASS, this.out.constant(template))

    if (!named) return
    this.scope = outer
    this.out.emit(Op.POP_ENV)
  }

  // CLASS takes the superclass (when there is one) and the `implements` values from the stack.
  private classOperands({ superClass, implements: interfaces }: ClassNode) {
    if (superClass) this.expression(superClass)
    for (const implemented of interfaces) this.expression(implemented)
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
    const record: ClassRecord = { info, scope: this.scope, isStatic: false, implicitNames: [] }

    this.enclosingClasses.push(record)

    try {
      return this.classBody(node, record)
    } finally {
      this.enclosingClasses.pop()
    }
  }

  private classBody(node: ClassNode, record: ClassRecord): ClassTemplate {
    const { info } = record
    const members = node.body.body
    const memberRefs: ClassMemberRef[] = []
    // Called right before each member is compiled: bare names in it are resolved in its (static) context.
    const context = (isStatic: boolean): ClassContext => {
      record.isStatic = isStatic

      return { info, isStatic, memberRefs }
    }
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
      interfaceCount: node.implements.length,
      implicitNames: record.implicitNames,
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
      this.out.scopeSize = this.scope.slotCount

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
    const index = this.enclosingClasses.findLastIndex(({ info }) => info.privates.has(name))

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
    const scope = this.blockScope(body, body.body)

    if (param) boundNames(param).forEach(name => this.declareName(scope, name, 'let'))
    this.declare(body.body, scope)
    this.enterScope(scope)

    if (param) this.bindTarget(param, 'init', null)
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
    this.out.emitPop()
  }

  variableDeclaration(node: VariableDeclaration) {
    for (const { id, init } of node.declarations) {
      if (init) this.namedExpression(init, id.type === 'Identifier' ? id.name : '')
      else this.out.emit(Op.NULL) // `let x` starts as null (D37)
      this.bindTarget(id, 'init', null)
    }
  }

  // `let f = function () {}` names the function `f`, as in JS.
  private namedExpression(node: Expression, name: string) {
    if (node.type === 'FunctionExpression') this.functionExpression(node, name)
    else if (node.type === 'ArrowFunctionExpression') this.closure(this.functionProto(node, name))
    else if (node.type === 'ClassExpression') this.classExpression(node, name)
    else this.expression(node)
  }

  // A block scope, folded into the enclosing environment when no one can tell (K9).
  private blockScope(node: Node, statements: Node[]): Scope {
    const scope = new Scope(this.scope, 'block')

    if (canFold(node, statements)) scope.fold()

    return scope
  }

  block(node: BlockStatement) {
    const outer = this.scope
    const scope = this.blockScope(node, node.body)

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
    const special = SPECIAL_UNARY[node.operator]

    if (special?.(this, node)) return
    this.expression(node.argument)
    this.out.mark(node.loc)
    this.out.emit(UNARY_OPS[node.operator])

    if (node.operator === 'void') this.out.emit(Op.UNDEFINED)
  }

  typeofGlobal({ argument }: UnaryExpression): boolean {
    if (!this.isGlobalName(argument)) return false
    this.out.emit(Op.TYPEOF_GLOBAL, this.out.constant(argument.name))

    return true
  }

  // `delete o.k` / `delete o[k]` (D41; the parser accepts only member expressions not on `super`).
  deleteExpression({ object, property, computed }: MemberExpression, loc: SourceLocation) {
    this.expression(object as Expression)

    if (computed) this.expression(property)
    this.out.mark(loc)

    if (computed) this.out.emit(Op.DELETE_INDEX)
    else this.out.emit(Op.DELETE_PROP, this.out.constant((property as Identifier).name))
  }

  // `typeof x` of a name that is not lexical must not throw when it is undeclared.
  // Bare names that may be class members follow the implicit resolution instead (§4.5.8).
  private isGlobalName(node: Expression): node is Identifier {
    if (node.type !== 'Identifier' || node.name === 'undefined') return false

    return this.scope.resolve(node.name).where !== 'lexical' && this.implicitName(node.name, node.loc) === null
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
    if (callee.type === 'Super') this.superCall(node)
    else if (!this.implicitCall(node)) this.plainCall(node)
  }

  private plainCall(node: CallExpression) {
    const callee = node.callee as Expression

    this.checkArity(callee, node.arguments, node.loc)

    const isMethod = this.callee(callee)

    for (const argument of node.arguments) this.expression(argument)
    this.emitAt(node.loc, isMethod ? Op.CALL_METHOD : Op.CALL, node.arguments.length)
  }

  // `m(x)` in a class body where `m` may be a member: <x> CALL_IMPLICIT i 1 fallback (§4.5.8).
  private implicitCall({ callee, arguments: args, loc }: CallExpression): boolean {
    if (callee.type !== 'Identifier' || this.implicitName(callee.name, callee.loc) === null) return false

    for (const argument of args) this.expression(argument)
    this.out.mark(loc)

    return this.implicit(Op.CALL_IMPLICIT, callee.name, callee.loc, args.length)
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
    if (left.type === 'ObjectPattern' || left.type === 'ArrayPattern') {
      this.patternAssignment(left, right)

      return
    }
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

  // `[a, b] = [b, a]`: the value of the assignment is the right side (D40).
  private patternAssignment(left: ObjectPattern | ArrayPattern, right: Expression) {
    this.expression(right)
    this.out.emit(Op.DUP)
    this.bindTarget(left, 'assign', null)
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
  // … and of the object literals passed to its named parameters (D40).
  private checkArity(callee: Expression, args: Expression[], loc: SourceLocation) {
    const signature = callee.type === 'Identifier' ? this.knownSignature(callee.name) : undefined

    if (signature) this.checkCall(signature, args, loc)
  }

  private checkCall(signature: Signature, args: Expression[], loc: SourceLocation) {
    const problem = arityError(signature, args.length)
    if (problem) throw this.error(problem, loc)

    const named = namedArgumentError(signature, args)
    if (named) throw this.error(named.reason, named.loc)
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
  // Names bound by parameter patterns come after the parameters (D40).
  private functionBody({ params, body }: AnyFunction, signature: Signature): FunctionProto {
    const slots = params.map(paramSlot)
    const patternNames = params.filter(param => paramTarget(param).type !== 'Identifier').flatMap(boundNames)

    for (const name of [...slots, ...patternNames]) this.declareName(this.scope, name, 'let')
    this.parameters(params, slots)

    if (body.type === 'BlockStatement') this.blockBody(body)
    else this.expressionBody(body)
    this.out.scopeSize = this.scope.slotCount

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

  // Default values are evaluated at call time, left to right, only for omitted arguments (D38); then the parameter's
  // pattern destructures it, so later defaults see the names it binds (D40).
  private parameters(params: Pattern[], slots: Identifier[]) {
    params.forEach((param, i) => {
      if (param.type === 'AssignmentPattern') this.defaultValue(param, slots[i])

      const target = paramTarget(param)

      if (target.type !== 'Identifier') {
        this.load(slots[i].name, param.loc)
        this.bindTarget(target, 'init', '')
      }
    })
  }

  private defaultValue({ left, right }: AssignmentPattern, slot: Identifier) {
    const resolution = this.scope.resolve(slot.name) as { slot: number }
    const skip = this.out.emit(Op.JUMP_IF_ARG, resolution.slot, -1) + 2

    this.namedExpression(right, left.type === 'Identifier' ? left.name : '')
    this.initialize(slot.name)
    this.out.patch(skip)
  }

  // ---------------------------------------------------------------------------
  // Patterns (D40, §4.4.14): the value is on the stack; binding it consumes it. `named` is the key path of a strict
  // named parameter ('' for a parameter, `pos.` inside its `pos` property), null where any keys are accepted.

  bindTarget(target: PatternElement | RestElement, mode: BindMode, named: string | null) {
    (PATTERN_TARGETS[target.type] as PatternHandler<typeof target>)(this, target, mode, named)
  }

  bindName({ name, loc }: Identifier, mode: BindMode) {
    if (mode === 'init') {
      this.initialize(name)

      return
    }
    this.store(name, loc)
    this.out.emitPop()
  }

  // `[o.x] = …`: the base goes below the value, then SET_PROP / SET_INDEX.
  bindMember(target: MemberExpression) {
    const reference = this.reference(target, 'write')

    reference.prepare()

    for (let i = 0; i < reference.baseSize; i++) this.out.emit(reference.baseSize === 1 ? Op.SWAP : Op.ROT3)
    reference.set()
    this.out.emitPop()
  }

  // A default applies when the value is undefined (a missing property or element).
  bindDefault({ left, right }: AssignmentPattern, mode: BindMode, named: string | null) {
    this.out.emit(Op.DUP)
    this.out.emit(Op.UNDEFINED)
    this.out.emit(Op.EQ)
    const skip = this.out.emitJump(Op.JUMP_IF_FALSE)

    this.out.emit(Op.POP)
    this.namedExpression(right, left.type === 'Identifier' ? left.name : '')
    this.out.patch(skip)
    this.bindTarget(left, mode, named)
  }

  bindObject(node: ObjectPattern, mode: BindMode, named: string | null) {
    const keys: string[] = []

    this.checkPattern(node, named)

    for (const property of node.properties) {
      if (property.type === 'RestElement') {
        this.emitAt(property.loc, Op.OBJECT_REST, this.out.constant(JSON.stringify(keys)))
        this.bindName(property.argument, mode)

        return
      }
      keys.push(this.bindProperty(property, mode, named))
    }
    this.out.emitPop()
  }

  private checkPattern(node: ObjectPattern, named: string | null) {
    const check = named === null ? null : strictKeys(node, named)

    this.emitAt(node.loc, Op.CHECK_PATTERN, check === null ? -1 : this.out.constant(check))
  }

  // DUP GET_PROP k <bind>: returns the key.
  private bindProperty({ key, value, loc }: AssignmentProperty, mode: BindMode, named: string | null): string {
    const name = keyName(key)

    this.out.emit(Op.DUP)
    this.emitGetProp(loc, name)
    this.bindTarget(value, mode, named === null ? null : `${named}${name}.`)

    return name
  }

  bindArray(node: ArrayPattern, mode: BindMode, named: string | null) {
    this.emitAt(node.loc, Op.GET_ITER)

    for (const [i, element] of node.elements.entries()) {
      if (element.type === 'RestElement') {
        this.out.emit(Op.ITER_REST)
        this.bindName(element.argument, mode)

        return
      }
      this.out.emit(Op.ITER_VALUE)
      this.bindTarget(element, mode, named === null ? null : `${named}${i}.`)
    }
    this.out.emitPop()
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
 * Compiles a module (§4.7, §5.5 "Module goal").
 *
 * @param source source text or a program parsed with the module goal
 * @param id the module id (also used as file name in errors)
 * @returns the compiled module
 */
export function compileModule(source: string | Program, id: string): CompiledModule {
  const program = typeof source === 'string' ? parse(source, { fileName: id, goal: 'module' }) : source
  const text = typeof source === 'string' ? source : undefined

  return new Compiler(text, id, 'module').module(program, id)
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

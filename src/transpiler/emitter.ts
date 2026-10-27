// AST → JavaScript printer of `psc` (§11.3, P2–P6). Statements and expressions become strings; the first line of a
// statement is not indented, its other lines carry their absolute indentation (so template literals spanning lines
// are never re-indented).
import { PScriptSyntaxError, formatExcerpt } from '@/errors'
import type {
  ArrayExpression,
  ArrowFunctionExpression,
  AssignmentExpression,
  AssignmentPattern,
  AssignmentProperty,
  BinaryExpression,
  BlockStatement,
  CallExpression,
  ClassDeclaration,
  ConditionalExpression,
  ExportNamedDeclaration,
  Expression,
  ForOfStatement,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  IfStatement,
  ImportDeclaration,
  InterfaceDeclaration,
  Literal,
  LogicalExpression,
  MemberExpression,
  MethodDefinition,
  ModuleDeclaration,
  NewExpression,
  Node,
  ObjectExpression,
  ObjectPattern,
  Pattern,
  PatternElement,
  Program,
  Property,
  PropertyDefinition,
  RestElement,
  ReturnStatement,
  SourceLocation,
  Statement,
  Super,
  TemplateLiteral,
  TryStatement,
  UnaryExpression,
  UpdateExpression,
  VariableDeclaration,
  WhileStatement,
} from '@/parser/ast'
import { classInfoOf, keyName, type ClassInfo } from '@/compiler/class-info'
import { ambiguityMessage, memberCandidate, type MemberContext } from '@/compiler/implicit-names'
import { arityError, namedArgumentError, type Signature } from '@/compiler/signature'
import { boundNames } from '@/parser/patterns'
import { stdlibGlobalNames } from '@/stdlib'
import { declaringClass, inheritedHalves, privateKey, staticPrefix, uniquePrivateName, type ClassNode } from './classes'
import { Helpers } from './helpers'
import { exportList, importClause, isModuleDeclaration, sourceText } from './modules'
import { Precedence, binaryPrecedence, precedenceOf, startsAmbiguously } from './precedence'
import { MARK_START, marker, resolveMarks } from './source-map'

/** Names JavaScript's strict mode does not allow as bindings. */
const RESTRICTED_NAMES = new Set(['arguments', 'eval'])

/** PScript's strict equality (D1) is JavaScript's `===`. */
const OPERATORS: Partial<Record<string, string>> = { '==': '===', '!=': '!==' }

const INDENT = '  '

/** Expressions that start a mapping of the source map: where runtime errors and stack frames point. */
const MAPPED_EXPRESSIONS = new Set<Expression['type']>(['CallExpression', 'NewExpression', 'MemberExpression'])

/**
 * Names declared in a block or function, to tell local names from globals; class declarations carry what the
 * compiler knows about the class.
 */
class Names {
  readonly names = new Map<string, ClassInfo | undefined>()

  constructor(readonly parent: Names | null) {}

  /**
   * The scope that declares a name.
   *
   * @param name the name
   * @returns the innermost scope declaring it, or null for a global
   */
  find(name: string): Names | null {
    return this.names.has(name) ? this : this.parent?.find(name) ?? null
  }
}

/**
 * A class body being printed (§4.5.8): bare names in it may be members.
 */
interface ClassRecord extends MemberContext {
  /** the scope around the class body, where outside definitions are found */
  names: Names
  /** the JS private name of each private member (`#x`, or `#x$2` when an enclosing class has a private `x` too) */
  privates: Map<string, string>
}

/**
 * How `o.x` reaches a private member `x` (§4.5.3 step 1).
 */
interface PrivateAccess {
  /** JS private names to try, innermost class first */
  names: string[]
  /** `o` may be an instance of none of these classes: the public `o.x` is tried last (§4.5.3 step 2) */
  fallback: boolean
}

const PUBLIC: PrivateAccess = { names: [], fallback: false }

/** Adds the read, write, update or call around a member access target. */
type Render = (target: string) => string

/**
 * The function being printed: what `this` and a bare `return` mean in it.
 */
interface Frame {
  /** class members have the instance (or class) as `this`; plain functions have their own */
  kind: 'function' | 'arrow' | 'method' | 'constructor' | 'derivedConstructor' | 'field'
  /** a nested plain function uses an implicit member: the member keeps `this` in an alias */
  aliasUsed?: boolean
}

/** Frames whose `this` is the receiver of implicit members. */
const MEMBER_FRAMES = new Set<Frame['kind']>(['method', 'constructor', 'derivedConstructor', 'field'])

/** Members whose `this` cannot be aliased: field initialisers, and derived constructors before `super()`. */
const UNALIASED_FRAMES = new Set<Frame['kind']>(['field', 'derivedConstructor'])

/** A constructor's bare `return` returns the instance; a derived constructor must not return null. */
const CONSTRUCTOR_FRAMES = new Set<Frame['kind']>(['constructor', 'derivedConstructor'])

/**
 * What the other modules of a program say about an imported binding (P10).
 */
export interface Imported {
  /** the class, when the binding is a class the program defines */
  info?: ClassInfo
  /** the signature, when the binding is a top-level function (D38) */
  signature?: Signature
}

/**
 * The program a module is printed in (T4): psc compiles the modules of a program together.
 */
export interface ProgramContext {
  /**
   * What is known about an imported name, or about an export of an imported namespace.
   *
   * @param local the local name of the import
   * @param member the export name read from a namespace import
   * @returns what the program knows, or undefined
   */
  imported(local: string, member?: string): Imported | undefined
  /** the AST of every class printed so far, for inherited accessor halves */
  classNodes: Map<ClassInfo, ClassNode>
}

type Printer<T> = (emitter: Emitter, node: T) => string

const EXPRESSIONS: { [K in Expression['type']]?: Printer<Extract<Expression, { type: K }>> } = {
  Identifier: (e, node) => e.identifier(node),
  Literal: (_, node) => node.raw,
  TemplateLiteral: (e, node) => e.template(node),
  ArrayExpression: (e, node) => e.array(node),
  ObjectExpression: (e, node) => e.object(node),
  FunctionExpression: (e, node) => e.functionText(node),
  ArrowFunctionExpression: (e, node) => e.arrow(node),
  UnaryExpression: (e, node) => e.unary(node),
  UpdateExpression: (e, node) => e.update(node),
  BinaryExpression: (e, node) => e.binary(node),
  LogicalExpression: (e, node) => e.logical(node),
  AssignmentExpression: (e, node) => e.assignment(node),
  ConditionalExpression: (e, node) => e.conditional(node),
  CallExpression: (e, node) => e.call(node),
  NewExpression: (e, node) => e.newExpression(node),
  MemberExpression: (e, node) => e.member(node),
  ThisExpression: e => e.thisText(),
  ClassExpression: (e, node) => e.classText(node),
}

const STATEMENTS: { [K in Statement['type']]?: Printer<Extract<Statement, { type: K }>> } = {
  ExpressionStatement: (e, { expression }) => `${e.wrapAmbiguous(expression, Precedence.Lowest)};`,
  VariableDeclaration: (e, node) => `${e.declaration(node)};`,
  FunctionDeclaration: (e, node) => e.functionText(node),
  ReturnStatement: (e, node) => e.returnStatement(node),
  IfStatement: (e, node) => e.ifStatement(node),
  WhileStatement: (e, node) => e.whileStatement(node),
  ForStatement: (e, node) => e.forStatement(node),
  ForOfStatement: (e, node) => e.forOfStatement(node),
  BreakStatement: () => 'break;',
  ContinueStatement: () => 'continue;',
  ThrowStatement: (e, { argument }) => `throw ${e.expression(argument)};`,
  TryStatement: (e, node) => e.tryStatement(node),
  BlockStatement: (e, node) => e.block(node.body),
  EmptyStatement: () => '',
  ClassDeclaration: (e, node) => e.classText(node),
  InterfaceDeclaration: (e, node) => e.interfaceText(node),
}

function nameOf({ id }: ClassNode): string {
  return id?.name ?? ''
}

// Whether a classification of a bare name means a member; `unknown` (superclass not visible) is decided by the caller.
function isMemberCandidate(candidate: ReturnType<typeof memberCandidate>, unknownIsMember: boolean): boolean {
  return candidate === 'unknown' ? unknownIsMember : candidate !== 'none'
}

// How the strict rule's message names a global, or null when the name is not one psc knows.
function globalDescription(name: string): string | null {
  return stdlibGlobalNames().has(name) ? 'a global' : null
}

function isGlobalPrintAccess({ object, property, computed }: MemberExpression): boolean {
  return !computed && object.type === 'Identifier' && object.name === 'globalThis' && (property as Identifier).name === 'print'
}

const DECLARATIONS = new Set<Statement['type']>(['FunctionDeclaration', 'ClassDeclaration', 'InterfaceDeclaration'])

function declaredByStatement(statement: Statement): Identifier[] {
  if (statement.type === 'VariableDeclaration') return statement.declarations.flatMap(({ id }) => boundNames(id))

  const declaration = statement as FunctionDeclaration | ClassDeclaration | InterfaceDeclaration

  return DECLARATIONS.has(statement.type) ? [declaration.id] : []
}

// The names a statement declares in its block (function declarations are hoisted, `let`/`const` have a TDZ: either
// way a use anywhere in the block refers to them). Imports declare their local names.
function declaredBy(statement: Statement | ModuleDeclaration): Identifier[] {
  if (statement.type === 'ImportDeclaration') return statement.specifiers.map(({ local }) => local)
  if (statement.type === 'ExportNamedDeclaration') return statement.declaration ? declaredBy(statement.declaration) : []

  return declaredByStatement(statement)
}

function paramNames(params: Pattern[]): Identifier[] {
  return params.flatMap(boundNames)
}

type PatternPart = PatternElement | RestElement

/** Prints a part of a pattern; `binding`: the names are being declared (never implicit members). */
type PatternPrinter<T> = (emitter: Emitter, node: T, binding: boolean) => string

const PATTERNS: { [K in PatternPart['type']]: PatternPrinter<Extract<PatternPart, { type: K }>> } = {
  Identifier: (e, node, binding) => binding ? node.name : e.identifier(node),
  MemberExpression: (e, node) => e.member(node),
  AssignmentPattern: (e, node, binding) => `${e.patternDefault(node, binding)}`,
  ObjectPattern: (e, node, binding) => e.objectPattern(node, binding),
  ArrayPattern: (e, node, binding) => `[${node.elements.map(element => e.pattern(element, binding)).join(', ')}]`,
  RestElement: (e, node, binding) => `...${e.pattern(node.argument, binding)}`,
}

// The lowest precedences of a binary operator's operands. `**` is right-associative and JavaScript rejects a unary
// operand on its left (D15).
function operandPrecedences(operator: string): [Precedence, Precedence] {
  const precedence = binaryPrecedence(operator)

  return operator === '**' ? [Precedence.Postfix, precedence] : [precedence, precedence + 1]
}

// `new (f())()` needs parentheses around a callee that contains a call; `new a.b()` does not.
function containsCall(node: Expression | Super): boolean {
  if (node.type === 'CallExpression') return true

  return node.type === 'MemberExpression' && containsCall(node.object)
}

/**
 * Prints one program.
 */
export class Emitter {
  private depth = 0
  private names = new Names(null)
  private readonly helpers: Helpers
  /** printing a `for` initialiser, where a bare `in` would be read as `for…in` */
  private noIn = false
  /** enclosing class bodies, innermost last */
  private readonly classes: ClassRecord[] = []
  /** enclosing functions, innermost last */
  private readonly frames: Frame[] = []
  /** the name of the alias of `this` in members whose nested functions use implicit members */
  private thisAlias: string | null = null
  /** the AST of the classes the emitter knows, for inherited accessor halves */
  private readonly classNodes: Map<ClassInfo, ClassNode>
  /** the local names of the imports */
  private readonly importNames = new Set<string>()
  /** the locations of the marked nodes, while printing with a source map (P11) */
  private locations: SourceLocation[] | null = null

  constructor(
    private readonly program: Program,
    private readonly source?: string,
    private readonly fileName?: string,
    private readonly context?: ProgramContext,
  ) {
    this.helpers = new Helpers(program)
    this.classNodes = context?.classNodes ?? new Map()
  }

  /**
   * Prints the program.
   *
   * @returns the JavaScript code
   */
  emit(): string {
    const { body } = this.program

    this.declareAll(body)
    this.declareImports(body)
    const statements = body.map(node => isModuleDeclaration(node) ? this.moduleDeclaration(node) : this.statement(node))
    // the helpers follow the leading imports
    const imports = body.findIndex(node => node.type !== 'ImportDeclaration')
    const split = imports === -1 ? body.length : imports
    const lines = [...statements.slice(0, split), ...this.helpers.code(), ...statements.slice(split)]

    return `${lines.filter(text => text !== '').join('\n')}\n`
  }

  /**
   * Prints the program with the mappings of a source map (P11).
   *
   * @returns the JavaScript code and its mappings
   */
  emitMapped(): { code: string, mappings: string } {
    // a source containing the marker characters (noncharacters) gets no mappings
    if (this.source?.includes(MARK_START)) return { code: this.emit(), mappings: '' }

    this.locations = []

    try {
      return resolveMarks(this.emit(), this.locations)
    } finally {
      this.locations = null
    }
  }

  // Marks where the code of a node starts, for the source map.
  private mark(node: Node, text: string): string {
    if (this.locations === null || text === '') return text

    return marker(this.locations.push(node.loc) - 1) + text
  }

  /**
   * The classes the module defines at the top level (call after `emit()`).
   *
   * @returns the classes by name
   */
  topLevelClasses(): Map<string, ClassInfo> {
    return new Map([...this.names.names].flatMap(([name, info]) => info ? [[name, info] as const] : []))
  }

  // ---------------------------------------------------------------------------
  // Names

  // Imported classes of the program carry what the compiler knows about them (for `extends`, §4.5.9).
  private declareImports(body: (Statement | ModuleDeclaration)[]) {
    for (const node of body) {
      if (node.type === 'ImportDeclaration') node.specifiers.forEach(({ local }) => this.importNames.add(local.name))
    }
    this.importNames.forEach(name => this.names.names.set(name, this.context?.imported(name)?.info))
  }

  // What the program knows about an import that `name` refers to here (not shadowed by a local or a member).
  private imported(name: string, member?: string): Imported | undefined {
    return this.refersToImport(name) ? this.context?.imported(name, member) : undefined
  }

  private refersToImport(name: string): boolean {
    if (!this.importNames.has(name) || this.isImplicitMember(name)) return false

    return this.names.find(name)?.parent === null
  }

  private declare(id: Identifier, info?: ClassInfo) {
    if (RESTRICTED_NAMES.has(id.name)) throw this.error(`'${id.name}' cannot be used as a name in JavaScript`, id)

    this.names.names.set(id.name, info)
  }

  private declareAll(body: (Statement | ModuleDeclaration)[]) {
    body.flatMap(declaredBy).forEach(id => this.declare(id))
  }

  // Runs `print` in a new scope that `declare` adds to.
  private scoped<T>(print: () => T): T {
    this.names = new Names(this.names)

    try {
      return print()
    } finally {
      this.names = this.names.parent!
    }
  }

  private isFree(name: string): boolean {
    return this.names.find(name) === null
  }

  // A bare name in a class body that is a member of the innermost class (§4.5.8). The compiler has already rejected
  // ambiguous names, so a name is a member exactly when the class (chain) declares it. When the superclass is not
  // visible, a name with no outside definition is taken to be an inherited member.
  private isImplicitMember(name: string): boolean {
    const record = this.classes.at(-1)
    if (!record || name === 'undefined') return false

    return this.isMemberOf(record, name)
  }

  private isMemberOf(record: ClassRecord, name: string): boolean {
    const outside = record.names.find(name)
    if (this.names.find(name) !== outside) return false // a local of the member's code

    return isMemberCandidate(memberCandidate(record, name), outside === null && globalDescription(name) === null)
  }

  // The strict rule for inherited members (§4.5.8), which the VM checks when the class is defined: with the whole
  // class chain visible, psc reports it at compile time.
  private checkInheritedAmbiguity(node: Identifier) {
    const record = this.classes.at(-1)!
    const outer = record.names.find(node.name) ? 'an outer binding' : globalDescription(node.name)
    if (memberCandidate(record, node.name) !== 'inherited' || outer === null) return

    throw this.error(ambiguityMessage(record.info.name, node.name, outer, declaringClass(record.info, node.name)), node)
  }

  // The JS name of an implicit member of the innermost class.
  private implicitName(name: string): string {
    return this.classes.at(-1)!.privates.get(name) ?? name
  }

  // Which private members `o.x` may mean. `this` is an instance of the innermost class declaring `x`; a class name
  // reaches its own static privates; a global is never an instance of a script class. Any other receiver is checked
  // at runtime when it is a plain name, else taken to be an instance of the innermost class.
  private privateAccess(object: Expression, name: string): PrivateAccess {
    const names = this.classes.toReversed().flatMap(({ privates }) => privates.has(name) ? [privates.get(name)!] : [])
    if (names.length === 0) return PUBLIC

    const isPlainName = object.type === 'Identifier' && !this.isImplicitMember(object.name)

    return isPlainName ? this.namedReceiverAccess(object.name, name, names) : { names: names.slice(0, 1), fallback: false }
  }

  private namedReceiverAccess(receiver: string, name: string, names: string[]): PrivateAccess {
    const scope = this.names.find(receiver)
    if (scope === null) return PUBLIC

    const info = scope.names.get(receiver)

    return info ? this.staticPrivateAccess(info, name) : { names, fallback: true }
  }

  // `C.x` inside class C (or a class nested in it) with a private static `x`.
  private staticPrivateAccess(info: ClassInfo, name: string): PrivateAccess {
    const jsName = this.classes.find(record => record.info === info)?.privates.get(name)

    return { names: jsName ? [jsName] : [], fallback: false }
  }

  // Prints a member access as part of an operation (`render` adds the read, write, update or call around the
  // target). When the receiver is checked at runtime, each candidate gets its own branch.
  private withMember(node: MemberExpression, render: Render): string {
    if (this.isGlobalPrint(node)) return render('print')

    const base = this.memberObject(node.object)
    const name = privateKey(node)
    const access = name === null ? PUBLIC : this.privateAccess(node.object as Expression, name)

    return this.renderAccess(base, access, this.publicTarget(node, base), render)
  }

  private publicTarget({ property, computed }: MemberExpression, base: string): string {
    return computed ? `${base}[${this.expression(property as Expression)}]` : `${base}.${(property as Identifier).name}`
  }

  private renderAccess(base: string, access: PrivateAccess, publicTarget: string, render: Render): string {
    const { names, fallback } = access

    if (!fallback) return render(names.length > 0 ? `${base}.${names[0]}` : publicTarget)

    const branch = (rest: string, jsName: string) => `${jsName} in ${base} ? ${render(`${base}.${jsName}`)} : ${rest}`

    return `(${names.reduceRight(branch, render(publicTarget))})`
  }

  // `globalThis.print` is the `print` helper (P6).
  private isGlobalPrint(node: MemberExpression): boolean {
    if (!isGlobalPrintAccess(node) || !this.isFree('globalThis')) return false

    this.helpers.usePrint()

    return true
  }

  // `this` of the enclosing member, or its alias inside a nested plain function (implicit members use the member's
  // `this`, §4.5.8).
  private receiver(node: Node): string {
    const frame = this.frames.findLast(({ kind }) => kind !== 'arrow')!

    return frame.kind === 'function' ? this.aliasOfThis(node) : 'this'
  }

  private aliasOfThis(node: Node): string {
    const member = this.frames.findLast(({ kind }) => MEMBER_FRAMES.has(kind))!
    if (UNALIASED_FRAMES.has(member.kind)) {
      throw this.unsupported(node, 'Implicit members in functions nested in field initialisers and derived constructors')
    }
    member.aliasUsed = true
    this.thisAlias ??= this.helpers.reserve('$this')

    return this.thisAlias
  }

  private framed<T>(frame: Frame, print: () => T): T {
    this.frames.push(frame)

    try {
      return print()
    } finally {
      this.frames.pop()
    }
  }

  // ---------------------------------------------------------------------------
  // Statements

  statement(node: Statement): string {
    return this.mark(node, (STATEMENTS[node.type] as Printer<Statement>)(this, node))
  }

  /**
   * `{ … }` with the statements one level deeper, in a new scope.
   *
   * @param body the statements
   * @param declare declares the scope's own names first (parameters, loop variables)
   * @returns the block text
   */
  block(body: Statement[], declare?: () => void): string {
    return this.scoped(() => {
      declare?.()
      this.declareAll(body)
      this.depth++
      const inner = INDENT.repeat(this.depth)
      const lines = body.map(statement => this.statement(statement)).filter(text => text !== '').map(text => inner + text)
      this.depth--

      return lines.length === 0 ? '{}' : `{\n${lines.join('\n')}\n${INDENT.repeat(this.depth)}}`
    })
  }

  // A loop or branch body; a single statement gets braces.
  private body(node: Statement, declare?: () => void): string {
    return this.block(node.type === 'BlockStatement' ? node.body : [node], declare)
  }

  declaration({ kind, declarations }: VariableDeclaration): string {
    // D37: a `let` without initialiser starts as null
    const initial = (init: Expression | null) => this.optional(init, Precedence.Assignment, 'null')
    const declarators = declarations.map(({ id, init }) => `${this.pattern(id, true)} = ${initial(init)}`)

    return `${kind} ${declarators.join(', ')}`
  }

  returnStatement({ argument }: ReturnStatement): string {
    if (argument) return `return ${this.expression(argument)};`

    // D37: a bare `return` returns null, except in constructors
    return CONSTRUCTOR_FRAMES.has(this.frames.at(-1)!.kind) ? 'return;' : 'return null;'
  }

  ifStatement({ test, consequent, alternate }: IfStatement): string {
    const head = `if (${this.expression(test)}) ${this.body(consequent)}`
    if (!alternate) return head

    return `${head} else ${alternate.type === 'IfStatement' ? this.ifStatement(alternate) : this.body(alternate)}`
  }

  whileStatement({ test, body }: WhileStatement): string {
    return `while (${this.expression(test)}) ${this.body(body)}`
  }

  forStatement({ init, test, update, body }: ForStatement): string {
    return this.scoped(() => {
      const clauses = [test, update].map(clause => this.optional(clause, Precedence.Lowest, '', ' '))
      const head = [init ? this.forInit(init) : '', ...clauses]

      return `for (${head.join(';')}) ${this.body(body)}`
    })
  }

  private forInit(init: VariableDeclaration | Expression): string {
    this.noIn = true

    try {
      if (init.type !== 'VariableDeclaration') return this.expression(init)

      init.declarations.flatMap(({ id }) => boundNames(id)).forEach(id => this.declare(id))

      return this.declaration(init)
    } finally {
      this.noIn = false
    }
  }

  forOfStatement({ left, right, body }: ForOfStatement): string {
    const iterated = this.expression(right, Precedence.Assignment)
    if (left.type !== 'VariableDeclaration') return `for (${this.pattern(left, false)} of ${iterated}) ${this.body(body)}`

    const [{ id }] = left.declarations
    const declare = () => boundNames(id).forEach(name => this.declare(name))

    return `for (${left.kind} ${this.pattern(id, true)} of ${iterated}) ${this.body(body, declare)}`
  }

  tryStatement({ block, handler, finalizer }: TryStatement): string {
    let text = `try ${this.block(block.body)}`

    if (handler) {
      const { param, body } = handler
      const clause = param ? `catch (${this.pattern(param, true)})` : 'catch'

      text += ` ${clause} ${this.block(body.body, () => param && boundNames(param).forEach(name => this.declare(name)))}`
    }

    return finalizer ? `${text} finally ${this.block(finalizer.body)}` : text
  }

  // ---------------------------------------------------------------------------
  // Functions

  functionText(node: FunctionDeclaration | FunctionExpression): string {
    const name = node.id ? ` ${node.id.name}` : node.type === 'FunctionExpression' ? ' ' : ''

    return `function${name}${this.functionRest(node, { kind: 'function' }, node.type === 'FunctionExpression' ? node.id : null)}`
  }

  // `(params) { body }`; a named function expression's name is visible in its body. A member whose nested functions
  // use implicit members starts by saving `this`.
  private functionRest(node: FunctionDeclaration | FunctionExpression, frame: Frame, ownName: Identifier | null = null): string {
    const { params, body } = node

    return this.framed(frame, () => this.scoped(() => {
      if (ownName) this.declare(ownName)

      const text = `(${this.params(params)}) ${this.functionBody(params, body)}`

      return frame.aliasUsed ? text.replace('{\n', `{\n${INDENT.repeat(this.depth + 1)}const ${this.thisAlias} = this;\n`) : text
    }))
  }

  private functionBody(params: Pattern[], body: BlockStatement): string {
    return this.block(body.body, () => paramNames(params).forEach(name => this.declare(name)))
  }

  // Default values are printed before the parameters are declared: they see the outer scope or earlier parameters,
  // which are both locals here.
  private params(params: Pattern[]): string {
    return params.map(param => this.pattern(param, true)).join(', ')
  }

  // ---------------------------------------------------------------------------
  // Patterns (D40): printed as JavaScript destructuring

  /**
   * Prints a binding or assignment pattern.
   *
   * @param node the pattern or one of its parts
   * @param binding the names are declared here (in an assignment, a name may be an implicit member)
   * @returns the pattern text
   */
  pattern(node: PatternPart, binding: boolean): string {
    return (PATTERNS[node.type] as PatternPrinter<PatternPart>)(this, node, binding)
  }

  objectPattern({ properties }: ObjectPattern, binding: boolean): string {
    if (properties.length === 0) return '{}'

    return `{ ${properties.map(property => this.objectPatternPart(property, binding)).join(', ')} }`
  }

  private objectPatternPart(property: AssignmentProperty | RestElement, binding: boolean): string {
    return property.type === 'RestElement' ? this.pattern(property, binding) : this.patternProperty(property, binding)
  }

  patternDefault({ left, right }: AssignmentPattern, binding: boolean): string {
    return `${this.pattern(left, binding)} = ${this.expression(right, Precedence.Assignment)}`
  }

  // `a`, `a = 1`, `key: target`; a shorthand whose name became `this.a` is written out.
  private patternProperty({ key, value }: AssignmentProperty, binding: boolean): string {
    const name = key.type === 'Identifier' ? key.name : key.raw
    const text = this.pattern(value, binding)

    return text === name || text.startsWith(`${name} = `) ? text : `${name}: ${text}`
  }

  arrow({ params, body, expression }: ArrowFunctionExpression): string {
    const head = params.length === 1 && params[0].type === 'Identifier' ? params[0].name : `(${this.params(params)})`
    const arrowBody = () => this.functionBody(params, body as BlockStatement)

    if (!expression) return `${head} => ${this.framed({ kind: 'arrow' }, arrowBody)}`

    return this.scoped(() => {
      paramNames(params).forEach(name => this.declare(name))

      return `${head} => ${this.wrapAmbiguous(body as Expression, Precedence.Assignment)}`
    })
  }

  // ---------------------------------------------------------------------------
  // Expressions

  /**
   * Prints an expression, in parentheses when its precedence is below `min`.
   *
   * @param node the expression
   * @param min the lowest precedence allowed without parentheses
   * @returns the expression text
   */
  expression(node: Expression, min: Precedence = Precedence.Lowest): string {
    const printed = (EXPRESSIONS[node.type] as Printer<Expression>)(this, node)
    const text = MAPPED_EXPRESSIONS.has(node.type) ? this.mark(node, printed) : printed

    return precedenceOf(node) < min ? `(${text})` : text
  }

  // An optional expression: `prefix` + its text, or `absent`.
  private optional(node: Expression | null, min: Precedence, absent: string, prefix = ''): string {
    return node ? prefix + this.expression(node, min) : absent
  }

  // Statements and arrow bodies must not start with `{`, `function` or `class`.
  wrapAmbiguous(node: Expression, min: Precedence): string {
    const text = this.expression(node, min)

    return startsAmbiguously(node) && !text.startsWith('(') ? `(${text})` : text
  }

  identifier(node: Identifier): string {
    const { name } = node

    if (this.isImplicitMember(name)) {
      this.checkInheritedAmbiguity(node)

      return `${this.receiver(node)}.${this.implicitName(name)}`
    }
    if (name === 'print' && this.isFree(name)) this.helpers.usePrint()

    return name
  }

  // `this` outside functions and classes is null in PScript (D37); in JavaScript it is the global object or undefined.
  thisText(): string {
    return this.frames.some(({ kind }) => kind !== 'arrow') ? 'this' : 'null'
  }

  template({ quasis, expressions }: TemplateLiteral): string {
    const substitutions = expressions.map(expression => `\${${this.expression(expression)}}`)
    const parts = quasis.map(({ value }, i) => value.raw + (substitutions[i] ?? ''))

    return `\`${parts.join('')}\``
  }

  array({ elements }: ArrayExpression): string {
    return `[${elements.map(element => this.expression(element, Precedence.Assignment)).join(', ')}]`
  }

  object({ properties }: ObjectExpression): string {
    if (properties.length === 0) return '{}'
    if (properties.every(property => property.kind === 'init' && !property.method)) {
      return `{ ${properties.map(property => this.property(property)).join(', ')} }`
    }

    this.depth++
    const inner = INDENT.repeat(this.depth)
    const lines = properties.map(property => `${inner}${this.property(property)},`)
    this.depth--

    return `{\n${lines.join('\n')}\n${INDENT.repeat(this.depth)}}`
  }

  private property({ key, value, kind, method, shorthand, computed }: Property): string {
    const name = this.key(key, computed)

    if (kind !== 'init' || method) return `${kind === 'init' ? '' : `${kind} `}${name}${this.method(value)}`

    return this.dataProperty(name, value, shorthand)
  }

  private dataProperty(name: string, value: Expression, shorthand: boolean): string {
    const text = this.expression(value, Precedence.Assignment)

    return shorthand && text === name ? name : `${name}: ${text}`
  }

  private key(key: Property['key'], computed: boolean): string {
    if (computed) return `[${this.expression(key, Precedence.Assignment)}]`

    return key.type === 'Identifier' ? key.name : (key as Literal).raw
  }

  private method(value: Expression): string {
    return this.functionRest(value as FunctionExpression, { kind: 'function' })
  }

  unary({ operator, argument }: UnaryExpression): string {
    if (operator === 'typeof') return this.typeofText(argument)
    if (operator === '!') return `!${this.expression(argument, Precedence.Unary)}`

    const text = this.expression(argument, Precedence.Unary)

    // `- -x` and `-(-x)`: never print `--x`
    return /^[+-]/.test(text) ? `${operator}(${text})` : `${operator}${text}`
  }

  // D39: `typeof null` is 'null'. `typeof` of an undeclared global must not throw.
  private typeofText(argument: Expression): string {
    const name = this.helpers.use('typeof')
    const text = this.expression(argument, Precedence.Assignment)
    const isGlobal = argument.type === 'Identifier' && this.isFree(argument.name) && !this.isImplicitMember(argument.name)
    if (!isGlobal) return `${name}(${text})`

    return `(typeof ${text} === 'undefined' ? 'undefined' : ${name}(${text}))`
  }

  update({ operator, prefix, argument }: UpdateExpression): string {
    const render = (target: string) => prefix ? `${operator}${target}` : `${target}${operator}`

    if (argument.type === 'MemberExpression') return this.withMember(argument, render)

    return render(this.expression(argument, Precedence.Postfix))
  }

  binary(node: BinaryExpression): string {
    const text = this.privateIn(node) ?? this.binaryText(node)

    return node.operator === 'in' && this.noIn ? `(${text})` : text
  }

  private binaryText({ operator, left, right }: BinaryExpression): string {
    const [leftMin, rightMin] = operandPrecedences(operator)

    return `${this.expression(left, leftMin)} ${OPERATORS[operator] ?? operator} ${this.expression(right, rightMin)}`
  }

  // `'x' in o` with a private `x` is the brand check `#x in o` (§4.5.2: `in` sees accessible members only).
  private privateIn({ operator, left, right }: BinaryExpression): string | null {
    const isKey = operator === 'in' && left.type === 'Literal' && typeof left.value === 'string'

    return isKey ? this.privateInText(left as Literal, right) : null
  }

  private privateInText(key: Literal, object: Expression): string | null {
    const { names, fallback } = this.privateAccess(object, key.value as string)
    if (names.length === 0) return null

    const base = this.expression(object, Precedence.Additive)
    const checks = [...names, ...fallback ? [key.raw] : []].map(name => `${name} in ${base}`)

    return checks.length > 1 ? `(${checks.join(' || ')})` : checks[0]
  }

  logical({ operator, left, right }: LogicalExpression): string {
    const precedence = binaryPrecedence(operator)

    const leftText = this.logicalOperand(operator, left, precedence)

    return `${leftText} ${operator} ${this.logicalOperand(operator, right, precedence + 1)}`
  }

  // JavaScript rejects `??` mixed with `&&` / `||` without parentheses.
  private logicalOperand(operator: string, operand: Expression, min: Precedence): string {
    const mixed = operator === '??' && operand.type === 'LogicalExpression' && operand.operator !== '??'

    return this.expression(operand, mixed ? Precedence.Primary : min)
  }

  assignment({ operator, left, right }: AssignmentExpression): string {
    const value = this.expression(right, Precedence.Assignment)
    const render = (target: string) => `${target} ${operator} ${value}`

    if (left.type === 'MemberExpression') return this.withMember(left, render)

    return render(left.type === 'Identifier' ? this.expression(left, Precedence.Member) : this.pattern(left, false))
  }

  conditional({ test, consequent, alternate }: ConditionalExpression): string {
    const [testText, consequentText, alternateText] = [
      this.expression(test, Precedence.Nullish),
      this.expression(consequent, Precedence.Assignment),
      this.expression(alternate, Precedence.Assignment),
    ]

    return `${testText} ? ${consequentText} : ${alternateText}`
  }

  private arguments(args: Expression[]): string {
    return `(${args.map(arg => this.expression(arg, Precedence.Assignment)).join(', ')})`
  }

  call(node: CallExpression): string {
    const { callee, arguments: args } = node

    this.checkImportedArity(node)
    const argumentList = this.arguments(args)
    if (callee.type === 'MemberExpression') return this.withMember(callee, target => target + argumentList)

    return `${callee.type === 'Super' ? 'super' : this.expression(callee, Precedence.Member)}${argumentList}`
  }

  // Strict arity of imported functions (D38), which the compiler can only check for local functions (P10).
  private checkImportedArity(node: CallExpression) {
    const signature = this.calleeSignature(node.callee)
    if (!signature) return

    const problem = arityError(signature, node.arguments.length)
    if (problem) throw this.error(problem, node)

    const named = namedArgumentError(signature, node.arguments)
    if (named) throw this.error(named.reason, { loc: named.loc } as Node)
  }

  // `f(…)` with an imported `f`, or `ns.f(…)` with a namespace import `ns`.
  private calleeSignature(callee: Expression | Super): Signature | undefined {
    if (callee.type === 'Identifier') return this.imported(callee.name)?.signature

    return callee.type === 'MemberExpression' ? this.namespaceMemberSignature(callee) : undefined
  }

  private namespaceMemberSignature({ object, property, computed }: MemberExpression): Signature | undefined {
    if (computed || object.type !== 'Identifier') return undefined

    return this.imported(object.name, (property as Identifier).name)?.signature
  }

  newExpression({ callee, arguments: args }: NewExpression): string {
    const text = this.expression(callee, Precedence.Member)

    return `new ${containsCall(callee) && !text.startsWith('(') ? `(${text})` : text}${this.arguments(args)}`
  }

  member(node: MemberExpression): string {
    return this.withMember(node, target => target)
  }

  // `1.toString()` would read as a number with a fraction.
  private memberObject(object: Expression | Super): string {
    if (object.type === 'Super') return 'super'

    const text = this.expression(object, Precedence.Member)

    return object.type === 'Literal' && typeof object.value === 'number' ? `(${text})` : text
  }

  // ---------------------------------------------------------------------------
  // Classes and interfaces (P7, P8)

  classText(node: ClassNode): string {
    const info = this.classInfo(node)
    const heritage = node.superClass ? ` extends ${this.expression(node.superClass, Precedence.Member)}` : ''
    const implemented = node.implements.map(iface => this.expression(iface, Precedence.Assignment))

    return this.scoped(() => {
      const { id } = node

      if (node.type === 'ClassExpression' && id) this.declare(id, info)

      return `class${id ? ` ${id.name}` : ''}${heritage} ${this.classBody(node, info, implemented)}`
    })
  }

  // What the compiler knows about the class; a declaration's binding carries it for later `extends` (§4.5.9).
  private classInfo(node: ClassNode): ClassInfo {
    const info = classInfoOf(node, nameOf(node), this.knownSuperClass(node))

    this.classNodes.set(info, node)

    if (node.type === 'ClassDeclaration') this.names.find(node.id.name)?.names.set(node.id.name, info)

    return info
  }

  // null: no superclass; undefined: a superclass the emitter cannot see.
  private knownSuperClass({ superClass }: ClassNode): ClassInfo | null | undefined {
    if (!superClass) return null

    return superClass.type === 'Identifier' ? this.names.find(superClass.name)?.names.get(superClass.name) : undefined
  }

  private classBody(node: ClassNode, info: ClassInfo, implemented: string[]): string {
    const record = this.classRecord(info)

    this.classes.push(record)
    this.depth++

    try {
      const members = node.body.body.map(member => this.mark(member, this.classMember(member, record, node.superClass !== null)))
      const lines = [...this.implementsBlock(implemented), ...members, ...inheritedHalves(node, info, this.classNodes)]

      const inner = lines.map(text => INDENT.repeat(this.depth) + text)

      return lines.length === 0 ? '{}' : `{\n${inner.join('\n')}\n${INDENT.repeat(this.depth - 1)}}`
    } finally {
      this.depth--
      this.classes.pop()
    }
  }

  private classRecord(info: ClassInfo): ClassRecord {
    const taken = new Set(this.classes.flatMap(({ privates }) => [...privates.values()]))
    const privates = new Map([...info.privates].map(name => [name, uniquePrivateName(name, taken)]))

    return { info, names: this.names, isStatic: false, privates }
  }

  // `implements` lists are kept for `instanceof` with interfaces (D32).
  private implementsBlock(implemented: string[]): string[] {
    if (implemented.length === 0) return []

    return [`static { ${this.helpers.use('interface')}.implement(this, [${implemented.join(', ')}]); }`]
  }

  private classMember(member: MethodDefinition | PropertyDefinition, record: ClassRecord, derived: boolean): string {
    record.isStatic = member.static

    if (member.type === 'PropertyDefinition') return `${staticPrefix(member)}${this.field(member, record)}`
    if (member.kind === 'constructor') return this.constructorText(member, derived)

    return this.methodText(member, record)
  }

  private constructorText({ value }: MethodDefinition, derived: boolean): string {
    return `constructor${this.functionRest(value, { kind: derived ? 'derivedConstructor' : 'constructor' })}`
  }

  private methodText(member: MethodDefinition, record: ClassRecord): string {
    const accessor = member.kind === 'method' ? '' : `${member.kind} `

    const rest = this.functionRest(member.value, { kind: 'method' })

    return `${staticPrefix(member)}${accessor}${this.memberKey(member, record)}${rest}`
  }

  // D37: a field without initialiser starts as null.
  private field(member: PropertyDefinition, record: ClassRecord): string {
    const value = this.framed({ kind: 'field' }, () => this.optional(member.value, Precedence.Assignment, 'null'))

    return `${this.memberKey(member, record)} = ${value};`
  }

  // `private` members are JS private names (P7); `protected`, `override` and `final` are compile-time only.
  private memberKey(member: MethodDefinition | PropertyDefinition, record: ClassRecord): string {
    const { key, access } = member
    if (access !== 'private') return key.type === 'Identifier' ? key.name : key.raw

    const name = keyName(key)
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw this.unsupported(member, 'Private members with non-identifier names')

    return record.privates.get(name)!
  }

  interfaceText({ id, extends: parents }: InterfaceDeclaration): string {
    const parentList = parents.map(parent => this.expression(parent, Precedence.Assignment)).join(', ')

    return `const ${id.name} = ${this.helpers.use('interface')}('${id.name}', [${parentList}]);`
  }

  // ---------------------------------------------------------------------------
  // Modules (P9)

  private moduleDeclaration(node: ModuleDeclaration): string {
    return this.mark(node, node.type === 'ImportDeclaration' ? this.importText(node) : this.exportText(node))
  }

  private importText(node: ImportDeclaration): string {
    return `import ${importClause(node)}${sourceText(node.source)};`
  }

  private exportText({ declaration, specifiers, source }: ExportNamedDeclaration): string {
    if (declaration) return `export ${this.statement(declaration)}`

    return `export ${exportList(specifiers)}${source ? ` from ${sourceText(source)}` : ''};`
  }

  // ---------------------------------------------------------------------------
  // Errors

  private error(reason: string, { loc: { start: { line, column } } }: Node): PScriptSyntaxError {
    const excerpt = this.source === undefined ? undefined : formatExcerpt(this.source, line, column)

    return new PScriptSyntaxError(reason, { fileName: this.fileName, line, column, excerpt })
  }

  private unsupported(node: Node, feature: string): PScriptSyntaxError {
    return this.error(`${feature} are not supported by psc yet`, node)
  }
}

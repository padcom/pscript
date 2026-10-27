// AST contract (§5.3): an ESTree subset, so acorn can serve as a parser oracle (§6.2).
// PScript extensions: `access`, `override` and `final` on class members, `final` and
// `implements` on classes, and `InterfaceDeclaration` (D28, D30, D31).

/**
 * A position in the source; line and column are both 1-based.
 */
export interface Position {
  /** 1-based line */
  line: number
  /** 1-based column */
  column: number
}

/**
 * Source range of a node.
 */
export interface SourceLocation {
  /** first character */
  start: Position
  /** just past the last character */
  end: Position
}

/**
 * Fields shared by every node.
 */
interface NodeBase {
  /** source range of the node */
  loc: SourceLocation
}

export type Access = 'public' | 'protected' | 'private'

/**
 * Root of a parsed script or module.
 */
export interface Program extends NodeBase {
  /** node type */
  type: 'Program'
  /** `script` for `run()`, `module` for modules (D20) */
  sourceType: 'script' | 'module'
  /** top-level statements */
  body: (Statement | ModuleDeclaration)[]
}

// ---------------------------------------------------------------------------
// Modules

export type ModuleDeclaration = ImportDeclaration | ExportNamedDeclaration

/**
 * `import { a, b as c } from 'm'`, `import * as ns from 'm'` or `import 'm'`.
 */
export interface ImportDeclaration extends NodeBase {
  /** node type */
  type: 'ImportDeclaration'
  /** imported bindings; empty for a side-effect import */
  specifiers: (ImportSpecifier | ImportNamespaceSpecifier)[]
  /** module specifier; `source.value` is a string */
  source: Literal
}

/**
 * `* as ns` in an import.
 */
export interface ImportNamespaceSpecifier extends NodeBase {
  /** node type */
  type: 'ImportNamespaceSpecifier'
  /** local name of the namespace object */
  local: Identifier
}

/**
 * `a` or `a as b` in an import.
 */
export interface ImportSpecifier extends NodeBase {
  /** node type */
  type: 'ImportSpecifier'
  /** name exported by the other module */
  imported: Identifier
  /** local binding name */
  local: Identifier
}

/**
 * `export <declaration>`, `export { a, b as c }` or `export { a } from 'm'`.
 */
export interface ExportNamedDeclaration extends NodeBase {
  /** node type */
  type: 'ExportNamedDeclaration'
  /** exported declaration, or `null` for a specifier list */
  declaration: VariableDeclaration | FunctionDeclaration | ClassDeclaration | InterfaceDeclaration | null
  /** exported names; empty when `declaration` is set */
  specifiers: ExportSpecifier[]
  /** non-null for re-exports */
  source: Literal | null
}

/**
 * `a` or `a as b` in an export.
 */
export interface ExportSpecifier extends NodeBase {
  /** node type */
  type: 'ExportSpecifier'
  /** local (or re-exported) name */
  local: Identifier
  /** name visible to importers */
  exported: Identifier
}

// ---------------------------------------------------------------------------
// Unions

export type Statement
  = VariableDeclaration | FunctionDeclaration | ClassDeclaration | InterfaceDeclaration | ReturnStatement | IfStatement
    | ForStatement | ForOfStatement | ForInStatement | WhileStatement | DoWhileStatement | SwitchStatement | BreakStatement
    | ContinueStatement | ThrowStatement | TryStatement | BlockStatement | ExpressionStatement | EmptyStatement

export type Expression
  = Identifier | Literal | ArrayExpression | ObjectExpression | FunctionExpression
    | ArrowFunctionExpression | ClassExpression | UnaryExpression | UpdateExpression
    | BinaryExpression | LogicalExpression | AssignmentExpression | ConditionalExpression
    | CallExpression | NewExpression | MemberExpression | ThisExpression | TemplateLiteral | YieldExpression
    | AwaitExpression | ChainExpression | ImportExpression | SequenceExpression

/** The name of a class member: `[Symbol.iterator]` / `[Symbol.asyncIterator]` methods have a member expression (D57). */
export type MemberKey = Identifier | Literal | MemberExpression

/** What binds names: a name, or an object or array pattern of names (D40). */
export type BindingPattern = Identifier | ObjectPattern | ArrayPattern

/** A parameter: a binding pattern, with a default, or a rest parameter. */
export type Pattern = BindingPattern | AssignmentPattern | RestElement

/** What a part of a pattern binds or assigns to (member expressions only in assignment patterns). */
export type PatternTarget = BindingPattern | MemberExpression

/** An element of an array pattern, or the value of a property of an object pattern. */
export type PatternElement = PatternTarget | AssignmentPattern

// ---------------------------------------------------------------------------
// Leaves

/**
 * A name. `undefined` is parsed as an `Identifier` too (as in ESTree).
 */
export interface Identifier extends NodeBase {
  /** node type */
  type: 'Identifier'
  /** the name */
  name: string
}

/**
 * A string, number, boolean or `null` literal.
 */
export interface Literal extends NodeBase {
  /** node type */
  type: 'Literal'
  /** the cooked value */
  value: string | number | boolean | null
  /** source text */
  raw: string
}

/**
 * `super` in `super(...)` or `super.x`.
 */
export interface Super extends NodeBase {
  /** node type */
  type: 'Super'
}

/**
 * `this`.
 */
export interface ThisExpression extends NodeBase {
  /** node type */
  type: 'ThisExpression'
}

// ---------------------------------------------------------------------------
// Declarations

/**
 * `let` or `const` with one or more declarators.
 */
export interface VariableDeclaration extends NodeBase {
  /** node type */
  type: 'VariableDeclaration'
  /** declaration kind */
  kind: 'let' | 'const'
  /** declared bindings */
  declarations: VariableDeclarator[]
}

/**
 * `x` or `x = init` inside a variable declaration.
 */
export interface VariableDeclarator extends NodeBase {
  /** node type */
  type: 'VariableDeclarator'
  /** binding name or pattern (a pattern always has an initialiser) */
  id: BindingPattern
  /** initialiser, or `null` (binding starts as `null`, D37) */
  init: Expression | null
}

/**
 * Fields shared by function declarations and expressions.
 */
interface FunctionBase {
  /** function name, if any */
  id: Identifier | null
  /** formal parameters */
  params: Pattern[]
  /** function body */
  body: BlockStatement
  /** `function*` / `*method()` (D42) */
  generator: boolean
  /** `async function` / `async method()` (D43) */
  async: boolean
}

/**
 * `function f(...) { ... }` as a statement (a constant binding, D38).
 */
export interface FunctionDeclaration extends NodeBase, FunctionBase {
  /** node type */
  type: 'FunctionDeclaration'
  /** function name */
  id: Identifier
}

/**
 * `function (...) { ... }` as an expression; also the value of class methods.
 */
export interface FunctionExpression extends NodeBase, FunctionBase {
  /** node type */
  type: 'FunctionExpression'
}

/**
 * `(a, b) => expr` or `(a, b) => { ... }`.
 */
export interface ArrowFunctionExpression extends NodeBase {
  /** node type */
  type: 'ArrowFunctionExpression'
  /** arrows are anonymous */
  id: null
  /** formal parameters */
  params: Pattern[]
  /** body: a block, or an expression when `expression` is true */
  body: BlockStatement | Expression
  /** true for an expression body */
  expression: boolean
  /** arrows are never generators */
  generator: false
  /** `async () => …` (D43) */
  async: boolean
}

/**
 * A target with a default value: a parameter `x = 1` (used only when the argument is omitted, D38), or `x = 1` in
 * a pattern (used when the value is `undefined`, D40).
 */
export interface AssignmentPattern extends NodeBase {
  /** node type */
  type: 'AssignmentPattern'
  /** the target */
  left: PatternTarget
  /** default value */
  right: Expression
}

/**
 * `a, b, c` (D55): evaluates every expression, gives the last one.
 */
export interface SequenceExpression extends NodeBase {
  /** node type */
  type: 'SequenceExpression'
  /** the expressions, at least two */
  expressions: Expression[]
}

/**
 * `import(source)` (D52): a promise of the namespace of the module `source` names.
 */
export interface ImportExpression extends NodeBase {
  /** node type */
  type: 'ImportExpression'
  /** the specifier */
  source: Expression
  /** import attributes are not supported */
  options: null
}

/**
 * `...x` in an argument list, array literal or object literal (D46).
 */
export interface SpreadElement extends NodeBase {
  /** node type */
  type: 'SpreadElement'
  /** the spread value */
  argument: Expression
}

/**
 * Rest parameter `...rest`, or the rest of an object or array pattern.
 */
export interface RestElement extends NodeBase {
  /** node type */
  type: 'RestElement'
  /** the name */
  argument: Identifier
}

/**
 * `{ a, b: c, d = 1, ...rest }` as a binding or assignment target (D40).
 */
export interface ObjectPattern extends NodeBase {
  /** node type */
  type: 'ObjectPattern'
  /** the properties; a rest element comes last */
  properties: (AssignmentProperty | RestElement)[]
}

/**
 * `a`, `a = 1`, `key: target` or `key: target = 1` in an object pattern.
 */
export interface AssignmentProperty extends NodeBase {
  /** node type (as in ESTree) */
  type: 'Property'
  /** the key read from the value */
  key: Identifier | Literal
  /** where the property's value goes */
  value: PatternElement
  /** always `init` */
  kind: 'init'
  /** never a method */
  method: false
  /** `{ a }` / `{ a = 1 }` */
  shorthand: boolean
  /** computed keys are not supported */
  computed: false
}

/**
 * `[a, b = 1, ...rest]` as a binding or assignment target (D40).
 */
export interface ArrayPattern extends NodeBase {
  /** node type */
  type: 'ArrayPattern'
  /** the elements (no holes); a rest element comes last */
  elements: (PatternElement | RestElement)[]
}

// ---------------------------------------------------------------------------
// Classes and interfaces

/**
 * Fields shared by class declarations and expressions.
 */
interface ClassBase {
  /** class name, if any */
  id: Identifier | null
  /** `extends` clause */
  superClass: Expression | null
  /** members */
  body: ClassBody
  /** `final class` (D28) */
  final: boolean
  /** `abstract class` (D58) */
  abstract: boolean
  /** `implements` list (D31) */
  implements: (Identifier | MemberExpression)[]
}

/**
 * `class C { ... }` as a statement.
 */
export interface ClassDeclaration extends NodeBase, ClassBase {
  /** node type */
  type: 'ClassDeclaration'
  /** class name */
  id: Identifier
}

/**
 * `class { ... }` as an expression.
 */
export interface ClassExpression extends NodeBase, ClassBase {
  /** node type */
  type: 'ClassExpression'
}

/**
 * The braces of a class and its members.
 */
export interface ClassBody extends NodeBase {
  /** node type */
  type: 'ClassBody'
  /** members in source order */
  body: (MethodDefinition | PropertyDefinition)[]
}

/**
 * Constructor, method or accessor of a class.
 */
export interface MethodDefinition extends NodeBase {
  /** node type */
  type: 'MethodDefinition'
  /** member name */
  key: MemberKey
  /** `[Symbol.iterator]() {}` (D57): the key is the member expression */
  computed: boolean
  /** `abstract m();` (D58): no body (the value's body is empty) */
  abstract: boolean
  /** member kind */
  kind: 'constructor' | 'method' | 'get' | 'set'
  /** `static` member */
  static: boolean
  /** the function */
  value: FunctionExpression
  /** access modifier (default `public`, D30) */
  access: Access
  /** `override` modifier (D28) */
  override: boolean
  /** `final` modifier (D28) */
  final: boolean
}

/**
 * Field of a class.
 */
export interface PropertyDefinition extends NodeBase {
  /** node type */
  type: 'PropertyDefinition'
  /** field name */
  key: Identifier | Literal
  /** computed keys are not supported */
  computed: false
  /** initialiser, or `null` (field starts as `null`, D37) */
  value: Expression | null
  /** `static` field */
  static: boolean
  /** access modifier (default `public`, D30) */
  access: Access
  /** `override` modifier (D28) */
  override: boolean
  /** `final` modifier (D28) */
  final: boolean
}

/**
 * `interface I extends A, B { ... }` (PScript extension, D31).
 */
export interface InterfaceDeclaration extends NodeBase {
  /** node type */
  type: 'InterfaceDeclaration'
  /** interface name */
  id: Identifier
  /** parent interfaces */
  extends: (Identifier | MemberExpression)[]
  /** required members */
  body: InterfaceMember[]
}

/**
 * One requirement of an interface.
 */
export interface InterfaceMember extends NodeBase {
  /** node type */
  type: 'InterfaceMember'
  /** member name */
  key: Identifier | Literal
  /** member kind */
  kind: 'method' | 'get' | 'set' | 'property'
  /** parameter names (methods only; empty otherwise) */
  params: Identifier[]
  /** whether the method has a rest parameter (methods only) */
  hasRest: boolean
}

// ---------------------------------------------------------------------------
// Statements

/**
 * `return` or `return expr`.
 */
export interface ReturnStatement extends NodeBase {
  /** node type */
  type: 'ReturnStatement'
  /** returned value, or `null` for a bare `return` (returns `null`, D37) */
  argument: Expression | null
}

/**
 * `if (test) consequent else alternate`.
 */
export interface IfStatement extends NodeBase {
  /** node type */
  type: 'IfStatement'
  /** condition */
  test: Expression
  /** then branch */
  consequent: Statement
  /** else branch */
  alternate: Statement | null
}

/**
 * `for (init; test; update) body`.
 */
export interface ForStatement extends NodeBase {
  /** node type */
  type: 'ForStatement'
  /** initialiser */
  init: VariableDeclaration | Expression | null
  /** condition */
  test: Expression | null
  /** update expression */
  update: Expression | null
  /** loop body */
  body: Statement
}

/**
 * `for (left of right) body`.
 */
export interface ForOfStatement extends NodeBase {
  /** node type */
  type: 'ForOfStatement'
  /** loop variable */
  left: VariableDeclaration | PatternTarget
  /** iterated value */
  right: Expression
  /** loop body */
  body: Statement
  /** `for await (… of …)` (D53) */
  await: boolean
}

/**
 * `for (k in object) body` (D56): the keys of the object.
 */
export interface ForInStatement extends NodeBase {
  /** node type */
  type: 'ForInStatement'
  /** loop variable */
  left: VariableDeclaration | PatternTarget
  /** the object */
  right: Expression
  /** loop body */
  body: Statement
}

/**
 * `while (test) body`.
 */
export interface WhileStatement extends NodeBase {
  /** node type */
  type: 'WhileStatement'
  /** condition */
  test: Expression
  /** loop body */
  body: Statement
}

/**
 * `do body while (test)`.
 */
export interface DoWhileStatement extends NodeBase {
  /** node type */
  type: 'DoWhileStatement'
  /** loop body */
  body: Statement
  /** condition, tested after each iteration */
  test: Expression
}

/**
 * `switch (discriminant) { case …: … default: … }`.
 */
export interface SwitchStatement extends NodeBase {
  /** node type */
  type: 'SwitchStatement'
  /** the value compared (with `==`, D1) against each case */
  discriminant: Expression
  /** the clauses in source order (at most one `default`) */
  cases: SwitchCase[]
}

/**
 * `case test: consequent` or `default: consequent`.
 */
export interface SwitchCase extends NodeBase {
  /** node type */
  type: 'SwitchCase'
  /** the compared value; `null` for `default` */
  test: Expression | null
  /** statements, run until a `break` (falling through to the next clause) */
  consequent: Statement[]
}

/**
 * `break`.
 */
export interface BreakStatement extends NodeBase {
  /** node type */
  type: 'BreakStatement'
  /** labels are not supported */
  label: null
}

/**
 * `continue`.
 */
export interface ContinueStatement extends NodeBase {
  /** node type */
  type: 'ContinueStatement'
  /** labels are not supported */
  label: null
}

/**
 * `throw expr`.
 */
export interface ThrowStatement extends NodeBase {
  /** node type */
  type: 'ThrowStatement'
  /** thrown value */
  argument: Expression
}

/**
 * `try { } catch (e) { } finally { }`.
 */
export interface TryStatement extends NodeBase {
  /** node type */
  type: 'TryStatement'
  /** protected block */
  block: BlockStatement
  /** catch clause */
  handler: CatchClause | null
  /** finally block */
  finalizer: BlockStatement | null
}

/**
 * `catch (param) { body }`; the parameter is optional.
 */
export interface CatchClause extends NodeBase {
  /** node type */
  type: 'CatchClause'
  /** caught value binding */
  param: BindingPattern | null
  /** handler body */
  body: BlockStatement
}

/**
 * `{ ... }` as a statement.
 */
export interface BlockStatement extends NodeBase {
  /** node type */
  type: 'BlockStatement'
  /** statements */
  body: Statement[]
}

/**
 * An expression used as a statement; its value is the completion value (D12).
 */
export interface ExpressionStatement extends NodeBase {
  /** node type */
  type: 'ExpressionStatement'
  /** the expression */
  expression: Expression
}

/**
 * A lone `;`.
 */
export interface EmptyStatement extends NodeBase {
  /** node type */
  type: 'EmptyStatement'
}

// ---------------------------------------------------------------------------
// Expressions

/**
 * Backtick string with `${...}` substitutions (D34).
 */
export interface TemplateLiteral extends NodeBase {
  /** node type */
  type: 'TemplateLiteral'
  /** literal parts; `quasis.length === expressions.length + 1` */
  quasis: TemplateElement[]
  /** substitutions */
  expressions: Expression[]
}

/**
 * Literal part of a template.
 */
export interface TemplateElement extends NodeBase {
  /** node type */
  type: 'TemplateElement'
  /** source text and its value with escapes processed */
  value: {
    /** source text */
    raw: string
    /** value with escapes processed */
    cooked: string
  }
  /** true for the last part */
  tail: boolean
}

/**
 * `[a, b, c]`.
 */
export interface ArrayExpression extends NodeBase {
  /** node type */
  type: 'ArrayExpression'
  /** elements (no holes); `...x` spreads an iterable (D46) */
  elements: (Expression | SpreadElement)[]
}

/**
 * `{ a: 1, b, c() {}, get d() {} }`.
 */
export interface ObjectExpression extends NodeBase {
  /** node type */
  type: 'ObjectExpression'
  /** properties in source order; `...x` copies the own properties of x (D46) */
  properties: (Property | SpreadElement)[]
}

/**
 * One property of an object literal.
 */
export interface Property extends NodeBase {
  /** node type */
  type: 'Property'
  /** property name (an expression only when `computed`) */
  key: Identifier | Literal | Expression
  /** property value; a `FunctionExpression` for methods and accessors */
  value: Expression
  /** data property or accessor half (R18) */
  kind: 'init' | 'get' | 'set'
  /** method shorthand `m() {}` */
  method: boolean
  /** shorthand `{ a }` */
  shorthand: boolean
  /** computed key `[k]: v`, `[k]() {}`, `get [k]() {}` (D48) */
  computed: boolean
}

/**
 * `!x`, `-x`, `+x`, `typeof x`, `void x`, `delete o.x`.
 */
export interface UnaryExpression extends NodeBase {
  /** node type */
  type: 'UnaryExpression'
  /** the operator */
  operator: '!' | '-' | '+' | '~' | 'typeof' | 'void' | 'delete'
  /** always prefix */
  prefix: true
  /** the operand */
  argument: Expression
}

/**
 * `yield`, `yield value`, `yield* iterable` (D42); only in generator functions.
 */
export interface YieldExpression extends NodeBase {
  /** node type */
  type: 'YieldExpression'
  /** the yielded value or the delegated iterable; `null` for a bare `yield` (yields null, D37) */
  argument: Expression | null
  /** `yield*` */
  delegate: boolean
}

/**
 * `await value` (D43); only in async functions.
 */
export interface AwaitExpression extends NodeBase {
  /** node type */
  type: 'AwaitExpression'
  /** the awaited value */
  argument: Expression
}

/**
 * `++x`, `x++`, `--x`, `x--`.
 */
export interface UpdateExpression extends NodeBase {
  /** node type */
  type: 'UpdateExpression'
  /** the operator */
  operator: '++' | '--'
  /** true for `++x` */
  prefix: boolean
  /** the updated target */
  argument: Identifier | MemberExpression
}

export type BinaryOperator
  = '+' | '-' | '*' | '/' | '%' | '**' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'instanceof' | 'in'
    | '&' | '|' | '^' | '<<' | '>>' | '>>>'

/**
 * Arithmetic, comparison, `instanceof` and `in`.
 */
export interface BinaryExpression extends NodeBase {
  /** node type */
  type: 'BinaryExpression'
  /** the operator (`==`/`!=` are strict, D1) */
  operator: BinaryOperator
  /** left operand */
  left: Expression
  /** right operand */
  right: Expression
}

/**
 * Short-circuiting `&&`, `||`, `??`.
 */
export interface LogicalExpression extends NodeBase {
  /** node type */
  type: 'LogicalExpression'
  /** the operator */
  operator: '&&' | '||' | '??'
  /** left operand */
  left: Expression
  /** right operand */
  right: Expression
}

export type AssignmentOperator
  = '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '**=' | '&&=' | '||=' | '??=' | '&=' | '|=' | '^=' | '<<=' | '>>=' | '>>>='

/**
 * Simple and compound assignment.
 */
export interface AssignmentExpression extends NodeBase {
  /** node type */
  type: 'AssignmentExpression'
  /** the operator */
  operator: AssignmentOperator
  /** assignment target */
  left: PatternTarget
  /** assigned value */
  right: Expression
}

/**
 * `test ? consequent : alternate`.
 */
export interface ConditionalExpression extends NodeBase {
  /** node type */
  type: 'ConditionalExpression'
  /** condition */
  test: Expression
  /** value when truthy */
  consequent: Expression
  /** value when falsy */
  alternate: Expression
}

/**
 * `f(...)`, `o.m(...)` or `super(...)`.
 */
export interface CallExpression extends NodeBase {
  /** node type */
  type: 'CallExpression'
  /** called expression */
  callee: Expression | Super
  /** arguments; `...x` spreads an iterable (D46) */
  arguments: (Expression | SpreadElement)[]
  /** true for `f?.(x)` (D47) */
  optional: boolean
}

/**
 * `new C(...)`; only classes are constructable (D25).
 */
export interface NewExpression extends NodeBase {
  /** node type */
  type: 'NewExpression'
  /** the class */
  callee: Expression
  /** arguments; `...x` spreads an iterable (D46) */
  arguments: (Expression | SpreadElement)[]
}

/**
 * `o.x`, `o[k]`, `super.x`.
 */
export interface MemberExpression extends NodeBase {
  /** node type */
  type: 'MemberExpression'
  /** the object */
  object: Expression | Super
  /** an `Identifier` for `o.x`, any expression for `o[k]` */
  property: Expression | Identifier
  /** true for `o[k]` */
  computed: boolean
  /** true for `o?.x` / `o?.[k]` (D47) */
  optional: boolean
}

/**
 * An optional chain `a?.b.c()` (D47): its member expressions and calls short-circuit to `undefined` when the value
 * before a `?.` is null or undefined.
 */
export interface ChainExpression extends NodeBase {
  /** node type */
  type: 'ChainExpression'
  /** the chain */
  expression: MemberExpression | CallExpression
}

export type Node
  = Program | ModuleDeclaration | ImportSpecifier | ImportNamespaceSpecifier | ExportSpecifier
    | Statement | Expression | Pattern | Super | VariableDeclarator
    | ClassBody | MethodDefinition | PropertyDefinition | InterfaceMember
    | CatchClause | SwitchCase | TemplateElement | Property | AssignmentProperty | SpreadElement

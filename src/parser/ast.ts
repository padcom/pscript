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
    | ForStatement | ForOfStatement | WhileStatement | BreakStatement | ContinueStatement
    | ThrowStatement | TryStatement | BlockStatement | ExpressionStatement | EmptyStatement

export type Expression
  = Identifier | Literal | ArrayExpression | ObjectExpression | FunctionExpression
    | ArrowFunctionExpression | ClassExpression | UnaryExpression | UpdateExpression
    | BinaryExpression | LogicalExpression | AssignmentExpression | ConditionalExpression
    | CallExpression | NewExpression | MemberExpression | ThisExpression | TemplateLiteral

export type Pattern = Identifier | AssignmentPattern | RestElement

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
  /** binding name */
  id: Identifier
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
}

/**
 * Parameter with a default value: `x = 1`.
 */
export interface AssignmentPattern extends NodeBase {
  /** node type */
  type: 'AssignmentPattern'
  /** parameter name */
  left: Identifier
  /** default value, used only when the argument is omitted (D38) */
  right: Expression
}

/**
 * Rest parameter: `...rest`.
 */
export interface RestElement extends NodeBase {
  /** node type */
  type: 'RestElement'
  /** parameter name */
  argument: Identifier
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
  key: Identifier | Literal
  /** computed keys are not supported */
  computed: false
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
  left: VariableDeclaration | Identifier
  /** iterated value */
  right: Expression
  /** loop body */
  body: Statement
  /** `for await` is not supported (v2) */
  await: false
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
  param: Identifier | null
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
  /** elements (no holes) */
  elements: Expression[]
}

/**
 * `{ a: 1, b, c() {}, get d() {} }`.
 */
export interface ObjectExpression extends NodeBase {
  /** node type */
  type: 'ObjectExpression'
  /** properties in source order */
  properties: Property[]
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
  /** computed key `[k]: v` (COULD) */
  computed: boolean
}

/**
 * `!x`, `-x`, `+x`, `typeof x`.
 */
export interface UnaryExpression extends NodeBase {
  /** node type */
  type: 'UnaryExpression'
  /** the operator */
  operator: '!' | '-' | '+' | 'typeof'
  /** always prefix */
  prefix: true
  /** the operand */
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

export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '**' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'instanceof' | 'in'

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

export type AssignmentOperator = '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '**=' | '&&=' | '||=' | '??='

/**
 * Simple and compound assignment.
 */
export interface AssignmentExpression extends NodeBase {
  /** node type */
  type: 'AssignmentExpression'
  /** the operator */
  operator: AssignmentOperator
  /** assignment target */
  left: Identifier | MemberExpression
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
  /** arguments */
  arguments: Expression[]
  /** optional calls are not supported */
  optional: false
}

/**
 * `new C(...)`; only classes are constructable (D25).
 */
export interface NewExpression extends NodeBase {
  /** node type */
  type: 'NewExpression'
  /** the class */
  callee: Expression
  /** arguments */
  arguments: Expression[]
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
  /** optional chaining is not supported */
  optional: false
}

export type Node
  = Program | ModuleDeclaration | ImportSpecifier | ImportNamespaceSpecifier | ExportSpecifier
    | Statement | Expression | Pattern | Super | VariableDeclarator
    | ClassBody | MethodDefinition | PropertyDefinition | InterfaceMember
    | CatchClause | TemplateElement | Property

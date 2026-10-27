// AST → JavaScript printer of `psc` (§11.3, P2–P6). Statements and expressions become strings; the first line of a
// statement is not indented, its other lines carry their absolute indentation (so template literals spanning lines
// are never re-indented).
import { PScriptSyntaxError, formatExcerpt } from '@/errors'
import type {
  ArrayExpression,
  ArrowFunctionExpression,
  AssignmentExpression,
  BinaryExpression,
  BlockStatement,
  CallExpression,
  ConditionalExpression,
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
  NewExpression,
  Node,
  ObjectExpression,
  Pattern,
  Program,
  Property,
  ReturnStatement,
  Statement,
  Super,
  TemplateLiteral,
  TryStatement,
  UnaryExpression,
  UpdateExpression,
  VariableDeclaration,
  WhileStatement,
} from '@/parser/ast'
import { Helpers } from './helpers'
import { Precedence, binaryPrecedence, precedenceOf, startsAmbiguously } from './precedence'

/** Names JavaScript's strict mode does not allow as bindings. */
const RESTRICTED_NAMES = new Set(['arguments', 'eval'])

/** PScript's strict equality (D1) is JavaScript's `===`. */
const OPERATORS: Partial<Record<string, string>> = { '==': '===', '!=': '!==' }

const INDENT = '  '

/**
 * Names declared in a block or function, to tell local names from globals.
 */
class Names {
  readonly names = new Set<string>()

  constructor(readonly parent: Names | null) {}

  has(name: string): boolean {
    return this.names.has(name) || (this.parent?.has(name) ?? false)
  }
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
  ThisExpression: () => 'this',
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
}

// The names a statement declares in its block (function declarations are hoisted, `let`/`const` have a TDZ: either
// way a use anywhere in the block refers to them).
function declaredBy(statement: Statement): Identifier[] {
  if (statement.type === 'VariableDeclaration') return statement.declarations.map(({ id }) => id)

  return statement.type === 'FunctionDeclaration' ? [statement.id] : []
}

function paramName(param: Pattern): Identifier {
  if (param.type === 'Identifier') return param

  return param.type === 'AssignmentPattern' ? param.left : param.argument
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

  constructor(private readonly program: Program, private readonly source?: string, private readonly fileName?: string) {
    this.helpers = new Helpers(program)
  }

  /**
   * Prints the program.
   *
   * @returns the JavaScript code
   */
  emit(): string {
    const body = this.program.body.map(node => {
      if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration') throw this.unsupported(node, 'Modules')

      return node
    })

    this.declareAll(body)
    const statements = body.map(statement => this.statement(statement)).filter(text => text !== '')

    return `${[...this.helpers.code(), ...statements].join('\n')}\n`
  }

  // ---------------------------------------------------------------------------
  // Names

  private declare(id: Identifier) {
    if (RESTRICTED_NAMES.has(id.name)) throw this.error(`'${id.name}' cannot be used as a name in JavaScript`, id)

    this.names.names.add(id.name)
  }

  private declareAll(body: Statement[]) {
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
    return !this.names.has(name)
  }

  // ---------------------------------------------------------------------------
  // Statements

  statement(node: Statement): string {
    const printer = STATEMENTS[node.type] as Printer<Statement> | undefined
    if (!printer) throw this.unsupported(node, node.type === 'InterfaceDeclaration' ? 'Interfaces' : 'Classes')

    return printer(this, node)
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
    const declarators = declarations.map(({ id, init }) => `${id.name} = ${this.optional(init, Precedence.Assignment, 'null')}`)

    return `${kind} ${declarators.join(', ')}`
  }

  returnStatement({ argument }: ReturnStatement): string {
    // D37: a bare `return` returns null
    return argument ? `return ${this.expression(argument)};` : 'return null;'
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

      init.declarations.forEach(({ id }) => this.declare(id))

      return this.declaration(init)
    } finally {
      this.noIn = false
    }
  }

  forOfStatement({ left, right, body }: ForOfStatement): string {
    const iterated = this.expression(right, Precedence.Assignment)
    if (left.type === 'Identifier') return `for (${this.identifier(left)} of ${iterated}) ${this.body(body)}`

    const [{ id }] = left.declarations

    return `for (${left.kind} ${id.name} of ${iterated}) ${this.body(body, () => this.declare(id))}`
  }

  tryStatement({ block, handler, finalizer }: TryStatement): string {
    let text = `try ${this.block(block.body)}`

    if (handler) {
      const { param, body } = handler
      const clause = param ? `catch (${param.name})` : 'catch'

      text += ` ${clause} ${this.block(body.body, () => param && this.declare(param))}`
    }

    return finalizer ? `${text} finally ${this.block(finalizer.body)}` : text
  }

  // ---------------------------------------------------------------------------
  // Functions

  functionText(node: FunctionDeclaration | FunctionExpression): string {
    const name = node.id ? ` ${node.id.name}` : node.type === 'FunctionExpression' ? ' ' : ''

    return `function${name}${this.functionRest(node.params, node.body, node.type === 'FunctionExpression' ? node.id : null)}`
  }

  // `(params) { body }`; a named function expression's name is visible in its body.
  private functionRest(params: Pattern[], body: BlockStatement, ownName: Identifier | null = null): string {
    return this.scoped(() => {
      if (ownName) this.declare(ownName)

      return `(${this.params(params)}) ${this.functionBody(params, body)}`
    })
  }

  private functionBody(params: Pattern[], body: BlockStatement): string {
    return this.block(body.body, () => params.forEach(param => this.declare(paramName(param))))
  }

  // Default values are printed before the parameters are declared: they see the outer scope or earlier parameters,
  // which are both locals here.
  private params(params: Pattern[]): string {
    return params.map(param => {
      if (param.type === 'Identifier') return param.name
      if (param.type === 'RestElement') return `...${param.argument.name}`

      return `${param.left.name} = ${this.expression(param.right, Precedence.Assignment)}`
    }).join(', ')
  }

  arrow({ params, body, expression }: ArrowFunctionExpression): string {
    const head = params.length === 1 && params[0].type === 'Identifier' ? params[0].name : `(${this.params(params)})`
    if (!expression) return `${head} => ${this.functionBody(params, body as BlockStatement)}`

    return this.scoped(() => {
      params.forEach(param => this.declare(paramName(param)))

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
    const printer = EXPRESSIONS[node.type] as Printer<Expression> | undefined
    if (!printer) throw this.unsupported(node, 'Classes')

    const text = printer(this, node)

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

  identifier({ name }: Identifier): string {
    if (name === 'print' && this.isFree(name)) this.helpers.usePrint()

    return name
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
    const { params, body } = value as FunctionExpression

    return this.functionRest(params, body)
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
    if (argument.type !== 'Identifier' || !this.isFree(argument.name)) return `${name}(${text})`

    return `(typeof ${text} === 'undefined' ? 'undefined' : ${name}(${text}))`
  }

  update({ operator, prefix, argument }: UpdateExpression): string {
    const text = this.expression(argument, Precedence.Postfix)

    return prefix ? `${operator}${text}` : `${text}${operator}`
  }

  binary({ operator, left, right }: BinaryExpression): string {
    const [leftMin, rightMin] = operandPrecedences(operator)
    const text = `${this.expression(left, leftMin)} ${OPERATORS[operator] ?? operator} ${this.expression(right, rightMin)}`

    return operator === 'in' && this.noIn ? `(${text})` : text
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
    return `${this.expression(left, Precedence.Member)} ${operator} ${this.expression(right, Precedence.Assignment)}`
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

  call({ callee, arguments: args }: CallExpression): string {
    if (callee.type === 'Super') throw this.unsupported(callee, 'Classes')

    return `${this.expression(callee, Precedence.Member)}${this.arguments(args)}`
  }

  newExpression({ callee, arguments: args }: NewExpression): string {
    const text = this.expression(callee, Precedence.Member)

    return `new ${containsCall(callee) && !text.startsWith('(') ? `(${text})` : text}${this.arguments(args)}`
  }

  member({ object, property, computed }: MemberExpression): string {
    if (object.type === 'Super') throw this.unsupported(object, 'Classes')

    const base = this.memberObject(object)

    return computed ? `${base}[${this.expression(property as Expression)}]` : `${base}.${(property as Identifier).name}`
  }

  // `1.toString()` would read as a number with a fraction.
  private memberObject(object: Expression): string {
    const text = this.expression(object, Precedence.Member)

    return object.type === 'Literal' && typeof object.value === 'number' ? `(${text})` : text
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

// AST node builders used by the grammar actions (`yy.*`, §5.3).
import type {
  ArrayExpression,
  ArrowFunctionExpression,
  AssignmentExpression,
  AssignmentPattern,
  AssignmentOperator,
  BinaryOperator,
  BlockStatement,
  BreakStatement,
  CatchClause,
  ClassBody,
  ClassDeclaration,
  ClassExpression,
  ContinueStatement,
  ForOfStatement,
  ForStatement,
  IfStatement,
  WhileStatement,
  ConditionalExpression,
  LogicalExpression,
  CallExpression,
  EmptyStatement,
  Expression,
  ExpressionStatement,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  Literal,
  MemberExpression,
  NewExpression,
  ObjectExpression,
  Pattern,
  Program,
  Property,
  RestElement,
  ReturnStatement,
  SourceLocation,
  Statement,
  Super,
  TemplateElement,
  TemplateLiteral,
  ThisExpression,
  ThrowStatement,
  TryStatement,
  UnaryExpression,
  UpdateExpression,
  VariableDeclaration,
  VariableDeclarator,
} from './ast'
import { cookString } from './literals'

/**
 * A Jison token or rule location (lines 1-based, columns 0-based, end exclusive).
 */
export interface JisonLoc {
  /** first line */
  first_line: number
  /** last line */
  last_line: number
  /** first column (0-based) */
  first_column: number
  /** column after the last character (0-based) */
  last_column: number
}

/**
 * Converts a Jison location to an AST location (1-based lines and columns).
 *
 * @param loc Jison location
 * @returns AST location
 */
export function toLoc(loc: JisonLoc): SourceLocation {
  return {
    start: { line: loc.first_line, column: loc.first_column + 1 },
    end: { line: loc.last_line, column: loc.last_column + 1 },
  }
}

/**
 * Location covering the whole source.
 *
 * @param source source text
 * @returns AST location from the first to the last character
 */
export function sourceLoc(source: string): SourceLocation {
  const lines = source.split(/\r\n|[\r\n\u2028\u2029]/)

  return {
    start: { line: 1, column: 1 },
    end: { line: lines.length, column: lines[lines.length - 1].length + 1 },
  }
}

/**
 * The three clauses of a `for` header.
 */
export type ForHeader = Pick<ForStatement, 'init' | 'test' | 'update'>

export type FunctionNode = FunctionDeclaration | FunctionExpression

export type ClassNode = ClassDeclaration | ClassExpression

/**
 * Name and `final` flag of a class.
 */
export interface ClassHead {
  /** class name, if any */
  id: Identifier | null
  /** `final class` */
  final: boolean
}

/**
 * `extends` clause and body of a class.
 */
export interface ClassTail {
  /** the `extends` expression */
  superClass: Expression | null
  /** the `implements` list */
  implements: Expression[]
  /** the class body */
  body: ClassBody
}

export type FunctionType = FunctionNode['type']

/**
 * Name and parameters of a function.
 */
export interface FunctionHead {
  /** function name, if any */
  id: Identifier | null
  /** formal parameters */
  params: Pattern[]
}

export const builders = {
  expressionStatement(expression: Expression, loc: JisonLoc): ExpressionStatement {
    return { type: 'ExpressionStatement', expression, loc: toLoc(loc) }
  },

  jump(type: 'BreakStatement' | 'ContinueStatement', loc: JisonLoc): BreakStatement | ContinueStatement {
    return { type, label: null, loc: toLoc(loc) }
  },

  ifStatement(test: Expression, consequent: Statement, alternate: Statement | null, loc: JisonLoc): IfStatement {
    return { type: 'IfStatement', test, consequent, alternate, loc: toLoc(loc) }
  },

  whileStatement(test: Expression, body: Statement, loc: JisonLoc): WhileStatement {
    return { type: 'WhileStatement', test, body, loc: toLoc(loc) }
  },

  forStatement({ init, test, update }: ForHeader, body: Statement, loc: JisonLoc): ForStatement {
    return { type: 'ForStatement', init, test, update, body, loc: toLoc(loc) }
  },

  functionNode(type: FunctionType, { id, params }: FunctionHead, body: BlockStatement, loc: JisonLoc): FunctionNode {
    return { type, id, params, body, loc: toLoc(loc) } as FunctionNode
  },

  arrow(params: Pattern[], body: BlockStatement | Expression, loc: JisonLoc): ArrowFunctionExpression {
    const expression = body.type !== 'BlockStatement'

    return { type: 'ArrowFunctionExpression', id: null, params, body, expression, loc: toLoc(loc) }
  },

  assignmentPattern(left: Identifier, right: Expression, loc: JisonLoc): AssignmentPattern {
    return { type: 'AssignmentPattern', left, right, loc: toLoc(loc) }
  },

  restElement(argument: Identifier, loc: JisonLoc): RestElement {
    return { type: 'RestElement', argument, loc: toLoc(loc) }
  },

  returnStatement(argument: Expression | null, loc: JisonLoc): ReturnStatement {
    return { type: 'ReturnStatement', argument, loc: toLoc(loc) }
  },

  thisExpression(loc: JisonLoc): ThisExpression {
    return { type: 'ThisExpression', loc: toLoc(loc) }
  },

  member(object: Expression, property: Expression, computed: boolean, loc: JisonLoc): MemberExpression {
    return { type: 'MemberExpression', object, property, computed, optional: false, loc: toLoc(loc) }
  },

  classNode(type: ClassNode['type'], { id, final }: ClassHead, tail: ClassTail, loc: JisonLoc): ClassNode {
    const { superClass, body } = tail

    return { type, id, superClass, body, final, implements: tail.implements, loc: toLoc(loc) } as ClassNode
  },

  classBody(body: ClassBody['body'], loc: JisonLoc): ClassBody {
    return { type: 'ClassBody', body, loc: toLoc(loc) }
  },

  superNode(loc: JisonLoc): Super {
    return { type: 'Super', loc: toLoc(loc) }
  },

  template(quasis: TemplateElement[], expressions: Expression[], loc: JisonLoc): TemplateLiteral {
    return { type: 'TemplateLiteral', quasis, expressions, loc: toLoc(loc) }
  },

  array(elements: Expression[], loc: JisonLoc): ArrayExpression {
    return { type: 'ArrayExpression', elements, loc: toLoc(loc) }
  },

  forOfStatement(left: ForOfStatement['left'], right: Expression, body: Statement, loc: JisonLoc): ForOfStatement {
    return { type: 'ForOfStatement', left, right, body, await: false, loc: toLoc(loc) }
  },

  // `let x` / `const x` in `for (… of …)`: one declarator without initialiser.
  forOfDeclaration(kind: 'let' | 'const', id: Identifier, start: JisonLoc, end: JisonLoc): VariableDeclaration {
    const loc = toLoc({ ...start, last_line: end.last_line, last_column: end.last_column })

    return { type: 'VariableDeclaration', kind, declarations: [{ type: 'VariableDeclarator', id, init: null, loc: id.loc }], loc }
  },

  object(properties: Property[], loc: JisonLoc): ObjectExpression {
    return { type: 'ObjectExpression', properties, loc: toLoc(loc) }
  },

  property(key: Identifier | Literal, value: Expression, method: boolean, loc: JisonLoc): Property {
    return { type: 'Property', key, value, kind: 'init', method, shorthand: false, computed: false, loc: toLoc(loc) }
  },

  accessorProperty(kind: 'get' | 'set', key: Identifier | Literal, value: Expression, loc: JisonLoc): Property {
    return { type: 'Property', key, value, kind, method: false, shorthand: false, computed: false, loc: toLoc(loc) }
  },

  newExpression(callee: Expression, args: Expression[], loc: JisonLoc): NewExpression {
    return { type: 'NewExpression', callee, arguments: args, loc: toLoc(loc) }
  },

  throwStatement(argument: Expression, loc: JisonLoc): ThrowStatement {
    return { type: 'ThrowStatement', argument, loc: toLoc(loc) }
  },

  tryStatement(block: BlockStatement, handler: CatchClause | null, finalizer: BlockStatement | null, loc: JisonLoc) {
    return { type: 'TryStatement', block, handler, finalizer, loc: toLoc(loc) } satisfies TryStatement
  },

  catchClause(param: Identifier | null, body: BlockStatement, loc: JisonLoc): CatchClause {
    return { type: 'CatchClause', param, body, loc: toLoc(loc) }
  },

  block(body: Statement[], loc: JisonLoc): BlockStatement {
    return { type: 'BlockStatement', body, loc: toLoc(loc) }
  },

  variableDeclaration(kind: 'let' | 'const', declarations: VariableDeclarator[], loc: JisonLoc): VariableDeclaration {
    return { type: 'VariableDeclaration', kind, declarations, loc: toLoc(loc) }
  },

  declarator(id: Identifier, init: Expression | null, loc: JisonLoc): VariableDeclarator {
    return { type: 'VariableDeclarator', id, init, loc: toLoc(loc) }
  },

  assignment(
    operator: AssignmentOperator,
    left: AssignmentExpression['left'],
    right: Expression,
    loc: JisonLoc,
  ): AssignmentExpression {
    return { type: 'AssignmentExpression', operator, left, right, loc: toLoc(loc) }
  },

  emptyStatement(loc: JisonLoc): EmptyStatement {
    return { type: 'EmptyStatement', loc: toLoc(loc) }
  },

  binary(operator: BinaryOperator, left: Expression, right: Expression, loc: JisonLoc): Expression {
    return { type: 'BinaryExpression', operator, left, right, loc: toLoc(loc) }
  },

  logical(operator: LogicalExpression['operator'], left: Expression, right: Expression, loc: JisonLoc): LogicalExpression {
    return { type: 'LogicalExpression', operator, left, right, loc: toLoc(loc) }
  },

  conditional(test: Expression, consequent: Expression, alternate: Expression, loc: JisonLoc): ConditionalExpression {
    return { type: 'ConditionalExpression', test, consequent, alternate, loc: toLoc(loc) }
  },

  update(operator: '++' | '--', prefix: boolean, argument: UpdateExpression['argument'], loc: JisonLoc): UpdateExpression {
    return { type: 'UpdateExpression', operator, prefix, argument, loc: toLoc(loc) }
  },

  unary(operator: UnaryExpression['operator'], argument: Expression, loc: JisonLoc): UnaryExpression {
    return { type: 'UnaryExpression', operator, prefix: true, argument, loc: toLoc(loc) }
  },

  call(callee: Expression, args: Expression[], loc: JisonLoc): CallExpression {
    return { type: 'CallExpression', callee, arguments: args, optional: false, loc: toLoc(loc) }
  },

  literal(value: Literal['value'], raw: string, loc: JisonLoc): Literal {
    return { type: 'Literal', value, raw, loc: toLoc(loc) }
  },

  numberLiteral(raw: string, loc: JisonLoc): Literal {
    return builders.literal(Number(raw), raw, loc)
  },

  stringLiteral(raw: string, loc: JisonLoc): Literal {
    return builders.literal(cookString(raw), raw, loc)
  },

  identifier(name: string, loc: JisonLoc): Identifier {
    return { type: 'Identifier', name, loc: toLoc(loc) }
  },
}

export type Builders = typeof builders

export type { Program, Statement }

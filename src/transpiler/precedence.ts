// Operator precedence of the emitted JavaScript (§11.3): when a child expression needs parentheses.
import type { Expression } from '@/parser/ast'

/** Precedence levels, lowest first (as in the ECMAScript grammar). */
export enum Precedence {
  Lowest = 0,
  Assignment = 2,
  Conditional = 3,
  Nullish = 4,
  Or = 5,
  And = 6,
  Equality = 10,
  Relational = 11,
  Additive = 13,
  Multiplicative = 14,
  Exponent = 15,
  Unary = 16,
  Postfix = 17,
  Member = 18,
  Primary = 20,
}

const BINARY: Record<string, Precedence> = {
  '??': Precedence.Nullish,
  '||': Precedence.Or,
  '&&': Precedence.And,
  '==': Precedence.Equality,
  '!=': Precedence.Equality,
  '<': Precedence.Relational,
  '<=': Precedence.Relational,
  '>': Precedence.Relational,
  '>=': Precedence.Relational,
  'instanceof': Precedence.Relational,
  'in': Precedence.Relational,
  '+': Precedence.Additive,
  '-': Precedence.Additive,
  '*': Precedence.Multiplicative,
  '/': Precedence.Multiplicative,
  '%': Precedence.Multiplicative,
  '**': Precedence.Exponent,
}

type ByType<R> = { [K in Expression['type']]?: (node: Extract<Expression, { type: K }>) => R }

const PRECEDENCES: ByType<Precedence> = {
  AssignmentExpression: () => Precedence.Assignment,
  ArrowFunctionExpression: () => Precedence.Assignment,
  ConditionalExpression: () => Precedence.Conditional,
  LogicalExpression: node => BINARY[node.operator],
  BinaryExpression: node => BINARY[node.operator],
  YieldExpression: () => Precedence.Assignment,
  AwaitExpression: () => Precedence.Unary,
  UnaryExpression: () => Precedence.Unary,
  UpdateExpression: node => node.prefix ? Precedence.Unary : Precedence.Postfix,
  MemberExpression: () => Precedence.Member,
  CallExpression: () => Precedence.Member,
  NewExpression: () => Precedence.Member,
  // `(a?.b).c` keeps its parentheses: a chain ends where a member or call of it would continue it (D47)
  ChainExpression: () => Precedence.Postfix,
}

// The sub-expression an expression's text starts with, when it does not start with its own token.
const LEFT_CHILDREN: ByType<Expression | null> = {
  BinaryExpression: node => node.left,
  LogicalExpression: node => node.left,
  AssignmentExpression: node => node.left as Expression, // an object pattern starts with `{` too
  ConditionalExpression: node => node.test,
  CallExpression: node => node.callee.type === 'Super' ? null : node.callee,
  MemberExpression: node => node.object.type === 'Super' ? null : node.object,
  UpdateExpression: node => node.prefix ? null : node.argument,
  ChainExpression: node => node.expression,
}

/**
 * The precedence of an operator of a binary or logical expression.
 *
 * @param operator the operator
 * @returns its level
 */
export function binaryPrecedence(operator: string): Precedence {
  return BINARY[operator]
}

/**
 * The precedence of an expression, as it will be printed.
 *
 * @param node the expression
 * @returns its level
 */
export function precedenceOf(node: Expression): Precedence {
  return PRECEDENCES[node.type]?.(node as never) ?? Precedence.Primary
}

/**
 * The expression a printed expression starts with, e.g. `{}` in `{}.x` (statements and arrow bodies must not start
 * with `{`, `function` or `class`).
 *
 * @param node the expression
 * @returns its leftmost sub-expression
 */
export function leftmost(node: Expression): Expression {
  const child = LEFT_CHILDREN[node.type]?.(node as never)

  return child ? leftmost(child) : node
}

/**
 * Whether an expression in statement position or as an arrow body must be wrapped in parentheses.
 *
 * @param node the expression
 * @returns true when it starts with `{`, `function` or `class`
 */
export function startsAmbiguously(node: Expression): boolean {
  return ['ObjectExpression', 'ObjectPattern', 'FunctionExpression', 'ClassExpression'].includes(leftmost(node).type)
}

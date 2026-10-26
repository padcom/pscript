import { describe, expect, it } from 'vitest'
import type { Expression, ExpressionStatement, Node } from '@/parser/ast'
import { parse } from '@/parser/parse'

function expression(source: string): Expression {
  return (parse(source).body[0] as ExpressionStatement).expression
}

const RENDER: Record<string, (node: any, render: (node: Node) => string) => string> = {
  LogicalExpression: (node, render) => `(${render(node.left)} ${node.operator} ${render(node.right)})`,
  ConditionalExpression: (node, render) => `(${render(node.test)} ? ${render(node.consequent)} : ${render(node.alternate)})`,
  UpdateExpression: (node, render) => node.prefix
    ? `(${node.operator}${render(node.argument)})`
    : `(${render(node.argument)}${node.operator})`,
  AssignmentExpression: (node, render) => `(${render(node.left)} ${node.operator} ${render(node.right)})`,
  BinaryExpression: (node, render) => `(${render(node.left)} ${node.operator} ${render(node.right)})`,
  UnaryExpression: (node, render) => `(${node.operator === 'typeof' ? 'typeof ' : node.operator}${render(node.argument)})`,
  CallExpression: (node, render) => `${render(node.callee)}(${node.arguments.map(render).join(', ')})`,
  Literal: node => node.raw,
  Identifier: node => node.name,
}

/**
 * Renders an expression with explicit parentheses.
 *
 * @param node expression
 * @returns its text
 */
function show(node: Node): string {
  return RENDER[node.type](node, show)
}

describe('precedence', () => {
  it.each([
    ['1 + 2 * 3', '(1 + (2 * 3))'],
    ['1 - 2 - 3', '((1 - 2) - 3)'],
    ['8 / 4 % 3 * 2', '(((8 / 4) % 3) * 2)'],
    ['2 ** 3 ** 2', '(2 ** (3 ** 2))'],
    ['-2 ** 2', '(-(2 ** 2))'],
    ['2 ** -2', '(2 ** (-2))'],
    ['2 ** -2 ** 2', '(2 ** (-(2 ** 2)))'],
    ['-a * b', '((-a) * b)'],
    ['!-+x', '(!(-(+x)))'],
    ['typeof x + 1', '((typeof x) + 1)'],
    ['(1 + 2) * 3', '((1 + 2) * 3)'],
    ['f(1, g(2))(3)', 'f(1, g(2))(3)'],
    ['f(a, b,)', 'f(a, b)'],
    ['-f(1) ** 2', '(-(f(1) ** 2))'],
  ])('%s', (source, expected) => {
    expect(show(expression(source))).toBe(expected)
  })
})

describe('precedence of comparison, logical and conditional operators (§4.4.3)', () => {
  it.each([
    ['a < b == c > d', '((a < b) == (c > d))'],
    ['a + 1 < b * 2', '((a + 1) < (b * 2))'],
    ['a instanceof B in c', '((a instanceof B) in c)'],
    ['a == b != c', '((a == b) != c)'],
    ['a && b || c && d', '((a && b) || (c && d))'],
    ['a || b ?? c', '((a || b) ?? c)'],
    ['a ?? b || c', '(a ?? (b || c))'],
    ['a ?? b && c ?? d', '((a ?? (b && c)) ?? d)'],
    ['!a && b', '((!a) && b)'],
    ['a ? b : c ? d : e', '(a ? b : (c ? d : e))'],
    ['a || b ? c : d', '((a || b) ? c : d)'],
    ['a ? b = 1 : c = 2', '(a ? (b = 1) : (c = 2))'],
    ['x = a ? b : c', '(x = (a ? b : c))'],
    ['-a++ ** 2', '(-((a++) ** 2))'],
    ['++a + b--', '((++a) + (b--))'],
    ['!--a', '(!(--a))'],
    ['typeof a++', '(typeof (a++))'],
  ])('%s', (source, expected) => {
    expect(show(expression(source))).toBe(expected)
  })
})

describe('locations', () => {
  it('uses 1-based lines and columns, end exclusive', () => {
    expect(expression('  1 + 23')).toMatchObject({
      loc: { start: { line: 1, column: 3 }, end: { line: 1, column: 9 } },
      right: { loc: { start: { line: 1, column: 7 }, end: { line: 1, column: 9 } } },
    })
  })

  it('covers the whole source with the Program', () => {
    expect(parse('1;\n22').loc).toEqual({ start: { line: 1, column: 1 }, end: { line: 2, column: 3 } })
  })
})

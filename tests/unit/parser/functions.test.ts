import { describe, expect, it } from 'vitest'
import type { ExpressionStatement } from '@/parser/ast'
import { parse, tokenize } from '@/parser/parse'

describe('function syntax', () => {
  it('parses declarations with all parameter kinds', () => {
    expect(parse('function f(a, b = 1, ...c) { return a }').body[0]).toMatchObject({
      type: 'FunctionDeclaration',
      id: { name: 'f' },
      params: [
        { type: 'Identifier', name: 'a' },
        { type: 'AssignmentPattern', left: { name: 'b' }, right: { value: 1 } },
        { type: 'RestElement', argument: { name: 'c' } },
      ],
      body: { type: 'BlockStatement', body: [{ type: 'ReturnStatement', argument: { name: 'a' } }] },
    })
  })

  it('parses anonymous and named function expressions', () => {
    const [anonymous, named] = parse('(function () {});\n(function g(x,) { return })')
      .body.map(s => (s as ExpressionStatement).expression)

    expect(anonymous).toMatchObject({ type: 'FunctionExpression', id: null, params: [] })
    expect(named).toMatchObject({ type: 'FunctionExpression', id: { name: 'g' }, params: [{ name: 'x' }] })
  })

  it('parses this, new and return with ASI', () => {
    expect(parse('function f() {\n  return\n  this\n}').body[0]).toMatchObject({
      body: { body: [{ type: 'ReturnStatement', argument: null }, { expression: { type: 'ThisExpression' } }] },
    })
    expect(parse('new F(1, 2)').body[0])
      .toMatchObject({ expression: { type: 'NewExpression', callee: { name: 'F' }, arguments: [{}, {}] } })
  })
})

describe('function declarations vs expressions', () => {
  it('tells declarations from expressions by position', () => {
    expect(tokenize('function f() {}')[0]).toBe('FUNCTION_DECLARATION')
    expect(tokenize('{ function f() {} }')[1]).toBe('FUNCTION_DECLARATION')
    expect(tokenize('if (a) b; function f() {}')[6]).toBe('FUNCTION_DECLARATION')
    expect(tokenize('let f = function () {}')[3]).toBe('FUNCTION')
    expect(tokenize('g(function () {})')[2]).toBe('FUNCTION')
  })
})

describe('function syntax errors', () => {
  it.each([
    ['function f(a = 1, b) {}', "Required parameter 'b' cannot follow an optional parameter", 19],
    ['function f(...a, b) {}', 'A rest parameter must be last', 18],
    ['function f(a, b, a) {}', "Duplicate parameter name 'a'", 18],
    ['if (x) function f() {}', 'Functions can only be declared at top level or inside a block', 8],
    ['function () {}', 'Unexpected token', 10],
  ])('%j', (source, reason, column) => {
    expect(() => parse(source)).toThrow(expect.objectContaining({ reason: expect.stringContaining(reason), column }))
  })
})

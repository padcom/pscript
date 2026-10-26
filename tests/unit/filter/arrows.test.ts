import { describe, expect, it } from 'vitest'
import { parse, tokenize } from '@/parser/parse'

describe('arrow detection (§4.2.3)', () => {
  it.each([
    ['x => x', ['ARROW_IDENT', '=>', 'IDENT', ';', 'EOF']],
    ['() => 1', ['ARROW_LPAREN', ')', '=>', 'NUMBER', ';', 'EOF']],
    ['(a, b) => a', ['ARROW_LPAREN', 'IDENT', ',', 'IDENT', ')', '=>', 'IDENT', ';', 'EOF']],
    ['(a = f(1)) => a', ['ARROW_LPAREN', 'IDENT', '=', 'IDENT', '(', 'NUMBER', ')', ')', '=>', 'IDENT', ';', 'EOF']],
    ['(a + b) * c', ['(', 'IDENT', '+', 'IDENT', ')', '*', 'IDENT', ';', 'EOF']],
    ['f((a) => a)', ['IDENT', '(', 'ARROW_LPAREN', 'IDENT', ')', '=>', 'IDENT', ')', ';', 'EOF']],
    ['f(a)(b => b)', ['IDENT', '(', 'IDENT', ')', '(', 'ARROW_IDENT', '=>', 'IDENT', ')', ';', 'EOF']],
    ['(x', ['(', 'IDENT', 'EOF']],
  ])('%j', (source, tokens) => {
    expect(tokenize(source)).toEqual(tokens)
  })

  it('rejects a newline before =>', () => {
    expect(() => parse('(a)\n=> a'))
      .toThrow(expect.objectContaining({ reason: "Line terminator not permitted before '=>'", line: 2 }))
    expect(() => parse('a\n=> a')).toThrow("Line terminator not permitted before '=>'")
  })
})

describe('arrow syntax', () => {
  it('builds ArrowFunctionExpression nodes', () => {
    expect(parse('x => x * 2').body[0]).toMatchObject({
      expression: {
        type: 'ArrowFunctionExpression', id: null, params: [{ name: 'x' }], expression: true,
        body: { type: 'BinaryExpression' },
      },
    })
    expect(parse('(a, ...b) => { return a }').body[0]).toMatchObject({
      expression: {
        params: [{ type: 'Identifier' }, { type: 'RestElement' }], expression: false,
        body: { type: 'BlockStatement' },
      },
    })
  })

  it('is right-associative and has the lowest precedence', () => {
    expect(parse('a => b => a + b').body[0]).toMatchObject({
      expression: { body: { type: 'ArrowFunctionExpression', body: { type: 'BinaryExpression' } } },
    })
    expect(parse('f(x => x, 1)').body[0])
      .toMatchObject({ expression: { arguments: [{ type: 'ArrowFunctionExpression' }, { value: 1 }] } })
  })

  it('checks arrow parameters like function parameters', () => {
    expect(() => parse('(a = 1, b) => a')).toThrow("Required parameter 'b' cannot follow an optional parameter")
    expect(() => parse('(a, a) => a')).toThrow("Duplicate parameter name 'a'")
  })
})

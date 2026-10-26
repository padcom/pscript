import { describe, expect, it } from 'vitest'
import type { ExpressionStatement } from '@/parser/ast'
import { parse } from '@/parser/parse'

function expression(source: string) {
  return (parse(source).body[0] as ExpressionStatement).expression
}

describe('object literals', () => {
  it('parses every property form', () => {
    expect(expression("x = { a: 1, 'b c': 2, 3: 4, d, m(y) { return y }, }")).toMatchObject({
      right: {
        type: 'ObjectExpression',
        properties: [
          {
            type: 'Property',
            key: { type: 'Identifier', name: 'a' },
            value: { value: 1 },
            kind: 'init',
            method: false,
            shorthand: false,
            computed: false,
          },
          { key: { type: 'Literal', value: 'b c' } },
          { key: { type: 'Literal', value: 3 } },
          { key: { name: 'd' }, value: { type: 'Identifier', name: 'd' }, shorthand: true },
          { key: { name: 'm' }, value: { type: 'FunctionExpression', id: null, params: [{ name: 'y' }] }, method: true },
        ],
      },
    })
  })

  it('rejects keywords as shorthand properties', () => {
    expect(() => parse('x = { if }')).toThrow("Unexpected keyword 'if' in shorthand property")
  })
})

describe('member expressions', () => {
  it('parses dot and bracket access', () => {
    expect(expression('a.b[c].d')).toMatchObject({
      type: 'MemberExpression',
      property: { name: 'd' },
      computed: false,
      object: { computed: true, property: { name: 'c' }, object: { object: { name: 'a' }, property: { name: 'b' } } },
    })
  })

  it('binds new to the member chain and lets calls extend it', () => {
    expect(expression('new a.B(1).c()')).toMatchObject({
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        property: { name: 'c' },
        object: { type: 'NewExpression', callee: { type: 'MemberExpression' } },
      },
    })
  })

  it('accepts members as assignment and update targets', () => {
    expect(expression('o.a.b = 1')).toMatchObject({ type: 'AssignmentExpression', left: { type: 'MemberExpression' } })
    expect(expression('o[k]++')).toMatchObject({ type: 'UpdateExpression', argument: { computed: true } })
  })
})

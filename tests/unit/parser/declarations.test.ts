import { describe, expect, it } from 'vitest'
import type { BlockStatement } from '@/parser/ast'
import { parse } from '@/parser/parse'

describe('declarations and blocks', () => {
  it('parses let and const with several declarators', () => {
    expect(parse('let a, b = 1\nconst c = 2').body).toMatchObject([
      {
        type: 'VariableDeclaration',
        kind: 'let',
        declarations: [{ id: { name: 'a' }, init: null }, { id: { name: 'b' }, init: { value: 1 } }],
      },
      { type: 'VariableDeclaration', kind: 'const', declarations: [{ id: { name: 'c' }, init: { value: 2 } }] },
    ])
  })

  it('parses nested blocks; the `;` inserted after a block `}` is an EmptyStatement (§4.2.1)', () => {
    const [outer] = parse('{ let a = 1\n { a } }').body

    expect(outer).toMatchObject({ type: 'BlockStatement' })
    expect((outer as BlockStatement).body.map(s => s.type)).toEqual(['VariableDeclaration', 'BlockStatement', 'EmptyStatement'])
  })

  it.each([
    ['const a', "Missing initializer in const declaration 'a'", 7],
    ['let undefined = 1', 'Unexpected token', 5],
    ['let let = 1', 'Unexpected token', 5],
  ])('rejects %j', (source, reason, column) => {
    expect(() => parse(source)).toThrow(expect.objectContaining({ reason: expect.stringContaining(reason), column }))
  })
})

describe('assignment', () => {
  it('is right-associative and an expression', () => {
    expect(parse('a = b += 1').body[0]).toMatchObject({
      expression: {
        type: 'AssignmentExpression',
        operator: '=',
        left: { name: 'a' },
        right: { operator: '+=', left: { name: 'b' } },
      },
    })
  })

  it.each(['=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??='])('parses %s', operator => {
    expect(parse(`x ${operator} 1`).body[0]).toMatchObject({ expression: { type: 'AssignmentExpression', operator } })
  })

  it.each([
    ['1 = 2', 'Invalid assignment target', 1],
    ['f() = 2', 'Invalid assignment target', 1],
    ['a + b = 2', 'Unexpected token', 7],
    ['undefined = 1', "Cannot assign to 'undefined'", 1],
  ])('rejects %j', (source, reason, column) => {
    expect(() => parse(source)).toThrow(expect.objectContaining({ reason: expect.stringContaining(reason), column }))
  })
})

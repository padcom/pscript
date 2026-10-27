import { describe, expect, it } from 'vitest'
import type { ClassDeclaration, ExpressionStatement, ObjectExpression } from '@/parser/ast'
import { parse, tokenize } from '@/parser/parse'

describe('get / set keywords (§4.2.5)', () => {
  it.each([
    ['class A { get x() {} }', 'GET IDENT'],
    ['class A { static set x(v) {} }', 'SET IDENT'],
    ['class A { get() {} }', 'IDENT ('],
    ['class A { get = 1 }', 'IDENT ='],
    ['class A { get\n x() {} }', 'IDENT ;'],
    ['x = { get y() {} }', 'GET IDENT'],
    ['x = { get: 1 }', 'IDENT :'],
    ['x = { get }', 'IDENT }'],
    ['x = { a, set if(v) {} }', 'SET IDENT'],
  ])('%j', (source, expected) => {
    expect(tokenize(source).join(' ')).toContain(expected)
  })

  it('recognises members on a new line after a field', () => {
    expect(tokenize('class A {\n x = 0\n get y() {}\n}').join(' ')).toContain('; GET IDENT')
  })
})

describe('accessor syntax', () => {
  it('builds class accessors and object-literal accessor properties', () => {
    const cls = parse('class A { get x() {}\n set x(v) {} }').body[0] as ClassDeclaration

    expect(cls.body.body.map(m => m.type === 'MethodDefinition' && m.kind)).toEqual(['get', 'set'])

    const statement = parse('o = { get x() { return 1 }, set x(v) {} }').body[0] as ExpressionStatement
    const object = (statement.expression as { right: ObjectExpression }).right

    expect(object.properties.map(p => p.type === 'Property' && [p.kind, p.method])).toEqual([['get', false], ['set', false]])
  })

  it('rejects an accessor named constructor and wrong arities', () => {
    expect(() => parse('class A { get constructor() {} }')).toThrow('Class constructor may not be an accessor')
    expect(() => parse('class A { get x(a) {} }')).toThrow()
    expect(() => parse('class A { set x() {} }')).toThrow()
  })
})

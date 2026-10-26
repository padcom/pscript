import { describe, expect, it } from 'vitest'
import type { ClassDeclaration, ExpressionStatement } from '@/parser/ast'
import { parse, tokenize } from '@/parser/parse'

function members(source: string) {
  return (parse(source).body[0] as ClassDeclaration).body.body
}

describe('class tokens', () => {
  it.each([
    ['class A {}', 'CLASS_DECLARATION IDENT CLASS_LBRACE } EOF'],
    ['final class A {}', 'FINAL CLASS_DECLARATION IDENT CLASS_LBRACE } EOF'],
    ['x = class {}', 'IDENT = CLASS CLASS_LBRACE } ; EOF'],
    ['class A extends f({}) {}', 'CLASS_DECLARATION IDENT EXTENDS IDENT ( OBJ_LBRACE } ) CLASS_LBRACE } EOF'],
    ['class A { static() {} }', 'CLASS_DECLARATION IDENT CLASS_LBRACE IDENT ( ) BLOCK_LBRACE } ; } EOF'],
    ['class A { final = 1 }', 'CLASS_DECLARATION IDENT CLASS_LBRACE IDENT = NUMBER ; } EOF'],
    ['class A { final override m() {} }', 'CLASS_DECLARATION IDENT CLASS_LBRACE FINAL OVERRIDE IDENT ( ) BLOCK_LBRACE } ; } EOF'],
    ['class A { private if = 1 }', 'CLASS_DECLARATION IDENT CLASS_LBRACE PRIVATE IDENT = NUMBER ; } EOF'],
  ])('%s', (source, tokens) => {
    expect(tokenize(source).join(' ')).toBe(tokens)
  })

  it('inserts semicolons between members (§4.2.1)', () => {
    expect(tokenize('class A {\n x = 1\n m() {}\n y\n}').filter(t => t === ';')).toHaveLength(3)
  })
})

describe('class syntax', () => {
  it('records modifiers on members', () => {
    expect(members('class A { protected static final x = 1\n protected override m() {}\n constructor() {} }')).toMatchObject([
      { type: 'PropertyDefinition', key: { name: 'x' }, access: 'protected', static: true, final: true, override: false },
      { type: 'MethodDefinition', kind: 'method', access: 'protected', override: true, static: false },
      { type: 'MethodDefinition', kind: 'constructor', access: 'public' },
    ])
  })

  it('parses class expressions, extends and final', () => {
    expect((parse('x = final class B extends A {}').body[0] as ExpressionStatement).expression).toMatchObject({
      right: { type: 'ClassExpression', id: { name: 'B' }, superClass: { name: 'A' }, final: true, implements: [] },
    })
  })

  it.each([
    ['class C { override private m() {} }', "Modifier 'private' cannot follow 'override'"],
    ['class C { private final m() {} }', "Private members cannot be 'final'"],
    ['class C { private override m() {} }', "Private members cannot be 'override'"],
    ['class C { constructor = 1 }', "Classes may not have a field named 'constructor'"],
    ['class C { static static x }', "Modifier 'static' cannot follow 'static'"],
  ])('rejects %j', (source, message) => {
    expect(() => parse(source)).toThrow(message)
  })
})

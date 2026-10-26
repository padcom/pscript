import { describe, expect, it } from 'vitest'
import { tokenize } from '@/parser/parse'

function braces(source: string): string[] {
  return tokenize(source).filter(name => name.endsWith('LBRACE'))
}

describe('brace classification (§4.2.2)', () => {
  it.each([
    ['{}', ['BLOCK_LBRACE']],
    ['x = {}', ['OBJ_LBRACE']],
    ['f({})', ['OBJ_LBRACE']],
    ['if (a) {}', ['BLOCK_LBRACE']],
    ['if (a) {} else {}', ['BLOCK_LBRACE', 'BLOCK_LBRACE']],
    ['function f() { return {} }', ['BLOCK_LBRACE', 'OBJ_LBRACE']],
    ['let f = () => {}', ['BLOCK_LBRACE']],
    ['let f = () => ({})', ['OBJ_LBRACE']],
    ['x = { a: { b: {} } }', ['OBJ_LBRACE', 'OBJ_LBRACE', 'OBJ_LBRACE']],
    ['x = { m() {} }', ['OBJ_LBRACE', 'BLOCK_LBRACE']],
    ['x = [{}]', ['OBJ_LBRACE']],
    ['x = a ? {} : {}', ['OBJ_LBRACE', 'OBJ_LBRACE']],
    ['{ {} }', ['BLOCK_LBRACE', 'BLOCK_LBRACE']],
    ['a; {}', ['BLOCK_LBRACE']],
  ])('%s', (source, expected) => {
    expect(braces(source)).toEqual(expected)
  })
})

describe('keywords as property names (§4.2.4)', () => {
  it.each([
    ['o.class', ['IDENT', '.', 'IDENT', ';', 'EOF']],
    ['o.new.if', ['IDENT', '.', 'IDENT', '.', 'IDENT', ';', 'EOF']],
    ['x = { class: 1 }', ['IDENT', '=', 'OBJ_LBRACE', 'IDENT', ':', 'NUMBER', '}', ';', 'EOF']],
    ['x = { if() {} }', ['IDENT', '=', 'OBJ_LBRACE', 'IDENT', '(', ')', 'BLOCK_LBRACE', '}', '}', ';', 'EOF']],
    ['x = { a: 1, new: 2 }', ['IDENT', '=', 'OBJ_LBRACE', 'IDENT', ':', 'NUMBER', ',', 'IDENT', ':', 'NUMBER', '}', ';', 'EOF']],
    ['x = { a: new F() }', ['IDENT', '=', 'OBJ_LBRACE', 'IDENT', ':', 'NEW', 'IDENT', '(', ')', '}', ';', 'EOF']],
    ['{ class: 1 }', ['BLOCK_LBRACE', 'CLASS_DECLARATION', ':', 'NUMBER', ';', '}', 'EOF']],
  ])('%j', (source, tokens) => {
    expect(tokenize(source)).toEqual(tokens)
  })
})

describe('ASI around object literals', () => {
  it('does not insert inside an object literal and does after it', () => {
    expect(tokenize('let o = {\n a: 1,\n b: 2\n}\nx')).toEqual([
      'LET', 'IDENT', '=', 'OBJ_LBRACE', 'IDENT', ':', 'NUMBER', ',', 'IDENT', ':', 'NUMBER', '}', ';', 'IDENT', ';', 'EOF',
    ])
  })
})

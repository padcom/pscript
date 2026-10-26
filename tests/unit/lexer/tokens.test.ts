import { describe, expect, it } from 'vitest'
import { parse } from '@/parser/parse'

describe('lexical errors', () => {
  it.each([
    ['a # b', "Unexpected '#'. Use the 'private' modifier for private members", 3],
    ['1 === 1', "'===' is not supported; use '=='", 3],
    ['1 !== 1', "'!==' is not supported; use '!='", 3],
    ['var', "Unexpected reserved word 'var'", 1],
    ['1 + async', "Unexpected reserved word 'async'", 5],
    ['1 @ 2', "Unexpected character '@'", 3],
  ])('%s', (source, reason, column) => {
    expect(() => parse(source)).toThrow(expect.objectContaining({ reason, line: 1, column }))
  })

  it('treats $ as an identifier character', () => {
    expect(parse('$a_1')).toMatchObject({ body: [{ expression: { type: 'Identifier', name: '$a_1' } }] })
  })

  it('parses undefined as an Identifier', () => {
    expect(parse('undefined')).toMatchObject({ body: [{ expression: { type: 'Identifier', name: 'undefined' } }] })
  })
})

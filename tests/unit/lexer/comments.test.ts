import { describe, expect, it } from 'vitest'
import { parse, tokenize } from '@/parser/parse'

describe('comments', () => {
  it.each([
    ['a // comment\nb', ['IDENT', ';', 'IDENT', ';', 'EOF']],
    ['// only a comment', ['EOF']],
    ['a /* inline */ + b', ['IDENT', '+', 'IDENT', ';', 'EOF']],
    ['a /* spans\nlines */ b', ['IDENT', ';', 'IDENT', ';', 'EOF']],
    ['a /* x */ /* y */\nb', ['IDENT', ';', 'IDENT', ';', 'EOF']],
    ['/* a */ /* b */ 1', ['NUMBER', ';', 'EOF']],
    ['a /* not /* nested */ + b', ['IDENT', '+', 'IDENT', ';', 'EOF']],
    ['1 // a\n// b\n+ 2', ['NUMBER', '+', 'NUMBER', ';', 'EOF']],
  ])('%j', (source, tokens) => {
    expect(tokenize(source)).toEqual(tokens)
  })

  it('rejects an unterminated block comment', () => {
    expect(() => parse('1 /* open')).toThrow(expect.objectContaining({ reason: 'Unterminated comment', column: 3 }))
  })

  it('rejects two expressions on one line separated by a single-line block comment', () => {
    expect(() => parse('1 /* x */ 2')).toThrow('Unexpected number 2')
  })
})

describe('whitespace and line terminators', () => {
  it.each([
    ['a\r\nb', 2],
    ['a\rb', 2],
    ['a b', 2],
    ['a b', 2],
  ])('treats %j as a line break', (source, line) => {
    expect(tokenize(source)).toEqual(['IDENT', ';', 'IDENT', ';', 'EOF'])
    expect(parse(source).body[1].loc.start).toEqual({ line, column: 1 })
  })

  it('skips tabs, vertical tabs, form feeds, NBSP and BOM', () => {
    expect(tokenize('﻿a\t+\v\fb ')).toEqual(['IDENT', '+', 'IDENT', ';', 'EOF'])
  })

  it('reports positions after a U+2028 line separator on the right line', () => {
    expect(() => parse('1   2 3')).toThrow(expect.objectContaining({ line: 2, column: 5 }))
  })
})

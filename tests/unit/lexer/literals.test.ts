import { describe, expect, it } from 'vitest'
import type { ExpressionStatement, Literal } from '@/parser/ast'
import { parse } from '@/parser/parse'

function literal(source: string): Literal {
  return (parse(source).body[0] as ExpressionStatement).expression as Literal
}

describe('number literals', () => {
  it.each([
    ['0', 0],
    ['42', 42],
    ['3.14', 3.14],
    ['.5', 0.5],
    ['5.', 5],
    ['1e10', 1e10],
    ['1E-7', 1e-7],
    ['6.022e+23', 6.022e23],
    ['0.25', 0.25],
    ['0e0', 0],
  ])('%s', (source, value) => {
    expect(literal(source)).toMatchObject({ type: 'Literal', value, raw: source })
  })

  it.each([
    ['012', 'Leading zeros are not allowed in numbers'],
    ['00.5', 'Leading zeros are not allowed in numbers'],
    ['3in', 'Identifier starts immediately after numeric literal'],
    ['1e', 'Identifier starts immediately after numeric literal'],
    ['1.5E-3x', 'Identifier starts immediately after numeric literal'],
  ])('rejects %s', (source, message) => {
    expect(() => parse(source)).toThrow(message)
  })
})

describe('string literals', () => {
  it.each([
    [String.raw`'single'`, 'single'],
    [String.raw`"double"`, 'double'],
    [String.raw`'A\x42'`, 'AB'],
    [String.raw`"say \"hi\""`, 'say "hi"'],
    [String.raw`'it\'s'`, "it's"],
    [String.raw`'\n\r\t\b\f\v\\'`, '\n\r\t\b\f\v\\'],
    [String.raw`'\0'`, '\0'],
    [String.raw`'A\u{1F600}'`, 'A😀'],
    [String.raw`'\q'`, 'q'],
    ["'a\\\nb'", 'ab'],
    ["'a\\\r\nb'", 'ab'],
  ])('%s', (source, value) => {
    expect(literal(source)).toMatchObject({ value, raw: source })
  })
})

describe('string literal errors', () => {
  it.each([
    [String.raw`'\x4'`, 'Invalid hexadecimal escape sequence', 2],
    [String.raw`'ab\u12'`, 'Invalid hexadecimal escape sequence', 4],
    [String.raw`'\u{110000}'`, 'Invalid Unicode escape sequence', 2],
    [String.raw`'\u{zz}'`, 'Invalid Unicode escape sequence', 2],
    [String.raw`'\1'`, 'Octal escape sequences are not allowed', 2],
    [String.raw`'\01'`, 'Octal escape sequences are not allowed', 2],
    ['"abc', 'Unterminated string', 1],
    ["'a\nb'", 'Unterminated string', 1],
  ])('rejects %j', (source, message, column) => {
    expect(() => parse(source)).toThrow(expect.objectContaining({ reason: message, line: 1, column }))
  })
})

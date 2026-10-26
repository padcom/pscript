import { describe, expect, it } from 'vitest'
import { parse } from '@/parser/parse'

describe('statements', () => {
  it('parses an empty program', () => {
    expect(parse('')).toMatchObject({ type: 'Program', sourceType: 'script', body: [] })
  })

  it('parses semicolon-separated expression statements; the last semicolon is optional', () => {
    expect(parse('1; 2;; 3').body.map(s => s.type))
      .toEqual(['ExpressionStatement', 'ExpressionStatement', 'EmptyStatement', 'ExpressionStatement'])
  })

  it('records the goal', () => {
    expect(parse('1', { goal: 'module' }).sourceType).toBe('module')
  })
})

describe('syntax errors', () => {
  it.each([
    ['1 +', 'Unexpected end of input', 4],
    ['1 2', 'Unexpected number 2', 3],
    ['f(1', 'Unexpected end of input', 4],
    ['(1 + 2', 'Unexpected end of input', 7],
    ['f(1 2', 'Unexpected number 2', 5],
    ['1 + )', "Unexpected token ')'", 5],
  ])('%s', (source, reason, column) => {
    expect(() => parse(source)).toThrow(expect.objectContaining({ reason: expect.stringContaining(reason), column }))
  })

  it('reports file name, location and excerpt', () => {
    expect(() => parse('1 +\n2 3', { fileName: 'a.pscript' }))
      .toThrow('a.pscript:2:3 SyntaxError: Unexpected number 3\n2 3\n  ^')
  })

  it('does not leak state between parses', () => {
    expect(() => parse('1 +')).toThrow()
    expect(parse('1 + 2').body).toHaveLength(1)
  })
})

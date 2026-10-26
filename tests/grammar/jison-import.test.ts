import { describe, expect, it } from 'vitest'
import calc from '../fixtures/jison/calc.jison'

describe('importing a .jison file', () => {
  it('yields a working parser', () => {
    expect(calc.parse('1 + 2 * 3')).toBe(7)
  })

  it('exposes a Parser constructor for fresh instances', () => {
    const parser = new calc.Parser()

    expect(parser.parse('-(4 - 6) / 2')).toBe(1)
  })

  it('reports syntax errors', () => {
    expect(() => new calc.Parser().parse('1 +')).toThrow(/Parse error/)
  })
})

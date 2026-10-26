// Every binary operator over a matrix of primitives, compared with Node (§6.3; == / != rewritten to === / !==).
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { Interpreter } from '@/index'
import { rewriteEquality } from '../../helpers/node-reference'

const VALUES = [
  '0',
  '(-0)',
  '1',
  '2.5',
  '(0 / 0)',
  '(1 / 0)',
  "''",
  "'0'",
  "'1'",
  "'a'",
  "'b'",
  'true',
  'false',
  'null',
  'undefined',
]
const OPERATORS = ['==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', '%', '**', '&&', '||', '??']

const interpreter = new Interpreter({ stdout: () => {} })
const cases = OPERATORS.flatMap(op => VALUES.flatMap(a => VALUES.map(b => `${a} ${op} ${b}`)))

describe('binary operators on primitives match Node', () => {
  it(`${cases.length} expressions`, () => {
    const mismatches = cases.filter(source => {
      const expected = runInNewContext(rewriteEquality(source))

      return !Object.is(interpreter.run(source), expected)
    })

    expect(mismatches).toEqual([])
  })
})

describe('unary operators on primitives match Node', () => {
  it.each(['!', '-', '+', 'typeof '])('%s', op => {
    for (const value of VALUES.filter(v => v !== 'null' || op !== 'typeof ')) {
      const source = `${op}${value}`

      expect(interpreter.run(source), source).toStrictEqual(runInNewContext(source))
    }
  })
})

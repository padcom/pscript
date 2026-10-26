import { describe, expect, it } from 'vitest'
import { rewriteEquality, runInNode } from '../helpers/node-reference'

describe('rewriteEquality', () => {
  it.each([
    ['a == b', 'a === b'],
    ['a != b', 'a !== b'],
    ['a <= b >= c', 'a <= b >= c'],
    ['x = y == z', 'x = y === z'],
    ["'a == b' == \"!=\"", "'a == b' === \"!=\""],
    ['a == b // c == d\n/* e != f */ g != h', 'a === b // c == d\n/* e != f */ g !== h'],
    ["'it\\'s == ' == x", "'it\\'s == ' === x"],
  ])('%s', (source, expected) => {
    expect(rewriteEquality(source)).toBe(expected)
  })
})

describe('runInNode', () => {
  it('collects print output and runs in strict mode', () => {
    expect(runInNode("print('a', 1)\nprint(null)")).toEqual({ output: ['a 1', 'null'] })
    expect(runInNode('undeclared = 1')).toEqual({ output: [], errorName: 'ReferenceError' })
  })
})

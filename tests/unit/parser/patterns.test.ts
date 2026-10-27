import { parse as acornParse } from 'acorn'
import { describe, expect, it } from 'vitest'
import { PScriptSyntaxError } from '@/errors'
import { parse } from '@/parser/parse'
import { boundNames, patternText } from '@/parser/patterns'
import type { FunctionDeclaration } from '@/parser/ast'

const IGNORED_KEYS = new Set([
  'start',
  'end',
  'loc',
  'range',
  'generator',
  'async',
  'directive',
  'access',
  'override',
  'final',
  'implements',
])

// The AST without positions and acorn-only flags (as in the parser oracle).
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize)
  if (node === null || typeof node !== 'object') return node

  const isFunction = (node as { type: string }).type.startsWith('Function')
  const keep = ([key]: [string, unknown]) => !IGNORED_KEYS.has(key) && !(key === 'expression' && isFunction)

  return Object.fromEntries(Object.entries(node).filter(keep).map(([key, value]) => [key, normalize(value)]))
}

function syntaxError(source: string): string {
  try {
    parse(source)
  } catch (e) {
    if (e instanceof PScriptSyntaxError) return `${e.line}:${e.column} ${e.reason}`
    throw e
  }

  return 'no error'
}

describe('parser: binding patterns (D40)', () => {
  it.each([
    'function testme({ x = 1, y = 2 } = {}) { return x + y }',
    'function f({ a, b: { c, d: [e, f = 1] }, ...rest }, [g, ...h]) {}',
    'const f = ({ a }, [b]) => a + b',
    'const o = { m({ a }) {}, set s([v]) {} }',
    'class C { m({ a, b }) {} constructor([x] = []) {} }',
    "let { a, 'b c': d, 1: e, class: k } = o, [x, [y, z = 2]] = arr",
    'const {} = o, [] = arr',
    'for (const [key, value] of entries) {}',
    'for (let { a, b = 1 } of items) {}',
    'try {} catch ({ message }) {}',
    'try {} catch ([first]) {}',
  ])('%s', source => {
    expect(normalize(parse(source))).toEqual(normalize(acornParse(source, { ecmaVersion: 'latest' })))
  })
})

describe('parser: assignment patterns (D40)', () => {
  it.each([
    '[a, b] = [b, a]',
    '({ x, y } = point)',
    '({ x = 1, y: o.y, z: [w = 2], ...rest } = point)',
    '[o.a, o[k], [c] = [], { d } = {}, ...tail] = list',
    'for ([k, v] of pairs) {}',
    'for ({ a, b } of items) {}',
    'for (o.x of items) {}',
    'x = [a, b] = [1, 2]',
  ])('%s', source => {
    expect(normalize(parse(source))).toEqual(normalize(acornParse(source, { ecmaVersion: 'latest' })))
  })
})

describe('parser: pattern errors', () => {
  it.each([
    ['({ a = 1 })', '1:4 Invalid shorthand property initializer'],
    ['[...a.b] = x', '1:5 A rest element must be a name'],
    ['({ ...f() } = x)', '1:7 A rest element must be a name'],
    ['[...undefined] = x', "1:5 Cannot assign to 'undefined'"],
    ['[a, b] += 1', '1:1 Invalid assignment target'],
    ['[a + 1] = x', '1:2 Invalid destructuring assignment target'],
    ['({ m() {} } = x)', '1:4 Invalid destructuring assignment target'],
    ['[...a, b] = x', '1:1 A rest element must be last in a destructuring pattern'],
    ['[undefined] = x', "1:2 Cannot assign to 'undefined'"],
    ['for (f() of xs) {}', '1:6 Invalid for-of target'],
    ['let { class } = o', "1:7 Unexpected keyword 'class' in shorthand property"],
    ['function f({ a }, a) {}', "1:19 Duplicate parameter name 'a'"],
    ['function f({ a } = {}, [b]) {}', "1:24 Required parameter '[b]' cannot follow an optional parameter"],
  ])('%s', (source, expected) => {
    expect(syntaxError(source)).toBe(expected)
  })
})

describe('parser: pattern helpers', () => {
  function params(source: string) {
    return (parse(source).body[0] as FunctionDeclaration).params
  }

  it('lists the bound names', () => {
    const names = params('function f(a, { b, c: [d, e = 1], ...f } = {}, ...g) {}').flatMap(boundNames).map(({ name }) => name)

    expect(names).toEqual(['a', 'b', 'd', 'e', 'f', 'g'])
  })

  it('shows patterns by the keys callers pass', () => {
    const texts = params("function f(a, { b, c: [d, e = 1], 'x y': z = 2, ...f } = {}, ...g) {}").map(patternText)

    expect(texts).toEqual(['a', '{b, c: [d, e?], x y?, ...f}?', '...g'])
  })
})

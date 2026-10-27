// Generator and async syntax (D42, D43): the AST matches acorn's, including `yield` precedence and ASI after `yield`.
import { parse as acornParse } from 'acorn'
import { describe, expect, it } from 'vitest'
import { parse } from '@/parser/parse'

const IGNORED = new Set(['start', 'end', 'loc', 'range', 'access', 'override', 'final', 'implements'])

function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize)
  if (node === null || typeof node !== 'object') return node

  const entries = Object.entries(node).filter(([key]) => !IGNORED.has(key))

  return Object.fromEntries(entries.map(([key, value]) => [key, normalize(value)]))
}

// acorn marks non-arrow functions with `expression: false`; PScript only has `expression` on arrows.
function dropFunctionExpressionFlag(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(dropFunctionExpressionFlag)
  if (node === null || typeof node !== 'object') return node

  const { type } = node as { type?: string }
  const entries = Object.entries(node).filter(([key]) => !(key === 'expression' && type?.startsWith('Function')))

  return Object.fromEntries(entries.map(([key, value]) => [key, dropFunctionExpressionFlag(value)]))
}

function sameAsAcorn(source: string) {
  const reference = dropFunctionExpressionFlag(normalize(acornParse(source, { ecmaVersion: 'latest' })))

  expect(normalize(parse(source))).toEqual(reference)
}

describe('generator syntax', () => {
  it.each([
    'function* g() {}',
    'function *g(a, b = 1) { yield a }',
    'const g = function* () { yield }',
    'const g = function* named() { yield* other() }',
    'const o = { *items() { yield 1 }, *"quoted"() {}, *of() {}, *delete() {} }',
    'class A { *values() { yield 1 } static *of() {} }',
    'function* g() { const x = yield 1 + 2; yield x * 2 }',
    'function* g() { yield yield 1 }',
    'function* g() { f(yield, yield a) }',
    'function* g() { yield\nx }',
    'function* g() { x = yield\n}',
    'function* g() { yield* [1, 2]; return yield* g() }',
    'function* g() { [a, b] = yield c }',
    'function* g() { yield a ? b : c }',
    'function* g() { yield () => 1 }',
  ])('%j', source => sameAsAcorn(source))

  it('marks generators in the AST', () => {
    const [declaration] = parse('function* g() { yield 1 }').body

    expect(declaration).toMatchObject({ type: 'FunctionDeclaration', generator: true, async: false })
    expect(parse('x => 1').body[0]).toMatchObject({ expression: { generator: false, async: false } })
  })

  it('rejects generator constructors', () => {
    expect(() => parse('class A { *constructor() {} }')).toThrow('Class constructor may not be a generator')
  })
})

describe('async syntax', () => {
  it.each([
    'async function f() { await x }',
    'export_ = async function () { return await f() }',
    'const f = async function named(a) {}',
    'const f = async x => await x',
    'const f = async (a, b = 1) => { await a }',
    'const f = async () => ({ a: await b })',
    'const o = { async m() { await 1 }, async delete() {}, async: 1 }',
    'class A { async m() { await this.x } static async of() {} async() {} }',
    'async function f() { const [a, b] = await Promise.all([x, y]) }',
    'async function f() { return await a + await b }',
    'async function f() { for (const x of await list()) await x }',
    'async function f() { await\nx }',
  ])('%j', source => sameAsAcorn(source))

  it('marks async functions in the AST', () => {
    expect(parse('async function f() {}').body[0]).toMatchObject({ type: 'FunctionDeclaration', async: true, generator: false })
    expect(parse('async x => x').body[0]).toMatchObject({ expression: { type: 'ArrowFunctionExpression', async: true } })
  })

  it.each([
    ['class A { async *constructor() {} }', 'Class constructor may not be a generator'],
    ['async\nfunction f() {}', "Line terminator not permitted after 'async'"],
    ['class A { async constructor() {} }', 'Class constructor may not be an async method'],
    ['let async = 1', "Unexpected token 'async'"],
  ])('rejects %j', (source, message) => {
    expect(() => parse(source)).toThrow(message)
  })
})

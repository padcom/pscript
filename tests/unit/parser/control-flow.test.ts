// `do … while`, `switch`, `void` and `delete` (D41): the AST matches acorn's; ASI as in JS.
import { parse as acornParse } from 'acorn'
import { describe, expect, it } from 'vitest'
import { parse } from '@/parser/parse'

const IGNORED = new Set(['start', 'end', 'loc', 'range'])

function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize)
  if (node === null || typeof node !== 'object') return node

  const entries = Object.entries(node).filter(([key]) => !IGNORED.has(key))

  return Object.fromEntries(entries.map(([key, value]) => [key, normalize(value)]))
}

function sameAsAcorn(source: string) {
  expect(normalize(parse(source))).toEqual(normalize(acornParse(source, { ecmaVersion: 'latest' })))
}

describe('do … while', () => {
  it.each([
    'do x++; while (x < 3)',
    'do { x++ } while (x < 3)',
    'do x++\nwhile (x < 3)',
    'do {} while (a) b()',
    'do {} while (a); b()',
    'do while (a) b(); while (c)',
    'do do x(); while (a); while (b)',
    'if (a) do x(); while (b); else y()',
    'do {}\nwhile (a)\n(b)',
  ])('%j', source => sameAsAcorn(source))

  it('rejects a declaration as the body', () => {
    expect(() => parse('do let x = 1; while (a)')).toThrow('Lexical declaration cannot appear in a single-statement context')
  })
})

describe('switch', () => {
  it.each([
    'switch (x) {}',
    'switch (x) { case 1: a(); break; default: b() }',
    'switch (x) {\n  case 1:\n    a()\n  case 2:\n  default:\n    b()\n}',
    'switch (x) { case a ? b : c: d() }',
    'switch (x) { case 1: { let y = 1 } }',
    'switch (x) { case 1: ({ a: 1 }) }',
    'switch (x) { default: let y = 2; y }',
    'switch (x)\n{\n  case y: z\n}',
    'const o = { case: 1, default: 2, do: 3 }; o.default',
    'x = c ? { a: 1 } : { b: 2 }',
  ])('%j', source => sameAsAcorn(source))

  it('rejects two default clauses', () => {
    expect(() => parse('switch (x) { default: default: }')).toThrow('More than one default clause in switch statement')
  })
})

describe('void and delete', () => {
  it.each([
    'void 0',
    'void f(x)',
    'delete o.x',
    'delete o[k]',
    'delete o.a.b',
    'x = delete o.x || void 1',
  ])('%j', source => sameAsAcorn(source))

  it.each([
    ['delete x', 'Delete of an unqualified identifier is not allowed'],
    ['delete 1', 'Invalid delete target'],
    ['delete f()', 'Invalid delete target'],
    ['class A extends B { m() { delete super.x } }', "Cannot delete a property of 'super'"],
  ])('rejects %j', (source, message) => {
    expect(() => parse(source)).toThrow(message)
  })
})

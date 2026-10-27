// Parser oracle (§6.2): every program that is valid JS must parse to the same AST as acorn,
// after dropping positions and fields acorn does not have (or PScript does not use).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parse as acornParse } from 'acorn'
import { describe, expect, it } from 'vitest'
import { parse } from '@/parser/parse'

const root = join(import.meta.dirname, 'programs')
// positions, PScript's class extensions (access, override, final, implements), and acorn-only flags
const IGNORED_KEYS = new Set(['start', 'end', 'loc', 'range', 'access', 'override', 'final', 'implements'])

IGNORED_KEYS.add('directive')

const programs = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter(file => file.endsWith('.pscript'))
  .map(file => ({ file, source: readFileSync(join(root, file), 'utf8') }))
  .filter(({ source }) => !source.includes('@pscript-only'))
  .sort((a, b) => a.file.localeCompare(b.file))

function tryAcorn(source: string): unknown {
  try {
    return acornParse(source, { ecmaVersion: 'latest', sourceType: 'script' })
  } catch {
    return null
  }
}

// acorn marks non-arrow functions with `expression: false`; PScript only has `expression` on arrows.
function keep(node: object, key: string): boolean {
  return !IGNORED_KEYS.has(key) && !(key === 'expression' && (node as { type?: string }).type?.startsWith('Function'))
}

function normalizeNode(node: object): object {
  const entries = Object.entries(node).filter(([key]) => keep(node, key))

  // eslint-disable-next-line no-use-before-define -- recursion
  return Object.fromEntries(entries.map(([key, value]) => [key, normalize(value)]))
}

function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize)

  return node === null || typeof node !== 'object' ? node : normalizeNode(node)
}

describe('parser oracle (acorn)', () => {
  it.each(programs)('$file', ({ source }) => {
    const reference = tryAcorn(source)
    if (reference === null) return

    expect(normalize(parse(source))).toEqual(normalize(reference))
  })
})

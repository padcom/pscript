// Runs a PScript program in Node as the behaviour oracle (§6.3).
import { runInNewContext } from 'node:vm'

/**
 * Outcome of running a program in Node.
 */
export interface NodeResult {
  /** lines written by `print` */
  output: string[]
  /** name of the thrown error (`SyntaxError`, `TypeError`, …), if any */
  errorName?: string
}

const QUOTES = new Set(['"', "'", '`'])

function skipString(source: string, start: number): number {
  const quote = source[start]
  let i = start + 1

  while (i < source.length && source[i] !== quote) i += source[i] === '\\' ? 2 : 1

  return i + 1
}

function skipComment(source: string, start: number): number {
  const block = source[start + 1] === '*'
  const end = source.indexOf(block ? '*/' : '\n', start + 2)

  return end < 0 ? source.length : end + (block ? 2 : 0)
}

function isComment(source: string, i: number): boolean {
  return source[i] === '/' && (source[i + 1] === '/' || source[i + 1] === '*')
}

// Index after the token-like chunk starting at `i`: a string, a comment or one character.
function chunkEnd(source: string, i: number): number {
  if (QUOTES.has(source[i])) return skipString(source, i)

  return isComment(source, i) ? skipComment(source, i) : i + 1
}

// Length of a PScript equality operator (`==` / `!=`, not part of `<=` `>=` `===`) at `i`, else 0.
const EQUALITY = new Set(['==', '!='])

function equalityAt(source: string, i: number): number {
  const isEquality = EQUALITY.has(source.slice(i, i + 2)) && !'=<>!'.includes(source[i - 1] ?? '')

  return isEquality ? 2 : 0
}

/**
 * Rewrites PScript's strict `==` / `!=` (D1) to JS `===` / `!==`, leaving strings and comments alone.
 *
 * @param source PScript source
 * @returns JS source with the same equality semantics
 */
export function rewriteEquality(source: string): string {
  let result = ''

  for (let i = 0; i < source.length;) {
    const equality = equalityAt(source, i)
    const end = equality ? i + equality : chunkEnd(source, i)

    result += source.slice(i, end) + (equality ? '=' : '')
    i = end
  }

  return result
}

/**
 * Runs a program in a fresh Node context in strict mode, with `print` collecting output.
 *
 * @param source PScript source (JS-compatible programs only)
 * @returns output and the thrown error's name
 */
export function runInNode(source: string): NodeResult {
  const output: string[] = []
  const print = (...args: unknown[]) => { output.push(args.map(String).join(' ')) }

  try {
    runInNewContext(`'use strict';\n${rewriteEquality(source)}`, { print })

    return { output }
  } catch (error) {
    return { output, errorName: (error as Error).name }
  }
}

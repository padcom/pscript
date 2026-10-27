// psc differential test (§11.5): every program without `@pscript-only` that psc supports is transpiled, run in Node
// and must print the same lines, and fail with the same kind of error, as the original program in Node.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { PScriptError, PScriptSyntaxError, compile, transpile } from '@/index'
import { runInNode, type NodeResult } from './helpers/node-reference'

const root = join(import.meta.dirname, 'programs')
const programs = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter(file => file.endsWith('.pscript'))
  .map(file => ({ file, source: readFileSync(join(root, file), 'utf8') }))
  .filter(({ source }) => !source.includes('@pscript-only'))
  .sort((a, b) => a.file.localeCompare(b.file))

const UNSUPPORTED = /not supported by psc yet/

/** Programs that rely on a documented difference of the emitted code (§11.4). */
const KNOWN_DIFFERENCES: Record<string, string> = {
  'stdlib/basics.pscript': '`print` is not a property of `globalThis`',
}

// Runs transpiled code like the Node oracle runs the original: strict mode, `print` and `console.log` collect output.
function runTranspiled(code: string): NodeResult {
  const output: string[] = []
  const print = (...args: unknown[]) => { output.push(args.map(String).join(' ')) }

  try {
    runInNewContext(`'use strict';\n${code}`, { console: { log: print } })

    return { output }
  } catch (error) {
    return { output, errorName: (error as Error).name }
  }
}

function transpileAndRun(source: string): NodeResult | null {
  try {
    return runTranspiled(transpile(source).code)
  } catch (error) {
    if (UNSUPPORTED.test((error as Error).message)) return null
    if (error instanceof PScriptError) return { output: [], errorName: 'SyntaxError' }
    throw error
  }
}

describe('psc (transpiled vs Node)', () => {
  it.for(programs)('$file', ({ file, source }, { skip }) => {
    const transpiled = transpileAndRun(source)
    if (!transpiled || file in KNOWN_DIFFERENCES) {
      skip(transpiled ? KNOWN_DIFFERENCES[file] : 'uses constructs of a later psc milestone')

      return
    }

    const node = runInNode(source)

    expect(transpiled.output).toEqual(node.output)
    expect(transpiled.errorName).toBe(node.errorName)
  })
})

// Compile-time errors of the interpreter are psc's errors too (P1).
const failing = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter(file => file.endsWith('.err'))
  .map(file => file.replace(/\.err$/, '.pscript'))
  .map(file => ({
    file,
    source: readFileSync(join(root, file), 'utf8'),
    expected: readFileSync(join(root, file.replace(/\.pscript$/, '.err')), 'utf8').trim(),
  }))
  .filter(({ source }) => {
    try {
      compile(source)

      return false
    } catch (error) {
      return error instanceof PScriptSyntaxError
    }
  })
  .sort((a, b) => a.file.localeCompare(b.file))

describe('psc compile-time errors', () => {
  it.each(failing)('$file', ({ file, source, expected }) => {
    expect(() => transpile(source, { fileName: file })).toThrow(expected)
  })
})

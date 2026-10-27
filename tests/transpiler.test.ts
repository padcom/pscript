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

/** PScript-only programs that rely on a documented difference of the emitted code (§11.4). */
const PSCRIPT_ONLY_DIFFERENCES: Record<string, string> = {
  'access/account.pscript': '`protected` is not checked at runtime',
  'access/nested.pscript': '`print` formats arrays like `console.log`',
  'access/private.pscript': 'private members read from outside give `undefined` instead of an AccessError',
  'access/protected.pscript': '`protected` is not checked at runtime',
  'accessors/printing.pscript': '`print` formatting (D18)',
  'arrays/pscript-specific.pscript': 'array reads out of range and holes (§4.4.7)',
  'async/pscript-specific.pscript': 'native promises: thenables are adopted, `Promise` can be extended, `undefined` values',
  'callbacks/callback-arity.pscript': 'stdlib callbacks receive every argument; functions return `undefined`',
  'classes/closed-instances.pscript': 'closed instances and sealed classes are not enforced at runtime',
  'classes/to-string.pscript': 'the default `toString()` of instances (D35)',
  'destructuring/named-parameters.pscript': 'named parameters are checked at compile time only; no arity checks at runtime',
  'exceptions/runtime-errors.pscript': 'operator, index and arity errors at runtime',
  'exceptions/stack.pscript': 'JavaScript stack traces',
  'functions/defaults-and-rest.pscript': 'defaults also apply to `undefined`; dynamic calls are not arity-checked',
  'functions/null-returns.pscript': 'functions falling off the end return `undefined`',
  'functions/this-in-plain-call.pscript': '`this` is `undefined` in a plain call',
  'generators/pscript-specific.pscript': 'missing values are `undefined` (`next()`, finished steps); JS error messages',
  'implicit-members/rules.pscript': 'static-context and method-assignment errors are runtime checks',
  'interfaces/declarations.pscript': 'interfaces declared in functions are not checked at compile time; `print` formatting',
  'objects/printing.pscript': '`print` formatting (D18)',
  'operators/pscript-specific.pscript': 'operators converting objects (D5); `print` formatting',
  'stdlib/pscript-specific.pscript': 'stdlib differences (callback arity, `print` formatting)',
}

// Runs transpiled code like the Node oracle runs the original: strict mode, `print` and `console.log` collect output.
function runTranspiled(code: string): NodeResult {
  const output: string[] = []
  const print = (...args: unknown[]) => { output.push(args.map(String).join(' ')) }

  try {
    runInNewContext(`'use strict';\n${code}`, { console: { log: print } }, { microtaskMode: 'afterEvaluate' })

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

// PScript-only programs with an expected output: the transpiled program must print it (P7, P8), unless it relies on
// a documented difference (§11.4).
const pscriptOnly = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter(file => file.endsWith('.out'))
  .map(file => file.replace(/\.out$/, '.pscript'))
  .map(file => ({
    file,
    source: readFileSync(join(root, file), 'utf8'),
    expected: readFileSync(join(root, file.replace(/\.pscript$/, '.out')), 'utf8').trimEnd(),
  }))
  .filter(({ source }) => source.includes('@pscript-only'))
  .sort((a, b) => a.file.localeCompare(b.file))

// The reason of a compile-time error psc reports for a program, or null when it transpiles.
function compileError(source: string): string | null {
  try {
    transpile(source)

    return null
  } catch (error) {
    if (error instanceof PScriptSyntaxError) return error.reason
    throw error
  }
}

describe('psc (PScript-only programs)', () => {
  it.for(pscriptOnly)('$file', ({ file, source, expected }, { skip }) => {
    if (file in PSCRIPT_ONLY_DIFFERENCES) {
      skip(PSCRIPT_ONLY_DIFFERENCES[file])

      return
    }

    // A class-definition error the VM throws at runtime (and the program catches) is a compile-time error in psc.
    const reason = compileError(source)
    if (reason !== null) {
      expect(expected).toContain(reason.replace(/ \(\d+:\d+\)$/, ''))

      return
    }

    const transpiled = runTranspiled(transpile(source).code)

    expect(transpiled.errorName).toBeUndefined()
    expect(transpiled.output.join('\n')).toBe(expected)
  })
})

// psc module graphs (§11.5, T3, T4): each tests/modules graph is transpiled as one program and run in Node as ES
// modules; it must print what the interpreter prints and fail with the same kind of error. The graphs whose error psc
// reports at compile time (P1, P10) must fail `transpileModules()` with the message of `main.err`.
import { describe, expect, it } from 'vitest'
import { PScriptSyntaxError, transpileModules } from '@/index'
import { errorName, expected, graphs, runGraph, sources } from './helpers/module-graphs'
import { runFilesInNode } from './helpers/node-modules'

/** Graphs that rely on a documented difference of the emitted code (§11.4). */
const DIFFERENCES: Record<string, string> = {
  'namespace-print': '`print` formatting of namespaces (D18)',
}

/** Graphs whose error is a compile-time error in psc. */
const COMPILE_TIME = new Set([
  'assign-import',
  'circular-reexport',
  'class-final',
  'class-implements',
  'class-override',
  'import-arity',
  'inherited-ambiguity',
  'missing-export',
  'namespace-arity',
])

function jsFile(name: string): string {
  return name.replace(/\.(?:pscript|psc)$/, '.js')
}

// The emitted modules by file name, or the compile-time error.
function transpileGraph(modules: Record<string, string>): Record<string, string> | PScriptSyntaxError {
  try {
    return Object.fromEntries(Object.entries(transpileModules(modules)).map(([name, { code }]) => [jsFile(name), code]))
  } catch (error) {
    if (error instanceof PScriptSyntaxError) return error
    throw error
  }
}

// The graph's error, reported by psc.
function expectCompileError(graph: string, files: Record<string, string> | PScriptSyntaxError) {
  expect(files).toBeInstanceOf(PScriptSyntaxError)
  expect((files as PScriptSyntaxError).message).toContain(expected(graph, '.err')?.trim())
}

// The graph's behaviour in Node, compared with the interpreter.
function expectSameRun(modules: Record<string, string>, files: Record<string, string> | PScriptSyntaxError) {
  if (files instanceof PScriptSyntaxError) throw files

  const pscript = runGraph(modules)
  const node = runFilesInNode(files, 'main.js')

  expect(node.output).toEqual(pscript.output)
  expect(node.errorName).toBe(errorName(pscript.error))
}

describe('psc module graphs', () => {
  it.for(graphs)('%s', (graph, { skip }) => {
    if (graph in DIFFERENCES) {
      skip(DIFFERENCES[graph])

      return
    }

    const modules = sources(graph)
    const files = transpileGraph(modules)

    if (COMPILE_TIME.has(graph)) expectCompileError(graph, files)
    else expectSameRun(modules, files)
  })
})

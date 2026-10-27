// psc module graphs (§11.5, T3): the modules of each tests/modules graph are transpiled and run in Node as ES modules;
// they must print what the interpreter prints and fail with the same kind of error. A graph whose error psc reports
// at compile time must fail with the message of `main.err`.
import { describe, expect, it } from 'vitest'
import { PScriptSyntaxError, transpile } from '@/index'
import { errorName, expected, graphs, runGraph, sources } from './helpers/module-graphs'
import { runFilesInNode } from './helpers/node-modules'

/** Graphs that rely on a documented difference of the emitted code (§11.4). */
const DIFFERENCES: Record<string, string> = {
  'namespace-print': '`print` formatting of namespaces (D18)',
}

function jsFile(name: string): string {
  return name.replace(/\.(?:pscript|psc)$/, '.js')
}

// The emitted modules by file name, or the compile-time error.
function transpileGraph(modules: Record<string, string>): Record<string, string> | PScriptSyntaxError {
  try {
    return Object.fromEntries(Object.entries(modules).map(([name, source]) => [
      jsFile(name),
      transpile(source, { fileName: name, goal: 'module' }).code,
    ]))
  } catch (error) {
    if (error instanceof PScriptSyntaxError) return error
    throw error
  }
}

describe('psc module graphs', () => {
  it.for(graphs)('%s', (graph, { skip }) => {
    if (graph in DIFFERENCES) {
      skip(DIFFERENCES[graph])

      return
    }

    const modules = sources(graph)
    const files = transpileGraph(modules)

    if (files instanceof PScriptSyntaxError) {
      expect(files.message).toContain(expected(graph, '.err')?.trim())

      return
    }

    const pscript = runGraph(modules)
    const node = runFilesInNode(files, 'main.js')

    expect(node.output).toEqual(pscript.output)
    expect(node.errorName).toBe(errorName(pscript.error))
  })
})

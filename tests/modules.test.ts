// Module programs (§4.7): each directory under tests/modules is a module graph whose entry is `main.pscript`.
// `main.out` holds the expected output, `main.err` text the error message must contain. Graphs whose entry does not
// contain `@pscript-only` must also behave the same in Node.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Interpreter, PScriptError, PScriptRuntimeError } from '@/index'
import { runModulesInNode } from './helpers/node-modules'
import type { ProgramResult } from './helpers/run-program'

const root = join(import.meta.dirname, 'modules')
const graphs = readdirSync(root).sort()

function sources(graph: string): Record<string, string> {
  const dir = join(root, graph)
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(file => /\.(?:pscript|psc)$/.test(file))

  return Object.fromEntries(files.map(file => [relative(dir, join(dir, file)), readFileSync(join(dir, file), 'utf8')]))
}

function expected(graph: string, extension: string): string | null {
  const path = join(root, graph, `main${extension}`)

  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

function runGraph(modules: Record<string, string>): ProgramResult {
  const output: string[] = []
  const interpreter = new Interpreter({ modules, stdout: text => output.push(text) })

  try {
    interpreter.importModule('./main')

    return { output }
  } catch (error) {
    return { output, error: error as Error }
  }
}

function errorName(error: Error | undefined): string | undefined {
  if (error instanceof PScriptRuntimeError) return error.scriptName

  return error instanceof PScriptError ? 'SyntaxError' : error?.name
}

describe('module programs', () => {
  it.each(graphs)('%s', graph => {
    const { output, error } = runGraph(sources(graph))
    const expectedError = expected(graph, '.err')

    if (expectedError === null) {
      expect(error).toBeUndefined()
      expect(output.join('\n')).toBe((expected(graph, '.out') ?? '').trimEnd())
    } else {
      expect(error?.message).toContain(expectedError.trim())
    }
  })
})

const differential = graphs.filter(graph => !sources(graph)['main.pscript'].includes('@pscript-only'))

describe('module programs against Node', () => {
  it.each(differential)('%s', graph => {
    const modules = sources(graph)
    const pscript = runGraph(modules)
    const node = runModulesInNode(modules, 'main.pscript')

    expect(pscript.output).toEqual(node.output)
    expect(errorName(pscript.error)).toBe(node.errorName)
  })
})

// The module graphs of tests/modules (§4.7): each directory is a graph whose entry is `main.pscript`. `main.out` holds
// the expected output, `main.err` text the error message must contain.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Interpreter, PScriptError, PScriptRuntimeError } from '@/index'
import type { ProgramResult } from './run-program'

const root = join(import.meta.dirname, '..', 'modules')

/** The graph names, sorted. */
export const graphs = readdirSync(root).sort()

/**
 * The modules of a graph.
 *
 * @param graph the graph name
 * @returns module sources by file name (relative paths)
 */
export function sources(graph: string): Record<string, string> {
  const dir = join(root, graph)
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(file => /\.(?:pscript|psc)$/.test(file))

  return Object.fromEntries(files.map(file => [relative(dir, join(dir, file)), readFileSync(join(dir, file), 'utf8')]))
}

/**
 * An expectation file of a graph's entry.
 *
 * @param graph the graph name
 * @param extension `.out` or `.err`
 * @returns the file's text, or null when there is none
 */
export function expected(graph: string, extension: string): string | null {
  const path = join(root, graph, `main${extension}`)

  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/**
 * Runs a graph in the interpreter.
 *
 * @param modules module sources by file name
 * @returns output and the thrown error
 */
export function runGraph(modules: Record<string, string>): ProgramResult {
  const output: string[] = []
  const interpreter = new Interpreter({ modules, stdout: text => output.push(text) })

  try {
    interpreter.importModule('./main')

    return { output }
  } catch (error) {
    return { output, error: error as Error }
  }
}

/**
 * The JavaScript name of an error of the interpreter (script errors by their script class).
 *
 * @param error the error
 * @returns its name, or undefined for no error
 */
export function errorName(error: Error | undefined): string | undefined {
  if (error instanceof PScriptRuntimeError) return error.scriptName

  return error instanceof PScriptError ? 'SyntaxError' : error?.name
}

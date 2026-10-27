// `transpile()`: PScript source → JavaScript (§11, P1).
import { compile, compileModule } from '@/compiler/compiler'
import type { PScriptSyntaxError } from '@/errors'
import type { Program } from '@/parser/ast'
import { parse } from '@/parser/parse'
import { checkClassDefinitions } from './class-checks'
import { Emitter } from './emitter'
import { hasModuleDeclarations } from './modules'

/**
 * Options of `transpile()`.
 */
export interface TranspileOptions {
  /** file name used in error messages; a module's id */
  fileName?: string
  /** compile as a script or as an ES module (default: a module when the source has `import`/`export` declarations) */
  goal?: 'script' | 'module'
}

/**
 * Result of `transpile()`.
 */
export interface TranspileResult {
  /** the JavaScript code */
  code: string
}

// The id of a module without a file name, as in `Interpreter.runModule()`.
function moduleId(fileName?: string): string {
  return fileName ?? 'main'
}

// A source that does not parse as a module is compiled as a script, which reports the error.
function detectGoal(source: string, fileName?: string): 'script' | 'module' {
  try {
    return hasModuleDeclarations(parse(source, { fileName, goal: 'module' })) ? 'module' : 'script'
  } catch {
    return 'script'
  }
}

/**
 * Runs the interpreter's compile-time checks (P1) and parses the source. Compiling from the text (not the AST) keeps
 * the code excerpts in error messages; the bytecode is discarded.
 *
 * @param source source text
 * @param options file name and goal
 * @returns the program
 * @throws {PScriptSyntaxError} on syntax errors and failed checks
 */
export function checkedProgram(source: string, options: TranspileOptions = {}): Program {
  const { fileName, goal = detectGoal(source, fileName) } = options

  if (goal === 'module') compileModule(source, moduleId(fileName))
  else compile(source, { fileName })

  return parse(source, { fileName, goal })
}

/**
 * Compiles a script or module to JavaScript. The interpreter's compile-time checks run first (P1), so a program `psc`
 * accepts is one the interpreter would compile.
 *
 * @param source source text
 * @param options file name and goal
 * @returns the JavaScript code
 * @throws {PScriptSyntaxError} on syntax errors, failed checks and constructs `psc` does not support yet
 */
export function transpile(source: string, options: TranspileOptions = {}): TranspileResult {
  const { fileName } = options
  const program = checkedProgram(source, options)

  checkClassDefinitions(program, source, fileName)

  return { code: new Emitter(program, source, fileName).emit() }
}

// `transpile()`: PScript source → JavaScript (§11, P1).
import { compile, compileModule } from '@/compiler/compiler'
import type { PScriptSyntaxError } from '@/errors'
import type { Program } from '@/parser/ast'
import { parse } from '@/parser/parse'
import { ModuleGraph } from './module-graph'
import { hasModuleDeclarations } from './modules'
import { transpileProgram, transpileScript } from './program'
import type { SourceMap } from './source-map'

/**
 * Options of `transpileModules()`.
 */
export interface TranspileModulesOptions {
  /** produce a source map (P11): `true` returns it as `map`, `'inline'` also appends it to the code as a comment */
  sourceMap?: boolean | 'inline'
}

/**
 * Options of `transpile()`.
 */
export interface TranspileOptions extends TranspileModulesOptions {
  /** file name used in error messages and source maps; a module's id */
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
  /** the source map, when asked for; it names the source relative to the code, taken to be next to it (`lib/a.js`) */
  map?: SourceMap
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
 * @param options file name, goal and source maps
 * @returns the JavaScript code (and source map)
 * @throws {PScriptSyntaxError} on syntax errors, failed checks and constructs `psc` does not support yet
 */
export function transpile(source: string, options: TranspileOptions = {}): TranspileResult {
  const { fileName } = options
  const program = checkedProgram(source, options)

  if (program.sourceType === 'script') return transpileScript({ id: fileName ?? '<script>', source, program }, options)

  const id = moduleId(fileName)

  return transpileProgram(new ModuleGraph([{ id, source, program }]), options).get(id)!
}

/**
 * Compiles the modules (and scripts) of a program to JavaScript, checking them together (P10): besides each file's
 * own checks, imports of missing exports, circular re-exports, the arity of imported functions, and overriding,
 * `final` and `implements` across modules are compile-time errors. Relative specifiers between the files resolve
 * like the interpreter's in-memory loader (`modules` option): POSIX paths, the exact id first, then `.pscript` and
 * `.psc`; other specifiers are modules outside the program.
 *
 * @param sources source text by module id (e.g. `main.pscript`, `lib/util.psc`)
 * @param options source maps
 * @returns the JavaScript code by module id
 * @throws {PScriptSyntaxError} on the first error
 */
export function transpileModules(
  sources: Record<string, string>,
  options: TranspileModulesOptions = {},
): Record<string, TranspileResult> {
  const units = Object.entries(sources).map(([id, source]) => ({ id, source, program: checkedProgram(source, { fileName: id }) }))
  const results = transpileProgram(new ModuleGraph(units), options)

  return Object.fromEntries(units.map(({ id }) => [id, results.get(id)!]))
}

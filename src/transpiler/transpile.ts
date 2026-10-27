// `transpile()`: PScript source → JavaScript (§11, P1).
import { compile } from '@/compiler/compiler'
import type { PScriptSyntaxError } from '@/errors'
import { parse } from '@/parser/parse'
import { Emitter } from './emitter'

/**
 * Options of `transpile()`.
 */
export interface TranspileOptions {
  /** file name used in error messages */
  fileName?: string
}

/**
 * Result of `transpile()`.
 */
export interface TranspileResult {
  /** the JavaScript code */
  code: string
}

/**
 * Compiles a script to JavaScript. The interpreter's compile-time checks run first (P1), so a program `psc` accepts
 * is one `run()` would compile.
 *
 * @param source source text
 * @param options file name
 * @returns the JavaScript code
 * @throws {PScriptSyntaxError} on syntax errors, failed checks and constructs `psc` does not support yet
 */
export function transpile(source: string, options: TranspileOptions = {}): TranspileResult {
  const { fileName } = options

  // Compiling from the text (not the AST) keeps the code excerpts in error messages; the bytecode is discarded.
  compile(source, { fileName })

  return { code: new Emitter(parse(source, { fileName }), source, fileName).emit() }
}

import { Interpreter, type InterpreterOptions } from '@/index'

/**
 * Outcome of running a script.
 */
export interface ProgramResult {
  /** lines written by `print` */
  output: string[]
  /** completion value, when the script finished */
  result?: unknown
  /** the thrown error, when it did not */
  error?: Error
}

/**
 * Runs a script in a fresh interpreter and captures its output.
 *
 * @param source source text
 * @param options extra interpreter options and the file name
 * @returns output, result and error
 */
export function runProgram(source: string, options: InterpreterOptions & { fileName?: string } = {}): ProgramResult {
  const output: string[] = []
  const interpreter = new Interpreter({ ...options, stdout: text => output.push(text) })

  try {
    return { output, result: interpreter.run(source, { fileName: options.fileName }) }
  } catch (error) {
    return { output, error: error as Error }
  }
}

// Errors raised by the runtime while a script runs. The VM turns them into script-visible
// error objects (M11) or, when uncaught, into a PScriptRuntimeError with location and stack.
import type { ScriptErrorName } from '@/errors'

export class ScriptError extends globalThis.Error {
  constructor(public scriptName: ScriptErrorName, message: string) {
    super(message)
  }
}

/**
 * Creates a TypeError.
 *
 * @param message error message
 * @returns a TypeError to throw
 */
export function typeError(message: string): ScriptError {
  return new ScriptError('TypeError', message)
}

/**
 * Creates a ReferenceError.
 *
 * @param message error message
 * @returns a ReferenceError to throw
 */
export function referenceError(message: string): ScriptError {
  return new ScriptError('ReferenceError', message)
}

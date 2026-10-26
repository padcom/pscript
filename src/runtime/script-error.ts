// Errors raised by the runtime while a script runs. The VM turns them into script-visible
// error objects (M11) or, when uncaught, into a PScriptRuntimeError with location and stack.
import type { ScriptErrorName, ScriptStackFrame } from '@/errors'
import type { Value } from './values'

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

/**
 * Creates a RangeError.
 *
 * @param message error message
 * @returns a RangeError
 */
export function rangeError(message: string): ScriptError {
  return new ScriptError('RangeError', message)
}

/**
 * A script value being thrown (`throw`, or a runtime error converted to an Error object),
 * with the script stack captured where it was thrown. Propagates through nested dispatch loops.
 */
export class ScriptThrow extends globalThis.Error {
  constructor(readonly value: Value, readonly frames: ScriptStackFrame[]) {
    super('script exception')
  }
}

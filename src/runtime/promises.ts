// Promises (D43, §4.4.17): instances of the built-in final class `Promise`. The state machine and the job queue live
// in the VM (`src/vm/promises.ts`); natives reach them through `AccessContext.promises`.
import type { ScriptStackFrame } from '@/errors'
import { Object as ScriptObject, type Value } from './values'

export type PromiseState = 'pending' | 'fulfilled' | 'rejected'

/** A reaction handler: a script value (called if callable, else the value passes through) or an internal callback. */
export type ReactionHandler = Value | ((value: Value, frames: ScriptStackFrame[]) => void)

/**
 * What runs when a promise settles: one of the handlers, then the derived promise (`then`) is settled with its result.
 */
export interface Reaction {
  /** called with the value */
  onFulfilled: ReactionHandler
  /** called with the reason */
  onRejected: ReactionHandler
  /** the promise `then` returned; null for internal reactions (`await`, combinators, host promises) */
  derived: PromiseObject | null
}

export class PromiseObject extends ScriptObject {
  state: PromiseState = 'pending'
  /** the value or the reason */
  result: Value = undefined
  /** waiting reactions (pending promises only) */
  reactions: Reaction[] = []
  /** some reaction was ever registered (unhandled-rejection tracking) */
  handled = false
  /** where the rejection came from (the stack of an uncaught rejection) */
  frames: ScriptStackFrame[] = []
}

/**
 * Promise operations for natives and interop (implemented by the VM).
 */
export interface PromiseOps {
  /**
   * A new pending promise.
   *
   * @returns the promise
   */
  create(): PromiseObject
  /**
   * Resolves a promise: adopts the state of a promise value, otherwise fulfills it.
   *
   * @param promise the promise
   * @param value the resolution
   */
  resolve(promise: PromiseObject, value: Value): void
  /**
   * Rejects a promise.
   *
   * @param promise the promise
   * @param reason the reason
   * @param frames where the rejection comes from
   */
  reject(promise: PromiseObject, reason: Value, frames?: ScriptStackFrame[]): void
  /**
   * `promise.then(onFulfilled, onRejected)` (PerformPromiseThen with a derived promise).
   *
   * @param promise the promise
   * @param onFulfilled handler (ignored when not callable)
   * @param onRejected handler (ignored when not callable)
   * @returns the derived promise
   */
  performThen(promise: PromiseObject, onFulfilled: Value, onRejected: Value): PromiseObject
  /**
   * Registers internal callbacks (no derived promise).
   *
   * @param promise the promise
   * @param onFulfilled called with the value
   * @param onRejected called with the reason
   */
  react(promise: PromiseObject, onFulfilled: ReactionHandler, onRejected: ReactionHandler): void
  /**
   * `Promise.resolve(value)`: a promise as is, anything else in a fulfilled promise.
   *
   * @param value the value
   * @returns a promise
   */
  promiseResolve(value: Value): PromiseObject
  /**
   * The `resolve` and `reject` functions handed to an executor (each works once).
   *
   * @param promise the promise they settle
   * @returns `[resolve, reject]`
   */
  resolvingFunctions(promise: PromiseObject): [Value, Value]
  /**
   * The script value of an exception caught by a native (a thrown value, or the error object of a runtime error).
   *
   * @param error the exception
   * @returns the value and where it was thrown
   */
  thrown(error: unknown): { value: Value, frames: ScriptStackFrame[] }
}

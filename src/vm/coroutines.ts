// Suspendable frames (§1.7, D42): a generator's frame leaves the frame stack at `yield` and comes back on `next()`.
// The frame object keeps its environment, handlers and ip; the coroutine keeps the frame's operand-stack values.
import type { GeneratorDriver, IteratorStep, ResumeMode } from '@/runtime/generators'
import { ScriptThrow } from '@/runtime/script-error'
import type { Value } from '@/runtime/values'
import type { Frame } from './frame'

/** Where a coroutine is in its life. */
export type CoroutineState = 'suspended-start' | 'suspended-yield' | 'running' | 'completed'

/**
 * What a coroutine needs from the VM.
 */
export interface CoroutineHost {
  /**
   * Runs a suspended coroutine until it suspends again or completes.
   *
   * @param coroutine the coroutine
   * @param mode how to resume
   * @param value the value sent, thrown or returned
   * @returns the step
   */
  resumeCoroutine(coroutine: Coroutine, mode: ResumeMode, value: Value): IteratorStep
}

export class Coroutine implements GeneratorDriver {
  state: CoroutineState = 'suspended-start'
  /** the frame's operand-stack values while it is suspended (bottom first) */
  saved: Value[] = []
  /** suspended inside `yield*`: resuming re-runs YIELD_DELEGATE, which forwards `mode` to the delegate */
  delegating = false
  /** how a delegating coroutine was resumed */
  mode: ResumeMode = 'next'

  constructor(private readonly host: CoroutineHost, readonly frame: Frame) {}

  get completed(): boolean {
    return this.state === 'completed'
  }

  /** the frame returned (it did not suspend): the coroutine is done */
  finishIfReturned() {
    if (this.state === 'running') this.state = 'completed'
  }

  resume(mode: ResumeMode, value: Value): IteratorStep {
    return this.host.resumeCoroutine(this, mode, value)
  }
}

/**
 * `generator.return(value)`: unwinds the generator's frame like an exception that `catch` blocks do not see, so
 * only `finally` blocks run (§5.6.5).
 */
export class GeneratorReturn extends ScriptThrow {
  constructor(readonly coroutine: Coroutine, value: Value) {
    super(value, [])
  }
}

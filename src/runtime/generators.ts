// Generator objects (D42, §4.4.16): script objects whose `next` / `return` / `throw` resume a suspended frame. The VM
// owns the frame; the object only holds the driver that resumes it.
import { Object as ScriptObject, type Value } from './values'

/** How a suspended generator is resumed: with a value, with an exception, or forced to return. */
export type ResumeMode = 'next' | 'throw' | 'return'

/**
 * One step of a generator: a yielded value, or the return value when `done`.
 */
export interface IteratorStep {
  /** the yielded or returned value */
  value: Value
  /** whether the generator has completed */
  done: boolean
}

/**
 * Resumes the frame behind a generator object (implemented by the VM).
 */
export interface GeneratorDriver {
  /** whether the generator has completed (returned or thrown) */
  readonly completed: boolean
  /**
   * Runs the generator until its next `yield` or its end.
   *
   * @param mode how to resume
   * @param value the value sent, thrown or returned
   * @returns the step
   */
  resume(mode: ResumeMode, value: Value): IteratorStep
}

export class GeneratorObject extends ScriptObject {
  constructor(proto: ScriptObject, readonly driver: GeneratorDriver) {
    super(proto)
    this.extensible = false
  }
}

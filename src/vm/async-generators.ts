// Async generators and `for await` (D53). An async generator's frame is a coroutine (§5.6.9) that suspends at `await`
// (resumed by the VM when the promise settles) and at `yield` (answering the oldest request). Requests (`next`,
// `return`, `throw`) are queued and answered in order with promises of `{ value, done }` objects, as in JS.
import type { ScriptStackFrame } from '@/errors'
import type { AsyncGeneratorDriver, IteratorStep, ResumeMode } from '@/runtime/generators'
import { DONE, ScriptIterator } from '@/runtime/iterators'
import type { PromiseObject } from '@/runtime/promises'
import type { ScriptThrow } from '@/runtime/script-error'
import type { Object as ScriptObject, Value } from '@/runtime/values'
import type { Coroutine } from './coroutines'
import type { Promises } from './promises'

/**
 * What async generators and async iterators need from the VM.
 */
export interface AsyncHost {
  /** promises and their jobs */
  promises: Promises
  /** runs the coroutine until it suspends or completes */
  resumeCoroutine(coroutine: Coroutine, mode: ResumeMode, value: Value): IteratorStep
  /** the script exception behind an exception caught by native code */
  toThrow(error: unknown): ScriptThrow
  /** a new `{ value, done }` object */
  stepObject(value: Value, done: boolean): ScriptObject
}

interface Request {
  mode: ResumeMode
  value: Value
  promise: PromiseObject
}

export class AsyncGeneratorRunner implements AsyncGeneratorDriver {
  private queue: Request[] = []
  /** a request is being answered (the body runs or waits for an `await`) */
  private running = false

  constructor(private readonly host: AsyncHost, private readonly coroutine: Coroutine) {}

  enqueue(mode: ResumeMode, value: Value): PromiseObject {
    const promise = this.host.promises.create()

    this.queue.push({ mode, value, promise })

    if (!this.running) this.answerNext()

    return promise
  }

  // A generator that has completed, or not started, answers `return` and `throw` without running its body.
  private answerNext() {
    const [request] = this.queue
    if (!request) return

    if (this.finished(request.mode)) this.answerFinished(request)
    else this.run(request.mode, request.value)
  }

  private finished(mode: ResumeMode): boolean {
    const { state } = this.coroutine

    return state === 'completed' || (state === 'suspended-start' && mode !== 'next')
  }

  private answerFinished({ mode, value }: Request) {
    this.coroutine.state = 'completed'

    if (mode === 'throw') this.reject(value, [])
    else this.fulfill(mode === 'return' ? value : null, true)
  }

  private run(mode: ResumeMode, value: Value) {
    let step: IteratorStep

    this.running = true

    try {
      step = this.host.resumeCoroutine(this.coroutine, mode, value)
    } catch (e) {
      const { value: reason, frames } = this.host.toThrow(e)

      this.reject(reason, frames)

      return
    }

    if (!step.done && this.coroutine.awaiting) this.await(step.value)
    else this.fulfill(step.value, step.done)
  }

  // `await v` in the body: the body goes on once v settles.
  private await(value: Value) {
    const { promises } = this.host

    promises.react(promises.promiseResolve(value), result => this.run('next', result), reason => this.run('throw', reason))
  }

  private fulfill(value: Value, done: boolean) {
    const request = this.take()

    this.host.promises.resolve(request.promise, this.host.stepObject(value, done))
    this.answerNext()
  }

  private reject(reason: Value, frames: ScriptStackFrame[]) {
    const request = this.take()

    this.host.promises.reject(request.promise, reason, frames)
    this.answerNext()
  }

  private take(): Request {
    this.running = false

    return this.queue.shift() as Request
  }
}

/**
 * The iterator of a `for await` loop on the VM stack: each step is a promise of a `{ value, done }` object.
 */
export class AsyncIterator extends ScriptIterator {
  constructor(private readonly step: () => Value, private readonly finish: () => Value) {
    super(() => 0, () => undefined)
  }

  /**
   * The next step.
   *
   * @returns a promise (or value) of the step object
   */
  nextStep(): Value {
    return this.step()
  }

  /**
   * `break` out of the loop: return() is awaited.
   *
   * @returns a promise (or value) of its result
   */
  closeStep(): Value {
    return this.finish()
  }

  // Leaving the loop by `return` or an exception calls return() without waiting for it.
  override close() {
    this.finish()
  }

  override next(): typeof DONE {
    return DONE
  }
}

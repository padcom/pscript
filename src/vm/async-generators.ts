// Async generators and `for await` (D53). An async generator's frame is a coroutine (§5.6.9) that suspends at `await`
// (resumed by the VM when the promise settles) and at `yield` (answering the oldest request). Requests (`next`,
// `return`, `throw`) are queued and answered in order with promises of `{ value, done }` objects, as in JS.
import type { ScriptStackFrame } from '@/errors'
import type { AsyncGeneratorDriver, GeneratorDriver, IteratorStep, ResumeMode } from '@/runtime/generators'
import { DONE, ScriptIterator } from '@/runtime/iterators'
import type { PromiseObject } from '@/runtime/promises'
import type { ScriptThrow } from '@/runtime/script-error'
import type { HostAsyncIterator, Object as ScriptObject, Value } from '@/runtime/values'
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

/** The methods of an async iterator: each gives the promise (or value) of a `{ value, done }` object. */
export type AsyncIteratorMethods = HostAsyncIterator

/**
 * The iterator of a `for await` loop or of an async `yield*` on the VM stack (D53, D54).
 */
export class AsyncIterator extends ScriptIterator {
  /** return() has been called: unwinding does not call it again */
  closed = false
  /** how the delegate was last resumed (async `yield*`): a `return` that completes ends the generator too */
  lastMode: ResumeMode = 'next'

  constructor(private readonly methods: AsyncIteratorMethods) {
    super(() => 0, () => undefined)
  }

  /**
   * Whether the iterator can be resumed this way (`next` always).
   *
   * @param mode the resumption
   * @returns true when it has the method
   */
  has(mode: ResumeMode): boolean {
    return mode === 'next' || this.methods[mode] !== undefined
  }

  /**
   * Calls `next`, `throw` or `return` (async `yield*`, D54).
   *
   * @param mode the method
   * @param value its argument
   * @returns a promise (or value) of the step object
   */
  send(mode: ResumeMode, value: Value): Value {
    this.lastMode = mode

    if (mode === 'return') this.closed = true

    return (this.methods[mode] as (value: Value) => Value)(value)
  }

  /**
   * The next step of a `for await` loop.
   *
   * @returns a promise (or value) of the step object
   */
  nextStep(): Value {
    return this.methods.next(null)
  }

  /**
   * Leaves the loop: calls return() (once), whose result is awaited.
   *
   * @returns a promise (or value) of its result
   */
  closeStep(): Value {
    if (this.closed || !this.methods.return) return null
    this.closed = true

    return this.methods.return(null)
  }

  // Unwinding the stack (generator.return(), §5.6.9) calls return() without waiting for it.
  override close() {
    this.closeStep()
  }

  override next(): typeof DONE {
    return DONE
  }
}

/**
 * The async iterator of an async generator object.
 *
 * @param driver the generator's driver
 * @returns the iterator
 */
export function asyncGeneratorIterator(driver: AsyncGeneratorDriver): AsyncIterator {
  return new AsyncIterator({
    next: value => driver.enqueue('next', value),
    throw: value => driver.enqueue('throw', value),
    return: value => driver.enqueue('return', value),
  })
}

// A synchronous step as an async one: the value is awaited (JS's async-from-sync iterator).
function awaitedStep(host: AsyncHost, { value, done }: IteratorStep): PromiseObject {
  const { promises } = host
  const result = promises.create()

  const fulfilled = (awaited: Value) => promises.resolve(result, host.stepObject(awaited, done))

  promises.react(promises.promiseResolve(value), fulfilled, (reason, frames) => promises.reject(result, reason, frames))

  return result
}

/**
 * A synchronous iterator used by `for await` or an async `yield*`: generators get `next`, `throw` and `return`
 * forwarded; other iterators only advance (`return` closes them).
 *
 * @param host the VM
 * @param iterator the synchronous iterator
 * @param generator the generator behind it, if any
 * @returns the async iterator
 */
export function syncAsAsync(host: AsyncHost, iterator: ScriptIterator, generator: GeneratorDriver | null): AsyncIterator {
  if (generator) {
    const resume = (mode: ResumeMode) => (value: Value) => awaitedStep(host, generator.resume(mode, value))

    return new AsyncIterator({ next: resume('next'), throw: resume('throw'), return: resume('return') })
  }

  return new AsyncIterator({
    next: () => {
      const next = iterator.next()

      return next === DONE ? host.stepObject(undefined, true) : awaitedStep(host, { value: next, done: false })
    },
    return: value => {
      iterator.close()

      return host.stepObject(value, true)
    },
  })
}

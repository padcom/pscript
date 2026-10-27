// The promise state machine (D43, §4.4.17), following ECMAScript's PerformPromiseThen / reaction jobs / resolve
// functions, so that callbacks run in the same order as in JavaScript. Jobs go to the VM's queue.
import type { ScriptStackFrame } from '@/errors'
import { PromiseObject, type PromiseOps, type Reaction, type ReactionHandler } from '@/runtime/promises'
import { typeError, type ScriptThrow } from '@/runtime/script-error'
import { Class, Function as ScriptFunction, NativeFunction, type AccessContext, type Value } from '@/runtime/values'
import { callBack } from '@/stdlib/callbacks'

/**
 * What the promise machinery needs from the VM.
 */
export interface PromiseHost extends AccessContext {
  /** the script exception an exception caught by native code stands for (internal errors are rethrown) */
  toThrow(error: unknown): ScriptThrow
  /** the current script stack */
  captureStack(): ScriptStackFrame[]
  /** queues a job (a microtask) */
  enqueueJob(job: () => void): void
}

type Settle = (value: Value, frames: ScriptStackFrame[]) => void

export class Promises implements PromiseOps {
  /** rejected promises nobody has handled yet, in rejection order */
  private unhandled = new Set<PromiseObject>()
  private promiseClass: Class | null = null

  constructor(private readonly host: PromiseHost) {}

  create(): PromiseObject {
    const cls = this.promiseClass ??= this.host.realm.globals.get('Promise')?.value as Class
    const promise = new PromiseObject(cls.prototype)

    promise.klass = cls

    return promise
  }

  // A promise adopts another promise's state one job later (NewPromiseResolveThenableJob); only PScript promises
  // are thenables (host promises are converted by interop, D43).
  resolve(promise: PromiseObject, value: Value) {
    if (value === promise) {
      this.reject(promise, this.errorValue(typeError('Chaining cycle detected for promise')))

      return
    }
    if (!(value instanceof PromiseObject)) {
      this.settle(promise, 'fulfilled', value, [])

      return
    }
    this.host.enqueueJob(() => this.react(value, v => this.settle(promise, 'fulfilled', v, []), (r, frames) => {
      this.settle(promise, 'rejected', r, frames)
    }))
  }

  reject(promise: PromiseObject, reason: Value, frames: ScriptStackFrame[] = this.host.captureStack()) {
    this.settle(promise, 'rejected', reason, frames)
  }

  performThen(promise: PromiseObject, onFulfilled: Value, onRejected: Value): PromiseObject {
    const derived = this.create()

    this.addReaction(promise, { onFulfilled, onRejected, derived })

    return derived
  }

  react(promise: PromiseObject, onFulfilled: ReactionHandler, onRejected: ReactionHandler) {
    this.addReaction(promise, { onFulfilled, onRejected, derived: null })
  }

  promiseResolve(value: Value): PromiseObject {
    if (value instanceof PromiseObject) return value

    const promise = this.create()

    this.settle(promise, 'fulfilled', value, [])

    return promise
  }

  resolvingFunctions(promise: PromiseObject): [Value, Value] {
    let done = false
    const once = (settle: (value: Value) => void) => (value: Value) => {
      if (done) return
      done = true
      settle(value)
    }
    const resolve = once(value => this.resolve(promise, value))
    const reject = once(reason => this.reject(promise, reason))

    // a missing argument is null (D37)
    return [this.native('resolve', resolve), this.native('reject', reject)]
  }

  thrown(error: unknown): { /**
                             *
                             */
    value: Value /**
                  *
                  */
    frames: ScriptStackFrame[]
  } {
    const { value, frames } = this.host.toThrow(error)

    return { value, frames }
  }

  /**
   * Takes the rejected promises that are still unhandled after the job queue has drained.
   *
   * @returns them, oldest first
   */
  takeUnhandled(): PromiseObject[] {
    const promises = [...this.unhandled]

    this.unhandled.clear()

    return promises
  }

  private native(name: string, settle: (value: Value) => void): NativeFunction {
    return new NativeFunction(this.host.realm.FunctionPrototype, name, 1, (_, __, args) => {
      settle(args.length === 0 ? null : args[0] as Value)

      return null
    })
  }

  private errorValue(error: unknown): Value {
    return this.host.toThrow(error).value
  }

  private addReaction(promise: PromiseObject, reaction: Reaction) {
    if (promise.state === 'pending') promise.reactions.push(reaction)
    else this.enqueueReaction(reaction, promise)

    this.unhandled.delete(promise)
    promise.handled = true
  }

  private settle(promise: PromiseObject, state: 'fulfilled' | 'rejected', result: Value, frames: ScriptStackFrame[]) {
    if (promise.state !== 'pending') return

    const { reactions } = promise

    promise.state = state
    promise.result = result
    promise.frames = frames
    promise.reactions = []
    this.trackRejection(promise)

    for (const reaction of reactions) this.enqueueReaction(reaction, promise)
  }

  private trackRejection(promise: PromiseObject) {
    if (promise.state === 'rejected' && !promise.handled) this.unhandled.add(promise)
  }

  private enqueueReaction(reaction: Reaction, promise: PromiseObject) {
    const fulfilled = promise.state === 'fulfilled'
    const handler = fulfilled ? reaction.onFulfilled : reaction.onRejected

    this.host.enqueueJob(() => this.runReaction(reaction, handler, fulfilled, promise))
  }

  // PromiseReactionJob: an internal callback just runs; a script handler's result (or exception) settles the derived
  // promise; a missing handler passes the value or reason on.
  private runReaction(reaction: Reaction, handler: ReactionHandler, fulfilled: boolean, { result, frames }: PromiseObject) {
    if (typeof handler === 'function') {
      (handler as Settle)(result, frames)

      return
    }
    const derived = reaction.derived as PromiseObject

    if (!(handler instanceof ScriptFunction)) {
      if (fulfilled) this.resolve(derived, result)
      else this.reject(derived, result, frames)

      return
    }
    this.callHandler(derived, handler, result)
  }

  private callHandler(derived: PromiseObject, handler: ScriptFunction, argument: Value) {
    let value: Value

    try {
      value = callBack(this.host, handler, null, [argument])
    } catch (e) {
      const thrown = this.host.toThrow(e)

      this.reject(derived, thrown.value, thrown.frames)

      return
    }
    this.resolve(derived, value)
  }
}

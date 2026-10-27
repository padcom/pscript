// Globals backed by the host's event loop (D44, D45, §4.6.1): `setTimeout` / `clearTimeout`, `setInterval` /
// `clearInterval`, `queueMicrotask` and `fetch`, with the interface they have in JavaScript. Timer callbacks run as
// tasks (`AccessContext.runTask`), microtasks as jobs (`AccessContext.enqueueJob`); `fetch` calls the host's fetch
// through interop, so the arguments and the response cross the boundary like any host call (§5.8.1).
import { toNumber } from '@/runtime/operators'
import { defineGlobal } from '@/runtime/realm'
import { typeError } from '@/runtime/script-error'
import { NativeFunction, type AccessContext, type NativeImpl, type Realm, type Value } from '@/runtime/values'
import { callBack, requireCallback } from './callbacks'

/**
 * The host functions behind the globals (the interpreter passes the host's own by default).
 */
export interface HostIO {
  /** schedules a callback after `delay` milliseconds; returns a handle for `clearTimeout` */
  setTimeout: (callback: () => void, delay: number) => unknown
  /** cancels a scheduled callback */
  clearTimeout: (handle: unknown) => void
  /** the Fetch API's `fetch` */
  fetch: (input: unknown, init?: unknown) => Promise<unknown>
}

type Capable<K extends keyof AccessContext> = AccessContext & Required<Pick<AccessContext, K>>

type Capability = 'runTask' | 'interop' | 'enqueueJob' | 'promises'

// The context, checked to provide what a global needs (the VM provides everything).
function capable<K extends Capability>(ctx: AccessContext, key: K, what: string): Capable<K> {
  if (!ctx[key]) throw typeError(`${what} is not available here`)

  return ctx as Capable<K>
}

// A missing or non-numeric delay is 0, as in JS; negative delays run as soon as possible.
function delayOf(value: Value, method: string): number {
  if (value === undefined || value === null) return 0

  const delay = toNumber(value, method)

  return globalThis.Number.isNaN(delay) ? 0 : globalThis.Math.max(0, delay)
}

/**
 * The timers of one realm: script-visible ids (positive integers, as in browsers) mapped to host handles.
 */
class Timers {
  private handles = new Map<number, unknown>()
  private nextId = 1

  constructor(private readonly io: HostIO) {}

  // `setTimeout` / `setInterval(callback, delay?, ...args)`: the callback receives the extra arguments it declares
  // (§4.6.4). An interval re-arms itself before each run, so the callback can clear it; an exception doesn't stop it.
  set(ctx: AccessContext, [callback, delay, ...args]: Value[], method: string, repeat: boolean): number {
    if (typeof callback === 'string') throw typeError(`${method}: code strings are not supported; pass a function`)

    const fn = requireCallback(callback, method)
    const host = capable(ctx, 'runTask', method)
    const ms = delayOf(delay, method)
    const id = this.nextId++
    const fire = () => {
      if (repeat) this.handles.set(id, this.io.setTimeout(fire, ms))
      else this.handles.delete(id)
      host.runTask(() => callBack(ctx, fn, null, args))
    }

    this.handles.set(id, this.io.setTimeout(fire, ms))

    return id
  }

  // `clearTimeout(id)` / `clearInterval(id)` (interchangeable, as in JS): unknown ids (fired, cleared, null) are
  // ignored.
  clear(id: Value) {
    if (typeof id !== 'number' || !this.handles.has(id)) return

    this.io.clearTimeout(this.handles.get(id))
    this.handles.delete(id)
  }
}

// `queueMicrotask(callback)`: a job, like a promise reaction. An exception in the callback is reported like an
// unhandled rejection (after the queue has drained), so the other jobs still run.
const queueMicrotaskImpl: NativeImpl = (ctx, _, [callback]) => {
  const fn = requireCallback(callback, 'queueMicrotask')
  const { enqueueJob } = capable(ctx, 'enqueueJob', 'queueMicrotask')
  const { promises } = capable(ctx, 'promises', 'queueMicrotask')

  enqueueJob.call(ctx, () => {
    try {
      callBack(ctx, fn, null, [])
    } catch (e) {
      const { value, frames } = promises.thrown(e)

      promises.reject(promises.create(), value, frames)
    }
  })

  return null
}

// `fetch(resource, options?)`: always a promise; an exception from the host's fetch rejects it, as in JS.
function fetchImpl(io: HostIO): NativeImpl {
  return (ctx, _, args) => {
    const { interop } = capable(ctx, 'interop', 'fetch')
    const [input, init] = args.map(arg => interop.toHost(arg))

    return interop.toScript(new globalThis.Promise(resolve => { resolve(io.fetch(input, init)) }))
  }
}

function native(realm: Realm, name: string, length: number, impl: NativeImpl): NativeFunction {
  return new NativeFunction(realm.FunctionPrototype, name, length, impl)
}

/**
 * Installs `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `queueMicrotask` and `fetch`.
 *
 * @param realm the realm
 * @param io the host functions behind them
 */
export function installHost(realm: Realm, io: HostIO) {
  const timers = new Timers(io)
  const clear: NativeImpl = (_, __, [id]) => {
    timers.clear(id)

    return null
  }

  const set = (method: string, repeat: boolean): NativeImpl => (ctx, _, args) => timers.set(ctx, args, method, repeat)

  defineGlobal(realm, 'setTimeout', native(realm, 'setTimeout', 1, set('setTimeout', false)), true)
  defineGlobal(realm, 'setInterval', native(realm, 'setInterval', 1, set('setInterval', true)), true)
  defineGlobal(realm, 'clearTimeout', native(realm, 'clearTimeout', 1, clear), true)
  defineGlobal(realm, 'clearInterval', native(realm, 'clearInterval', 1, clear), true)
  defineGlobal(realm, 'queueMicrotask', native(realm, 'queueMicrotask', 1, queueMicrotaskImpl), true)
  defineGlobal(realm, 'fetch', native(realm, 'fetch', 1, fetchImpl(io)), true)
}

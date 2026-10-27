// Globals backed by the host's event loop (D44, §4.6.1): `setTimeout` / `clearTimeout` and `fetch`, with the
// interface they have in JavaScript. Timer callbacks run as tasks (`AccessContext.runTask`); `fetch` calls the host's
// fetch through interop, so the arguments and the response cross the boundary like any host call (§5.8.1).
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

// The context, checked to provide what a global needs (the VM provides everything).
function capable<K extends 'runTask' | 'interop'>(ctx: AccessContext, key: K, what: string): Capable<K> {
  if (!ctx[key]) throw typeError(`${what} is not available here`)

  return ctx as Capable<K>
}

// A missing or non-numeric delay is 0, as in JS; negative delays run as soon as possible.
function delayOf(value: Value): number {
  if (value === undefined || value === null) return 0

  const delay = toNumber(value, 'setTimeout')

  return globalThis.Number.isNaN(delay) ? 0 : globalThis.Math.max(0, delay)
}

/**
 * The timers of one realm: script-visible ids (positive integers, as in browsers) mapped to host handles.
 */
class Timers {
  private handles = new Map<number, unknown>()
  private nextId = 1

  constructor(private readonly io: HostIO) {}

  // `setTimeout(callback, delay?, ...args)`: the callback receives the extra arguments it declares (§4.6.4).
  set(ctx: AccessContext, [callback, delay, ...args]: Value[]): number {
    if (typeof callback === 'string') throw typeError('setTimeout: code strings are not supported; pass a function')

    const fn = requireCallback(callback, 'setTimeout')
    const host = capable(ctx, 'runTask', 'setTimeout')
    const id = this.nextId++
    const fire = () => {
      this.handles.delete(id)
      host.runTask(() => callBack(ctx, fn, null, args))
    }

    this.handles.set(id, this.io.setTimeout(fire, delayOf(delay)))

    return id
  }

  // `clearTimeout(id)`: unknown ids (fired, cleared, null) are ignored, as in JS.
  clear(id: Value) {
    if (typeof id !== 'number' || !this.handles.has(id)) return

    this.io.clearTimeout(this.handles.get(id))
    this.handles.delete(id)
  }
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
 * Installs `setTimeout`, `clearTimeout` and `fetch`.
 *
 * @param realm the realm
 * @param io the host functions behind them
 */
export function installHost(realm: Realm, io: HostIO) {
  const timers = new Timers(io)

  defineGlobal(realm, 'setTimeout', native(realm, 'setTimeout', 1, (ctx, _, args) => timers.set(ctx, args)), true)
  defineGlobal(realm, 'clearTimeout', native(realm, 'clearTimeout', 1, (_, __, [id]) => {
    timers.clear(id)

    return null
  }), true)
  defineGlobal(realm, 'fetch', native(realm, 'fetch', 1, fetchImpl(io)), true)
}

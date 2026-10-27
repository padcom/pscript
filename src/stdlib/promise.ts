// The Promise class (D43, §4.4.17): a final built-in class. `then` / `catch` / `finally` on the prototype; `resolve`,
// `reject`, `all`, `allSettled`, `race`, `any` and `withResolvers` as statics. Callbacks receive the arguments they
// declare (§4.6.4); a missing argument is null (D37).
import { DONE, getIterator } from '@/runtime/iterators'
import { kindOf } from '@/runtime/operators'
import { PromiseObject, type PromiseOps } from '@/runtime/promises'
import { defineGlobal } from '@/runtime/realm'
import { ScriptThrow, typeError } from '@/runtime/script-error'
import {
  Array as ScriptArray,
  Class,
  Function as ScriptFunction,
  NativeFunction,
  Object as ScriptObject,
  type AccessContext,
  type NativeImpl,
  type Realm,
  type Value,
} from '@/runtime/values'
import { callBack } from './callbacks'
import { builtinTemplate } from './errors'
import { defineMethods, method } from './native'

function opsOf(ctx: AccessContext): PromiseOps {
  if (!ctx.promises) throw typeError('Promises are not available here')

  return ctx.promises
}

function requirePromise(self: Value, name: string): PromiseObject {
  if (!(self instanceof PromiseObject)) throw typeError(`Promise.prototype.${name} called on ${kindOf(self)}`)

  return self
}

function argument(args: Value[]): Value {
  return args.length === 0 ? null : args[0] as Value
}

function native(realm: Realm, length: number, impl: NativeImpl): NativeFunction {
  return new NativeFunction(realm.FunctionPrototype, '', length, impl)
}

function plainObject(realm: Realm, entries: Record<string, Value>): ScriptObject {
  const object = new ScriptObject(realm.ObjectPrototype)

  for (const [key, value] of Object.entries(entries)) object.props.set(key, value)

  return object
}

// `new Promise(executor)`: the executor gets resolve and reject; an exception it throws rejects the promise.
function construct(ctx: AccessContext, [executor]: Value[]): PromiseObject {
  if (!(executor instanceof ScriptFunction)) throw typeError(`Promise resolver ${kindOf(executor)} is not a function`)

  const ops = opsOf(ctx)
  const promise = ops.create()
  const [resolve, reject] = ops.resolvingFunctions(promise)

  try {
    callBack(ctx, executor, null, [resolve, reject])
  } catch (e) {
    ctx.callFunction(reject, null, [ops.thrown(e).value])
  }

  return promise
}

// `finally(f)`: f runs without arguments; then the original value or reason passes through (unless f fails).
function finallyHandlers(ctx: AccessContext, onFinally: ScriptFunction): [NativeFunction, NativeFunction] {
  const ops = opsOf(ctx)
  const { realm } = ctx
  const after = (pass: NativeImpl) => (value: Value) => {
    const done = ops.promiseResolve(callBack(ctx, onFinally, null, []))

    return ops.performThen(done, native(realm, 0, () => pass(ctx, null, [value])), undefined)
  }
  const thenFinally = after((_, __, [value]) => value as Value)
  const catchFinally = after((_, __, [reason]) => { throw new ScriptThrow(reason as Value, ctx.captureStack?.() ?? []) })

  return [
    native(realm, 1, (_, __, args) => thenFinally(argument(args))),
    native(realm, 1, (_, __, args) => catchFinally(argument(args))),
  ]
}

function promiseFinally(ctx: AccessContext, self: Value, onFinally: Value): PromiseObject {
  const promise = requirePromise(self, 'finally')
  if (!(onFinally instanceof ScriptFunction)) return opsOf(ctx).performThen(promise, onFinally, onFinally)

  return opsOf(ctx).performThen(promise, ...finallyHandlers(ctx, onFinally))
}

function promiseThen(ctx: AccessContext, self: Value, onFulfilled: Value, onRejected: Value): PromiseObject {
  return opsOf(ctx).performThen(requirePromise(self, 'then'), onFulfilled, onRejected)
}

function prototypeMethods(): Record<string, [number, NativeImpl]> {
  return {
    then: method(2, (ctx, self, [onFulfilled, onRejected]) => promiseThen(ctx, self, onFulfilled, onRejected)),
    catch: method(1, (ctx, self, [onRejected]) => opsOf(ctx).performThen(requirePromise(self, 'catch'), undefined, onRejected)),
    finally: method(1, (ctx, self, [onFinally]) => promiseFinally(ctx, self, onFinally)),
    toString: method(0, () => '[object Promise]'),
  }
}

/**
 * The combinators' view of an iterable: its values, or the TypeError that rejects the result (as in JS).
 */
type Collected = { values: Value[] } | { error: unknown }

function collect(ctx: AccessContext, iterable: Value): Collected {
  try {
    const iterator = getIterator(iterable, ctx)
    const values: Value[] = []

    for (let value = iterator.next(); value !== DONE; value = iterator.next()) values.push(value)

    return { values }
  } catch (error) {
    return { error }
  }
}

/**
 * How a combinator reacts to its promises settling.
 */
interface Combinator {
  /** element i fulfilled with value */
  fulfilled(i: number, value: Value): void
  /** element i rejected */
  rejected(i: number, reason: Value, frames: Parameters<PromiseOps['reject']>[2]): void
  /** every element has settled (or there were none) */
  finished(): void
}

// The common shape of Promise.all / allSettled / race / any: subscribe to each element, count down to the end.
function combine(ctx: AccessContext, iterable: Value, make: (result: PromiseObject, count: number) => Combinator): PromiseObject {
  const ops = opsOf(ctx)
  const result = ops.create()
  const collected = collect(ctx, iterable)

  if ('error' in collected) {
    ops.reject(result, ops.thrown(collected.error).value)

    return result
  }
  const { values } = collected
  const combinator = make(result, values.length)
  let remaining = values.length + 1
  const countDown = () => {
    if (--remaining === 0) combinator.finished()
  }

  values.forEach((value, i) => ops.react(ops.promiseResolve(value), v => {
    combinator.fulfilled(i, v)
    countDown()
  }, (reason, frames) => {
    combinator.rejected(i, reason, frames)
    countDown()
  }))
  countDown()

  return result
}

function aggregateError(ctx: AccessContext, errors: Value[]): Value {
  const cls = ctx.realm.globals.get('AggregateError')?.value as Class & Required<Pick<Class, 'native'>>

  return cls.native.construct(ctx, cls, [new ScriptArray(ctx.realm.ArrayPrototype, errors), 'All promises were rejected'])
}

function all(ctx: AccessContext, iterable: Value): PromiseObject {
  const ops = opsOf(ctx)

  return combine(ctx, iterable, (result, count) => {
    const items: Value[] = new globalThis.Array(count).fill(null)

    return {
      fulfilled: (i, value) => { items[i] = value },
      rejected: (_, reason, frames) => ops.reject(result, reason, frames),
      finished: () => ops.resolve(result, new ScriptArray(ctx.realm.ArrayPrototype, items)),
    }
  })
}

function allSettled(ctx: AccessContext, iterable: Value): PromiseObject {
  const ops = opsOf(ctx)
  const { realm } = ctx

  return combine(ctx, iterable, (result, count) => {
    const items: Value[] = new globalThis.Array(count).fill(null)

    return {
      fulfilled: (i, value) => { items[i] = plainObject(realm, { status: 'fulfilled', value }) },
      rejected: (i, reason) => { items[i] = plainObject(realm, { status: 'rejected', reason }) },
      finished: () => ops.resolve(result, new ScriptArray(realm.ArrayPrototype, items)),
    }
  })
}

function race(ctx: AccessContext, iterable: Value): PromiseObject {
  const ops = opsOf(ctx)

  return combine(ctx, iterable, result => ({
    fulfilled: (_, value) => ops.resolve(result, value),
    rejected: (_, reason, frames) => ops.reject(result, reason, frames),
    finished: () => {},
  }))
}

function any(ctx: AccessContext, iterable: Value): PromiseObject {
  const ops = opsOf(ctx)

  return combine(ctx, iterable, (result, count) => {
    const errors: Value[] = new globalThis.Array(count).fill(null)
    let fulfilled = false

    return {
      fulfilled: (_, value) => {
        fulfilled = true
        ops.resolve(result, value)
      },
      rejected: (i, reason) => { errors[i] = reason },
      finished: () => {
        if (!fulfilled) ops.reject(result, aggregateError(ctx, errors))
      },
    }
  })
}

function withResolvers(ctx: AccessContext): ScriptObject {
  const ops = opsOf(ctx)
  const promise = ops.create()
  const [resolve, reject] = ops.resolvingFunctions(promise)

  return plainObject(ctx.realm, { promise, resolve, reject })
}

function staticMethods(): Record<string, [number, NativeImpl]> {
  return {
    resolve: method(1, (ctx, _, args) => opsOf(ctx).promiseResolve(argument(args))),
    reject: method(1, (ctx, _, args) => {
      const promise = opsOf(ctx).create()

      opsOf(ctx).reject(promise, argument(args))

      return promise
    }),
    all: method(1, (ctx, _, [iterable]) => all(ctx, iterable)),
    allSettled: method(1, (ctx, _, [iterable]) => allSettled(ctx, iterable)),
    race: method(1, (ctx, _, [iterable]) => race(ctx, iterable)),
    any: method(1, (ctx, _, [iterable]) => any(ctx, iterable)),
    withResolvers: method(0, ctx => withResolvers(ctx)),
  }
}

/**
 * Installs the `Promise` class.
 *
 * @param realm the realm
 */
export function installPromise(realm: Realm) {
  const prototype = new ScriptObject(realm.ObjectPrototype)
  const cls = new Class(realm.FunctionPrototype, { ...builtinTemplate('Promise', false), isFinal: true }, null, prototype)

  cls.length = 1
  cls.final = true // instances have exactly the built-in behaviour (D29)
  cls.native = { construct: (ctx, _, args) => construct(ctx, args) }
  defineMethods(realm, prototype, prototypeMethods())
  defineMethods(realm, cls, staticMethods())
  defineGlobal(realm, 'Promise', cls, true)
}

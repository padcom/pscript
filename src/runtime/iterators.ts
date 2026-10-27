// Iteration for `for…of` (§4.4.8): arrays (live, by index, while i < length), strings (by UTF-16 code unit),
// generators (D42), maps and sets (D49) and host iterables.
import { CollectionObject } from './collections'
import { GeneratorObject, type IteratorStep } from './generators'
import { ITERATOR_KEY } from '@/parser/symbol-keys'
import { isObject, kindOf, truthy } from './operators'
import { getProperty, hasPropertyIn } from './properties'
import { type ScriptError, typeError } from './script-error'
import { publicProps } from './members'
import {
  HostObject,
  Array as ScriptArray,
  Function as ScriptFunction,
  Object as ScriptObject,
  type AccessContext,
  type Value,
} from './values'

/** Returned by `ScriptIterator.next()` when the iteration is over. */
export const DONE: unique symbol = Symbol('DONE')

/**
 * An iterator on the VM stack (never visible to scripts).
 */
export class ScriptIterator {
  private index = 0

  constructor(private readonly length: () => number, private readonly at: (index: number) => Value) {}

  /**
   * Advances the iterator.
   *
   * @returns the next value, or `DONE` when the iteration is over
   */
  next(): Value | typeof DONE {
    return this.index < this.length() ? this.at(this.index++) : DONE
  }

  /**
   * Ends the iteration early (`break`, `return` or an exception leaving a `for…of`): generators run their `finally`
   * blocks. Other iterators have nothing to clean up.
   */
  close() {}
}

/**
 * Iterates a generator object (D42).
 */
export class GeneratorIterator extends ScriptIterator {
  constructor(readonly generator: GeneratorObject) {
    super(() => 0, () => undefined)
  }

  override next(): Value | typeof DONE {
    const { value, done } = this.step(null)

    return done ? DONE : value
  }

  /**
   * Resumes the generator with a value (`yield*` forwards what its own generator receives).
   *
   * @param sent the value the generator's `yield` gives
   * @returns the step
   */
  step(sent: Value): IteratorStep {
    return this.generator.driver.resume('next', sent)
  }

  override close() {
    if (!this.generator.driver.completed) this.generator.driver.resume('return', null)
  }
}

/**
 * Iterates a JS iterator of script values: host iterables (arrays, Maps, Sets, generators …, whose host iterator
 * converts each value, §5.8.1) and script maps and sets (D49). Values are taken one at a time, so a map or set that
 * grows during the loop is iterated live.
 */
export class JsIterator extends ScriptIterator {
  constructor(private readonly iterator: Iterator<Value>) {
    super(() => 0, () => undefined)
  }

  override next(): Value | typeof DONE {
    const step = this.iterator.next()

    return step.done ? DONE : step.value
  }
}

function enumerableKeys(value: Value): string[] {
  if (typeof value === 'string') return [...value].map((_, i) => String(i))
  if (value instanceof ScriptArray) return value.items.map((_, i) => String(i))

  return value instanceof ScriptObject ? publicProps(value).map(([key]) => key) : []
}

/**
 * The keys a `for…in` loop visits (D56), as JS does for PScript's objects: own enumerable public properties (plain
 * objects, the fields of class instances, the exports of namespaces, host objects), the indices of arrays and strings,
 * nothing for null, undefined and other primitives. A key deleted before it is reached is skipped.
 */
export class KeyIterator extends ScriptIterator {
  private readonly keys: string[]
  private position = 0

  constructor(private readonly object: Value) {
    super(() => 0, () => undefined)
    this.keys = enumerableKeys(object)
  }

  override next(): Value | typeof DONE {
    while (this.position < this.keys.length) {
      const key = this.keys[this.position++]

      if (this.present(key)) return key
    }

    return DONE
  }

  private present(key: string): boolean {
    const { object } = this

    if (object instanceof ScriptArray) return globalThis.Number(key) < object.items.length

    return !(object instanceof ScriptObject) || object instanceof HostObject || object.props.has(key)
  }
}

/**
 * Iterates the iterator object an `[Symbol.iterator]()` method returned (D57): `next()` gives `{ value, done }`
 * objects; leaving early calls `return()` when there is one.
 */
export class ProtocolIterator extends ScriptIterator {
  private finished = false
  private readonly nextMethod: Value

  constructor(private readonly ctx: AccessContext, private readonly iterator: ScriptObject) {
    super(() => 0, () => undefined)
    this.nextMethod = getProperty(ctx, iterator, 'next')
  }

  override next(): Value | typeof DONE {
    if (!(this.nextMethod instanceof ScriptFunction)) throw typeError('The iterator has no next() method')

    const step = this.ctx.callFunction(this.nextMethod, this.iterator, [])
    if (!isObject(step)) throw typeError(`Iterator result ${kindOf(step)} is not an object`)
    if (!truthy(getProperty(this.ctx, step, 'done'))) return getProperty(this.ctx, step, 'value')

    this.finished = true

    return DONE
  }

  override close() {
    if (this.finished || !hasPropertyIn(this.ctx, 'return', this.iterator)) return
    this.finished = true

    const method = getProperty(this.ctx, this.iterator, 'return')

    if (method instanceof ScriptFunction) this.ctx.callFunction(method, this.iterator, [])
  }
}

// Whether a value has a `[Symbol.iterator]` member (D57).
function isIterableObject(ctx: AccessContext | undefined, value: Value): ctx is AccessContext {
  return ctx !== undefined && value instanceof ScriptObject && hasPropertyIn(ctx, ITERATOR_KEY, value)
}

function iteratorOf(ctx: AccessContext, iterator: Value): ScriptIterator {
  if (iterator instanceof GeneratorObject) return new GeneratorIterator(iterator)
  if (!isObject(iterator)) throw typeError('Result of the Symbol.iterator method is not an object')

  return new ProtocolIterator(ctx, iterator)
}

// `[Symbol.iterator]()` (D57); a generator it returns is iterated directly.
function protocolIterator(ctx: AccessContext, value: ScriptObject): ScriptIterator {
  const method = getProperty(ctx, value, ITERATOR_KEY)
  if (!(method instanceof ScriptFunction)) throw typeError(`${kindOf(value)} is not iterable`)

  return iteratorOf(ctx, ctx.callFunction(method, value, []))
}

// Built-in iterables, then user-defined ones.
function builtinIterator(value: Value): ScriptIterator | null {
  if (value instanceof GeneratorObject) return new GeneratorIterator(value)
  if (value instanceof CollectionObject) return new JsIterator(value.iterate())

  return value instanceof HostObject ? new JsIterator(value.host.iterate(value.target)) : null
}

function objectIterator(value: Value, ctx: AccessContext | undefined): ScriptIterator {
  const builtin = builtinIterator(value)
  if (builtin) return builtin
  if (!isIterableObject(ctx, value)) throw typeError(`${kindOf(value)} is not iterable`)

  return protocolIterator(ctx, value as ScriptObject)
}

/**
 * `GET_ITER`: an iterator over an iterable value.
 *
 * @param value the iterated value
 * @param ctx the context to call `[Symbol.iterator]()` in (D57); without it, user-defined iterables are not iterable
 * @returns the iterator
 * @throws {ScriptError} TypeError when the value is not iterable
 */
export function getIterator(value: Value, ctx?: AccessContext): ScriptIterator {
  if (value instanceof ScriptArray) return new ScriptIterator(() => value.items.length, i => value.items[i])
  if (typeof value === 'string') return new ScriptIterator(() => value.length, i => value[i])

  return objectIterator(value, ctx)
}

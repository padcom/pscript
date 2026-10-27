// Iteration for `for…of` (§4.4.8): arrays (live, by index, while i < length), strings (by UTF-16 code unit),
// generators (D42), maps and sets (D49) and host iterables.
import { CollectionObject } from './collections'
import { GeneratorObject, type IteratorStep } from './generators'
import { kindOf } from './operators'
import { type ScriptError, typeError } from './script-error'
import { publicProps } from './members'
import { HostObject, Array as ScriptArray, Object as ScriptObject, type Value } from './values'

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

function objectIterator(value: Value): ScriptIterator {
  if (value instanceof GeneratorObject) return new GeneratorIterator(value)
  if (value instanceof CollectionObject) return new JsIterator(value.iterate())
  if (value instanceof HostObject) return new JsIterator(value.host.iterate(value.target))

  throw typeError(`${kindOf(value)} is not iterable`)
}

/**
 * `GET_ITER`: an iterator over an iterable value.
 *
 * @param value the iterated value
 * @returns the iterator
 * @throws {ScriptError} TypeError when the value is not iterable
 */
export function getIterator(value: Value): ScriptIterator {
  if (value instanceof ScriptArray) return new ScriptIterator(() => value.items.length, i => value.items[i])
  if (typeof value === 'string') return new ScriptIterator(() => value.length, i => value[i])

  return objectIterator(value)
}

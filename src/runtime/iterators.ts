// Iteration for `for…of` (§4.4.8): arrays (live, by index, while i < length), strings (by UTF-16 code unit) and
// host iterables.
import { kindOf } from './operators'
import { type ScriptError, typeError } from './script-error'
import { HostObject, Array as ScriptArray, type Value } from './values'

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
}

// Host iterables (arrays, Maps, Sets, generators …) use the host iterator, converting each value (§5.8.1).
function hostIterator(iterator: Iterator<Value>): ScriptIterator {
  let next = iterator.next()
  const advance = (): Value => {
    const { value } = next

    next = iterator.next()

    return value
  }

  return new ScriptIterator(() => (next.done ? 0 : Infinity), advance)
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
  if (value instanceof HostObject) return hostIterator(value.host.iterate(value.target))
  if (typeof value === 'string') return new ScriptIterator(() => value.length, i => value[i])

  throw typeError(`${kindOf(value)} is not iterable`)
}

// Iteration for `for…of` (§4.4.8): arrays (live, by index, while i < length), strings (by UTF-16 code unit),
// generators (D42) and host iterables.
import { GeneratorObject, type IteratorStep } from './generators'
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

function objectIterator(value: Value): ScriptIterator {
  if (value instanceof GeneratorObject) return new GeneratorIterator(value)
  if (value instanceof HostObject) return hostIterator(value.host.iterate(value.target))

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

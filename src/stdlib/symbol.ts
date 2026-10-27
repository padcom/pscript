// `Symbol.iterator` and `Symbol.asyncIterator` (D57): the `Symbol` namespace, and the `[Symbol.iterator]()` methods of
// the built-in iterables, which return iterator objects that work like generators.
import { ASYNC_ITERATOR_KEY, ITERATOR_KEY } from '@/parser/symbol-keys'
import { GeneratorObject, type GeneratorDriver, type IteratorStep, type ResumeMode } from '@/runtime/generators'
import { DONE, getIterator, type ScriptIterator } from '@/runtime/iterators'
import { defineProperty } from '@/runtime/properties'
import { defineGlobal } from '@/runtime/realm'
import { ScriptThrow } from '@/runtime/script-error'
import { SYMBOL_ASYNC_ITERATOR, SYMBOL_ITERATOR } from '@/runtime/symbols'
import { Class, Object as ScriptObject, type Realm, type Value } from '@/runtime/values'
import { defineMethods, method } from './native'

/**
 * Drives native iterator objects (`[Symbol.iterator]()`, a map's `keys()` …): they work like generators (`next`,
 * `return`, `throw`, `for…of`).
 */
class NativeDriver implements GeneratorDriver {
  completed = false

  constructor(private readonly iterator: Iterator<Value>) {}

  resume(mode: ResumeMode, value: Value): IteratorStep {
    if (this.completed || mode !== 'next') return this.finish(mode, value)

    const next = this.iterator.next()

    return next.done ? this.finish('next', null) : { value: next.value, done: false }
  }

  private finish(mode: ResumeMode, value: Value): IteratorStep {
    this.completed = true

    if (mode === 'throw') throw new ScriptThrow(value, [])

    return { value: mode === 'return' ? value : null, done: true }
  }
}

/**
 * An iterator object over the values of a JS iterator.
 *
 * @param realm the realm
 * @param iterator the values
 * @returns the object
 */
export function iteratorObject(realm: Realm, iterator: Iterator<Value>): GeneratorObject {
  return new GeneratorObject(realm.GeneratorPrototype, new NativeDriver(iterator))
}

function* values(iterator: ScriptIterator): Generator<Value> {
  for (let next = iterator.next(); next !== DONE; next = iterator.next()) yield next
}

// `[Symbol.iterator]()` of arrays and strings: the values `for…of` visits.
function iterate(realm: Realm) {
  return method(0, (ctx, self) => iteratorObject(realm, values(getIterator(self, ctx))))
}

function prototypeOf(realm: Realm, name: string): ScriptObject {
  return (realm.globals.get(name)?.value as Class).prototype
}

/**
 * Installs `Symbol` and the `[Symbol.iterator]()` / `[Symbol.asyncIterator]()` methods of the built-ins (after them).
 *
 * @param realm the realm
 */
export function installSymbol(realm: Realm) {
  const namespace = new ScriptObject(realm.ObjectPrototype)

  defineProperty(namespace, 'iterator', SYMBOL_ITERATOR)
  defineProperty(namespace, 'asyncIterator', SYMBOL_ASYNC_ITERATOR)
  namespace.extensible = false
  namespace.frozen = true
  defineGlobal(realm, 'Symbol', namespace, true)

  defineMethods(realm, realm.ArrayPrototype, { [ITERATOR_KEY]: iterate(realm) })
  defineMethods(realm, realm.StringPrototype, { [ITERATOR_KEY]: iterate(realm) })
  defineMethods(realm, realm.GeneratorPrototype, { [ITERATOR_KEY]: method(0, (_, self) => self) })
  defineMethods(realm, realm.AsyncGeneratorPrototype, { [ASYNC_ITERATOR_KEY]: method(0, (_, self) => self) })

  for (const [name, from] of [['Map', 'entries'], ['Set', 'values']]) {
    const prototype = prototypeOf(realm, name)

    defineProperty(prototype, ITERATOR_KEY, prototype.props.get(from) as Value)
  }
}

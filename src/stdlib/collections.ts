// The Map and Set classes (D49): final built-in classes with the JavaScript interface. Callbacks receive the arguments
// they declare (§4.6.4); a missing entry is null (D37), like other "not found" results of the standard library.
import { MapObject, SetObject, collectionKey } from '@/runtime/collections'
import { GeneratorObject, type GeneratorDriver, type IteratorStep, type ResumeMode } from '@/runtime/generators'
import { DONE, getIterator } from '@/runtime/iterators'
import { kindOf } from '@/runtime/operators'
import { defineAccessor, getProperty } from '@/runtime/properties'
import { defineGlobal } from '@/runtime/realm'
import { ScriptThrow, typeError } from '@/runtime/script-error'
import {
  Array as ScriptArray,
  Class,
  HostObject,
  NativeFunction,
  Object as ScriptObject,
  type AccessContext,
  type NativeImpl,
  type Realm,
  type Value,
} from '@/runtime/values'
import { callBack, requireCallback } from './callbacks'
import { builtinTemplate } from './errors'
import { defineMethods, method } from './native'

type Collection = typeof MapObject | typeof SetObject

function receiver<T extends Collection>(type: T, self: Value, name: string): InstanceType<T> {
  const what = type === MapObject ? 'Map' : 'Set'

  if (!(self instanceof type)) throw typeError(`${what}.prototype.${name} called on ${kindOf(self)}`)

  return self as InstanceType<T>
}

/**
 * Drives the iterator objects of keys(), values() and entries(): they work like generators (`next`, `return`,
 * `throw`, `for…of`).
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

function iteratorObject(realm: Realm, iterator: Iterator<Value>): GeneratorObject {
  return new GeneratorObject(realm.GeneratorPrototype, new NativeDriver(iterator))
}

function forEachValue(iterable: Value, each: (value: Value) => void) {
  if (iterable === undefined || iterable === null) return

  const iterator = getIterator(iterable)

  for (let next = iterator.next(); next !== DONE; next = iterator.next()) each(next)
}

function isHostArray(value: Value): value is HostObject {
  return value instanceof HostObject && globalThis.Array.isArray(value.target)
}

// The entries of `new Map(iterable)`: arrays of a key and a value (host arrays too, e.g. from a host Map).
function entryOf(ctx: AccessContext, value: Value): [Value, Value] {
  if (value instanceof ScriptArray) return [value.items[0], value.items[1]]
  if (!isHostArray(value)) throw typeError(`Iterator value ${kindOf(value)} is not an entry object`)

  return [getProperty(ctx, value, '0'), getProperty(ctx, value, '1')]
}

// -0 is stored as 0 (SameValueZero), as JS does.
function normalizedKey(key: Value): Value {
  return key === 0 ? 0 : key
}

function* keysOf({ entries }: MapObject): Generator<Value> {
  for (const [key] of entries.values()) yield key
}

function* valuesOf({ entries }: MapObject): Generator<Value> {
  for (const [, value] of entries.values()) yield value
}

function* setEntries(set: SetObject, arrayPrototype: ScriptObject): Generator<Value> {
  for (const value of set.elements.values()) yield new ScriptArray(arrayPrototype, [value, value])
}

function size(realm: Realm, type: Collection): NativeFunction {
  return new NativeFunction(realm.FunctionPrototype, 'size', 0, (_, self) => {
    const collection = receiver(type, self, 'size')

    return collection instanceof MapObject ? collection.entries.size : collection.elements.size
  })
}

const map = (self: Value, name: string) => receiver(MapObject, self, name)
const set = (self: Value, name: string) => receiver(SetObject, self, name)

function setEntry(self: Value, key: Value, value: Value): Value {
  const { entries } = map(self, 'set')
  const stored = collectionKey(key)
  const existing = entries.get(stored)

  entries.set(stored, [existing ? existing[0] : normalizedKey(key), value])

  return self
}

function clear(self: Value, entries: Map<unknown, unknown>): null {
  entries.clear()

  return null
}

function mapMethods(realm: Realm): Record<string, [number, NativeImpl]> {
  return {
    get: method(1, (_, self, [key]) => map(self, 'get').entries.get(collectionKey(key))?.[1] ?? null),
    set: method(2, (_, self, [key, value]) => setEntry(self, key, value)),
    has: method(1, (_, self, [key]) => map(self, 'has').entries.has(collectionKey(key))),
    delete: method(1, (_, self, [key]) => map(self, 'delete').entries.delete(collectionKey(key))),
    clear: method(0, (_, self) => clear(self, map(self, 'clear').entries)),
    forEach: method(1, (ctx, self, [callback]) => {
      const fn = requireCallback(callback, 'Map.prototype.forEach')

      for (const [key, value] of map(self, 'forEach').entries.values()) callBack(ctx, fn, null, [value, key, self])

      return null
    }),
    keys: method(0, (_, self) => iteratorObject(realm, keysOf(map(self, 'keys')))),
    values: method(0, (_, self) => iteratorObject(realm, valuesOf(map(self, 'values')))),
    entries: method(0, (_, self) => iteratorObject(realm, map(self, 'entries').iterate())),
    toString: method(0, () => '[object Map]'),
  }
}

function addElement(self: Value, value: Value): Value {
  const { elements } = set(self, 'add')
  const stored = collectionKey(value)

  if (!elements.has(stored)) elements.set(stored, normalizedKey(value))

  return self
}

function setMethods(realm: Realm): Record<string, [number, NativeImpl]> {
  const values = method(0, (_, self) => iteratorObject(realm, set(self, 'values').iterate()))

  return {
    add: method(1, (_, self, [value]) => addElement(self, value)),
    has: method(1, (_, self, [value]) => set(self, 'has').elements.has(collectionKey(value))),
    delete: method(1, (_, self, [value]) => set(self, 'delete').elements.delete(collectionKey(value))),
    clear: method(0, (_, self) => clear(self, set(self, 'clear').elements)),
    forEach: method(1, (ctx, self, [callback]) => {
      const fn = requireCallback(callback, 'Set.prototype.forEach')

      for (const value of set(self, 'forEach').elements.values()) callBack(ctx, fn, null, [value, value, self])

      return null
    }),
    values,
    keys: values,
    entries: method(0, (_, self) => iteratorObject(realm, setEntries(set(self, 'entries'), realm.ArrayPrototype))),
    toString: method(0, () => '[object Set]'),
  }
}

// `new Map(entries?)` / `new Set(values?)`: filled through `set` / `add`.
function constructor(isMap: boolean, add: NativeImpl): NativeImpl {
  return (ctx, cls, [iterable]) => {
    const { prototype } = cls as Class
    const collection = isMap ? new MapObject(prototype, ctx.realm.ArrayPrototype) : new SetObject(prototype)

    collection.klass = cls as Class
    forEachValue(iterable, value => add(ctx, collection, isMap ? entryOf(ctx, value) : [value]))

    return collection
  }
}

function installCollection(realm: Realm, name: 'Map' | 'Set', type: Collection, methods: Record<string, [number, NativeImpl]>) {
  const prototype = new ScriptObject(realm.ObjectPrototype)
  const cls = new Class(realm.FunctionPrototype, { ...builtinTemplate(name, false), isFinal: true }, null, prototype)
  const isMap = type === MapObject
  const construct = constructor(isMap, methods[isMap ? 'set' : 'add'][1])

  cls.length = 0
  cls.final = true // instances have exactly the built-in behaviour (D29)
  cls.native = { construct: (ctx, c, args) => construct(ctx, c, args) as ScriptObject }
  defineMethods(realm, prototype, methods)
  defineAccessor(prototype, 'size', 'get', size(realm, type))
  defineGlobal(realm, name, cls, true)
}

/**
 * Installs the `Map` and `Set` classes.
 *
 * @param realm the realm
 */
export function installCollections(realm: Realm) {
  installCollection(realm, 'Map', MapObject, mapMethods(realm))
  installCollection(realm, 'Set', SetObject, setMethods(realm))
}

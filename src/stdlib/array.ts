// Array.prototype methods without callbacks (§4.6.4) and the Array namespace.
// Callback methods (map, filter, sort, …) arrive with re-entrant calls (M12).
import { isHostArray } from '@/runtime/interop'
import { defineGlobal } from '@/runtime/realm'
import { toStringIn } from '@/runtime/conversions'
import { typeError } from '@/runtime/script-error'
import { DONE, getIterator } from '@/runtime/iterators'
import { getProperty } from '@/runtime/properties'
import {
  Array as ScriptArray,
  Object as ScriptObject,
  type AccessContext,
  type NativeImpl,
  type Realm,
  type Value,
} from '@/runtime/values'
import { callBack, requireCallback } from './callbacks'
import { callbackMethods } from './array-callbacks'
import { defineMethods, integerArgument, method, orNull } from './native'

function items(thisValue: Value, name: string): Value[] {
  if (!(thisValue instanceof ScriptArray)) throw typeError(`Array.prototype.${name} called on a non-array`)

  return thisValue.items
}

// SameValueZero, as JS `includes` (NaN finds NaN); `indexOf` stays strict (D1).
function sameValueZero(a: Value, b: Value): boolean {
  return a === b || (globalThis.Number.isNaN(a) && globalThis.Number.isNaN(b))
}

function joinPart(ctx: AccessContext, value: Value): string {
  return value === null || value === undefined ? '' : toStringIn(ctx, value)
}

function flatten(values: Value[]): Value[] {
  return values.flatMap(value => (value instanceof ScriptArray ? value.items : [value]))
}

function splice(values: Value[], start: Value, count: Value, added: Value[]): Value[] {
  if (start === undefined) return []
  const from = integerArgument(start) as number

  return count === undefined ? values.splice(from) : values.splice(from, integerArgument(count) as number, ...added)
}

function lastIndexOf(values: Value[], value: Value, from: Value[]): number {
  return from.length === 0 ? values.lastIndexOf(value) : values.lastIndexOf(value, integerArgument(from[0]))
}

function join(ctx: AccessContext, values: Value[], separator: Value): string {
  return values.map(value => joinPart(ctx, value)).join(separator === undefined ? ',' : toStringIn(ctx, separator))
}

function makeMethods(realm: Realm): Record<string, [number, NativeImpl]> {
  const array = (values: Value[]) => new ScriptArray(realm.ArrayPrototype, values)

  return {
    push: [1, (_, self, args) => items(self, 'push').push(...args)],
    pop: [0, (_, self) => orNull(items(self, 'pop').pop())],
    shift: [0, (_, self) => orNull(items(self, 'shift').shift())],
    unshift: [1, (_, self, args) => items(self, 'unshift').unshift(...args)],
    slice: [2, (_, self, [start, end]) => array(items(self, 'slice').slice(integerArgument(start), integerArgument(end)))],
    splice: [2, (_, self, [start, count, ...added]) => array(splice(items(self, 'splice'), start, count, added))],
    concat: [1, (_, self, args) => array([...items(self, 'concat'), ...flatten(args)])],
    join: [1, (ctx, self, [separator]) => join(ctx, items(self, 'join'), separator)],
    toString: method(0, (ctx, self) => join(ctx, items(self, 'toString'), undefined)),
    reverse: [0, (_, self) => {
      items(self, 'reverse').reverse()

      return self
    }],
    indexOf: [1, (_, self, [value, from]) => items(self, 'indexOf').indexOf(value, integerArgument(from))],
    lastIndexOf: [1, (_, self, [value, ...from]) => lastIndexOf(items(self, 'lastIndexOf'), value, from)],
    includes: [1, (_, self, [value]) => items(self, 'includes').some(item => sameValueZero(item, value))],
    at: [1, (_, self, [index]) => orNull(items(self, 'at').at(integerArgument(index) ?? 0))],
    fill: [1, (_, self, [value, start, end]) => {
      items(self, 'fill').fill(value, integerArgument(start), integerArgument(end))

      return self
    }],
    flat: [0, (_, self) => array(flatten(items(self, 'flat')))],
  }
}

function isArrayLike(value: Value): value is ScriptObject {
  return value instanceof ScriptObject && !(value instanceof ScriptArray) && value.props.has('length')
}

function arrayLikeValues(ctx: AccessContext, source: ScriptObject): Value[] {
  const length = integerArgument(getProperty(ctx, source, 'length')) ?? 0

  return globalThis.Array.from({ length }, (_, i) => getProperty(ctx, source, String(i)))
}

function iterate(ctx: AccessContext, source: Value): Value[] {
  const iterator = getIterator(source, ctx)
  const values: Value[] = []

  for (let value = iterator.next(); value !== DONE; value = iterator.next()) values.push(value)

  return values
}

// `Array.from(iterable | { length }, mapFn?)`; missing elements of an array-like are undefined, as in JS.
function arrayFrom(ctx: AccessContext, source: Value, mapFn: Value): Value[] {
  const values = isArrayLike(source) ? arrayLikeValues(ctx, source) : iterate(ctx, source)
  if (mapFn === undefined) return values

  const fn = requireCallback(mapFn, 'Array.from')

  return values.map((value, index) => callBack(ctx, fn, null, [value, index]))
}

/**
 * Installs `Array.prototype` methods and the `Array` namespace (not a class: `Array.isArray` instead of instanceof).
 *
 * @param realm the realm
 */
export function installArray(realm: Realm) {
  const namespace = new ScriptObject(realm.ObjectPrototype)

  defineMethods(realm, realm.ArrayPrototype, { ...makeMethods(realm), ...callbackMethods(realm) })
  defineMethods(realm, namespace, {
    isArray: [1, (_, __, [value]) => value instanceof ScriptArray || isHostArray(value)],
    of: [0, (_, __, args) => new ScriptArray(realm.ArrayPrototype, args)],
    from: [1, (ctx, __, [source, mapFn]) => new ScriptArray(realm.ArrayPrototype, arrayFrom(ctx, source, mapFn))],
  })
  defineGlobal(realm, 'Array', namespace, true)
}

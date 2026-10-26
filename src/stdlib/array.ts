// Array.prototype methods without callbacks (§4.6.4) and the Array namespace.
// Callback methods (map, filter, sort, …) arrive with re-entrant calls (M12).
import { defineGlobal } from '@/runtime/realm'
import { toString } from '@/runtime/operators'
import { typeError } from '@/runtime/script-error'
import { Array as ScriptArray, Object as ScriptObject, type NativeImpl, type Realm, type Value } from '@/runtime/values'
import { defineMethods, integerArgument, orNull } from './native'

function items(thisValue: Value, method: string): Value[] {
  if (!(thisValue instanceof ScriptArray)) throw typeError(`Array.prototype.${method} called on a non-array`)

  return thisValue.items
}

// SameValueZero, as JS `includes` (NaN finds NaN); `indexOf` stays strict (D1).
function sameValueZero(a: Value, b: Value): boolean {
  return a === b || (globalThis.Number.isNaN(a) && globalThis.Number.isNaN(b))
}

function joinPart(value: Value): string {
  return value === null || value === undefined ? '' : toString(value)
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

function join(values: Value[], separator: Value): string {
  return values.map(joinPart).join(separator === undefined ? ',' : toString(separator))
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
    join: [1, (_, self, [separator]) => join(items(self, 'join'), separator)],
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

/**
 * Installs `Array.prototype` methods and the `Array` namespace (not a class: `Array.isArray` instead of instanceof).
 *
 * @param realm the realm
 */
export function installArray(realm: Realm) {
  const namespace = new ScriptObject(realm.ObjectPrototype)

  defineMethods(realm, realm.ArrayPrototype, makeMethods(realm))
  defineMethods(realm, namespace, {
    isArray: [1, (_, __, [value]) => value instanceof ScriptArray],
    of: [0, (_, __, args) => new ScriptArray(realm.ArrayPrototype, args)],
  })
  defineGlobal(realm, 'Array', namespace, true)
}

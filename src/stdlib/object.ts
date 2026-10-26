// Object.prototype methods and the Object namespace (§4.6.1). Keys are listed in insertion order
// (integer-like keys are not reordered, a documented deviation from JS, §4.4.6).
import { toStringIn } from '@/runtime/conversions'
import { errorToString, isErrorObject } from '@/runtime/operators'
import { defineGlobal } from '@/runtime/realm'
import { typeError } from '@/runtime/script-error'
import { Array as ScriptArray, Object as ScriptObject, type AccessContext, type Realm, type Value } from '@/runtime/values'
import { defineMethods, method } from './native'

type Entry = [string, Value]

function objectEntries(value: ScriptObject): Entry[] {
  return value instanceof ScriptArray ? value.items.map((item, i) => [String(i), item]) : [...value.props] as Entry[]
}

function primitiveEntries(value: Value): Entry[] {
  if (value === null || value === undefined) throw typeError(`Cannot convert ${value} to object`)

  return typeof value === 'string' ? [...value].map((ch, i) => [String(i), ch]) : []
}

/**
 * Own enumerable properties, as `Object.entries` sees them.
 *
 * @param value any value
 * @returns `[key, value]` pairs in insertion order
 */
export function ownEntries(value: Value): Entry[] {
  return value instanceof ScriptObject ? objectEntries(value) : primitiveEntries(value)
}

function assign(target: Value, sources: Value[]): ScriptObject {
  if (!(target instanceof ScriptObject)) throw typeError('Object.assign called on a non-object')
  for (const [key, item] of sources.flatMap(ownEntries)) target.props.set(key, item)

  return target
}

function freeze(value: Value): Value {
  if (value instanceof ScriptObject) {
    value.extensible = false
    value.frozen = true
  }

  return value
}

function objectToString(self: Value): string {
  return self instanceof ScriptObject && isErrorObject(self) ? errorToString(self) : '[object Object]'
}

function hasOwn(ctx: AccessContext, self: Value, key: Value): boolean {
  const name = toStringIn(ctx, key)

  return ownEntries(self).some(([own]) => own === name)
}

/**
 * Installs `Object.prototype.toString` / `hasOwnProperty` and the `Object` namespace.
 *
 * @param realm the realm
 */
export function installObject(realm: Realm) {
  const array = (values: Value[]) => new ScriptArray(realm.ArrayPrototype, values)
  const namespace = new ScriptObject(realm.ObjectPrototype)

  defineMethods(realm, realm.ObjectPrototype, {
    toString: method(0, (_, self) => objectToString(self)),
    hasOwnProperty: method(1, (ctx, self, [key]) => hasOwn(ctx, self, key)),
  })
  defineMethods(realm, namespace, {
    keys: method(1, (_, __, [value]) => array(ownEntries(value).map(([key]) => key))),
    values: method(1, (_, __, [value]) => array(ownEntries(value).map(([, item]) => item))),
    entries: method(1, (_, __, [value]) => array(ownEntries(value).map(entry => array(entry)))),
    assign: method(2, (_, __, [target, ...sources]) => assign(target, sources)),
    freeze: method(1, (_, __, [value]) => freeze(value)),
  })
  defineGlobal(realm, 'Object', namespace, true)
}

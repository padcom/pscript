// Object.prototype methods and the Object namespace (§4.6.1). Keys are listed in insertion order
// (integer-like keys are not reordered, a documented deviation from JS, §4.4.6).
import { toStringIn } from '@/runtime/conversions'
import { formatNested } from '@/runtime/format'
import { getProperty, setProperty } from '@/runtime/properties'
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

// Values of own properties; object-literal accessors are read through their getter.
function ownValues(ctx: AccessContext, value: Value): Entry[] {
  return ownEntries(value).map(([key]) => [key, getProperty(ctx, value, key)])
}

function assign(ctx: AccessContext, target: Value, sources: Value[]): ScriptObject {
  if (!(target instanceof ScriptObject)) throw typeError('Object.assign called on a non-object')
  for (const [key, item] of sources.flatMap(source => ownValues(ctx, source))) setProperty(ctx, target, key, item)

  return target
}

function freeze(value: Value): Value {
  if (value instanceof ScriptObject) {
    value.extensible = false
    value.frozen = true
  }

  return value
}

/** Instances being converted by the default toString, so that cycles print as [Circular]. */
const converting = new Set<ScriptObject>()

// D35: `ClassName(field = value, …)` with the instance's own data properties (public ones from M17 on).
function instanceToString(ctx: AccessContext, instance: ScriptObject): string {
  if (converting.has(instance)) return '[Circular]'

  converting.add(instance)

  try {
    const fields = [...instance.props].map(([key, value]) => `${key} = ${formatNested(value as Value, ctx)}`)

    return `${instance.klass?.name || 'anonymous'}(${fields.join(', ')})`
  } finally {
    converting.delete(instance)
  }
}

function objectToString(ctx: AccessContext, self: Value): string {
  if (!(self instanceof ScriptObject)) return '[object Object]'
  if (isErrorObject(self)) return errorToString(self)

  return self.klass ? instanceToString(ctx, self) : '[object Object]'
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
    toString: method(0, (ctx, self) => objectToString(ctx, self)),
    hasOwnProperty: method(1, (ctx, self, [key]) => hasOwn(ctx, self, key)),
  })
  defineMethods(realm, namespace, {
    keys: method(1, (_, __, [value]) => array(ownEntries(value).map(([key]) => key))),
    values: method(1, (ctx, __, [value]) => array(ownValues(ctx, value).map(([, item]) => item))),
    entries: method(1, (ctx, __, [value]) => array(ownValues(ctx, value).map(entry => array(entry)))),
    assign: method(2, (ctx, __, [target, ...sources]) => assign(ctx, target, sources)),
    freeze: method(1, (_, __, [value]) => freeze(value)),
  })
  defineGlobal(realm, 'Object', namespace, true)
}

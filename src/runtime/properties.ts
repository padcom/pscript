// Property access (§5.7): the single entry points for reads and writes.
// Accessors (M16), access modifiers (M17) and exotic objects (modules, host proxies) come later.
import { isObject, kindOf, toString } from './operators'
import { rangeError, typeError } from './script-error'
import {
  Array as ScriptArray,
  Function as ScriptFunction,
  Object as ScriptObject,
  type AccessContext,
  type Realm,
  type Value,
} from './values'

/**
 * Converts a computed key (`o[k]`) to a property name.
 *
 * @param key the key value
 * @returns the property name
 */
export function propertyKey(key: Value): string {
  return typeof key === 'string' ? key : toString(key)
}

function indexOf(key: string): number {
  const index = globalThis.Number(key)

  return globalThis.Number.isInteger(index) && index >= 0 && String(index) === key ? index : -1
}

// `xs[10]` / `'abc'[5]` out of range is an error, not undefined (D37).
function checkIndex(index: number, length: number) {
  if (index >= length) throw rangeError(`Index ${index} out of range for length ${length}`)
}

function lookup(object: ScriptObject | null, key: string): Value {
  for (let current = object; current; current = current.proto) {
    if (current.props.has(key)) return current.props.get(key) as Value
  }

  return undefined
}

const PRIMITIVE_PROTOTYPES: Record<string, (realm: Realm) => ScriptObject> = {
  string: realm => realm.StringPrototype,
  number: realm => realm.NumberPrototype,
  boolean: realm => realm.BooleanPrototype,
}

function getString(ctx: AccessContext, value: string, key: string): Value {
  if (key === 'length') return value.length

  const index = indexOf(key)
  if (index < 0) return lookup(ctx.realm.StringPrototype, key)
  checkIndex(index, value.length)

  return value[index]
}

function getArray(array: ScriptArray, key: string): Value {
  if (key === 'length') return array.items.length

  const index = indexOf(key)
  if (index < 0) return lookup(array, key)
  checkIndex(index, array.items.length)

  return array.items[index]
}

function getFunction(fn: ScriptFunction, key: string): Value {
  if (fn.props.has(key)) return fn.props.get(key) as Value
  if (key === 'name') return fn.name

  return key === 'length' ? fn.length : lookup(fn.proto, key)
}

function getObject(object: ScriptObject, key: string): Value {
  if (object instanceof ScriptArray) return getArray(object, key)

  return object instanceof ScriptFunction ? getFunction(object, key) : lookup(object, key)
}

function getPrimitive(ctx: AccessContext, value: Value, key: string): Value {
  if (value === null || value === undefined) throw typeError(`Cannot read properties of ${value} (reading '${key}')`)
  if (typeof value === 'string') return getString(ctx, value, key)

  return lookup(PRIMITIVE_PROTOTYPES[typeof value](ctx.realm), key)
}

/**
 * Reads a property. A missing property of an object is `undefined` (D37).
 *
 * @param ctx access context
 * @param receiver the value the property is read from
 * @param key property name
 * @returns the value
 */
export function getProperty(ctx: AccessContext, receiver: Value, key: string): Value {
  return isObject(receiver) ? getObject(receiver, key) : getPrimitive(ctx, receiver, key)
}

// Writing past the end of an array fills the gap with null (D37).
function setArray(array: ScriptArray, key: string, value: Value): boolean {
  const index = indexOf(key)
  if (index < 0) return false

  while (array.items.length < index) array.items.push(null)
  array.items[index] = value

  return true
}

const READ_ONLY_FUNCTION_KEYS = new Set(['name', 'length'])

function isReadOnlyFunctionKey(object: ScriptObject, key: string): boolean {
  return object instanceof ScriptFunction && READ_ONLY_FUNCTION_KEYS.has(key)
}

function checkWritable(object: ScriptObject, key: string) {
  if (!object.extensible && !object.props.has(key)) throw typeError(`Cannot add property '${key}', object is not extensible`)
  if (isReadOnlyFunctionKey(object, key)) throw typeError(`Cannot assign to read only property '${key}' of function`)
}

function setArrayLength(array: ScriptArray, value: Value) {
  array.items.length = globalThis.Math.max(0, globalThis.Number(value) | 0)
}

// Arrays: `length` and indices live in `items`; everything else is an ordinary property.
function setArrayElement(array: ScriptArray, key: string, value: Value): boolean {
  if (key === 'length') setArrayLength(array, value)

  return key === 'length' || setArray(array, key, value)
}

function setObject(object: ScriptObject, key: string, value: Value) {
  if (object instanceof ScriptArray && setArrayElement(object, key, value)) return
  checkWritable(object, key)
  object.props.set(key, value)
}

/**
 * Writes a property (creating an own data property when needed).
 *
 * @param ctx access context
 * @param receiver the value the property is written to
 * @param key property name
 * @param value the new value
 */
export function setProperty(ctx: AccessContext, receiver: Value, key: string, value: Value) {
  if (isObject(receiver)) {
    setObject(receiver, key, value)

    return
  }
  if (receiver === null || receiver === undefined) throw typeError(`Cannot set properties of ${receiver} (setting '${key}')`)

  throw typeError(`Cannot create property '${key}' on ${kindOf(receiver)}`)
}

/**
 * Defines an own property of an object literal (`DEFINE_PROP`).
 *
 * @param object the object being built
 * @param key property name
 * @param value property value
 */
export function defineProperty(object: ScriptObject, key: string, value: Value) {
  object.props.set(key, value)
}

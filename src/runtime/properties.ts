// Property access (§5.7): the single entry points for reads and writes, including accessors (§4.5.4):
// getters and setters are called with the original receiver. Access modifiers (M17) and exotic
// objects (modules, host proxies) come later.
import { GlobalObject } from './global-object'
import { find, functionProperty, onlyGetter, own, resolve } from './lookup'
import { getClassMember, getInstanceMember, hasClassMember, setClassMember, setInstanceMember } from './members'
import { hasProperty, isObject, kindOf, toString } from './operators'
import { rangeError, typeError } from './script-error'
import {
  Accessor,
  Array as ScriptArray,
  Class,
  Function as ScriptFunction,
  ModuleNamespace,
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

const INTEGER_KEY = /^-?(?:0|[1-9]\d*)$/

// The integer an index-like key denotes (negative too), or null for other keys.
function indexOf(key: string): number | null {
  return INTEGER_KEY.test(key) ? globalThis.Number(key) : null
}

// `xs[10]`, `xs[-1]` and `'abc'[5]` are errors, not undefined (D37).
function checkIndex(index: number, length: number) {
  if (index < 0 || index >= length) throw rangeError(`Index ${index} out of range for length ${length}`)
}

function lookup(ctx: AccessContext, object: ScriptObject | null, key: string, receiver: Value): Value {
  const found = find(object, key)

  return found ? resolve(ctx, found[0], receiver) : undefined
}

const PRIMITIVE_PROTOTYPES: Record<string, (realm: Realm) => ScriptObject> = {
  string: realm => realm.StringPrototype,
  number: realm => realm.NumberPrototype,
  boolean: realm => realm.BooleanPrototype,
}

function getString(ctx: AccessContext, value: string, key: string): Value {
  if (key === 'length') return value.length

  const index = indexOf(key)
  if (index === null) return lookup(ctx, ctx.realm.StringPrototype, key, value)
  checkIndex(index, value.length)

  return value[index]
}

function getArray(ctx: AccessContext, array: ScriptArray, key: string): Value {
  if (key === 'length') return array.items.length

  const index = indexOf(key)
  if (index === null) return lookup(ctx, array, key, array)
  checkIndex(index, array.items.length)

  return array.items[index]
}

// Functions are open objects: own properties, name/length, Function.prototype; anything else is undefined.
function getFunction(ctx: AccessContext, fn: ScriptFunction, key: string): Value {
  const found = own(fn, key) ?? functionProperty(fn, key) ?? find(fn.proto, key)

  return found ? resolve(ctx, found[0], fn) : undefined
}

function getGlobal(ctx: AccessContext, object: GlobalObject, key: string): Value {
  const binding = object.realm.globals.get(key)

  return binding ? binding.value : lookup(ctx, object.proto, key, object)
}

function getPlain(ctx: AccessContext, object: ScriptObject, key: string): Value {
  return object instanceof ScriptFunction ? getFunction(ctx, object, key) : lookup(ctx, object, key, object)
}

// A namespace has exactly its exports (live, TDZ-checked); anything else is undefined (§4.7.2).
function getNamespace(_: AccessContext, namespace: ModuleNamespace, key: string): Value {
  return namespace.names.includes(key) ? namespace.read(key) : undefined
}

type ExoticGetter = (ctx: AccessContext, object: any, key: string) => Value

// Objects whose reads do not use ordinary properties: namespaces, `globalThis`, classes.
const EXOTIC_GETTERS: [abstract new (...args: any[]) => ScriptObject, ExoticGetter][] = [
  [ModuleNamespace, getNamespace],
  [GlobalObject, getGlobal],
  [Class, getClassMember],
]

function getExotic(ctx: AccessContext, object: ScriptObject, key: string): Value {
  const getter = EXOTIC_GETTERS.find(([type]) => object instanceof type)?.[1]
  if (getter) return getter(ctx, object, key)

  return object.klass ? getInstanceMember(ctx, object, key) : getPlain(ctx, object, key)
}

function getPrimitive(ctx: AccessContext, value: Value, key: string): Value {
  if (value === null || value === undefined) throw typeError(`Cannot read properties of ${value} (reading '${key}')`)
  if (typeof value === 'string') return getString(ctx, value, key)

  return lookup(ctx, PRIMITIVE_PROTOTYPES[typeof value](ctx.realm), key, value)
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
  if (!isObject(receiver)) return getPrimitive(ctx, receiver, key)

  return receiver instanceof ScriptArray ? getArray(ctx, receiver, key) : getExotic(ctx, receiver, key)
}

// Writing past the end of an array fills the gap with null (D37); other keys are not allowed (§4.4.7).
function setArray(array: ScriptArray, key: string, value: Value) {
  const index = indexOf(key)
  if (index === null) throw typeError(`Arrays only accept integer keys (got '${key}')`)
  if (index < 0) throw rangeError(`Index ${index} out of range for length ${array.items.length}`)

  while (array.items.length < index) array.items.push(null)
  array.items[index] = value
}

const READ_ONLY_FUNCTION_KEYS = new Set(['name', 'length'])

function isReadOnlyFunctionKey(object: ScriptObject, key: string): boolean {
  return object instanceof ScriptFunction && READ_ONLY_FUNCTION_KEYS.has(key)
}

function checkFrozen(object: ScriptObject, key: string) {
  if (object instanceof GlobalObject) throw typeError(`Cannot assign to '${key}' through globalThis`)
  if (object instanceof ModuleNamespace) throw typeError(`Cannot assign to '${key}' of a module namespace`)
  if (object.frozen) throw typeError(`Cannot assign to read only property '${key}' of object`)
}

function checkWritable(object: ScriptObject, key: string) {
  checkFrozen(object, key)

  if (!object.extensible && !object.props.has(key)) throw typeError(`Cannot add property '${key}', object is not extensible`)
  if (isReadOnlyFunctionKey(object, key)) throw typeError(`Cannot assign to read only property '${key}' of function`)
}

// Writing `length` truncates or extends (with null, D37).
function setArrayLength(array: ScriptArray, value: Value) {
  const length = globalThis.Number(value)
  if (!(globalThis.Number.isInteger(length) && length >= 0)) throw rangeError('Invalid array length')

  array.items.length = globalThis.Math.min(length, array.items.length)

  while (array.items.length < length) array.items.push(null)
}

// Arrays: only `length` and integer indices can be written.
function setArrayElement(array: ScriptArray, key: string, value: Value) {
  if (key === 'length') setArrayLength(array, value)
  else setArray(array, key, value)
}

/**
 * A property write: the key, the original receiver (`this` for a setter) and the value.
 */
interface Write {
  /** property name */
  key: string
  /** the object written to */
  receiver: Value
  /** the new value */
  value: Value
}

// Object literals: an own accessor calls its setter (or rejects the write); otherwise a data property is created or updated.
function setOrdinary(ctx: AccessContext, object: ScriptObject, write: Write) {
  const stored = object.props.get(write.key)
  if (stored instanceof Accessor) {
    if (!stored.set) onlyGetter(write.key, 'object')
    ctx.callFunction(stored.set, object, [write.value])

    return
  }
  checkWritable(object, write.key)
  object.props.set(write.key, write.value)
}

function setObject(ctx: AccessContext, object: ScriptObject, write: Write) {
  if (object instanceof ScriptArray) setArrayElement(object, write.key, write.value)
  else if (object instanceof Class) setClassMember(ctx, object, write.key, write.value)
  else if (object.klass) setInstanceMember(ctx, object, write.key, write.value)
  else setOrdinary(ctx, object, write)
}

/**
 * Writes a property (calling a setter, or creating an own data property when needed).
 *
 * @param ctx access context
 * @param receiver the value the property is written to
 * @param key property name
 * @param value the new value
 */
export function setProperty(ctx: AccessContext, receiver: Value, key: string, value: Value) {
  if (isObject(receiver)) {
    setObject(ctx, receiver, { key, receiver, value })

    return
  }
  if (receiver === null || receiver === undefined) throw typeError(`Cannot set properties of ${receiver} (setting '${key}')`)

  throw typeError(`Cannot create property '${key}' on ${kindOf(receiver)}`)
}

/**
 * Defines an own data property of an object literal (`DEFINE_PROP`); it replaces an accessor of the same name.
 *
 * @param object the object being built
 * @param key property name
 * @param value property value
 */
export function defineProperty(object: ScriptObject, key: string, value: Value) {
  object.props.set(key, value)
}

/**
 * Defines one half of an object-literal accessor (`DEFINE_GETTER` / `DEFINE_SETTER`, R18); `get` and `set`
 * with the same key combine, a later data property replaces them.
 *
 * @param object the object being built
 * @param key property name
 * @param half which half
 * @param fn the getter or setter
 */
export function defineAccessor(object: ScriptObject, key: string, half: 'get' | 'set', fn: ScriptFunction) {
  const existing = object.props.get(key)
  const accessor = existing instanceof Accessor ? existing : new Accessor()

  accessor[half] = fn as Accessor['get']
  object.props.set(key, accessor)
}

function isClassObject(object: Value): boolean {
  return object instanceof Class || (object instanceof ScriptObject && object.klass !== undefined)
}

/**
 * `key in object` with access rules: class members count only when the caller may use them (§4.5.2).
 *
 * @param ctx access context
 * @param key the key
 * @param object the object
 * @returns whether the property exists (and is accessible)
 */
export function hasPropertyIn(ctx: AccessContext, key: Value, object: Value): boolean {
  if (object instanceof ModuleNamespace) return object.names.includes(propertyKey(key))

  return isClassObject(object) ? hasClassMember(ctx, object as ScriptObject, propertyKey(key)) : hasProperty(key, object)
}

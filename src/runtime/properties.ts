// Property access (§5.7): the single entry points for reads and writes.
// Accessors (M16), access modifiers (M17) and exotic objects (modules, host proxies) come later.
import { GlobalObject } from './global-object'
import { isObject, kindOf, toString } from './operators'
import { rangeError, typeError } from './script-error'
import {
  Array as ScriptArray,
  Class,
  Function as ScriptFunction,
  Object as ScriptObject,
  type AccessContext,
  type MemberEntry,
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
  if (index === null) return lookup(ctx.realm.StringPrototype, key)
  checkIndex(index, value.length)

  return value[index]
}

function getArray(array: ScriptArray, key: string): Value {
  if (key === 'length') return array.items.length

  const index = indexOf(key)
  if (index === null) return lookup(array, key)
  checkIndex(index, array.items.length)

  return array.items[index]
}

// A found property: `[value]`, or null when the key is not there (undefined is a valid value).
type Found = [Value] | null

function find(object: ScriptObject | null, key: string): Found {
  for (let current = object; current; current = current.proto) {
    if (current.props.has(key)) return [current.props.get(key) as Value]
  }

  return null
}

function own(object: ScriptObject, key: string): Found {
  return object.props.has(key) ? [object.props.get(key) as Value] : null
}

function className(cls: Class): string {
  return cls.name || 'anonymous'
}

function noMember(owner: string, key: string): never {
  throw typeError(`${owner} has no member '${key}'`)
}

function orNoMember(found: Found, owner: string, key: string): Value {
  return (found ?? noMember(owner, key))[0]
}

function functionProperty(fn: ScriptFunction, key: string): Found {
  if (key === 'name') return [fn.name]

  return key === 'length' ? [fn.length] : null
}

// Functions are open objects: own properties, name/length, Function.prototype; anything else is undefined.
function getFunction(fn: ScriptFunction, key: string): Value {
  return (own(fn, key) ?? functionProperty(fn, key) ?? find(fn.proto, key) ?? [undefined])[0]
}

function getGlobal(object: GlobalObject, key: string): Value {
  const binding = object.realm.globals.get(key)

  return binding ? binding.value : lookup(object.proto, key)
}

// A declared member: methods give their function; a declared field not initialised yet reads as null (D37).
function memberValue(entry: MemberEntry | undefined): Found {
  return entry ? [entry.fn ?? null] : null
}

// Class instances have exactly their declared members (D36): own fields, the class's methods, built-in prototype members.
function getInstance(object: ScriptObject, klass: Class, key: string): Value {
  const found = own(object, key) ?? memberValue(klass.memberIndex.get(key)) ?? find(object.proto, key)

  return orNoMember(found, className(klass), key)
}

// Static fields live on the class that declares them and are inherited by subclasses.
function ownStatic(cls: Class, key: string): Found {
  let found: Found = null

  for (let current: Class | null = cls; current && !found; current = current.superClass) found = own(current, key)

  return found
}

// Classes have their statics, `name`, `length` and Function.prototype members, nothing else (D29, D36).
function getClass(cls: Class, key: string): Value {
  const found = ownStatic(cls, key) ?? memberValue(cls.staticMemberIndex.get(key)) ?? functionProperty(cls, key)

  return orNoMember(found ?? find(cls.proto, key), `Class '${cls.name}'`, key)
}

function getPlain(object: ScriptObject, key: string): Value {
  return object instanceof ScriptFunction ? getFunction(object, key) : lookup(object, key)
}

function getExotic(object: ScriptObject, key: string): Value {
  if (object instanceof GlobalObject) return getGlobal(object, key)
  if (object instanceof Class) return getClass(object, key)

  return object.klass ? getInstance(object, object.klass, key) : getPlain(object, key)
}

function getObject(object: ScriptObject, key: string): Value {
  return object instanceof ScriptArray ? getArray(object, key) : getExotic(object, key)
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

// An own field, or inherited built-in data (e.g. an error's `name`) that the instance may shadow.
function hasData(object: ScriptObject, key: string): boolean {
  return object.props.has(key) || find(object.proto, key) !== null
}

function cannotAssignMethod(entry: MemberEntry | undefined, key: string) {
  if (entry?.kind === 'method') throw typeError(`Cannot assign to method '${key}' of class '${entry.owner.name}'`)
}

// Instances: declared fields (and inherited built-in data such as an error's `name`) are writable; methods and
// undeclared names are not (D29, D36).
function setInstance(object: ScriptObject, klass: Class, key: string, value: Value) {
  const entry = klass.memberIndex.get(key)

  cannotAssignMethod(entry, key)

  if (!entry && !hasData(object, key)) noMember(className(klass), key)
  checkFrozen(object, key)
  object.props.set(key, value)
}

// Classes: static fields (own or inherited) are writable; static methods, name/length and new names are not (D29).
function setClass(cls: Class, key: string, value: Value) {
  const entry = cls.staticMemberIndex.get(key)

  cannotAssignMethod(entry, key)

  if (!(cls.props.has(key) || entry)) {
    throw typeError(`Cannot add property '${key}' to class '${cls.name}': classes are not extensible`)
  }
  cls.props.set(key, value)
}

function setOrdinary(object: ScriptObject, key: string, value: Value) {
  checkWritable(object, key)
  object.props.set(key, value)
}

function setObject(object: ScriptObject, key: string, value: Value) {
  if (object instanceof ScriptArray) setArrayElement(object, key, value)
  else if (object instanceof Class) setClass(object, key, value)
  else if (object.klass) setInstance(object, object.klass, key, value)
  else setOrdinary(object, key, value)
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

// Property access (§5.7): the single entry points for reads and writes, including accessors (§4.5.4):
// getters and setters are called with the original receiver. Access modifiers (M17) and exotic
// objects (modules, host proxies) come later.
import { GlobalObject } from './global-object'
import { isObject, kindOf, toString } from './operators'
import { rangeError, typeError } from './script-error'
import {
  Accessor,
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

/** What a props map holds: a value, or an object literal's own accessor. */
type Stored = Value | Accessor

// A found property: `[stored]`, or null when the key is not there (undefined is a valid value).
type Found = [Stored] | null

function find(object: ScriptObject | null, key: string): Found {
  for (let current = object; current; current = current.proto) {
    if (current.props.has(key)) return [current.props.get(key) as Stored]
  }

  return null
}

function own(object: ScriptObject, key: string): Found {
  return object.props.has(key) ? [object.props.get(key) as Stored] : null
}

// Accessors are read through their getter with the original receiver; an object literal's setter-only accessor reads undefined.
function resolve(ctx: AccessContext, stored: Stored, receiver: Value): Value {
  if (!(stored instanceof Accessor)) return stored

  return stored.get ? ctx.callFunction(stored.get, receiver, []) : undefined
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

function className(cls: Class): string {
  return cls.name || 'anonymous'
}

function noMember(owner: string, key: string): never {
  throw typeError(`${owner} has no member '${key}'`)
}

function functionProperty(fn: ScriptFunction, key: string): Found {
  if (key === 'name') return [fn.name]

  return key === 'length' ? [fn.length] : null
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

// A class accessor without getter: reading it is an error (§4.4.12), unlike an object literal's.
function getterOf(entry: MemberEntry, key: string): ScriptFunction {
  if (!entry.get) throw typeError(`'${key}' has only a setter`)

  return entry.get
}

// A declared member: methods give their function, accessors call their getter, a declared field not
// initialised yet reads as null (D37).
function readMember(ctx: AccessContext, entry: MemberEntry, key: string, receiver: Value): Value {
  if (entry.kind === 'accessor') return ctx.callFunction(getterOf(entry, key), receiver, [])

  return entry.fn ?? null
}

// Class instances have exactly their declared members (D36): own fields, the class's members, built-in prototype members.
function getInstance(ctx: AccessContext, object: ScriptObject, klass: Class, key: string): Value {
  if (object.props.has(key)) return object.props.get(key) as Value

  const entry = klass.memberIndex.get(key)
  if (entry) return readMember(ctx, entry, key, object)

  const found = find(object.proto, key) ?? noMember(className(klass), key)

  return resolve(ctx, found[0], object)
}

// Static fields live on the class that declares them and are inherited by subclasses.
function ownStatic(cls: Class, key: string): Found {
  let found: Found = null

  for (let current: Class | null = cls; current && !found; current = current.superClass) found = own(current, key)

  return found
}

function getClassBuiltin(ctx: AccessContext, cls: Class, key: string): Value {
  const inherited = functionProperty(cls, key) ?? find(cls.proto, key) ?? noMember(`Class '${cls.name}'`, key)

  return resolve(ctx, inherited[0], cls)
}

// Classes have their statics, `name`, `length` and Function.prototype members, nothing else (D29, D36).
function getClass(ctx: AccessContext, cls: Class, key: string): Value {
  const found = ownStatic(cls, key)
  if (found) return found[0] as Value

  const entry = cls.staticMemberIndex.get(key)

  return entry ? readMember(ctx, entry, key, cls) : getClassBuiltin(ctx, cls, key)
}

function getPlain(ctx: AccessContext, object: ScriptObject, key: string): Value {
  return object instanceof ScriptFunction ? getFunction(ctx, object, key) : lookup(ctx, object, key, object)
}

function getExotic(ctx: AccessContext, object: ScriptObject, key: string): Value {
  if (object instanceof GlobalObject) return getGlobal(ctx, object, key)
  if (object instanceof Class) return getClass(ctx, object, key)

  return object.klass ? getInstance(ctx, object, object.klass, key) : getPlain(ctx, object, key)
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

function onlyGetter(key: string, owner: string): never {
  throw typeError(`Cannot set property ${key} of ${owner} which has only a getter`)
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

// An accessor's setter runs with the original receiver; returns false when there is no setter.
function callSetter(ctx: AccessContext, setter: ScriptFunction | null | undefined, { receiver, value }: Write): boolean {
  if (!setter) return false
  ctx.callFunction(setter, receiver, [value])

  return true
}

function writeAccessor(ctx: AccessContext, entry: MemberEntry, write: Write): boolean {
  return callSetter(ctx, entry.set, write) || onlyGetter(write.key, entry.owner.name)
}

// Methods cannot be reassigned (D29); accessors call their setter. Returns whether the write was handled.
function writeMember(ctx: AccessContext, entry: MemberEntry | undefined, write: Write): boolean {
  if (!entry || entry.kind === 'field') return false
  if (entry.kind === 'method') throw typeError(`Cannot assign to method '${write.key}' of class '${entry.owner.name}'`)

  return writeAccessor(ctx, entry, write)
}

// An own field, or inherited built-in data (e.g. an error's `name`) that the instance may shadow.
function hasData(object: ScriptObject, key: string): boolean {
  return object.props.has(key) || find(object.proto, key) !== null
}

// Instances: declared fields (and inherited built-in data such as an error's `name`) are writable; methods and
// undeclared names are not (D29, D36).
function setInstance(ctx: AccessContext, object: ScriptObject, klass: Class, write: Write) {
  const { key } = write
  const entry = klass.memberIndex.get(key)
  if (writeMember(ctx, entry, write)) return
  if (!entry && !hasData(object, key)) noMember(className(klass), key)
  checkFrozen(object, key)
  object.props.set(key, write.value)
}

// Classes: static fields (own or inherited) are writable; static methods, name/length and new names are not (D29).
function setClass(ctx: AccessContext, cls: Class, write: Write) {
  const { key } = write
  const entry = cls.staticMemberIndex.get(key)
  if (writeMember(ctx, entry, write)) return
  if (!(cls.props.has(key) || entry)) {
    throw typeError(`Cannot add property '${key}' to class '${cls.name}': classes are not extensible`)
  }
  cls.props.set(key, write.value)
}

// Object literals: an own accessor calls its setter (or rejects the write); otherwise a data property is created or updated.
function setOrdinary(ctx: AccessContext, object: ScriptObject, write: Write) {
  const stored = object.props.get(write.key)
  if (stored instanceof Accessor) {
    if (!callSetter(ctx, stored.set, write)) onlyGetter(write.key, 'object')

    return
  }
  checkWritable(object, write.key)
  object.props.set(write.key, write.value)
}

function setObject(ctx: AccessContext, object: ScriptObject, write: Write) {
  if (object instanceof ScriptArray) setArrayElement(object, write.key, write.value)
  else if (object instanceof Class) setClass(ctx, object, write)
  else if (object.klass) setInstance(ctx, object, object.klass, write)
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

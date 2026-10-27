// Operator semantics (§4.4.2, §4.4.3). Primitives coerce as in JS; objects, arrays and
// functions in arithmetic or comparison are a TypeError (D5).
import { type ScriptError, typeError } from './script-error'
import {
  Array as ScriptArray,
  Class,
  Function as ScriptFunction,
  HostObject,
  Interface,
  Object as ScriptObject,
  type Value,
} from './values'

/**
 * Whether a value is a script object.
 *
 * @param value any value
 * @returns whether the value is a script object (anything non-primitive)
 */
export function isObject(value: Value): value is ScriptObject {
  return value instanceof ScriptObject
}

/**
 * `typeof` (D39: `typeof null` is `'null'`).
 *
 * @param value any value
 * @returns the type name
 */
export function typeOf(value: Value): string {
  if (value === null) return 'null'
  if (value instanceof ScriptFunction) return 'function'

  return isObject(value) ? 'object' : typeof value
}

/**
 * Describes a value's kind for error messages: `array`, `class`, `function`, `object` or the primitive type.
 *
 * @param value any value
 * @returns the kind
 */
export function kindOf(value: Value): string {
  if (value instanceof ScriptArray) return 'array'
  if (value instanceof Class) return 'class'

  return typeOf(value)
}

/**
 * Truthiness (§4.4.2).
 *
 * @param value any value
 * @returns JS truthiness; every object is truthy
 */
export function truthy(value: Value): boolean {
  if (typeof value === 'boolean') return value

  return isObject(value) || Boolean(value)
}

/**
 * `ToNumber` for an operand of `op`.
 *
 * @param value operand
 * @param op operator, for the error message
 * @returns the number
 * @throws {ScriptError} TypeError for an object operand (D5)
 */
export function toNumber(value: Value, op: string): number {
  if (typeof value === 'number') return value
  if (isObject(value)) throw typeError(`Cannot apply '${op}' to ${kindOf(value)}`)

  return globalThis.Number(value)
}

function cannotConvert(): never {
  throw typeError('Cannot convert object to string')
}

function functionToString(fn: ScriptFunction): string {
  return fn instanceof Class ? `[class ${fn.name}]` : `[Function: ${fn.name}]`
}

function arrayToString(array: ScriptArray): string {
  // eslint-disable-next-line no-use-before-define -- mutual recursion with toString
  return array.items.map(item => (item === null || item === undefined ? '' : toString(item))).join(',')
}

/**
 * Reads a data property along the prototype chain, without accessors or access checks.
 *
 * @param object the object
 * @param key property name
 * @returns the value, or undefined
 */
export function inheritedProperty(object: ScriptObject, key: string): Value {
  for (let current: ScriptObject | null = object; current; current = current.proto) {
    if (current.props.has(key)) return current.props.get(key) as Value
  }

  return undefined
}

function rootClass(klass: Class): Class {
  let root = klass

  while (root.superClass) root = root.superClass

  return root
}

/**
 * Whether an object was constructed by a built-in error class (or a subclass of one).
 *
 * @param object any object
 * @returns true for error objects
 */
export function isErrorObject(object: ScriptObject): boolean {
  return object.klass !== undefined && rootClass(object.klass).native !== undefined
}

/**
 * `Name: message` (just the name when the message is empty), as JS `Error.prototype.toString`.
 *
 * @param error an error object
 * @returns its string form
 */
export function errorToString(error: ScriptObject): string {
  const name = String(inheritedProperty(error, 'name') ?? 'Error')
  const message = String(inheritedProperty(error, 'message') ?? '')

  return message === '' ? name : `${name}: ${message}`
}

function plainToString(object: ScriptObject): string {
  return object instanceof Interface ? cannotConvert() : '[object Object]'
}

// Built-in string forms (§4.4.3). A script-defined `toString()` is honoured from M13 on.
function objectToString(object: ScriptObject): string {
  if (object instanceof ScriptArray) return arrayToString(object)
  if (object instanceof ScriptFunction) return functionToString(object)

  return isErrorObject(object) ? errorToString(object) : plainToString(object)
}

/**
 * `ToString`. Objects use their built-in forms: arrays join with `,`, plain objects `[object Object]`.
 *
 * @param value any value
 * @returns the string
 * @throws {ScriptError} TypeError when the object cannot be converted
 */
export function toString(value: Value): string {
  return isObject(value) ? objectToString(value) : String(value)
}

function checkPrimitives(op: string, a: Value, b: Value) {
  if (isObject(a) || isObject(b)) throw typeError(`Cannot apply '${op}' to ${kindOf(a)} and ${kindOf(b)}`)
}

/**
 * `+`: string concatenation if either operand is a string, else numeric addition.
 *
 * @param a left operand
 * @param b right operand
 * @returns the sum or concatenation
 */
export function add(a: Value, b: Value): Value {
  if (typeof a === 'string' || typeof b === 'string') return toString(a) + toString(b)
  checkPrimitives('+', a, b)

  return globalThis.Number(a) + globalThis.Number(b)
}

export type ArithmeticOperator = '-' | '*' | '/' | '%' | '**' | '&' | '|' | '^' | '<<' | '>>' | '>>>'

// Bitwise operators (D50) convert to 32-bit integers, as JS's own do.
const ARITHMETIC: Record<ArithmeticOperator, (a: number, b: number) => number> = {
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '%': (a, b) => a % b,
  '**': (a, b) => a ** b,
  '&': (a, b) => a & b,
  '|': (a, b) => a | b,
  '^': (a, b) => a ^ b,
  '<<': (a, b) => a << b,
  '>>': (a, b) => a >> b,
  '>>>': (a, b) => a >>> b,
}

/**
 * `- * / % **` and the bitwise operators on primitives.
 *
 * @param op operator
 * @param a left operand
 * @param b right operand
 * @returns the result
 */
export function arithmetic(op: ArithmeticOperator, a: Value, b: Value): number {
  checkPrimitives(op, a, b)

  return ARITHMETIC[op](globalThis.Number(a), globalThis.Number(b))
}

/**
 * `==` (D1): strict like JS `===`, no coercion; objects by identity.
 *
 * @param a left operand
 * @param b right operand
 * @returns whether the operands are equal
 */
export function strictEquals(a: Value, b: Value): boolean {
  return a === b
}

export type RelationalOperator = '<' | '<=' | '>' | '>='

const RELATIONAL: Record<RelationalOperator, (a: number | string, b: number | string) => boolean> = {
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
}

/**
 * `< <= > >=`: two strings compare by code unit, other primitives as numbers; objects → TypeError (D5).
 *
 * @param op operator
 * @param a left operand
 * @param b right operand
 * @returns the comparison result
 */
export function compare(op: RelationalOperator, a: Value, b: Value): boolean {
  checkPrimitives(op, a, b)

  if (typeof a === 'string' && typeof b === 'string') return RELATIONAL[op](a, b)

  return RELATIONAL[op](globalThis.Number(a), globalThis.Number(b))
}

function classOf(value: Value): Class | null {
  return value instanceof ScriptObject ? value.klass ?? null : null
}

function isConstructedFrom(value: Value, type: Class): boolean {
  let klass = classOf(value)

  while (klass && klass !== type) klass = klass.superClass

  return klass !== null
}

// Host objects are instances of the host class whose constructor made them (§5.8.1).
function isHostInstance(value: HostObject, type: Class): boolean {
  return type.host !== undefined && value.target instanceof type.host
}

function implementsInterface(value: Value, type: Interface): boolean {
  return classOf(value)?.interfaces.has(type) ?? false
}

/**
 * `a instanceof T` (D26, D32): `T` must be a class or an interface; only class-constructed objects match.
 *
 * @param value left operand
 * @param type right operand
 * @returns whether `value` was constructed from `type` (or implements it)
 */
export function instanceOf(value: Value, type: Value): boolean {
  if (type instanceof Interface) return implementsInterface(value, type)
  if (!(type instanceof Class)) throw typeError("Right-hand side of 'instanceof' is not a class")

  return value instanceof HostObject ? isHostInstance(value, type) : isConstructedFrom(value, type)
}

function isIndex(name: string, length: number): boolean {
  const index = globalThis.Number(name)

  return String(index) === name && globalThis.Number.isInteger(index) && index >= 0 && index < length
}

function isArrayKey(array: ScriptArray, name: string): boolean {
  return name === 'length' || isIndex(name, array.items.length)
}

function hasInChain(object: ScriptObject, name: string): boolean {
  for (let current: ScriptObject | null = object; current; current = current.proto) {
    if (current.props.has(name)) return true
  }

  return false
}

function isClassMember(object: ScriptObject, name: string): boolean {
  if (object instanceof Class) return object.staticMemberIndex.has(name)

  return object.klass?.memberIndex.has(name) ?? false
}

function isOwnKey(object: ScriptObject, name: string): boolean {
  return object instanceof ScriptArray ? isArrayKey(object, name) : isClassMember(object, name)
}

/**
 * `key in object`: the property exists on the object or its prototype chain (arrays: indices and `length`).
 * Hidden members (§4.5.2) arrive with access modifiers.
 *
 * @param key left operand
 * @param object right operand
 * @returns whether the property exists
 */
export function hasProperty(key: Value, object: Value): boolean {
  if (!isObject(object)) throw typeError(`Cannot use 'in' operator to search for a key in ${kindOf(object)}`)

  const name = toString(key)

  return isOwnKey(object, name) || hasInChain(object, name)
}

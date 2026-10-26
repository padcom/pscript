// Operator semantics (§4.4.2, §4.4.3). Primitives coerce as in JS; objects, arrays and
// functions in arithmetic or comparison are a TypeError (D5).
import { type ScriptError, typeError } from './script-error'
import { Array as ScriptArray, Class, Function as ScriptFunction, Interface, Object as ScriptObject, type Value } from './values'

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
  if (isObject(value)) throw typeError(`Cannot apply '${op}' to ${kindOf(value)}`)

  return globalThis.Number(value)
}

/**
 * `ToString`. Objects: only the built-in forms of functions and classes so far.
 *
 * @param value any value
 * @returns the string
 * @throws {ScriptError} TypeError when the object cannot be converted
 */
export function toString(value: Value): string {
  if (!isObject(value)) return String(value)
  if (value instanceof Class) return `[class ${value.name}]`
  if (value instanceof ScriptFunction) return `[Function: ${value.name}]`

  throw typeError('Cannot convert object to string')
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

export type ArithmeticOperator = '-' | '*' | '/' | '%' | '**'

const ARITHMETIC: Record<ArithmeticOperator, (a: number, b: number) => number> = {
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '%': (a, b) => a % b,
  '**': (a, b) => a ** b,
}

/**
 * `- * / % **` on primitives.
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

  return isConstructedFrom(value, type)
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

  return (object instanceof ScriptArray && isArrayKey(object, name)) || hasInChain(object, name)
}

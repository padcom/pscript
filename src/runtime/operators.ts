// Operator semantics (§4.4.2, §4.4.3). Primitives coerce as in JS; objects, arrays and
// functions in arithmetic or comparison are a TypeError (D5).
import { type ScriptError, typeError } from './script-error'
import { Array as ScriptArray, Class, Function as ScriptFunction, Object as ScriptObject, type Value } from './values'

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

// Conversions that may run script code (§4.4.3): `ToString(object)` looks up `toString` with the
// normal member resolution and calls it; the result must be a primitive.
import { SymbolValue } from './symbols'
import { isObject, kindOf } from './operators'
import { getProperty } from './properties'
import { type ScriptError, typeError } from './script-error'
import { Function as ScriptFunction, type AccessContext, type Value } from './values'

function objectToStringIn(ctx: AccessContext, value: Value): string {
  const method = getProperty(ctx, value, 'toString')
  if (!(method instanceof ScriptFunction)) throw typeError('Cannot convert object to string')

  const result = ctx.callFunction(method, value, [])
  if (isObject(result)) throw typeError(`toString() returned ${kindOf(result)}, not a primitive`)

  return String(result)
}

/**
 * `ToString`, calling a script- or built-in `toString()` for objects.
 *
 * @param ctx access context (to call `toString`)
 * @param value any value
 * @returns the string
 * @throws {ScriptError} TypeError when there is no usable `toString` or it returns an object
 */
export function toStringIn(ctx: AccessContext, value: Value): string {
  if (!isObject(value)) return String(value)

  return value instanceof SymbolValue ? value.text() : objectToStringIn(ctx, value) // symbols: D57
}

function addPrimitives(a: Value, b: Value): Value {
  if (isObject(a) || isObject(b)) throw typeError(`Cannot apply '+' to ${kindOf(a)} and ${kindOf(b)}`)

  return globalThis.Number(a) + globalThis.Number(b)
}

/**
 * `+` with `ToString` that honours `toString()` methods.
 *
 * @param ctx access context
 * @param a left operand
 * @param b right operand
 * @returns the sum or concatenation
 */
export function addIn(ctx: AccessContext, a: Value, b: Value): Value {
  if (typeof a === 'string' || typeof b === 'string') return toStringIn(ctx, a) + toStringIn(ctx, b)

  return addPrimitives(a, b)
}

// Calling script callbacks from natives (§4.6.4, D38): a callback receives as many of the
// native's arguments as it declares (all of them when it has a rest parameter).
import { kindOf, toNumber } from '@/runtime/operators'
import { typeError } from '@/runtime/script-error'
import { Closure, Function as ScriptFunction, type AccessContext, type Value } from '@/runtime/values'

/**
 * Checks that a value can be called as a callback.
 *
 * @param fn the value
 * @param method the native's name, for the message
 * @returns the function
 */
export function requireCallback(fn: Value, method: string): ScriptFunction {
  if (!(fn instanceof ScriptFunction)) throw typeError(`${method}: ${kindOf(fn)} is not a function`)

  return fn
}

function declaredArguments(fn: ScriptFunction, args: Value[]): Value[] {
  if (!(fn instanceof Closure) || fn.fnProto.hasRest) return args

  return args.slice(0, fn.fnProto.paramCount)
}

/**
 * Calls a callback with the leading arguments it declares.
 *
 * @param ctx access context (the VM)
 * @param fn the callback
 * @param thisValue `this` for the call
 * @param args everything the native offers, e.g. `(element, index, array)`
 * @returns the callback's result
 */
export function callBack(ctx: AccessContext, fn: ScriptFunction, thisValue: Value, args: Value[]): Value {
  return ctx.callFunction(fn, thisValue, declaredArguments(fn, args))
}

/**
 * A comparator result as a number (NaN counts as 0, as in JS).
 *
 * @param value the comparator's result
 * @returns a number usable by Array.prototype.sort
 */
export function compareResult(value: Value): number {
  const number = toNumber(value, 'sort')

  return globalThis.Number.isNaN(number) ? 0 : number
}

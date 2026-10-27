// Helpers for defining native functions.
import { displayKey } from '@/parser/symbol-keys'
import { defineProperty } from '@/runtime/properties'
import { toNumber } from '@/runtime/operators'
import { NativeFunction, type NativeImpl, type Object as ScriptObject, type Realm, type Value } from '@/runtime/values'

/**
 * Defines native methods on an object (a prototype or a namespace).
 *
 * @param realm the realm (for the functions' prototype)
 * @param target the object receiving the methods
 * @param methods name → [length, implementation]
 */
export function defineMethods(realm: Realm, target: ScriptObject, methods: Record<string, [number, NativeImpl]>) {
  for (const [name, [length, impl]] of Object.entries(methods)) {
    defineProperty(target, name, new NativeFunction(realm.FunctionPrototype, displayKey(name), length, impl))
  }
}

/**
 * A method entry for `defineMethods` (keeps the implementation's types even for keys like `toString`).
 *
 * @param length the function's `length`
 * @param impl the implementation
 * @returns the entry
 */
export function method(length: number, impl: NativeImpl): [number, NativeImpl] {
  return [length, impl]
}

/**
 * `ToIntegerOrInfinity` for optional numeric arguments: `undefined` stays `undefined` (the JS default applies).
 *
 * @param value argument
 * @returns an integer, ±Infinity or undefined
 */
export function integerArgument(value: Value): number | undefined {
  if (value === undefined) return undefined

  const number = toNumber(value, 'argument')

  return globalThis.Number.isNaN(number) ? 0 : globalThis.Math.trunc(number)
}

/**
 * Converts JS `undefined` results ("nothing", "not found") to `null` (D37).
 *
 * @param value a result
 * @returns the value, or null instead of undefined
 */
export function orNull(value: Value): Value {
  return value === undefined ? null : value
}

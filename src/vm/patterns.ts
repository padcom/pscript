// Destructuring at runtime (D40, §4.4.14): CHECK_PATTERN, OBJECT_REST and the array-pattern iteration; spread (D46):
// ARRAY_SPREAD and OBJECT_SPREAD.
import { unknownNamedParameter } from '@/compiler/signature'
import { DONE, getIterator, type ScriptIterator } from '@/runtime/iterators'
import { publicProps } from '@/runtime/members'
import { defineProperty, getProperty } from '@/runtime/properties'
import { type ScriptError, typeError } from '@/runtime/script-error'
import { Array as ScriptArray, Object as ScriptObject, type AccessContext, type Realm, type Value } from '@/runtime/values'

/** The strict named-parameter check of an object pattern: the keys it accepts and the path of nested patterns. */
interface NamedKeys {
  keys: Set<string>
  path: string
}

/** Parsed CHECK_PATTERN operands, by their JSON text. */
const namedKeys = new Map<string, NamedKeys>()

function parseNamedKeys(text: string): NamedKeys {
  let parsed = namedKeys.get(text)

  if (!parsed) {
    const { keys, path } = JSON.parse(text) as { keys: string[], path: string }

    parsed = { keys: new Set(keys), path }
    namedKeys.set(text, parsed)
  }

  return parsed
}

// Plain objects (object literals, `Object` results): not class instances, arrays, functions or host values.
function isPlainObject(value: Value): value is ScriptObject {
  return value instanceof ScriptObject && Object.getPrototypeOf(value) === ScriptObject.prototype && !value.klass
}

function checkKeys(value: ScriptObject, { keys, path }: NamedKeys, signature: string) {
  const unknown = [...value.props.keys()].find(key => !keys.has(key))

  if (unknown !== undefined) throw typeError(unknownNamedParameter(path + unknown, signature))
}

function isNullish(value: Value): value is null | undefined {
  return value === null || value === undefined
}

/**
 * `CHECK_PATTERN`: an object pattern cannot destructure null or undefined; a strict named parameter rejects the
 * unknown keys of a plain object.
 *
 * @param value the destructured value
 * @param check the JSON of the accepted keys, or null
 * @param signature the signature of the function, for the message
 */
export function checkPattern(value: Value, check: string | null, signature: string) {
  if (isNullish(value)) throw typeError(`Cannot destructure ${String(value)}`)
  if (check !== null && isPlainObject(value)) checkKeys(value, parseNamedKeys(check), signature)
}

// The own enumerable public properties, as `Object.entries` sees them.
function ownValues(ctx: AccessContext, value: Value): [string, Value][] {
  if (value instanceof ScriptArray) return value.items.map((item, i) => [String(i), item])
  if (typeof value === 'string') return [...value].map((ch, i) => [String(i), ch])
  if (!(value instanceof ScriptObject)) return []

  return publicProps(value).map(([key]) => [key, getProperty(ctx, value, key)])
}

/**
 * `OBJECT_REST`: a plain object with the properties an object pattern did not name.
 *
 * @param ctx access context (getters run in it)
 * @param value the destructured value
 * @param excluded the JSON array of the named keys
 * @returns the new object
 */
export function objectRest(ctx: AccessContext & { realm: Realm }, value: Value, excluded: string): ScriptObject {
  const named = new Set(JSON.parse(excluded) as string[])
  const rest = new ScriptObject(ctx.realm.ObjectPrototype)

  for (const [key, item] of ownValues(ctx, value)) {
    if (!named.has(key)) defineProperty(rest, key, item)
  }

  return rest
}

/**
 * `ITER_REST`: the values an iterator has left, as a new array.
 *
 * @param iterator the iterator
 * @param realm the realm (for the array's prototype)
 * @returns the array
 */
export function iteratorRest(iterator: ScriptIterator, realm: Realm): ScriptArray {
  const items: Value[] = []

  for (let next = iterator.next(); next !== DONE; next = iterator.next()) items.push(next)

  return new ScriptArray(realm.ArrayPrototype, items)
}

/**
 * `ARRAY_SPREAD`: appends what an iterable produces to an array (`[...x]`, spread arguments, D46).
 *
 * @param array the array being built
 * @param iterable the spread value
 * @throws {ScriptError} TypeError when the value is not iterable
 */
export function arraySpread(array: ScriptArray, iterable: Value) {
  const iterator = getIterator(iterable)

  for (let next = iterator.next(); next !== DONE; next = iterator.next()) array.items.push(next)
}

/**
 * `OBJECT_SPREAD`: copies the own enumerable public properties of a value into an object literal (`{ ...x }`, D46).
 * Getters run; `null`, `undefined` and other primitives except strings add nothing, as in JS.
 *
 * @param ctx access context (getters run in it)
 * @param target the object being built
 * @param value the spread value
 */
export function objectSpread(ctx: AccessContext, target: ScriptObject, value: Value) {
  for (const [key, item] of ownValues(ctx, value)) defineProperty(target, key, item)
}

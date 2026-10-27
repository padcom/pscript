// Shared helpers of property access: prototype-chain lookup and accessor resolution.
import { typeError } from './script-error'
import { Accessor, type AccessContext, type Function as ScriptFunction, type Object as ScriptObject, type Value } from './values'

/** What a props map holds: a value, or an object literal's own accessor. */
export type Stored = Value | Accessor

/** A found property: `[stored]`, or null when the key is not there (undefined is a valid value). */
export type Found = [Stored] | null

/**
 * Finds a property along the prototype chain.
 *
 * @param object where to start
 * @param key property name
 * @returns the stored value, or null
 */
export function find(object: ScriptObject | null, key: string): Found {
  for (let current = object; current; current = current.proto) {
    if (current.props.has(key)) return [current.props.get(key) as Stored]
  }

  return null
}

/**
 * An own property.
 *
 * @param object the object
 * @param key property name
 * @returns the stored value, or null
 */
export function own(object: ScriptObject, key: string): Found {
  return object.props.has(key) ? [object.props.get(key) as Stored] : null
}

/**
 * Reads a stored value: accessors through their getter with the original receiver (an object literal's
 * setter-only accessor reads undefined).
 *
 * @param ctx access context
 * @param stored the stored value
 * @param receiver `this` for a getter
 * @returns the value
 */
export function resolve(ctx: AccessContext, stored: Stored, receiver: Value): Value {
  if (!(stored instanceof Accessor)) return stored

  return stored.get ? ctx.callFunction(stored.get, receiver, []) : undefined
}

/**
 * The `name` / `length` of a function.
 *
 * @param fn the function
 * @param key property name
 * @returns the value, or null for other keys
 */
export function functionProperty(fn: ScriptFunction, key: string): Found {
  if (key === 'name') return [fn.name]

  return key === 'length' ? [fn.length] : null
}

/**
 * Throws the D36 error for a member that does not exist.
 *
 * @param owner how the receiver is described (`Point`, `Class 'Point'`)
 * @param key member name
 */
export function noMember(owner: string, key: string): never {
  throw typeError(`${owner} has no member '${key}'`)
}

/**
 * Throws the error for writing an accessor that has no setter.
 *
 * @param key member name
 * @param owner how the receiver is described
 */
export function onlyGetter(key: string, owner: string): never {
  throw typeError(`Cannot set property ${key} of ${owner} which has only a getter`)
}

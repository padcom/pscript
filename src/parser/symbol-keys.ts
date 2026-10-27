// The well-known symbols PScript has (D57): `Symbol.iterator` and `Symbol.asyncIterator`, as member names of classes
// and object literals. Properties named by them are stored under internal keys that scripts cannot spell and that
// no enumeration lists (as JS does not list symbol keys).
import type { Identifier, Literal, MemberExpression } from './ast'

/** The names of the well-known symbols, as in `Symbol.<name>`. */
export const WELL_KNOWN_SYMBOLS: ReadonlySet<string> = new Set(['iterator', 'asyncIterator'])

/**
 * The internal property key of a well-known symbol.
 *
 * @param name `iterator` or `asyncIterator`
 * @returns the key
 */
export function symbolKey(name: string): string {
  return `\u0000Symbol.${name}`
}

/** The key of `Symbol.iterator`. */
export const ITERATOR_KEY = symbolKey('iterator')

/** The key of `Symbol.asyncIterator`. */
export const ASYNC_ITERATOR_KEY = symbolKey('asyncIterator')

/**
 * Whether a property key stands for a symbol (and is not listed by enumerations).
 *
 * @param key a property key
 * @returns true for a symbol key
 */
export function isSymbolKey(key: string): boolean {
  return key.charCodeAt(0) === 0
}

/**
 * How a key is shown in names and messages: `[Symbol.iterator]` for a symbol key.
 *
 * @param key a property key
 * @returns the display form
 */
export function displayKey(key: string): string {
  return isSymbolKey(key) ? `[${key.slice(1)}]` : key
}

/**
 * The name of a class member: an identifier, a string or number literal, or `[Symbol.iterator]` (D57).
 *
 * @param key the key node
 * @returns the property key
 */
export function memberKeyName(key: Identifier | Literal | MemberExpression): string {
  if (key.type === 'MemberExpression') return symbolKey((key.property as Identifier).name)

  return key.type === 'Identifier' ? key.name : String(key.value)
}

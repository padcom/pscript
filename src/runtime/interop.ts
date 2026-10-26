// Host ⇄ script value conversion (§5.8.1). Primitives only so far; live proxies arrive with M23.
import type { Value } from './values'

/**
 * Converts a host value for use by scripts.
 *
 * @param value host value
 * @returns the script value
 * @throws {TypeError} for host objects and functions (not supported yet)
 */
export function toScript(value: unknown): Value {
  if (value === null || !['object', 'function'].includes(typeof value)) return value as Value

  throw new TypeError('Passing host objects and functions to scripts is not supported yet')
}

/**
 * Converts a script value for the host. Script objects are returned as they are for now.
 *
 * @param value script value
 * @returns the host value
 */
export function toHost(value: Value): unknown {
  return value
}

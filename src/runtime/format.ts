// print formatting (§4.6.2, D18). Arrays, objects and class instances arrive with their milestones.
import { isObject } from './operators'
import { Class, Function as ScriptFunction, type Value } from './values'

function formatFunction(fn: ScriptFunction): string {
  if (fn instanceof Class) {
    return fn.superClass ? `[class ${fn.name} extends ${fn.superClass.name}]` : `[class ${fn.name}]`
  }

  return fn.name ? `[Function: ${fn.name}]` : '[Function (anonymous)]'
}

/**
 * Formats a value nested in an array or object: strings are double-quoted.
 *
 * @param value any value
 * @returns the formatted text
 */
export function formatNested(value: Value): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value instanceof ScriptFunction) return formatFunction(value)

  return isObject(value) ? '[Object]' : String(value)
}

/**
 * Formats a top-level `print` argument: strings are printed raw.
 *
 * @param value any value
 * @returns the formatted text
 */
export function formatValue(value: Value): string {
  return typeof value === 'string' ? value : formatNested(value)
}

// JSON.stringify (§4.6.1, SHOULD). Own serializer so that key order matches Object.keys (insertion order).
// JSON.parse is COULD (not implemented).
import { defineGlobal } from '@/runtime/realm'
import { typeError } from '@/runtime/script-error'
import {
  Array as ScriptArray,
  Function as ScriptFunction,
  Object as ScriptObject,
  type Realm,
  type Value,
} from '@/runtime/values'
import { defineMethods, integerArgument, method } from './native'

// Non-finite numbers serialize as null, as in JS.
function primitive(value: Value): string {
  return typeof value === 'number' && !Number.isFinite(value) ? 'null' : JSON.stringify(value)
}

/**
 * Serialization state: indentation and the containers being serialized (cycle detection).
 */
class Serializer {
  private stack = new Set<ScriptObject>()

  constructor(private unit: string) {}

  value(value: Value, indent: string): string | undefined {
    if (value === undefined || value instanceof ScriptFunction) return undefined

    return value instanceof ScriptObject ? this.container(value, indent) : primitive(value)
  }

  private container(object: ScriptObject, indent: string): string {
    if (this.stack.has(object)) throw typeError('Converting circular structure to JSON')

    this.stack.add(object)

    try {
      return object instanceof ScriptArray ? this.array(object, indent) : this.object(object, indent)
    } finally {
      this.stack.delete(object)
    }
  }

  private array(array: ScriptArray, indent: string): string {
    const inner = indent + this.unit

    return this.wrap('[', array.items.map(item => this.value(item, inner) ?? 'null'), ']', indent)
  }

  private object(object: ScriptObject, indent: string): string {
    const inner = indent + this.unit
    const separator = this.unit ? ': ' : ':'
    const members = [...object.props].flatMap(([key, item]) => {
      const text = this.value(item as Value, inner)

      return text === undefined ? [] : [`${JSON.stringify(key)}${separator}${text}`]
    })

    return this.wrap('{', members, '}', indent)
  }

  private wrap(open: string, parts: string[], close: string, indent: string): string {
    if (parts.length === 0) return open + close
    if (!this.unit) return open + parts.join(',') + close

    const inner = indent + this.unit

    return `${open}\n${inner}${parts.join(`,\n${inner}`)}\n${indent}${close}`
  }
}

function indentUnit(indent: Value): string {
  if (typeof indent === 'string') return indent.slice(0, 10)

  return typeof indent === 'number' ? ' '.repeat(Math.min(10, Math.max(0, integerArgument(indent) ?? 0))) : ''
}

/**
 * `JSON.stringify(value, null?, indent?)`.
 *
 * @param value the value
 * @param replacer must be null or undefined (replacer functions are not supported)
 * @param indent number of spaces or an indentation string
 * @returns the JSON text, or undefined for undefined and functions
 */
export function stringify(value: Value, replacer: Value, indent: Value): Value {
  if (replacer !== undefined && replacer !== null) throw typeError('JSON.stringify: replacers are not supported')

  return new Serializer(indentUnit(indent)).value(value, '')
}

/**
 * Installs `JSON`.
 *
 * @param realm the realm
 */
export function installJson(realm: Realm) {
  const json = new ScriptObject(realm.ObjectPrototype)

  defineMethods(realm, json, {
    stringify: method(3, (_, __, [value, replacer, indent]) => stringify(value, replacer, indent)),
  })
  defineGlobal(realm, 'JSON', json, true)
}

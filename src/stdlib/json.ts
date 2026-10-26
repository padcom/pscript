// JSON.stringify (§4.6.1, SHOULD). Own serializer so that key order matches Object.keys (insertion order).
// JSON.parse is COULD (not implemented).
import { defineGlobal } from '@/runtime/realm'
import { typeError } from '@/runtime/script-error'
import {
  Accessor,
  Array as ScriptArray,
  Function as ScriptFunction,
  Object as ScriptObject,
  type AccessContext,
  type Realm,
  type Value,
} from '@/runtime/values'
import { defineMethods, integerArgument, method } from './native'

// Own accessors of object literals are serialized through their getter (§4.4.6).
function readOwn(ctx: AccessContext, object: ScriptObject, stored: Value | Accessor): Value {
  if (!(stored instanceof Accessor)) return stored

  return stored.get ? ctx.callFunction(stored.get, object, []) : undefined
}

// Non-finite numbers serialize as null, as in JS.
function primitive(value: Value): string {
  return typeof value === 'number' && !Number.isFinite(value) ? 'null' : JSON.stringify(value)
}

/**
 * Serialization state: indentation and the containers being serialized (cycle detection).
 */
class Serializer {
  private stack = new Set<ScriptObject>()

  constructor(private unit: string, private ctx: AccessContext) {}

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
      const text = this.value(readOwn(this.ctx, object, item), inner)

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
 * @param ctx access context (for getters)
 * @param value the value
 * @param options `[replacer, indent]`: the replacer must be null or undefined, indent a number of spaces or a string
 * @returns the JSON text, or undefined for undefined and functions
 */
export function stringify(ctx: AccessContext, value: Value, options: Value[]): Value {
  const [replacer, indent] = options

  if (replacer !== undefined && replacer !== null) throw typeError('JSON.stringify: replacers are not supported')

  return new Serializer(indentUnit(indent), ctx).value(value, '')
}

/**
 * Installs `JSON`.
 *
 * @param realm the realm
 */
export function installJson(realm: Realm) {
  const json = new ScriptObject(realm.ObjectPrototype)

  defineMethods(realm, json, {
    stringify: method(3, (ctx, __, [value, ...options]) => stringify(ctx, value, options)),
  })
  defineGlobal(realm, 'JSON', json, true)
}

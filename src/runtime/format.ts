// print formatting (§4.6.2, D18): primitives, containers (also host arrays and objects), class instances (D35),
// accessors, functions, classes and interfaces.
import { IDENT_PATTERN } from '@/parser/tokens'
import { toStringIn } from './conversions'
import { publicProps } from './members'
import { toString } from './operators'
import {
  Accessor,
  Array as ScriptArray,
  Class,
  Function as ScriptFunction,
  HostObject,
  Interface,
  ModuleNamespace,
  Object as ScriptObject,
  type AccessContext,
  type Value,
} from './values'

// The elements of script arrays and host arrays (which print like arrays, §5.8.1); null for other objects.
function listItems(object: ScriptObject): Value[] | null {
  if (object instanceof ScriptArray) return object.items

  const isHostArray = object instanceof HostObject && globalThis.Array.isArray(object.target)

  return isHostArray ? publicProps(object).map(([, value]) => value as Value) : null
}

/** Nested containers deeper than this print as `[Object]` / `[Array]`. */
const MAX_DEPTH = 2

function className({ name }: Class): string {
  return name || '(anonymous)'
}

function formatFunction(fn: ScriptFunction): string {
  if (fn instanceof Class) {
    const parent = fn.superClass ? ` extends ${className(fn.superClass)}` : ''

    return `[class ${className(fn)}${parent}]`
  }

  return fn.name ? `[Function: ${fn.name}]` : '[Function (anonymous)]'
}

// Functions, classes and interfaces print as a bracketed name.
function formatNamed(value: ScriptFunction | Interface): string {
  return value instanceof Interface ? `[interface ${value.name}]` : formatFunction(value)
}

function formatKey(key: string): string {
  return IDENT_PATTERN.test(key) ? key : JSON.stringify(key)
}

function accessorLabel({ get, set }: Accessor): string {
  if (get && set) return '[Getter/Setter]'

  return get ? '[Getter]' : '[Setter]'
}

function placeholder(object: ScriptObject): string {
  return object instanceof ScriptArray ? '[Array]' : '[Object]'
}

/**
 * Formats nested values, tracking depth and the containers being printed (cycles).
 */
class Formatter {
  private seen = new Set<ScriptObject>()

  constructor(private ctx?: AccessContext) {}

  value(value: Value, depth: number): string {
    if (typeof value === 'string') return JSON.stringify(value)

    return value instanceof ScriptObject ? this.object(value, depth) : String(value)
  }

  // Class instances print as their toString() (D35); functions and containers have their own forms.
  private object(object: ScriptObject, depth: number): string {
    if (object instanceof ScriptFunction || object instanceof Interface) return formatNamed(object)

    return object.klass ? this.instance(object) : this.container(object, depth)
  }

  private instance(object: ScriptObject): string {
    return this.ctx ? toStringIn(this.ctx, object) : toString(object)
  }

  private container(object: ScriptObject, depth: number): string {
    if (this.seen.has(object)) return '[Circular]'
    if (depth > MAX_DEPTH) return placeholder(object)

    this.seen.add(object)

    try {
      const items = listItems(object)

      return items ? this.array(items, depth) : this.plainObject(object, depth)
    } finally {
      this.seen.delete(object)
    }
  }

  private array(items: Value[], depth: number): string {
    return `[${items.map(item => this.value(item, depth + 1)).join(', ')}]`
  }

  // Own accessors are shown, not called (§4.6.2).
  private property(value: Value | Accessor, depth: number): string {
    return value instanceof Accessor ? accessorLabel(value) : this.value(value, depth)
  }

  // Module namespaces print as `[Module] {a: 1}` (§4.7.2).
  private plainObject(object: ScriptObject, depth: number): string {
    const entries = publicProps(object).map(([key, value]) => `${formatKey(key)}: ${this.property(value, depth + 1)}`)
    const text = entries.length === 0 ? '{}' : `{${entries.join(', ')}}`

    return object instanceof ModuleNamespace ? `[Module] ${text}` : text
  }
}

/**
 * Formats a value nested in an array or object: strings are double-quoted.
 *
 * @param value any value
 * @param ctx access context, to call script `toString()` methods of class instances
 * @returns the formatted text
 */
export function formatNested(value: Value, ctx?: AccessContext): string {
  return new Formatter(ctx).value(value, 0)
}

/**
 * Formats a top-level `print` argument: strings are printed raw.
 *
 * @param value any value
 * @param ctx access context, to call script `toString()` methods of class instances
 * @returns the formatted text
 */
export function formatValue(value: Value, ctx?: AccessContext): string {
  return typeof value === 'string' ? value : formatNested(value, ctx)
}

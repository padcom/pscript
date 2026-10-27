// Script values seen from the host (§5.8.1): live proxies. Functions are proxies over arrow functions (not
// constructable, D25), classes over classes (`new` runs script construction, `instanceof` applies the brand rule),
// arrays over arrays (live `items`), other objects over plain objects (reads and writes go through the runtime with
// no home class, so private and protected members stay inaccessible).
import { publicProps } from './members'
import { instanceOf } from './operators'
import { getProperty, hasPropertyIn, setProperty } from './properties'
import { ScriptError } from './script-error'
import {
  Array as ScriptArray,
  Class,
  Closure,
  Function as ScriptFunction,
  ModuleNamespace,
  type AccessContext,
  type Object as ScriptObject,
  type Value,
} from './values'

/**
 * What the proxies need from the VM.
 */
export interface ProxyHost {
  /** access context of host code: no home class */
  hostContext: AccessContext
  /** calls a script function (re-entrant) */
  callFunction(fn: Value, thisValue: Value, args: Value[]): Value
  /** `new cls(...args)` */
  construct(cls: Class, args: Value[]): Value
  /** turns a script exception that reaches the host into a `PScriptRuntimeError` */
  toHostError(error: unknown): unknown
}

/**
 * Value conversion in both directions.
 */
export interface Converter {
  /** host → script */
  toScript(value: unknown): Value
  /** script → host */
  toHost(value: Value): unknown
}

const INDEX = /^(?:0|[1-9]\d*)$/

function isIndex(key: string | symbol): key is string {
  return typeof key === 'string' && INDEX.test(key)
}

function isNoMember(error: unknown, key: string): boolean {
  return error instanceof ScriptError && error.message.endsWith(`has no member '${key}'`)
}

// Own data properties of plain objects can be deleted; namespaces, frozen objects and class members cannot.
function isDeletable(object: ScriptObject): boolean {
  return !object.klass && !(object instanceof ModuleNamespace) && !object.frozen
}

function deleteOwn(object: ScriptObject, key: string): boolean {
  if (!isDeletable(object)) return false
  object.props.delete(key)

  return true
}

class Proxies {
  constructor(private host: ProxyHost, private convert: Converter) {}

  // Script code run for the host: script exceptions become PScriptRuntimeErrors.
  enter<T>(f: () => T): T {
    try {
      return f()
    } catch (e) {
      throw this.host.toHostError(e)
    }
  }

  // Extra arguments from the host are dropped (§5.8.1); missing required ones are the usual arity error.
  private scriptArgs(fn: ScriptFunction, args: unknown[]): Value[] {
    const values = args.map(arg => this.convert.toScript(arg))
    if (!(fn instanceof Closure) || fn.fnProto.hasRest) return values

    return values.slice(0, fn.fnProto.paramCount)
  }

  function(fn: ScriptFunction): object {
    const call = (thisArg: unknown, args: unknown[]) => this.enter(() => {
      const thisValue = thisArg === undefined ? null : this.convert.toScript(thisArg)

      return this.convert.toHost(this.host.callFunction(fn, thisValue, this.scriptArgs(fn, args)))
    })
    const named: Record<string | symbol, unknown> = { name: fn.name, length: fn.length }

    return new Proxy(() => {}, {
      apply: (_, thisArg, args) => call(thisArg, args),
      get: (target, key) => (key in named ? named[key] : Reflect.get(target, key)),
    })
  }

  class(cls: Class): object {
    const target = class {}
    const construct = (args: unknown[]) => this.enter(() => {
      const values = args.map(arg => this.convert.toScript(arg))

      return this.convert.toHost(this.host.construct(cls, values)) as object
    })

    const hasInstance = (value: unknown) => instanceOf(this.convert.toScript(value), cls)

    Object.defineProperty(target, Symbol.hasInstance, { value: hasInstance })

    return new Proxy(target, {
      construct: (_, args) => construct(args),
      apply: () => { throw new TypeError(`Class constructor ${cls.name} cannot be invoked without 'new'`) },
      get: (proxied, key) => (typeof key === 'symbol' || key === 'prototype' ? Reflect.get(proxied, key) : this.read(cls, key)),
    })
  }

  array(array: ScriptArray): object {
    const { items } = array

    return new Proxy([] as unknown[], {
      get: (target, key, receiver) => this.arrayGet(array, target, key, receiver),
      set: (_, key, value) => this.arraySet(array, key, value),
      has: (target, key) => key === 'length' || (isIndex(key) && Number(key) < items.length) || Reflect.has(target, key),
      ownKeys: () => [...items.keys()].map(String).concat('length'),
      getOwnPropertyDescriptor: (_, key) => this.arrayDescriptor(array, key),
      deleteProperty: () => false,
    })
  }

  private arrayGet(array: ScriptArray, target: unknown[], key: string | symbol, receiver: unknown): unknown {
    if (key === 'length') return array.items.length

    return isIndex(key) ? this.convert.toHost(array.items[Number(key)]) : Reflect.get(target, key, receiver)
  }

  private arraySet(array: ScriptArray, key: string | symbol, value: unknown): boolean {
    if (key !== 'length' && !isIndex(key)) return false

    this.enter(() => setProperty(this.host.hostContext, array, key, this.convert.toScript(value)))

    return true
  }

  private arrayDescriptor(array: ScriptArray, key: string | symbol): PropertyDescriptor | undefined {
    if (key === 'length') return { value: array.items.length, writable: true, enumerable: false, configurable: false }
    if (!isIndex(key) || Number(key) >= array.items.length) return undefined

    return { value: this.convert.toHost(array.items[Number(key)]), writable: true, enumerable: true, configurable: true }
  }

  object(object: ScriptObject): object {
    return new Proxy({}, {
      get: (_, key) => (typeof key === 'symbol' ? undefined : this.read(object, key)),
      set: (_, key, value) => typeof key === 'string' && this.write(object, key, value),
      has: (_, key) => typeof key === 'string' && this.enter(() => hasPropertyIn(this.host.hostContext, key, object)),
      ownKeys: () => this.keys(object),
      getOwnPropertyDescriptor: (_, key) => this.descriptor(object, key),
      deleteProperty: (_, key) => typeof key === 'string' && deleteOwn(object, key),
    })
  }

  // Undeclared members of class instances read as undefined from the host (JS conventions, D36).
  read(object: ScriptObject, key: string): unknown {
    return this.enter(() => {
      try {
        return this.convert.toHost(getProperty(this.host.hostContext, object, key))
      } catch (e) {
        if (isNoMember(e, key)) return undefined
        throw e
      }
    })
  }

  private write(object: ScriptObject, key: string, value: unknown): boolean {
    this.enter(() => setProperty(this.host.hostContext, object, key, this.convert.toScript(value)))

    return true
  }

  private keys(object: ScriptObject): string[] {
    return publicProps(object).map(([key]) => key)
  }

  private descriptor(object: ScriptObject, key: string | symbol): PropertyDescriptor | undefined {
    if (typeof key !== 'string' || !this.keys(object).includes(key)) return undefined

    return { value: this.read(object, key), writable: true, enumerable: true, configurable: true }
  }
}

/**
 * Creates the host proxy of a script object.
 *
 * @param host the VM side
 * @param convert value conversion
 * @param value the script object (not a host wrapper)
 * @returns the proxy
 */
export function hostProxy(host: ProxyHost, convert: Converter, value: ScriptObject): object {
  const proxies = new Proxies(host, convert)

  if (value instanceof Class) return proxies.class(value)
  if (value instanceof ScriptFunction) return proxies.function(value)

  return value instanceof ScriptArray ? proxies.array(value) : proxies.object(value)
}

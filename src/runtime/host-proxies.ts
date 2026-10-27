// Script values seen from the host (§5.8.1): live proxies. Functions are proxies over arrow functions (not
// constructable, D25), classes over classes (`new` runs script construction, `instanceof` applies the brand rule),
// arrays over arrays (live `items`), other objects over plain objects (reads and writes go through the runtime with
// no home class, so private and protected members stay inaccessible), generators over JS iterators (D42).
import { CollectionObject } from './collections'
import { GeneratorObject, type ResumeMode } from './generators'
import { PromiseObject, type PromiseOps } from './promises'
import { ScriptThrow } from './script-error'
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

function* converted(iterator: Iterator<Value>, toHost: (value: Value) => unknown): Generator<unknown> {
  for (let step = iterator.next(); !step.done; step = iterator.next()) yield toHost(step.value)
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

  // A JS iterator: `for…of`, spread and `Array.from` work on the host side; a missing argument is null (D37).
  generator(generator: GeneratorObject): object {
    const step = (mode: ResumeMode, args: unknown[]) => this.enter(() => {
      const { value, done } = generator.driver.resume(mode, args.length === 0 ? null : this.convert.toScript(args[0]))

      return { value: this.convert.toHost(value), done }
    })

    return {
      next: (...args: unknown[]) => step('next', args),
      return: (...args: unknown[]) => step('return', args),
      throw: (...args: unknown[]) => step('throw', args),
      [Symbol.iterator]() { return this },
      [Symbol.toStringTag]: 'Generator',
    }
  }

  // A real host promise that follows the script promise (D43); a rejection arrives as a PScriptRuntimeError.
  promise(promise: PromiseObject): object {
    const promises = this.host.hostContext.promises as PromiseOps

    return new globalThis.Promise((resolve, reject) => {
      promises.react(promise, value => resolve(this.convert.toHost(value)), (reason, frames) => {
        reject(this.host.toHostError(new ScriptThrow(reason, frames)))
      })
    })
  }

  object(object: ScriptObject): object {
    return new Proxy({}, {
      get: (_, key) => (typeof key === 'symbol' ? this.symbol(object, key) : this.read(object, key)),
      set: (_, key, value) => typeof key === 'string' && this.write(object, key, value),
      has: (_, key) => typeof key === 'string' && this.enter(() => hasPropertyIn(this.host.hostContext, key, object)),
      ownKeys: () => this.keys(object),
      getOwnPropertyDescriptor: (_, key) => this.descriptor(object, key),
      deleteProperty: (_, key) => typeof key === 'string' && deleteOwn(object, key),
    })
  }

  // Maps and sets (D49) are iterable on the host side, like the host's own.
  private symbol(object: ScriptObject, key: symbol): unknown {
    if (key !== Symbol.iterator || !(object instanceof CollectionObject)) return undefined

    return () => converted(object.iterate(), value => this.convert.toHost(value))
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

function objectProxy(proxies: Proxies, value: ScriptObject): object {
  if (value instanceof GeneratorObject) return proxies.generator(value)
  if (value instanceof PromiseObject) return proxies.promise(value)

  return value instanceof ScriptArray ? proxies.array(value) : proxies.object(value)
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

  return objectProxy(proxies, value)
}

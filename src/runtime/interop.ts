// Host ⇄ script values (§5.8.1, D9): values cross the boundary by reference. Host objects and functions become
// HostObject / HostFunction / host classes, script objects become live proxies; both directions keep identity
// (WeakMap caches) and round trips unwrap.
import { builtinTemplate } from '@/stdlib/errors'
import { hostProxy, type ProxyHost } from './host-proxies'
import { typeError } from './script-error'
import {
  Class,
  Function as ScriptFunction,
  HostFunction,
  HostObject,
  Object as ScriptObject,
  type AccessContext,
  type HostAccess,
  type Value,
} from './values'

const HOST_CLASSES = new WeakSet<object>()

/**
 * Marks a host function as a class (D25): scripts can `new` and extend it, and calling it without `new` is an error.
 * Functions declared with `class` syntax are classes without marking.
 *
 * @param fn the constructor
 * @returns the same function
 */
export function markAsClass<T extends abstract new (...args: any[]) => any>(fn: T): T

export function markAsClass<T extends (...args: any[]) => any>(fn: T): T

export function markAsClass(fn: object): object {
  HOST_CLASSES.add(fn)

  return fn
}

/** Keys that are never read from or written to host objects (sandbox hardening, §5.8.1). */
export const BLOCKED_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
])

function isHostClass(fn: (...args: unknown[]) => unknown): boolean {
  return HOST_CLASSES.has(fn) || globalThis.Function.prototype.toString.call(fn).startsWith('class')
}

const PASS_THROUGH = new Set(['undefined', 'boolean', 'number', 'string'])

// bigint and symbol values cannot cross the boundary (§5.8.1).
function checkPassable(value: unknown): object {
  if (typeof value === 'object' || typeof value === 'function') return value as object

  throw new TypeError(`A ${typeof value} cannot be passed to a script`)
}

// Round trips unwrap: host wrappers give back the host value they wrap.
function hostOriginal(value: ScriptObject): unknown {
  if (value instanceof HostObject || value instanceof HostFunction) return value.target

  return value instanceof Class ? value.host : undefined
}

/**
 * What interop needs from the VM.
 */
export interface InteropHost extends ProxyHost {
  /** turns an exception thrown by host code into a script exception (catchable by scripts) */
  fromHost(error: unknown): unknown
}

export class Interop implements HostAccess {
  /** host object or function → its script wrapper */
  private wrappers = new WeakMap<object, Value>()
  /** script object → its host proxy */
  private proxies = new WeakMap<ScriptObject, object>()
  /** host proxy → the script object behind it */
  private originals = new WeakMap<object, ScriptObject>()

  constructor(private host: InteropHost) {}

  /**
   * The context the host acts in: no home class, so private and protected members are inaccessible (§5.8.1).
   *
   * @returns the access context
   */
  get ctx(): AccessContext {
    return this.host.hostContext
  }

  /**
   * Converts a host value for scripts.
   *
   * @param value host value
   * @returns the script value
   */
  toScript(value: unknown): Value {
    if (value === null || PASS_THROUGH.has(typeof value)) return value as Value

    return this.originals.get(checkPassable(value)) ?? this.wrapper(value as object)
  }

  private wrapper(value: object): Value {
    let wrapper = this.wrappers.get(value)

    if (wrapper === undefined) {
      wrapper = this.wrap(value)
      this.wrappers.set(value, wrapper)
    }

    return wrapper
  }

  private wrap(value: object): Value {
    const { realm } = this.ctx
    if (typeof value !== 'function') return new HostObject(realm.ObjectPrototype, value, this)

    const fn = value as (...args: unknown[]) => unknown

    return isHostClass(fn) ? this.hostClass(fn) : new HostFunction(realm.FunctionPrototype, fn.name, fn.length, fn)
  }

  // A host class: `new` constructs the host object; a script subclass's instances keep it as their `hostTarget`.
  private hostClass(fn: (...args: unknown[]) => unknown): Class {
    const { realm } = this.ctx
    const cls = new Class(realm.FunctionPrototype, builtinTemplate(fn.name, false), null, new ScriptObject(realm.ObjectPrototype))
    const host = fn as unknown as new (...args: unknown[]) => object

    cls.host = host
    cls.hostAccess = this
    cls.length = fn.length
    cls.native = { construct: (_, newTarget, args) => this.constructHost(cls, newTarget, args) }

    return cls
  }

  private constructHost(cls: Class, newTarget: Class, args: Value[]): ScriptObject {
    const host = cls.host as new (...args: unknown[]) => object
    const instance = this.call(() => Reflect.construct(host, args.map(arg => this.toHost(arg))))
    if (newTarget === cls) return this.toScript(instance) as ScriptObject

    const object = new ScriptObject(newTarget.prototype)

    object.klass = newTarget
    object.hostTarget = instance

    return object
  }

  /**
   * Converts a script value for the host.
   *
   * @param value script value
   * @returns the host value (primitives as they are, wrappers unwrapped, other objects as live proxies)
   */
  toHost(value: Value): unknown {
    if (!(value instanceof ScriptObject)) return value

    return hostOriginal(value) ?? this.proxies.get(value) ?? this.proxy(value)
  }

  private proxy(value: ScriptObject): object {
    const proxy = hostProxy(this.host, this, value)

    this.proxies.set(value, proxy)
    this.originals.set(proxy, value)

    return proxy
  }

  /**
   * Runs host code from the VM: host exceptions become script exceptions.
   *
   * @param f the host code
   * @returns its result
   */
  call<T>(f: () => T): T {
    try {
      return f()
    } catch (e) {
      throw this.host.fromHost(e)
    }
  }

  /**
   * Calls a host function from a script: arguments and `this` go through `toHost`, the result through `toScript`
   * (`undefined` becomes `null`, D37).
   *
   * @param fn the host function
   * @param thisValue the script `this`
   * @param args script arguments
   * @returns the script result
   */
  invoke(fn: HostFunction, thisValue: Value, args: Value[]): Value {
    const result = this.call(() => fn.target.apply(this.hostThis(thisValue), args.map(arg => this.toHost(arg))))

    return result === undefined ? null : this.toScript(result)
  }

  // Host methods inherited by script subclass instances run on the host part.
  private hostThis(thisValue: Value): unknown {
    return thisValue instanceof ScriptObject && thisValue.hostTarget ? thisValue.hostTarget : this.toHost(thisValue)
  }

  get(target: object, key: string): Value {
    if (BLOCKED_KEYS.has(key)) return undefined

    return this.call(() => this.toScript(Reflect.get(target, key)))
  }

  set(target: object, key: string, value: Value) {
    if (BLOCKED_KEYS.has(key)) throw typeError(`Cannot assign to '${key}' of a host object`)
    this.call(() => Reflect.set(target, key, this.toHost(value)))
  }

  has(target: object, key: string): boolean {
    return !BLOCKED_KEYS.has(key) && key in target
  }

  keys(target: object): string[] {
    return globalThis.Object.keys(target).filter(key => !BLOCKED_KEYS.has(key))
  }

  * iterate(target: object): Iterator<Value> {
    const iterable = target as Iterable<unknown>
    if (typeof iterable[Symbol.iterator] !== 'function') throw typeError('host object is not iterable')

    const iterator = this.call(() => iterable[Symbol.iterator]())

    for (let step = this.call(() => iterator.next()); !step.done; step = this.call(() => iterator.next())) {
      yield this.toScript(step.value)
    }
  }
}

/**
 * Whether a value is a host array seen from scripts (`Array.isArray`, printing, JSON).
 *
 * @param value script value
 * @returns true for HostObjects over arrays
 */
export function isHostArray(value: Value): value is HostObject {
  return value instanceof HostObject && globalThis.Array.isArray(value.target)
}

/**
 * Whether a script value is callable from the host side (functions and classes).
 *
 * @param value script value
 * @returns true for functions
 */
export function isScriptFunction(value: Value): value is ScriptFunction {
  return value instanceof ScriptFunction
}

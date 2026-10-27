// Runtime value model (§5.7). The script-side classes deliberately shadow the JS built-ins (D8):
// files that import them and also need the host built-ins use `globalThis.Object` etc.
import type { Access } from '@/parser/ast'
import type { ClassTemplate, FunctionProto, InterfaceMemberTemplate } from '@/compiler/function-proto'
import type { PromiseOps } from './promises'
import type { ScriptStackFrame } from '@/errors'
import type { ModuleRecord } from '@/modules/module-record'

export type Value = undefined | null | boolean | number | string | Object

/** TDZ marker for uninitialised bindings; never escapes to scripts. */
export const UNINITIALIZED: unique symbol = Symbol('UNINITIALIZED')

export type Slot = Value | typeof UNINITIALIZED

/**
 * What a property read or write needs besides the receiver and key (§5.7).
 */
export interface AccessContext {
  /** realm of the running code */
  realm: Realm
  /** home class of the running code, for private and protected access (§4.5.3) */
  homeClass: Class | null
  /** calls a script or native function (getters, setters, `toString()`), provided by the VM */
  callFunction(fn: Value, thisValue: Value, args: Value[]): Value
  /** the current script stack, innermost first (for `Error.stack`) */
  captureStack?(): ScriptStackFrame[]
  /** promise operations and the job queue (D43), provided by the VM */
  promises?: PromiseOps
  /** host ⇄ script value conversion (§5.8.1), provided by the VM */
  interop?: { toScript(value: unknown): Value, toHost(value: Value): unknown }
  /** runs a task of the host's event loop (a timer callback, D44) and the jobs it queues, provided by the VM */
  runTask?(task: () => void): void
  /** queues a job (a microtask, `queueMicrotask`, D45), provided by the VM */
  enqueueJob?(job: () => void): void
}

/**
 * Access to host objects for the runtime (§5.8.1), implemented by the interop layer.
 */
export interface HostAccess {
  /** reads a property of a host object (blocked keys read as undefined) */
  get(target: object, key: string): Value
  /** writes a property of a host object (blocked keys throw) */
  set(target: object, key: string, value: Value): void
  /** `key in target` */
  has(target: object, key: string): boolean
  /** `delete target[key]` (blocked keys throw) */
  delete(target: object, key: string): boolean
  /** own enumerable string keys */
  keys(target: object): string[]
  /** iterates a host iterable, converting each value */
  iterate(target: object): Iterator<Value>
  /** a host async iterable's iterator for `for await` (D53): each call gives the promise of a step object */
  asyncIterator(target: object): { next(): Value, return(): Value } | null
}

export type NativeImpl = (ctx: AccessContext, thisValue: Value, args: Value[]) => Value

/**
 * Native construction for built-in classes (the `Error` family).
 */
export interface NativeClassImpl {
  /** creates and initialises an instance of `cls` (which may be a script subclass) */
  construct(ctx: AccessContext, cls: Class, args: Value[]): Object
}

export class Object {
  /** insertion-ordered own properties; accessors may be own (object literals) or on prototypes (classes) */
  props = new Map<string, Value | Accessor>()
  /** private fields, keyed per declaring class (§5.6.7) */
  privates?: Map<PrivateKey, Value>
  /** set for class instances (brand, access checks, interfaces) */
  klass?: Class
  extensible = true
  /** `Object.freeze`: existing properties are read-only too */
  frozen?: boolean
  /** instances of script classes extending a host class: the host object their host part lives in (§5.8.1) */
  hostTarget?: object

  constructor(public proto: Object | null) {}
}

export class Array extends Object {
  constructor(proto: Object | null, public items: Value[]) {
    super(proto)
  }
}

export class Function extends Object {
  constructor(proto: Object | null, public name: string, public length: number) {
    super(proto)
  }
}

/**
 * What a bare name used in a class body means, per context (§4.5.8): a member, an outside definition, or (static
 * context only) an instance member, which is an error.
 */
export type ImplicitKind = 'member' | 'outer' | 'instance-only'

/**
 * The class-definition resolution of one implicit name.
 */
export interface ImplicitEntry {
  /** in instance code */
  instance: ImplicitKind
  /** in static code */
  static: ImplicitKind
}

/**
 * Where implicit member accesses find their receiver: the frame of the enclosing method (§4.5.8).
 */
export interface ImplicitReceiver {
  /** `this` of that frame */
  thisValue: Value
}

export class Closure extends Function {
  /** arrows only */
  thisValue?: Value
  /** frame of the method (constructor, accessor, initialiser) the closure was created in */
  implicitFrame: ImplicitReceiver | null = null
  homeClass: Class | null = null
  /** for `super` lookups */
  homeObject: Object | null = null
  /** the VM's cache of script bindings used by the closure's code (opaque here) */
  globalCache: any[] | null = null

  constructor(
    proto: Object | null,
    /** named `fnProto` to avoid a clash with `proto` */
    public fnProto: FunctionProto,
    public env: Environment,
    /** module the closure was created in (§5.6.8) */
    public module: ModuleRecord | null,
  ) {
    super(proto, fnProto.name, fnProto.length)
  }
}

/** Never constructable (D25). */
export class NativeFunction extends Function {
  constructor(proto: Object | null, name: string, length: number, public impl: NativeImpl) {
    super(proto, name, length)
  }
}

/**
 * An entry of a class's flattened member index (§5.6.7).
 */
export interface MemberEntry {
  /** member kind */
  kind: 'field' | 'method' | 'accessor'
  /** access modifier */
  access: Access
  /** class that declares the member */
  owner: Class
  /** `final` member (D28) */
  final: boolean
  /** methods */
  fn?: Closure
  /** accessors */
  get?: Closure | null
  /** accessors */
  set?: Closure | null
  /** accessors whose halves differ in access (§4.5.2): access of the getter */
  getAccess?: Access
  /** accessors whose halves differ in access: access of the setter */
  setAccess?: Access
}

/**
 * A private member, looked up with the caller's home class (§4.5.3).
 */
export interface PrivateEntry {
  /** member kind */
  kind: 'field' | 'method' | 'accessor'
  /** fields */
  key?: PrivateKey
  /** methods */
  fn?: Closure
  /** accessors */
  get?: Closure
  /** accessors */
  set?: Closure
}

export class Class extends Function {
  /** public + protected instance members, flattened (§5.6.7) */
  memberIndex = new Map<string, MemberEntry>()
  staticMemberIndex = new Map<string, MemberEntry>()
  /** own private instance members */
  privateIndex = new Map<string, PrivateEntry>()
  staticPrivateIndex = new Map<string, PrivateEntry>()
  /** transitive: own `implements`, their ancestors, and the superclass's set */
  interfaces = new Set<Interface>()
  final = false
  ctor: Closure | null = null
  fieldInit: Closure | null = null
  /** built-in classes (Error family): native construct */
  native?: NativeClassImpl
  /** host classes (§5.8.1) */
  host?: new (...args: any[]) => any
  /** host classes: access to their instances' host parts */
  hostAccess?: HostAccess
  /** lexically enclosing class (private access from nested classes, §4.5.2) */
  outerClass: Class | null = null
  /** resolution of `template.implicitNames`, by index (§4.5.8) */
  implicitTable: ImplicitEntry[] = []

  constructor(
    proto: Object | null,
    public template: ClassTemplate,
    public superClass: Class | null,
    /** internal only (D29) */
    public prototype: Object,
  ) {
    super(proto, template.name, 0)
  }
}

/** Never exposed to scripts as a value. */
export class Accessor {
  constructor(public get: Closure | null = null, public set: Closure | null = null) {}
}

/** Identity = (class, name). */
export class PrivateKey {
  constructor(readonly owner: Class, readonly name: string) {}
}

/** §4.5.7; frozen, not callable. */
export class Interface extends Object {
  /** merged with all ancestors */
  members = new Map<string, InterfaceMemberTemplate>()
  /** including itself */
  ancestors = new Set<Interface>([this])

  constructor(proto: Object | null, public name: string, public parents: Interface[]) {
    super(proto)
    this.extensible = false
  }
}

/**
 * §4.7.2, exotic: a frozen, null-prototype object with one live property per export name (sorted). Reads go through
 * the exports' binding cells (`read` throws the TDZ error for uninitialised bindings).
 */
export class ModuleNamespace extends Object {
  constructor(
    public record: ModuleRecord,
    /** export names, sorted */
    public names: string[],
    /** reads an export */
    public read: (name: string) => Value,
  ) {
    super(null)
    this.extensible = false
    this.frozen = true
  }
}

/** §5.8.1, exotic: all operations delegate to `target`. */
export class HostObject extends Object {
  constructor(proto: Object | null, public target: object, public host: HostAccess) {
    super(proto)
  }
}

/** Host functions that are not classes; host classes become `Class` with `host` set. */
export class HostFunction extends Function {
  constructor(proto: Object | null, name: string, length: number, public target: (...args: any[]) => any) {
    super(proto, name, length)
  }
}

export class Environment {
  constructor(public slots: Slot[], public parent: Environment | null) {}
}

/**
 * A global binding.
 */
export interface GlobalBinding {
  /** current value */
  value: Value
  /** assignment throws a TypeError */
  readonly: boolean
}

/**
 * Intrinsics and globals of one interpreter.
 */
export interface Realm {
  /** prototype of object literals */
  ObjectPrototype: Object
  /** prototype of every function */
  FunctionPrototype: Object
  /** prototype of arrays */
  ArrayPrototype: Object
  /** methods of string primitives */
  StringPrototype: Object
  /** methods of number primitives */
  NumberPrototype: Object
  /** methods of boolean primitives */
  BooleanPrototype: Object
  /** prototype of `Error` instances */
  ErrorPrototype: Object
  /** `next`, `return` and `throw` of generator objects (D42) */
  GeneratorPrototype: Object
  /** `next`, `return` and `throw` of async generator objects (D53) */
  AsyncGeneratorPrototype: Object
  /** global bindings */
  globals: Map<string, GlobalBinding>
}

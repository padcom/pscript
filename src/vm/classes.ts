// Class definition (§5.6.7): the CLASS instruction builds a sealed class with flattened member indexes,
// after the override/final checks (overrides.ts) and interface conformance (interfaces.ts).
import type {
  ClassFieldTemplate,
  ClassMemberRef,
  ClassMethodTemplate,
  ClassTemplate,
  FunctionProto,
} from '@/compiler/function-proto'
import type { ModuleRecord } from '@/modules/module-record'
import { kindOf } from '@/runtime/operators'
import { resolveImplicitNames } from './implicit'
import { checkInterfaces, implementInterfaces } from './interfaces'
import { overrideViolations } from './overrides'
import { typeError } from '@/runtime/script-error'
import {
  Accessor,
  Class,
  Closure,
  Function as ScriptFunction,
  Object as ScriptObject,
  PrivateKey,
  type Environment,
  type MemberEntry,
  type PrivateEntry,
  type Realm,
  type Value,
} from '@/runtime/values'

/**
 * What defining a class needs from the VM.
 */
export interface ClassHost {
  /** the realm */
  realm: Realm
  /** calls static initialisers */
  callFunction(fn: Value, thisValue: Value, args: Value[]): Value
  /** how a script binding or global is described in implicit-name ambiguities, or null when there is none (§4.5.8) */
  outerGlobal(name: string): string | null
}

/**
 * Where the CLASS instruction runs.
 */
export interface DefinitionSite {
  /** environment captured by the class's methods */
  env: Environment
  /** enclosing class (nested classes) */
  homeClass: Class | null
  /** constants of the running proto (method protos are referenced by index) */
  constants: unknown[]
  /** module of the running code (methods read its imports) */
  module: ModuleRecord | null
}

/**
 * What a class definition inherits from: the evaluated `extends` and `implements` expressions.
 */
export interface Heritage {
  /** the `extends` value (undefined without `extends`) */
  superClass: Value
  /** the `implements` values */
  interfaces: Value[]
}

function hasInChain(object: ScriptObject | null, key: string): boolean {
  for (let current = object; current; current = current.proto) {
    if (current.props.has(key)) return true
  }

  return false
}

/**
 * Whether instances of a class have a member (declared in the class chain or inherited from built-in prototypes).
 *
 * @param cls the class
 * @param name member name
 * @returns true when the member exists
 */
export function hasInstanceMember(cls: Class, name: string): boolean {
  return cls.memberIndex.has(name) || hasInChain(cls.prototype, name)
}

/**
 * Whether a class object has a static member (declared statics, inherited statics, function properties).
 *
 * @param cls the class
 * @param name member name
 * @returns true when the member exists
 */
export function hasStaticMember(cls: Class, name: string): boolean {
  return cls.staticMemberIndex.has(name) || name === 'name' || name === 'length' || hasInChain(cls.proto, name)
}

function describe(value: Value): string {
  return value instanceof ScriptFunction ? value.name || 'anonymous function' : kindOf(value)
}

function checkSuperClass(superClass: Value, template: ClassTemplate): Class | null {
  if (!template.hasSuper) return null
  if (!(superClass instanceof Class)) throw typeError(`Class extends value ${describe(superClass)} is not a class`)
  if (superClass.final) throw typeError(`Cannot extend final class '${superClass.name}'`)

  return superClass
}

// The host part of a class extending a host class is open: its members are only known at runtime (§5.8.1).
function extendsHostClass(cls: Class | null): boolean {
  let current = cls

  while (current && !current.host) current = current.superClass

  return current !== null
}

function hasMember(cls: Class, name: string, isStatic: boolean): boolean {
  if (extendsHostClass(cls)) return true

  return isStatic ? hasStaticMember(cls, name) : hasInstanceMember(cls, name)
}

// Without a constructor a base class takes no arguments; a derived one those of its superclass (D38).
function implicitLength(cls: Class): number {
  return cls.superClass ? cls.superClass.length : 0
}

function accessorHalves(entry: MemberEntry | undefined): Partial<MemberEntry> {
  if (entry?.kind !== 'accessor') return {}

  const { get, set, getAccess, setAccess } = entry

  return { get, set, getAccess, setAccess }
}

class ClassBuilder {
  readonly cls: Class

  constructor(private host: ClassHost, private template: ClassTemplate, superClass: Class | null, private site: DefinitionSite) {
    const prototype = new ScriptObject(superClass ? superClass.prototype : host.realm.ObjectPrototype)

    this.cls = new Class(host.realm.FunctionPrototype, template, superClass, prototype)
    this.cls.outerClass = site.homeClass
    this.cls.final = template.isFinal
    this.cls.memberIndex = new Map(superClass?.memberIndex)
    this.cls.staticMemberIndex = new Map(superClass?.staticMemberIndex)
  }

  closure(proto: FunctionProto, isStatic: boolean): Closure {
    const closure = new Closure(this.host.realm.FunctionPrototype, proto, this.site.env, this.site.module)

    closure.homeClass = this.cls
    closure.homeObject = isStatic ? this.cls : this.cls.prototype

    return closure
  }

  // Public and protected members go into the (inherited) member indexes, private ones into the class's own
  // private indexes (§5.6.7).
  members() {
    for (const method of this.template.methods) this.method(method)

    for (const field of this.template.fields) this.field(field)
  }

  private method(method: ClassMethodTemplate) {
    const fn = this.closure(this.site.constants[method.protoIndex] as FunctionProto, method.isStatic)

    if (method.access === 'private') this.privateMethod(method, fn)
    else if (method.kind === 'method') this.index(method.isStatic).set(method.key, this.entry(method, { kind: 'method', fn }))
    else this.accessor(method, fn)
  }

  private field({ key, access, isStatic, final }: ClassFieldTemplate) {
    const { cls } = this

    if (access === 'private') this.privates(isStatic).set(key, { kind: 'field', key: new PrivateKey(cls, key) })
    else this.index(isStatic).set(key, { kind: 'field', access, owner: cls, final })
  }

  private privateMethod(method: ClassMethodTemplate, fn: Closure) {
    const index = this.privates(method.isStatic)

    if (method.kind === 'method') index.set(method.key, { kind: 'method', fn })
    else index.set(method.key, { kind: 'accessor', ...index.get(method.key), [method.kind]: fn })
  }

  private privates(isStatic: boolean): Map<string, PrivateEntry> {
    return isStatic ? this.cls.staticPrivateIndex : this.cls.privateIndex
  }

  functions() {
    const { cls, template } = this

    cls.ctor = this.optionalClosure(template.constructor)
    cls.fieldInit = this.optionalClosure(template.instanceFieldInit)
    cls.length = cls.ctor ? cls.ctor.length : implicitLength(cls)
  }

  private optionalClosure(proto: FunctionProto | null): Closure | null {
    return proto && this.closure(proto, false)
  }

  // Unproven `this.x` references (§4.5.9) must exist once the whole chain is known.
  memberRefViolations(): string[] {
    const { cls } = this
    const missing = this.template.memberRefs.filter(ref => !hasMember(cls, ref.name, ref.isStatic))
    const where = (ref: ClassMemberRef) => `${ref.loc.start.line}:${ref.loc.start.column}`

    return missing.map(ref => `Class '${cls.name}' has no member '${ref.name}' (${where(ref)})`)
  }

  // The name is visible to static initialisers; the class is sealed (D29) before they run.
  finish() {
    const { cls, template, site } = this

    if (template.bindsName) site.env.slots[0] = cls
    cls.extensible = false

    if (template.staticInit) this.host.callFunction(this.closure(template.staticInit, true), cls, [])
  }

  private entry(member: ClassMethodTemplate, parts: Partial<MemberEntry> & Pick<MemberEntry, 'kind'>): MemberEntry {
    return { access: member.access, owner: this.cls, final: member.final, ...parts }
  }

  // A get/set pair combines into one accessor; an inherited half the class does not redefine stays in effect (§4.5.6).
  // The halves may differ in access (C# style): each keeps its own.
  private accessor(method: ClassMethodTemplate, fn: Closure) {
    const index = this.index(method.isStatic)
    const halves = accessorHalves(index.get(method.key))

    const half = { [method.kind]: fn, [`${method.kind}Access`]: method.access }

    index.set(method.key, this.entry(method, { kind: 'accessor', ...halves, ...half }))
  }

  private index(isStatic: boolean): Map<string, MemberEntry> {
    return isStatic ? this.cls.staticMemberIndex : this.cls.memberIndex
  }
}

/**
 * `CLASS`: builds a class from its template (§5.6.7).
 *
 * @param host the VM
 * @param template the class template
 * @param heritage the evaluated `extends` value (ignored when the class has none) and `implements` values
 * @param site where the class is defined
 * @returns the class
 */
export function defineClass(host: ClassHost, template: ClassTemplate, heritage: Heritage, site: DefinitionSite): Class {
  const parent = checkSuperClass(heritage.superClass, template)
  const interfaces = checkInterfaces(heritage.interfaces)
  const builder = new ClassBuilder(host, template, parent, site)
  const violations = overrideViolations(template, { realm: host.realm, superClass: parent, constants: site.constants })

  builder.members()
  builder.functions()
  violations.push(...builder.memberRefViolations(), ...resolveImplicitNames(builder.cls, name => host.outerGlobal(name)))
  violations.push(...implementInterfaces(builder.cls, interfaces))

  // All violations of one class definition are reported together (§5.6.7).
  if (violations.length > 0) throw typeError(violations.join('; '))
  builder.finish()

  return builder.cls
}

function inherited(object: ScriptObject | null, key: string): [Value] | null {
  for (let current = object; current; current = current.proto) {
    if (current.props.has(key)) return [current.props.get(key) as Value]
  }

  return null
}

// Without a superclass, `super` reaches the built-in prototypes (Object.prototype / Function.prototype).
function accessorOf({ get, set }: MemberEntry): Accessor {
  return new Accessor(get ?? null, set ?? null)
}

// A superclass member: a method's function, or an accessor (its getter is called with the current `this`).
function memberFound(entry: MemberEntry | undefined): [Value | Accessor] | null {
  if (!entry || entry.kind === 'field') return null

  return [entry.kind === 'accessor' ? accessorOf(entry) : entry.fn as Value]
}

function superStatic(realm: Realm, parent: Class | null, key: string): [Value | Accessor] | null {
  if (!parent) return inherited(realm.FunctionPrototype, key)

  return memberFound(parent.staticMemberIndex.get(key)) ?? inherited(parent, key)
}

function superInstance(realm: Realm, parent: Class | null, key: string): [Value | Accessor] | null {
  if (!parent) return inherited(realm.ObjectPrototype, key)

  return memberFound(parent.memberIndex.get(key)) ?? inherited(parent.prototype, key)
}

/**
 * `super.key` (GET_SUPER): a method (or built-in member) of the home class's superclass.
 *
 * @param realm the realm
 * @param home the class whose method runs
 * @param key member name
 * @param isStatic static context (statics of the superclass)
 * @returns the member's value
 */
export function superMember(realm: Realm, home: Class, key: string, isStatic: boolean): Value | Accessor {
  const found = (isStatic ? superStatic : superInstance)(realm, home.superClass, key)
  if (!found) throw typeError(`'super' has no member '${key}' (class '${home.name}')`)

  return found[0]
}

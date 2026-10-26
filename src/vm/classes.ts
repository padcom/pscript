// Class definition (§5.6.7): the CLASS instruction builds a sealed class with flattened member indexes.
// Override/final checks (M18), access modifiers (M17), accessors (M16) and interfaces (M19) build on this.
import type { ClassMemberRef, ClassTemplate, FunctionProto } from '@/compiler/function-proto'
import { kindOf } from '@/runtime/operators'
import { typeError } from '@/runtime/script-error'
import {
  Class,
  Closure,
  Function as ScriptFunction,
  Object as ScriptObject,
  type Environment,
  type MemberEntry,
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

  return superClass
}

function hasMember(cls: Class, name: string, isStatic: boolean): boolean {
  return isStatic ? hasStaticMember(cls, name) : hasInstanceMember(cls, name)
}

// Without a constructor a base class takes no arguments; a derived one those of its superclass (D38).
function implicitLength(cls: Class): number {
  return cls.superClass ? cls.superClass.length : 0
}

class ClassBuilder {
  readonly cls: Class

  constructor(private host: ClassHost, private template: ClassTemplate, superClass: Class | null, private site: DefinitionSite) {
    const prototype = new ScriptObject(superClass ? superClass.prototype : host.realm.ObjectPrototype)

    this.cls = new Class(host.realm.FunctionPrototype, template, superClass, prototype)
    this.cls.outerClass = site.homeClass
    this.cls.memberIndex = new Map(superClass?.memberIndex)
    this.cls.staticMemberIndex = new Map(superClass?.staticMemberIndex)
  }

  closure(proto: FunctionProto, isStatic: boolean): Closure {
    const closure = new Closure(this.host.realm.FunctionPrototype, proto, this.site.env, null)

    closure.homeClass = this.cls
    closure.homeObject = isStatic ? this.cls : this.cls.prototype

    return closure
  }

  members() {
    const { cls, template, site } = this

    for (const method of template.methods) {
      const fn = this.closure(site.constants[method.protoIndex] as FunctionProto, method.isStatic)

      this.index(method.isStatic).set(method.key, { kind: 'method', access: method.access, owner: cls, final: method.final, fn })
    }

    for (const field of template.fields) {
      this.index(field.isStatic).set(field.key, { kind: 'field', access: field.access, owner: cls, final: field.final })
    }
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
  checkMemberRefs() {
    const { cls } = this
    const missing = this.template.memberRefs.filter(ref => !hasMember(cls, ref.name, ref.isStatic))
    if (missing.length === 0) return

    const where = (ref: ClassMemberRef) => `${ref.loc.start.line}:${ref.loc.start.column}`

    throw typeError(missing.map(ref => `Class '${cls.name}' has no member '${ref.name}' (${where(ref)})`).join('; '))
  }

  // The name is visible to static initialisers; the class is sealed (D29) before they run.
  finish() {
    const { cls, template, site } = this

    if (template.bindsName) site.env.slots[0] = cls
    cls.extensible = false

    if (template.staticInit) this.host.callFunction(this.closure(template.staticInit, true), cls, [])
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
 * @param superClass the evaluated `extends` value (ignored when the class has none)
 * @param site where the class is defined
 * @returns the class
 */
export function defineClass(host: ClassHost, template: ClassTemplate, superClass: Value, site: DefinitionSite): Class {
  const builder = new ClassBuilder(host, template, checkSuperClass(superClass, template), site)

  builder.members()
  builder.functions()
  builder.checkMemberRefs()
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
function superStatic(realm: Realm, parent: Class | null, key: string): [Value] | null {
  if (!parent) return inherited(realm.FunctionPrototype, key)

  const entry = parent.staticMemberIndex.get(key)

  return entry?.fn ? [entry.fn] : inherited(parent, key)
}

function superInstance(realm: Realm, parent: Class | null, key: string): [Value] | null {
  if (!parent) return inherited(realm.ObjectPrototype, key)

  const entry = parent.memberIndex.get(key)

  return entry?.fn ? [entry.fn] : inherited(parent.prototype, key)
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
export function superMember(realm: Realm, home: Class, key: string, isStatic: boolean): Value {
  const found = (isStatic ? superStatic : superInstance)(realm, home.superClass, key)
  if (!found) throw typeError(`'super' has no member '${key}' (class '${home.name}')`)

  return found[0]
}

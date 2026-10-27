// Interfaces at runtime (§4.5.7): the INTERFACE instruction merges requirements with the parents', and CLASS
// checks that a class provides every requirement of the interfaces it lists through public members.
import type { FunctionProto, InterfaceMemberTemplate, InterfaceTemplate } from '@/compiler/function-proto'
import type { Access } from '@/parser/ast'
import { kindOf } from '@/runtime/operators'
import { typeError } from '@/runtime/script-error'
import {
  Closure,
  Function as ScriptFunction,
  Interface,
  type Class,
  type MemberEntry,
  type Object as ScriptObject,
  type Realm,
  type Value,
} from '@/runtime/values'

type Requirement = InterfaceMemberTemplate

function describe(value: Value): string {
  return value instanceof ScriptFunction ? value.name || 'anonymous function' : kindOf(value)
}

function checkInterface(value: Value, what: string): Interface {
  if (!(value instanceof Interface)) throw typeError(`${what} value ${describe(value)} is not an interface`)

  return value
}

type Property = Exclude<Requirement['kind'], 'method'>

const CAPABILITIES: Record<Property, string[]> = { get: ['read'], set: ['write'], property: ['read', 'write'] }
const BY_CAPABILITIES: Record<string, Property> = { 'read': 'get', 'write': 'set', 'read,write': 'property' }
const SUFFIXES: Partial<Record<Requirement['kind'], string>> = { get: ' (getter)', set: ' (setter)' }

// Readable / writable requirements merge: `get x` + `set x` is the property `x`.
function mergeProperties(a: Requirement, b: Requirement): Requirement {
  const capabilities = new Set([...CAPABILITIES[a.kind as Property], ...CAPABILITIES[b.kind as Property]])
  const kind = BY_CAPABILITIES[['read', 'write'].filter(capability => capabilities.has(capability)).join(',')]

  return { ...a, kind, description: a.key + (SUFFIXES[kind] ?? '') }
}

function sameMethod(a: Requirement, b: Requirement): boolean {
  return a.paramCount === b.paramCount && a.hasRest === b.hasRest
}

// The merged requirement, or null when the two cannot both hold (a method and a property, different arities).
function merge(a: Requirement, b: Requirement): Requirement | null {
  const methods = [a, b].filter(requirement => requirement.kind === 'method').length
  if (methods === 0) return mergeProperties(a, b)

  return methods === 2 && sameMethod(a, b) ? a : null
}

function quoted(names: string[]): string {
  return [...new Set(names)].map(name => `'${name}'`).join(', ')
}

class InterfaceBuilder {
  readonly iface: Interface
  private conflicts: string[] = []

  constructor(realm: Realm, template: InterfaceTemplate, parents: Interface[]) {
    this.iface = new Interface(realm.ObjectPrototype, template.name, parents)
  }

  add(requirement: Requirement) {
    const { members } = this.iface
    const existing = members.get(requirement.key)
    const merged = existing ? merge(existing, requirement) : requirement

    if (merged) members.set(requirement.key, merged)
    else this.conflicts.push(requirement.key)
  }

  finish(): Interface {
    const { iface, conflicts } = this
    if (conflicts.length > 0) throw typeError(`Interface '${iface.name}' has conflicting requirements for ${quoted(conflicts)}`)

    for (const parent of iface.parents) parent.ancestors.forEach(ancestor => iface.ancestors.add(ancestor))
    iface.frozen = true

    return iface
  }
}

/**
 * `INTERFACE k n` (§4.5.7): builds an interface from its template and parents; requirements inherited from
 * several parents must agree.
 *
 * @param realm the realm
 * @param template the interface template
 * @param parents the evaluated `extends` values
 * @returns the interface
 */
export function defineInterface(realm: Realm, template: InterfaceTemplate, parents: Value[]): Interface {
  const builder = new InterfaceBuilder(realm, template, parents.map(parent => checkInterface(parent, 'Interface extends')))

  for (const parent of builder.iface.parents) parent.members.forEach(requirement => builder.add(requirement))

  for (const requirement of template.members) builder.add(requirement)

  return builder.finish()
}

/**
 * Checks the `implements` values of a class definition.
 *
 * @param values the evaluated `implements` values
 * @returns the interfaces
 */
export function checkInterfaces(values: Value[]): Interface[] {
  return values.map(value => checkInterface(value, 'Class implements'))
}

function accessorHalfAccess(entry: MemberEntry, half: 'get' | 'set'): Access | null {
  return entry[half] ? entry[`${half}Access`] ?? entry.access : null
}

function halfAccess(entry: MemberEntry, half: 'get' | 'set'): Access | null {
  if (entry.kind === 'field') return entry.access

  return entry.kind === 'accessor' ? accessorHalfAccess(entry, half) : null
}

// A public field, or a public getter / setter.
function isPublic(entry: MemberEntry | undefined, half: 'get' | 'set'): boolean {
  return entry !== undefined && halfAccess(entry, half) === 'public'
}

function publicMethod(entry: MemberEntry): FunctionProto | null {
  const isMethod = entry.kind === 'method' && entry.access === 'public'

  return isMethod && entry.fn instanceof Closure ? entry.fn.fnProto : null
}

// Exactly the required parameters, no optional ones (D38); a rest parameter only when the interface has one.
function sameArity(proto: FunctionProto, requirement: Requirement): boolean {
  return proto.length === proto.paramCount && proto.paramCount === requirement.paramCount && proto.hasRest === requirement.hasRest
}

// Methods of built-in prototypes (Object.prototype.toString) count, whatever their arity.
function builtinMethod(prototype: ScriptObject, key: string): boolean {
  for (let current: ScriptObject | null = prototype; current; current = current.proto) {
    if (current.props.has(key)) return current.props.get(key) instanceof ScriptFunction
  }

  return false
}

function providesMethod(cls: Class, requirement: Requirement): boolean {
  const entry = cls.memberIndex.get(requirement.key)
  if (!entry) return builtinMethod(cls.prototype, requirement.key)

  const proto = publicMethod(entry)

  return proto !== null && sameArity(proto, requirement)
}

const PROVIDES: Record<Requirement['kind'], (cls: Class, requirement: Requirement) => boolean> = {
  method: providesMethod,
  get: (cls, { key }) => isPublic(cls.memberIndex.get(key), 'get'),
  set: (cls, { key }) => isPublic(cls.memberIndex.get(key), 'set'),
  property: (cls, { key }) => isPublic(cls.memberIndex.get(key), 'get') && isPublic(cls.memberIndex.get(key), 'set'),
}

/**
 * Records the interfaces of a class (its superclass's and the listed ones, with their ancestors) and checks that
 * the class provides every requirement of the listed interfaces (§5.6.7 step 5).
 *
 * @param cls the class, with its member index built
 * @param interfaces the listed interfaces
 * @returns one violation per interface the class does not fully implement
 */
export function implementInterfaces(cls: Class, interfaces: Interface[]): string[] {
  cls.superClass?.interfaces.forEach(iface => cls.interfaces.add(iface))

  for (const iface of interfaces) iface.ancestors.forEach(ancestor => cls.interfaces.add(ancestor))

  return interfaces.flatMap(iface => {
    const missing = [...iface.members.values()].filter(requirement => !PROVIDES[requirement.kind](cls, requirement))
    const list = missing.map(requirement => requirement.description).join(', ')

    return missing.length > 0 ? [`Class '${cls.name || 'anonymous'}' does not implement ${iface.name}: ${list}`] : []
  })
}

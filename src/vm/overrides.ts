// Override and `final` checks (§4.5.6, D28), run by CLASS against the superclass before the new class's members
// are installed. Private members never participate: they are not inherited.
import type { ClassFieldTemplate, ClassMethodTemplate, ClassTemplate, FunctionProto } from '@/compiler/function-proto'
import type { Access } from '@/parser/ast'
import {
  Accessor,
  Closure,
  Function as ScriptFunction,
  type Class,
  type MemberEntry,
  type Object as ScriptObject,
  type Realm,
  type Value,
} from '@/runtime/values'

type Member = ClassMethodTemplate | ClassFieldTemplate

type Kind = MemberEntry['kind']

/**
 * What a member would override.
 */
interface Inherited {
  /** member kind */
  kind: Kind
  /** name of the class (or built-in prototype) that declares it */
  owner: string
  /** `final` member */
  final: boolean
  /** access of the member (of the matching half, for accessors) */
  access: Access
  /** the half of an accessor the member redefines exists (always true for other kinds) */
  hasHalf: boolean
  /** methods declared in script: their proto (signature check) */
  proto?: FunctionProto
}

/**
 * What a member is checked against.
 */
interface Context {
  /** the realm (built-in prototypes) */
  realm: Realm
  /** the superclass, or null */
  superClass: Class | null
  /** constants of the running proto (method protos) */
  constants: unknown[]
}

const KINDS: Record<ClassMethodTemplate['kind'], Kind> = { method: 'method', get: 'accessor', set: 'accessor' }

function kindOf(member: Member): Kind {
  return 'kind' in member ? KINDS[member.kind] : 'field'
}

function half(member: Member): 'get' | 'set' | null {
  return 'kind' in member && member.kind !== 'method' ? member.kind : null
}

function halfAccess(entry: MemberEntry, which: 'get' | 'set' | null): Access {
  if (which === null) return entry.access

  return (which === 'get' ? entry.getAccess : entry.setAccess) ?? entry.access
}

function hasHalf(entry: MemberEntry, which: 'get' | 'set' | null): boolean {
  return which === null || entry.kind !== 'accessor' || Boolean(entry[which])
}

function fromEntry(entry: MemberEntry, member: Member): Inherited {
  const which = half(member)
  const proto = entry.fn instanceof Closure ? entry.fn.fnProto : undefined

  return {
    kind: entry.kind,
    owner: entry.owner.name,
    final: entry.final,
    access: halfAccess(entry, which),
    hasHalf: hasHalf(entry, which),
    proto,
  }
}

function builtinKind(value: Value | Accessor): Kind {
  if (value instanceof Accessor) return 'accessor'

  return value instanceof ScriptFunction ? 'method' : 'field'
}

function builtin(value: Value | Accessor, owner: string): Inherited {
  return { kind: builtinKind(value), owner, final: false, access: 'public', hasHalf: true }
}

// A data property or native method of a built-in prototype (`Object.prototype.toString`, `Error`'s `name`).
function inPrototype(object: ScriptObject, key: string, owner: string): Inherited | null {
  for (let current: ScriptObject | null = object; current; current = current.proto) {
    if (current.props.has(key)) return builtin(current.props.get(key) as Value | Accessor, owner)
  }

  return null
}

function hostMember(value: unknown, owner: string): Inherited {
  return { kind: typeof value === 'function' ? 'method' : 'field', owner, final: false, access: 'public', hasHalf: true }
}

// A member of a class's prototype: built-in data and methods, or what a host class's prototype has (§4.5.6).
function prototypeMember(cls: Class, key: string): Inherited | null {
  if (cls.prototype.props.has(key)) return builtin(cls.prototype.props.get(key) as Value, cls.name)

  return cls.host && key in cls.host.prototype ? hostMember(cls.host.prototype[key], cls.name) : null
}

function builtinInstanceMember({ realm, superClass }: Context, key: string): Inherited | null {
  for (let cls = superClass; cls; cls = cls.superClass) {
    const found = prototypeMember(cls, key)
    if (found) return found
  }

  return inPrototype(realm.ObjectPrototype, key, 'Object')
}

function memberIndex({ superClass }: Context, isStatic: boolean): Map<string, MemberEntry> | undefined {
  return isStatic ? superClass?.staticMemberIndex : superClass?.memberIndex
}

function builtinMember(context: Context, member: Member): Inherited | null {
  if (!member.isStatic) return builtinInstanceMember(context, member.key)

  return inPrototype(context.realm.FunctionPrototype, member.key, 'Function')
}

function inheritedMember(context: Context, member: Member): Inherited | null {
  const entry = memberIndex(context, member.isStatic)?.get(member.key)

  return entry ? fromEntry(entry, member) : builtinMember(context, member)
}

function article(kind: Kind): string {
  return kind === 'accessor' ? 'an' : 'a'
}

function protoOf(context: Context, member: Member): FunctionProto | null {
  return 'protoIndex' in member && member.kind === 'method' ? context.constants[member.protoIndex] as FunctionProto : null
}

function sameSignature(a: FunctionProto, b: FunctionProto): boolean {
  return a.length === b.length && a.paramCount === b.paramCount && a.hasRest === b.hasRest
}

// Overrides keep the signature (D38).
function signatureViolation(context: Context, member: Member, inherited: Inherited): string | null {
  const proto = protoOf(context, member)
  if (!proto || !inherited.proto || sameSignature(proto, inherited.proto)) return null

  return `Override '${proto.signature}' must keep the signature of '${inherited.owner}.${inherited.proto.signature}'`
}

type Check = (member: Member, inherited: Inherited) => string | null

const CHECKS: Check[] = [
  (member, { final, kind, owner }) => final ? `Cannot override final ${kind} '${member.key}' of class '${owner}'` : null,
  (member, inherited) => member.override || !inherited.hasHalf
    ? null
    : `'${member.key}' overrides '${inherited.owner}.${member.key}' and must be marked 'override'`,
  (member, { kind }) => {
    const own = kindOf(member)

    return own === kind ? null : `Cannot override ${kind} '${member.key}' with ${article(own)} ${own}`
  },
  (member, { access }) => member.access === access
    ? null
    : `cannot change access of '${member.key}' from ${access} to ${member.access}`,
]

function superName({ superClass }: Context): string {
  return superClass ? superClass.name : 'Object'
}

function overrideProblem(member: Member, inherited: Inherited): string | null {
  for (const check of CHECKS) {
    const problem = check(member, inherited)
    if (problem) return problem
  }

  return null
}

function violation(context: Context, member: Member): string | null {
  const inherited = inheritedMember(context, member)
  if (!inherited) return member.override ? `'${member.key}' does not override anything in '${superName(context)}'` : null

  return overrideProblem(member, inherited) ?? signatureViolation(context, member, inherited)
}

function located(message: string, { loc }: Member): string {
  return `${message} (${loc.start.line}:${loc.start.column})`
}

/**
 * Checks every public and protected member of a class template against what it inherits (§4.5.6).
 *
 * @param template the class template
 * @param context the realm, the superclass and the constants holding the method protos
 * @returns the violations, each with its source location
 */
export function overrideViolations(template: ClassTemplate, context: Context): string[] {
  const members: Member[] = [...template.methods, ...template.fields].filter(member => member.access !== 'private')

  return members.flatMap(member => {
    const problem = violation(context, member)

    return problem ? [located(problem, member)] : []
  })
}

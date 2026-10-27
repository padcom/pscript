// What psc needs to know about classes besides `class-info.ts` (P7): private names, accessor halves, ambiguity.
import { keyName, type ClassInfo } from '@/compiler/class-info'
import type {
  ClassDeclaration,
  ClassExpression,
  Identifier,
  MemberExpression,
  MethodDefinition,
  PropertyDefinition,
} from '@/parser/ast'

export type ClassNode = ClassDeclaration | ClassExpression

type Member = MethodDefinition | PropertyDefinition

type Accessor = MethodDefinition & { kind: 'get' | 'set' }

const HALVES = new Set(['get', 'set'])

const OTHER_HALF = { get: 'set', set: 'get' } as const

function stringKey(property: MemberExpression['property']): string | null {
  return property.type === 'Literal' && typeof property.value === 'string' ? property.value : null
}

/**
 * The name of `o.x` or `o['x']` that may be private; null for other computed keys and `super.x`.
 *
 * @param node the member expression
 * @returns the name, or null
 */
export function privateKey(node: MemberExpression): string | null {
  if (node.object.type === 'Super') return null

  return node.computed ? stringKey(node.property) : (node.property as Identifier).name
}

/**
 * A private name for a member that differs from the enclosing classes' private names (JS private names shadow).
 *
 * @param name the member name
 * @param taken the JS private names of the enclosing classes
 * @returns `#x`, or `#x$2` …
 */
export function uniquePrivateName(name: string, taken: Set<string>): string {
  let jsName = `#${name}`

  for (let i = 2; taken.has(jsName); i++) jsName = `#${name}$${i}`

  return jsName
}

function declares(cls: ClassInfo, name: string): boolean {
  return cls.instance.has(name) || cls.statics.has(name)
}

/**
 * The name of the superclass that declares an inherited member.
 *
 * @param info the class
 * @param name the member, known to be inherited
 * @returns the superclass's name
 */
export function declaringClass(info: ClassInfo, name: string): string {
  let cls = info.superClass as ClassInfo

  while (!declares(cls, name)) cls = cls.superClass as ClassInfo

  return cls.name || 'anonymous'
}

/**
 * `static ` for static members.
 *
 * @param member the member
 * @returns the prefix
 */
export function staticPrefix(member: Member): string {
  return member.static ? 'static ' : ''
}

function isPublicAccessor(member: Member): member is Accessor {
  return member.type === 'MethodDefinition' && HALVES.has(member.kind) && member.access !== 'private'
}

function sameMember(a: Member, b: Member): boolean {
  return a.static === b.static && keyName(a.key) === keyName(b.key)
}

function declaredIn(node: ClassNode | undefined, member: Member): Member[] {
  return node ? node.body.body.filter(candidate => sameMember(candidate, member)) : []
}

// Whether the nearest superclass declaring the member has the accessor's other half.
function inheritsOtherHalf(info: ClassInfo, member: Accessor, classNodes: Map<ClassInfo, ClassNode>): boolean {
  const half = OTHER_HALF[member.kind]

  for (let cls = info.superClass; cls; cls = cls.superClass) {
    const declared = declaredIn(classNodes.get(cls), member)
    if (declared.length > 0) return declared.some(candidate => isPublicAccessor(candidate) && candidate.kind === half)
  }

  return false
}

// `set x(value) { super.x = value; }` or `get x() { return super.x; }`.
function forwardingHalf(member: Accessor): string {
  const { key } = member
  const [name, target] = key.type === 'Identifier' ? [key.name, `super.${key.name}`] : [key.raw, `super[${key.raw}]`]
  const prefix = staticPrefix(member)

  if (member.kind === 'set') return `${prefix}get ${name}() { return ${target}; }`

  return `${prefix}set ${name}(value) { ${target} = value; }`
}

/**
 * Accessor halves are inherited separately (§4.5.4): a class that redefines only the getter keeps the inherited
 * setter, so JS needs a forwarding setter (and vice versa). Only visible superclasses are known.
 *
 * @param node the class
 * @param info what the compiler knows about it
 * @param classNodes the classes the emitter has seen
 * @returns the forwarding accessors to add
 */
export function inheritedHalves(node: ClassNode, info: ClassInfo, classNodes: Map<ClassInfo, ClassNode>): string[] {
  const own = node.body.body.filter(isPublicAccessor)
  const hasOwnOther = (member: Accessor) => own.some(other => other.kind === OTHER_HALF[member.kind] && sameMember(other, member))

  return own.filter(member => !hasOwnOther(member) && inheritsOtherHalf(info, member, classNodes)).map(forwardingHalf)
}

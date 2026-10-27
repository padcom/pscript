// What the compiler knows about classes (§4.5.9): member names per class, so that `this.x` and
// `C.x` can be rejected at compile time when the whole class chain is visible.
import type { Access, ClassDeclaration, ClassExpression, MemberKey, MethodDefinition, PropertyDefinition } from '@/parser/ast'
import { memberKeyName } from '@/parser/symbol-keys'

/**
 * Compile-time view of a class.
 */
export interface ClassInfo {
  /** class name */
  name: string
  /** own instance member names (fields, methods) */
  instance: Set<string>
  /** own static member names */
  statics: Set<string>
  /** the superclass, when it is a class known to the compiler */
  superClass: ClassInfo | null
  /** whether every class in the chain is known (members can be proven absent) */
  visible: boolean
  /** names of private members (instance or static), resolved first inside the class (§4.5.3) */
  privates: Set<string>
  /** `abstract class` (D58): `new` is an error */
  abstract: boolean
  /** access of the constructor (D60): `new` of a non-public one only inside the class */
  constructorAccess: Access
}

/** Inherited by every class instance from Object.prototype. */
const INSTANCE_BUILTINS = new Set(['toString', 'hasOwnProperty'])

/** Every class object has these (Function.prototype and the function properties). */
const STATIC_BUILTINS = new Set(['name', 'length', 'toString', 'bind', 'call', 'apply'])

/**
 * The name of a class member or property key.
 *
 * @param key identifier or literal key
 * @returns the name
 */
export function keyName(key: MemberKey): string {
  return memberKeyName(key)
}

function isConstructor(member: MethodDefinition | PropertyDefinition): boolean {
  return member.type === 'MethodDefinition' && member.kind === 'constructor'
}

type ClassNode = ClassDeclaration | ClassExpression

function privateNames(node: ClassNode): Set<string> {
  return new Set(node.body.body.filter(member => member.access === 'private').map(member => keyName(member.key)))
}

function memberNames(node: ClassNode, isStatic: boolean): Set<string> {
  const members = node.body.body.filter(member => !isConstructor(member) && member.static === isStatic)

  return new Set(members.map(member => keyName(member.key)))
}

// The access of the class's constructor (D60): public when it has none.
function constructorAccessOf(node: ClassNode): Access {
  const constructor = node.body.body.find(member => member.type === 'MethodDefinition' && member.kind === 'constructor')

  return constructor ? constructor.access : 'public'
}

// The parts of the info that do not depend on the superclass.
function ownInfo(node: ClassNode, name: string) {
  const { abstract } = node

  return { name, instance: memberNames(node, false), statics: memberNames(node, true), privates: privateNames(node), abstract }
}

/**
 * Builds the compile-time view of a class.
 *
 * @param node the class
 * @param name its name
 * @param superClass the superclass's info; `undefined` when there is a superclass the compiler cannot see
 * @returns the class info
 */
export function classInfoOf(node: ClassNode, name: string, superClass: ClassInfo | null | undefined): ClassInfo {
  const visible = superClass === null || Boolean(superClass?.visible)

  return { ...ownInfo(node, name), superClass: superClass ?? null, visible, constructorAccess: constructorAccessOf(node) }
}

function declares(info: ClassInfo, name: string, isStatic: boolean): boolean {
  return (isStatic ? info.statics : info.instance).has(name)
}

function declaredInChain(info: ClassInfo, name: string, isStatic: boolean): boolean {
  let current: ClassInfo | null = info

  while (current && !declares(current, name, isStatic)) current = current.superClass

  return current !== null
}

/**
 * Whether a class (or its known chain) declares a member.
 *
 * @param info the class
 * @param name member name
 * @param isStatic static member (on the class) or instance member
 * @returns true when declared
 */
export function hasMember(info: ClassInfo, name: string, isStatic: boolean): boolean {
  return declaredInChain(info, name, isStatic) || (isStatic ? STATIC_BUILTINS : INSTANCE_BUILTINS).has(name)
}

/**
 * The message of a `new` that a private or protected constructor refuses (D60), the same at compile time and runtime.
 *
 * @param name the class name
 * @param access the constructor's access
 * @returns the message
 */
export function constructorAccessMessage(name: string, access: Access): string {
  return `Constructor of class '${name}' is ${access} and only accessible within the class`
}

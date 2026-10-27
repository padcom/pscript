// What the compiler knows about classes (§4.5.9): member names per class, so that `this.x` and
// `C.x` can be rejected at compile time when the whole class chain is visible.
import type { ClassDeclaration, ClassExpression, MemberKey, MethodDefinition, PropertyDefinition } from '@/parser/ast'
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
  const instance = memberNames(node, false)
  const statics = memberNames(node, true)

  return { name, instance, statics, superClass: superClass ?? null, visible, privates: privateNames(node) }
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

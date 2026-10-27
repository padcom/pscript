// Implicit member access (§4.5.8, D33): what the compiler knows about a bare name used in a class body.
import type { Binding, Scope } from './scope'
import type { ClassInfo } from './class-info'
import type { ImplicitName } from './function-proto'
import type { SourceLocation } from '@/parser/ast'

/**
 * A class body being compiled.
 */
export interface ClassRecord {
  /** what the compiler knows about the class */
  info: ClassInfo
  /** the scope around the class body: where outside definitions are resolved */
  scope: Scope
  /** the member being compiled is static */
  isStatic: boolean
  /** bare names that may be members, in first-use order (the class template's `implicitNames`) */
  implicitNames: ImplicitName[]
}

/** The class and the (static or instance) context a bare name is used in. */
export type MemberContext = Pick<ClassRecord, 'info' | 'isStatic'>

/** Whether a bare name may be a member: own member, member of a visible superclass, none, or not known yet. */
export type MemberCandidate = 'own' | 'inherited' | 'none' | 'unknown'

function declaresInContext(info: ClassInfo, name: string, isStatic: boolean): boolean {
  return (isStatic ? info.statics : info.instance).has(name)
}

// In a static context an instance member is a candidate too: using it is an error (§4.5.8), not an outer name.
function declaresOwn(info: ClassInfo, name: string): boolean {
  return info.instance.has(name) || info.statics.has(name)
}

// Superclasses' private members are not candidates.
function inherits(info: ClassInfo, name: string, isStatic: boolean): boolean {
  for (let cls = info.superClass; cls; cls = cls.superClass) {
    if (declaresInContext(cls, name, isStatic) && !cls.privates.has(name)) return true
  }

  return false
}

function ownsMember({ info, isStatic }: MemberContext, name: string): boolean {
  return isStatic ? declaresOwn(info, name) : info.instance.has(name)
}

function inheritsMember({ info, isStatic }: MemberContext, name: string): boolean {
  return inherits(info, name, isStatic) || (isStatic && inherits(info, name, false))
}

/**
 * Classifies a bare name against the members the compiler can see.
 *
 * @param record the class body
 * @param name the bare name
 * @returns how the name relates to the class's members
 */
export function memberCandidate(record: MemberContext, name: string): MemberCandidate {
  if (ownsMember(record, name)) return 'own'
  if (inheritsMember(record, name)) return 'inherited'

  return record.info.visible ? 'none' : 'unknown'
}

/**
 * Records a use of an implicit name.
 *
 * @param record the class body
 * @param name the name
 * @param outer where the name resolves when it is not a member
 * @param loc the use
 * @returns its index in the template's `implicitNames`
 */
export function implicitIndex(
  record: ClassRecord,
  name: string,
  outer: ImplicitName['outer'],
  loc: SourceLocation,
): number {
  const context = record.isStatic ? 'static' : 'instance'
  let index = record.implicitNames.findIndex(entry => entry.name === name)

  if (index < 0) index = record.implicitNames.push({ name, outer, contexts: [], loc }) - 1

  const { contexts } = record.implicitNames[index]
  if (!contexts.includes(context)) contexts.push(context)

  return index
}

const OUTER_KINDS: Record<string, string> = {
  function: 'an outer function',
  const: 'an outer constant',
  let: 'an outer variable',
}

/**
 * How the ambiguity message names an outside definition.
 *
 * @param binding the outer binding, or undefined for a global
 * @returns e.g. `an outer function`
 */
export function outerDescription(binding: Binding | undefined): string {
  return binding ? OUTER_KINDS[binding.kind] ?? 'an outer binding' : 'a global'
}

/**
 * The strict rule's error message (§4.5.8).
 *
 * @param className the class
 * @param name the bare name
 * @param outer how the outside definition is described
 * @param inheritedFrom the class the member is inherited from, if it is not the class's own
 * @returns the message
 */
export function ambiguityMessage(className: string, name: string, outer: string, inheritedFrom?: string): string {
  const member = inheritedFrom ? `a member (inherited from '${inheritedFrom}')` : 'a member'
  const fix = outer === 'a global' ? `'globalThis.${name}' for the global` : 'rename the outer binding'

  return `Ambiguous name '${name}' in class '${className || 'anonymous'}': it is both ${member} and ${outer}. `
    + `Write 'this.${name}' for the member, or ${fix}.`
}

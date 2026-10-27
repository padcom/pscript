// Implicit member access at class definition (§4.5.8, §5.6.7 step 4b): decides, once per class, whether each bare
// name of the class body is a member, and reports the strict rule's ambiguities the compiler could not see
// (inherited members, host globals).
import { ambiguityMessage } from '@/compiler/implicit-names'
import type { ImplicitName } from '@/compiler/function-proto'
import type { Class, ImplicitEntry, ImplicitKind } from '@/runtime/values'

type Context = ImplicitName['contexts'][number]

function declaredOwner(cls: Class, name: string, isStatic: boolean): Class | null {
  const entry = (isStatic ? cls.staticMemberIndex : cls.memberIndex).get(name)

  return entry ? entry.owner : null
}

// The class declaring a member `name` usable implicitly: inherited public/protected ones, or the class's own private.
function ownerOf(cls: Class, name: string, isStatic: boolean): Class | null {
  const privates = isStatic ? cls.staticPrivateIndex : cls.privateIndex

  return declaredOwner(cls, name, isStatic) ?? (privates.has(name) ? cls : null)
}

function entryOf(cls: Class, name: string): ImplicitEntry {
  const instance = ownerOf(cls, name, false) !== null
  const staticKind: ImplicitKind = instance ? 'instance-only' : 'outer'

  return { instance: instance ? 'member' : 'outer', static: ownerOf(cls, name, true) ? 'member' : staticKind }
}

function nameOf({ name }: Class): string {
  return name || 'anonymous'
}

function inheritedFrom(cls: Class, name: string, context: Context): string | undefined {
  const owner = ownerOf(cls, name, context === 'static') ?? ownerOf(cls, name, false)

  return owner && owner !== cls ? nameOf(owner) : undefined
}

function ambiguity(cls: Class, implicitName: ImplicitName, context: Context, outer: string): string {
  const { name, loc } = implicitName
  const message = ambiguityMessage(cls.name, name, outer, inheritedFrom(cls, name, context))

  return `${message} (${loc.start.line}:${loc.start.column})`
}

/**
 * Builds the class's implicit-name table and returns the ambiguity violations.
 *
 * @param cls the class, with its member indexes built
 * @param outerGlobal how a script binding or global of that name is described, or null when there is none now
 * @returns violations, each with the location of the name's first use
 */
export function resolveImplicitNames(cls: Class, outerGlobal: (name: string) => string | null): string[] {
  const violations: string[] = []

  cls.implicitTable = cls.template.implicitNames.map(implicitName => {
    const entry = entryOf(cls, implicitName.name)
    const outer = implicitName.outer === 'lexical' ? 'an outer binding' : outerGlobal(implicitName.name)
    const ambiguous = implicitName.contexts.filter(context => outer !== null && entry[context] !== 'outer')

    violations.push(...ambiguous.slice(0, 1).map(context => ambiguity(cls, implicitName, context, outer as string)))

    return entry
  })

  return violations
}

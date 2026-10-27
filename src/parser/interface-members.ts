// Interface declarations (§4.5.7): requirements only — no modifiers, bodies, initialisers, defaults or duplicate names
// (a `get`/`set` pair is one requirement). Builds InterfaceDeclaration / InterfaceMember nodes.
import type {
  Expression,
  Identifier,
  InterfaceDeclaration,
  InterfaceMember,
  Literal,
  MemberKey,
  Pattern,
  SourceLocation,
} from './ast'
import { toLoc, type JisonLoc } from './ast-builders'
import type { Modifier } from './class-members'

/**
 * An interface member as parsed.
 */
export interface RawInterfaceMember {
  /** member kind */
  kind: InterfaceMember['kind']
  /** member name */
  key: MemberKey
  /** parameters */
  params: Pattern[]
  /** a body was written */
  body?: boolean
  /** an initialiser was written */
  initializer?: boolean
  /** location */
  loc: JisonLoc
}

type Fail = (reason: string, loc: JisonLoc) => never

type FailAt = (reason: string, loc: SourceLocation) => never

function keyName(key: Identifier | Literal): string {
  return key.type === 'Identifier' ? key.name : String(key.value)
}

function checkShape({ body, initializer, loc }: RawInterfaceMember, modifiers: Modifier[], fail: Fail) {
  if (modifiers.length > 0) fail('Interface members cannot have modifiers', modifiers[0].loc)
  if (body) fail('Interface members cannot have a body', loc)
  if (initializer) fail('Interface members cannot have an initializer', loc)
}

function plainParams(params: Pattern[], loc: JisonLoc, fail: Fail): Identifier[] {
  return params.map(param => {
    if (param.type === 'AssignmentPattern') fail('Interface methods cannot have default parameters', loc)

    return param.type === 'RestElement' ? param.argument : param as Identifier
  })
}

/**
 * Builds an interface member node.
 *
 * @param modifiers modifier keywords (always an error)
 * @param member the member as parsed
 * @param fail reports a syntax error
 * @returns the InterfaceMember
 */
export function interfaceMember(modifiers: Modifier[], member: RawInterfaceMember, fail: Fail): InterfaceMember {
  checkShape(member, modifiers, fail)

  const { kind, key, params, loc } = member
  const hasRest = params.at(-1)?.type === 'RestElement'

  if (key.type === 'MemberExpression') fail('Interface members cannot be named by a symbol', loc)

  const name = key as Identifier | Literal

  return { type: 'InterfaceMember', key: name, kind, params: plainParams(params, loc, fail), hasRest, loc: toLoc(loc) }
}

// A getter and a setter of the same name form one requirement; any other repeated name is an error.
function compatible(a: InterfaceMember, b: InterfaceMember): boolean {
  const kinds = new Set([a.kind, b.kind])

  return kinds.size === 2 && kinds.has('get') && kinds.has('set')
}

function checkDuplicates(members: InterfaceMember[], fail: FailAt) {
  const seen = new Map<string, InterfaceMember>()

  for (const member of members) {
    const name = keyName(member.key)
    const previous = seen.get(name)
    if (previous && !compatible(previous, member)) fail(`Duplicate interface member '${name}'`, member.loc)
    seen.set(name, member)
  }
}

/**
 * Builds an interface declaration node.
 *
 * @param head the interface name and its `extends` expressions
 * @param head.id the interface name
 * @param head.parents the `extends` expressions
 * @param members the members
 * @param loc location
 * @param fail reports a syntax error at a node
 * @returns the InterfaceDeclaration
 */
export function interfaceDeclaration(
  head: { id: Identifier, parents: Expression[] },
  members: InterfaceMember[],
  loc: JisonLoc,
  fail: FailAt,
): InterfaceDeclaration {
  checkDuplicates(members, fail)

  const parents = head.parents as InterfaceDeclaration['extends']

  return { type: 'InterfaceDeclaration', id: head.id, extends: parents, body: members, loc: toLoc(loc) }
}

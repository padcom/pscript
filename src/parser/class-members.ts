// Class members (§4.5.1): modifiers in a fixed order, `(public | private | protected)? static? final? override?`,
// and the constructor rules. Builds MethodDefinition / PropertyDefinition nodes.
import type {
  Access,
  BlockStatement,
  Expression,
  Identifier,
  Literal,
  MethodDefinition,
  Pattern,
  PropertyDefinition,
} from './ast'
import { toLoc, type JisonLoc } from './ast-builders'

/**
 * A modifier keyword as parsed.
 */
export interface Modifier {
  /** lower-case keyword */
  name: string
  /** location */
  loc: JisonLoc
}

/**
 * A class member before modifiers are applied.
 */
export type RawMember
  = { kind: 'method', key: Identifier | Literal, params: Pattern[], body: BlockStatement, loc: JisonLoc }
    | { kind: 'field', key: Identifier | Literal, value: Expression | null, loc: JisonLoc }

type Fail = (reason: string, loc: JisonLoc) => never

class ModifierError extends Error {
  constructor(message: string, readonly loc: JisonLoc) {
    super(message)
  }
}

const ORDER: Record<string, number> = { public: 0, protected: 0, private: 0, static: 1, final: 2, override: 3 }

/**
 * Applied modifiers of a member.
 */
interface Flags {
  /** access level */
  access: Access
  /** `static` */
  isStatic: boolean
  /** `final` */
  final: boolean
  /** `override` */
  override: boolean
}

function flags(modifiers: Modifier[], fail: Fail): Flags {
  modifiers.forEach((modifier, i) => {
    const previous = modifiers[i - 1]
    if (previous && ORDER[previous.name] >= ORDER[modifier.name]) {
      fail(`Modifier '${modifier.name}' cannot follow '${previous.name}'`, modifier.loc)
    }
  })

  const names = new Set(modifiers.map(modifier => modifier.name))
  const access = (['private', 'protected'] as const).find(name => names.has(name)) ?? 'public'

  return { access, isStatic: names.has('static'), final: names.has('final'), override: names.has('override') }
}

function keyName(key: Identifier | Literal): string {
  return key.type === 'Identifier' ? key.name : String(key.value)
}

// Private members are not inherited, so `override` / `final` make no sense on them (§4.5.6).
function checkPrivate({ access, final, override }: Flags, loc: JisonLoc, fail: Fail) {
  if (access !== 'private') return
  if (final) fail("Private members cannot be 'final'", loc)
  if (override) fail("Private members cannot be 'override'", loc)
}

function isConstructor(member: RawMember, { isStatic }: Flags): boolean {
  return member.kind === 'method' && !isStatic && keyName(member.key) === 'constructor'
}

type FieldMember = Extract<RawMember, { kind: 'field' }>

function field(member: FieldMember, { access, isStatic, final, override }: Flags, fail: Fail): PropertyDefinition {
  if (keyName(member.key) === 'constructor') fail("Classes may not have a field named 'constructor'", member.loc)

  const { key, value } = member
  const loc = toLoc(member.loc)

  return { type: 'PropertyDefinition', key, computed: false, value, static: isStatic, access, override, final, loc }
}

function method(member: Extract<RawMember, { kind: 'method' }>, applied: Flags, modifiers: Modifier[]): MethodDefinition {
  const constructor = isConstructor(member, applied)
  const loc = toLoc(member.loc)
  const { access, isStatic, final, override } = applied

  if (constructor && modifiers.length > 0) throw new ModifierError('Constructors cannot have modifiers', member.loc)

  return {
    type: 'MethodDefinition',
    key: member.key,
    computed: false,
    kind: constructor ? 'constructor' : 'method',
    static: isStatic,
    value: { type: 'FunctionExpression', id: null, params: member.params, body: member.body, loc },
    access,
    override,
    final,
    loc,
  }
}

/**
 * Builds a class member node from its modifiers.
 *
 * @param modifiers modifier keywords in source order
 * @param member the member
 * @param fail reports a syntax error
 * @returns the MethodDefinition or PropertyDefinition
 */
export function classMember(modifiers: Modifier[], member: RawMember, fail: Fail): MethodDefinition | PropertyDefinition {
  const applied = flags(modifiers, fail)

  checkPrivate(applied, member.loc, fail)

  try {
    return member.kind === 'field' ? field(member, applied, fail) : method(member, applied, modifiers)
  } catch (e) {
    if (e instanceof ModifierError) fail(e.message, e.loc)
    throw e
  }
}

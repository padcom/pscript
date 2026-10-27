// Class members (§4.5.1): modifiers in a fixed order, `(public | private | protected)? static? final? override?`,
// and the constructor rules. Builds MethodDefinition / PropertyDefinition nodes.
import type {
  Access,
  BlockStatement,
  Expression,
  FunctionExpression,
  Identifier,
  Literal,
  MemberKey,
  MethodDefinition,
  Pattern,
  PropertyDefinition,
  SourceLocation,
} from './ast'
import { toLoc, type JisonLoc } from './ast-builders'
import { memberKeyName } from './symbol-keys'

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
 * A method or accessor as the grammar collects it.
 */
interface MethodMember {
  /** method or accessor half */
  kind: 'method' | 'get' | 'set'
  /** member name */
  key: MemberKey
  /** formal parameters */
  params: Pattern[]
  /** body; null for an abstract member (D58) */
  body: BlockStatement | null
  /** location */
  loc: JisonLoc
  /** `*method()` (D42) */
  generator?: boolean
  /** `async method()` (D43) */
  async?: boolean
}

/**
 * A field as the grammar collects it.
 */
interface RawField {
  /** always a field */
  kind: 'field'
  /** field name */
  key: MemberKey
  /** initialiser */
  value: Expression | null
  /** location */
  loc: JisonLoc
}

/**
 * A class member before modifiers are applied.
 */
export type RawMember = MethodMember | RawField

type Fail = (reason: string, loc: JisonLoc) => never

class ModifierError extends Error {
  constructor(message: string, readonly loc: JisonLoc) {
    super(message)
  }
}

const ORDER: Record<string, number> = { public: 0, protected: 0, private: 0, static: 1, final: 2, abstract: 2, override: 3 }

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
  /** `abstract` (D58) */
  abstract: boolean
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

  const has = (name: string) => names.has(name)

  return { access, isStatic: has('static'), final: has('final'), override: has('override'), abstract: has('abstract') }
}

/** A member's problem by its kind (field or method with or without a body) and whether it is abstract (D58). */
const BODY_PROBLEMS: Record<string, string> = {
  'field abstract': 'Fields cannot be abstract',
  'body abstract': 'Abstract methods cannot have a body',
  'no-body concrete': 'Only abstract methods can omit their body',
}

function shape(member: RawMember): string {
  if (member.kind === 'field') return 'field'

  return member.body ? 'body' : 'no-body'
}

function bodyProblem(member: RawMember, abstract: boolean): string | null {
  return BODY_PROBLEMS[`${shape(member)} ${abstract ? 'abstract' : 'concrete'}`] ?? null
}

// An abstract member is not static or private (D58).
function modifierProblem({ abstract, isStatic, access }: Flags): string | null {
  if (!abstract) return null

  return isStatic || access === 'private' ? 'Abstract members cannot be static or private' : null
}

function abstractProblem(member: RawMember, applied: Flags): string | null {
  return bodyProblem(member, applied.abstract) ?? modifierProblem(applied)
}

function checkAbstract(member: RawMember, applied: Flags, fail: Fail) {
  const problem = abstractProblem(member, applied)
  if (problem) fail(problem, member.loc)
}

// `[Symbol.iterator]` names methods only (D57).
function checkSymbolName({ key, kind, loc }: RawMember, fail: Fail) {
  if (key.type === 'MemberExpression' && kind !== 'method') fail('Only methods can be named by a symbol', loc)
}

// Private members are not inherited, so `override` / `final` make no sense on them (§4.5.6).
function checkPrivate({ access, final, override }: Flags, loc: JisonLoc, fail: Fail) {
  if (access !== 'private') return
  if (final) fail("Private members cannot be 'final'", loc)
  if (override) fail("Private members cannot be 'override'", loc)
}

function namesConstructor(member: RawMember, { isStatic }: Flags): boolean {
  return !isStatic && memberKeyName(member.key) === 'constructor'
}

// What a constructor may not be (as in JS).
function constructorProblem({ kind, generator, async }: Exclude<RawMember, { kind: 'field' }>): string | null {
  if (kind !== 'method') return 'Class constructor may not be an accessor'
  if (generator) return 'Class constructor may not be a generator'

  return async ? 'Class constructor may not be an async method' : null
}

function isConstructor(member: Exclude<RawMember, { kind: 'field' }>, applied: Flags): boolean {
  const named = namesConstructor(member, applied)
  const problem = named ? constructorProblem(member) : null
  if (problem) throw new ModifierError(problem, member.loc)

  return named
}

type FieldMember = Extract<RawMember, { kind: 'field' }>

function field(member: FieldMember, { access, isStatic, final, override }: Flags, fail: Fail): PropertyDefinition {
  if (memberKeyName(member.key) === 'constructor') fail("Classes may not have a field named 'constructor'", member.loc)

  const { value } = member
  const key = member.key as Identifier | Literal // checkSymbolName
  const loc = toLoc(member.loc)

  return { type: 'PropertyDefinition', key, computed: false, value, static: isStatic, access, override, final, loc }
}

// An abstract member's function has an empty body (D58); it is never called.
function functionValue(member: MethodMember, loc: SourceLocation): FunctionExpression {
  const { params, generator = false, async = false } = member
  const body = member.body ?? { type: 'BlockStatement', body: [], loc }

  return { type: 'FunctionExpression', id: null, params, body, generator, async, loc }
}

function method(member: Exclude<RawMember, { kind: 'field' }>, applied: Flags, modifiers: Modifier[]): MethodDefinition {
  const constructor = isConstructor(member, applied)
  const loc = toLoc(member.loc)
  const { access, isStatic, final, override, abstract } = applied

  if (constructor && modifiers.length > 0) throw new ModifierError('Constructors cannot have modifiers', member.loc)

  return {
    type: 'MethodDefinition',
    key: member.key,
    computed: member.key.type === 'MemberExpression',
    abstract,
    kind: constructor ? 'constructor' : member.kind,
    static: isStatic,
    value: functionValue(member, loc),
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
  checkSymbolName(member, fail)
  checkAbstract(member, applied, fail)

  try {
    return member.kind === 'field' ? field(member, applied, fail) : method(member, applied, modifiers)
  } catch (e) {
    if (e instanceof ModifierError) fail(e.message, e.loc)
    throw e
  }
}

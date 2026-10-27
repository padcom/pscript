// Parameter signatures and strict arity (D38, §4.4.13), shared by the compiler (compile-time
// checks) and the VM (runtime checks). Object patterns in parameters are strict named parameters (D40, §4.4.14).
import type { Expression, ObjectExpression, Pattern, PatternElement, RestElement, SourceLocation } from '@/parser/ast'
import { patternKey, patternText } from '@/parser/patterns'

/**
 * The keys an object pattern of a parameter accepts (D40).
 */
export interface NamedParameters {
  /** each key, with the keys of a nested object pattern */
  keys: Map<string, NamedParameters | null>
  /** the pattern has `...rest`: any key is accepted */
  open: boolean
}

/**
 * What a call must supply.
 */
export interface Signature {
  /** display form, e.g. `greet(name, greeting?)` */
  text: string
  /** parameters without a default */
  required: number
  /** parameters with a default */
  optional: number
  /** whether the last parameter is a rest parameter */
  hasRest: boolean
  /** per parameter, the keys its object pattern accepts (compile-time checks of object literals) */
  named?: (NamedParameters | null)[]
}

function withoutDefault(node: PatternElement | RestElement): PatternElement | RestElement {
  return node.type === 'AssignmentPattern' ? node.left : node
}

/**
 * The keys an object pattern accepts, or null when the node is not an object pattern.
 *
 * @param node a parameter or part of one
 * @returns the accepted keys
 */
export function namedParameters(node: PatternElement | RestElement): NamedParameters | null {
  const target = withoutDefault(node)
  if (target.type !== 'ObjectPattern') return null

  const keys = new Map<string, NamedParameters | null>()

  for (const property of target.properties) {
    if (property.type === 'Property') keys.set(patternKey(property.key), namedParameters(property.value))
  }

  return { keys, open: target.properties.some(property => property.type === 'RestElement') }
}

/**
 * Computes the signature of a parameter list.
 *
 * @param name function name (empty when anonymous)
 * @param params formal parameters
 * @returns the signature
 */
export function signatureOf(name: string, params: Pattern[]): Signature {
  const count = (type: Pattern['type']) => params.filter(param => param.type === type).length
  const named = params.map(namedParameters)

  return {
    text: `${name || 'anonymous'}(${params.map(patternText).join(', ')})`,
    required: params.length - count('AssignmentPattern') - count('RestElement'),
    optional: count('AssignmentPattern'),
    hasRest: count('RestElement') > 0,
    ...named.some(Boolean) ? { named } : {},
  }
}

function plural(n: number): string {
  return n === 1 ? 'argument' : 'arguments'
}

function expected({ required, optional, hasRest }: Signature): string {
  if (hasRest) return `at least ${required} ${plural(required)}`

  return optional === 0 ? `${required} ${plural(required)}` : `${required}-${required + optional} arguments`
}

/**
 * Checks an argument count against a signature.
 *
 * @param signature the callee's signature
 * @param argc number of arguments passed
 * @returns the error message, or `null` when the call is valid
 */
export function arityError(signature: Signature, argc: number): string | null {
  const { required, optional, hasRest } = signature
  const valid = argc >= required && (hasRest || argc <= required + optional)

  return valid ? null : `${signature.text} expects ${expected(signature)}, got ${argc}`
}

/**
 * The message of an unknown named parameter (D40), the same at compile time and at runtime.
 *
 * @param key the key, with the path of nested patterns (`pos.z`)
 * @param signature the display form of the function's signature
 * @returns the message
 */
export function unknownNamedParameter(key: string, signature: string): string {
  return `Unknown named parameter '${key}' of ${signature}`
}

/**
 * A problem found in the arguments, and where.
 */
export interface ArgumentProblem {
  /** the message */
  reason: string
  /** the offending part of the call */
  loc: SourceLocation
}

/** An unknown key and where it is. */
interface UnknownKey {
  /** the key, with its path */
  key: string
  /** the property */
  loc: SourceLocation
}

/* eslint-disable no-use-before-define -- nested literals are checked recursively */
type LiteralProperty = ObjectExpression['properties'][number]

// A nested literal passed to a nested object pattern.
function nestedProblem(nested: NamedParameters | null | undefined, { value }: LiteralProperty, path: string): UnknownKey | null {
  return nested && value.type === 'ObjectExpression' ? unknownKey(nested, value, path) : null
}

// A property of an object literal: unknown, or a nested literal with an unknown key.
function propertyProblem(named: NamedParameters, property: LiteralProperty, path: string): UnknownKey | null {
  const key = patternKey(property.key as Parameters<typeof patternKey>[0])
  if (!named.open && !named.keys.has(key)) return { key: path + key, loc: property.loc }

  return nestedProblem(named.keys.get(key), property, `${path}${key}.`)
}
/* eslint-enable no-use-before-define */

// The first key of an object literal (or of a nested literal) that the pattern does not accept.
function unknownKey(named: NamedParameters, literal: ObjectExpression, path: string): UnknownKey | null {
  for (const property of literal.properties) {
    const found = property.computed ? null : propertyProblem(named, property, path)
    if (found) return found
  }

  return null
}

// An object literal passed to an object pattern.
function argumentProblem(named: NamedParameters | null | undefined, arg: Expression): UnknownKey | null {
  return named && arg.type === 'ObjectExpression' ? unknownKey(named, arg, '') : null
}

/**
 * Checks object literals passed to named parameters (D40) at compile time.
 *
 * @param signature the callee's signature
 * @param args the arguments of the call
 * @returns the first problem, or null
 */
export function namedArgumentError(signature: Signature, args: Expression[]): ArgumentProblem | null {
  for (const [i, arg] of args.entries()) {
    const found = argumentProblem(signature.named?.[i], arg)
    if (found) return { reason: unknownNamedParameter(found.key, signature.text), loc: found.loc }
  }

  return null
}

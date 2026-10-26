// Parameter signatures and strict arity (D38, §4.4.13), shared by the compiler (compile-time
// checks) and the VM (runtime checks).
import type { Pattern } from '@/parser/ast'

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
}

function paramText(param: Pattern): string {
  if (param.type === 'Identifier') return param.name

  return param.type === 'AssignmentPattern' ? `${param.left.name}?` : `...${param.argument.name}`
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

  return {
    text: `${name || 'anonymous'}(${params.map(paramText).join(', ')})`,
    required: count('Identifier'),
    optional: count('AssignmentPattern'),
    hasRest: count('RestElement') > 0,
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

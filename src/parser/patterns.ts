// Names bound by patterns, and their display form in signatures (D40), shared by the parser's checks, the compiler
// and psc.
import type {
  ArrayPattern,
  AssignmentPattern,
  AssignmentProperty,
  Identifier,
  Literal,
  ObjectPattern,
  Pattern,
  PatternElement,
  RestElement,
} from './ast'

type Part = Pattern | PatternElement | RestElement | AssignmentProperty

type PartOf<K extends Part['type']> = Extract<Part, { type: K }>

type Visitor<T> = { [K in Part['type']]?: (node: PartOf<K>) => T }

function visit<T>(visitor: Visitor<T>, node: Part, otherwise: T): T {
  const handler = visitor[node.type] as ((node: Part) => T) | undefined

  return handler ? handler(node) : otherwise
}

/* eslint-disable no-use-before-define -- the visitors are mutually recursive */
const BOUND_NAMES: Visitor<Identifier[]> = {
  Identifier: node => [node],
  AssignmentPattern: node => boundNames(node.left),
  RestElement: node => [node.argument],
  Property: node => boundNames(node.value),
  ObjectPattern: node => node.properties.flatMap(boundNames),
  ArrayPattern: node => node.elements.flatMap(boundNames),
}
/* eslint-enable no-use-before-define */

/**
 * The names a parameter, binding pattern or assignment pattern binds, in source order (member expressions bind none).
 *
 * @param node the pattern
 * @returns the names
 */
export function boundNames(node: Part): Identifier[] {
  return visit(BOUND_NAMES, node, [])
}

/**
 * The name of a property key (`a`, `'a b'`, `1`).
 *
 * @param key the key
 * @returns its name
 */
export function patternKey(key: Identifier | Literal): string {
  return key.type === 'Identifier' ? key.name : String(key.value)
}

function isNested(node: Part): node is ObjectPattern | ArrayPattern {
  return node.type === 'ObjectPattern' || node.type === 'ArrayPattern'
}

function withoutDefault(value: PatternElement): Exclude<PatternElement, AssignmentPattern> {
  return value.type === 'AssignmentPattern' ? value.left : value
}

/* eslint-disable no-use-before-define -- the visitors are mutually recursive */
// An object pattern shows the keys a caller passes: `{a, b?, pos: {x, y}, ...rest}`.
function propertyText({ key, value }: AssignmentProperty): string {
  const target = withoutDefault(value)
  const nested = isNested(target) ? `: ${patternText(target)}` : ''

  return `${patternKey(key)}${nested}${value.type === 'AssignmentPattern' ? '?' : ''}`
}

const PATTERN_TEXT: Visitor<string> = {
  Identifier: node => node.name,
  AssignmentPattern: node => `${patternText(node.left)}?`,
  RestElement: node => `...${node.argument.name}`,
  Property: propertyText,
  ObjectPattern: node => `{${node.properties.map(patternText).join(', ')}}`,
  ArrayPattern: node => `[${node.elements.map(patternText).join(', ')}]`,
}
/* eslint-enable no-use-before-define */

/**
 * The display form of a parameter in signatures (D38, D40): `a`, `b?`, `...c`, `{x, y?}`, `[a, b?]`.
 *
 * @param node the parameter or pattern
 * @returns the text
 */
export function patternText(node: Part): string {
  return visit(PATTERN_TEXT, node, '…')
}

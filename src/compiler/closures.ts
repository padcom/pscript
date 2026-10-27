// Escape analysis for block environments (§5.5, K9): a block needs an environment of its own only when a
// closure can capture its bindings (or tell loop iterations apart), or when its slots must start in the TDZ.
import type { Node, Position } from '@/parser/ast'
import { boundNames } from '@/parser/patterns'

// Functions, arrows, methods, accessors and classes all capture the environment they are created in.
const CLOSURE_TYPES = /Function|Class|Method/

function isClosure({ type }: { type?: unknown }): boolean {
  return typeof type === 'string' && CLOSURE_TYPES.test(type)
}

// Walks every nested object, not only typed nodes, so that no wrapped child is missed.
function contains(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false

  return isClosure(value) || Object.values(value).some(contains)
}

/**
 * Whether evaluating `node` may create a closure.
 *
 * @param node an AST node
 * @returns true when the node is or contains a function, arrow, method or class
 */
export function createsClosure(node: Node): boolean {
  return contains(node)
}

/** Name → end of the statement declaring it. */
type Declarations = Map<string, Position>

function before(a: Position, b: Position): boolean {
  return a.line < b.line || (a.line === b.line && a.column < b.column)
}

// Keys whose identifiers are not references: `o.x`, `{ x: 1 }` and the declared names themselves.
const NON_REFERENCE_KEYS: Record<string, string> = {
  MemberExpression: 'property',
  Property: 'key',
  VariableDeclarator: 'id',
  InterfaceDeclaration: 'id',
}

// A pattern's defaults may refer to names (D40): only a plain declared name is skipped.
function isPatternDeclarator(node: Record<string, unknown>): boolean {
  return node.type === 'VariableDeclarator' && (node.id as Node).type !== 'Identifier'
}

function nonReferenceKey(node: Record<string, unknown>): string | null {
  if (node.computed || isPatternDeclarator(node)) return null

  return NON_REFERENCE_KEYS[node.type as string] ?? null
}

function isEarlyReference(node: Record<string, unknown>, declarations: Declarations): boolean {
  const declared = node.type === 'Identifier' ? declarations.get(node.name as string) : undefined

  return declared !== undefined && before((node.loc as { start: Position }).start, declared)
}

function hasEarlyReference(value: unknown, declarations: Declarations): boolean {
  if (typeof value !== 'object' || value === null) return false

  const node = value as Record<string, unknown>
  if (isEarlyReference(node, declarations)) return true

  const skipped = nonReferenceKey(node)

  return Object.entries(node).some(([key, child]) => key !== skipped && hasEarlyReference(child, declarations))
}

function declaredNames(statement: Node): string[] {
  if (statement.type === 'VariableDeclaration') {
    return statement.declarations.flatMap(({ id }) => boundNames(id)).map(({ name }) => name)
  }

  return statement.type === 'InterfaceDeclaration' ? [statement.id.name] : []
}

function declarationsOf(statements: Node[]): Declarations {
  return new Map(statements.flatMap(statement => declaredNames(statement).map(name => [name, statement.loc.end] as const)))
}

/**
 * Whether a binding declared by one of `statements` may be used before it is initialised: some identifier with its
 * name appears before the end of the declaring statement (conservative: shadowing is ignored).
 *
 * @param statements the statements of a block (their `let`, `const` and `interface` declarations count)
 * @returns true when a TDZ access is possible
 */
export function usedBeforeDeclaration(statements: Node[]): boolean {
  const declarations = declarationsOf(statements)

  return declarations.size > 0 && hasEarlyReference(statements, declarations)
}

/**
 * Whether a block's bindings can live in the enclosing environment (K9).
 *
 * @param node the code of the block scope
 * @param statements its declaring statements
 * @returns true when no closure is created and no binding is used before its declaration
 */
export function canFold(node: Node, statements: Node[]): boolean {
  return !createsClosure(node) && !usedBeforeDeclaration(statements)
}

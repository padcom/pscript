// Escape check for per-iteration loop environments (§5.5): only a closure created inside a `for (let ...)`
// loop can observe that each iteration has its own binding.
import type { Node } from '@/parser/ast'

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

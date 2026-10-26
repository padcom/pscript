// Compile-time scopes and static name resolution (§5.5, §4.4.4).
import type { Signature } from './signature'

/** `function`: a function declaration or the name of a named function expression (constant, D38). */
export type BindingKind = 'let' | 'const' | 'function'

/**
 * A declared name.
 */
export interface Binding {
  /** the name */
  name: string
  /** declaration kind */
  kind: BindingKind
  /** slot in the scope's environment (unused for script-level bindings) */
  slot: number
  /** parameters of the function bound here, when known at compile time (D38) */
  signature?: Signature
}

/** Where a name lives: a lexical environment slot, a script-level binding, or the globals. */
export type Resolution
  = { where: 'lexical', depth: number, slot: number, binding: Binding }
    | { where: 'script', binding: Binding }
    | { where: 'global' }

export class Scope {
  readonly bindings = new Map<string, Binding>()

  constructor(readonly parent: Scope | null, readonly kind: 'script' | 'function' | 'block') {}

  // A function always has its top environment; blocks get one only when they declare something (§5.5).
  get hasEnv(): boolean {
    return this.kind === 'function' || (this.kind === 'block' && this.bindings.size > 0)
  }

  // Number of environments between this scope and the script's top environment.
  get envDepth(): number {
    return (this.parent?.envDepth ?? 0) + (this.hasEnv ? 1 : 0)
  }

  /**
   * Declares a name in this scope.
   *
   * @param name the name
   * @param kind declaration kind
   * @param signature parameters, when the name is bound to a known function
   * @returns the binding, or `null` when the name is already declared here
   */
  declare(name: string, kind: BindingKind, signature?: Signature): Binding | null {
    if (this.bindings.has(name)) return null

    const binding = { name, kind, slot: this.bindings.size, signature }

    this.bindings.set(name, binding)

    return binding
  }

  /**
   * Resolves a name from this scope outwards.
   *
   * @param name the name
   * @param depth environments crossed so far
   * @returns where the name lives
   */
  resolve(name: string, depth = 0): Resolution {
    const binding = this.bindings.get(name)
    if (binding) return this.found(binding, depth)
    if (!this.parent) return { where: 'global' }

    return this.parent.resolve(name, depth + Number(this.hasEnv))
  }

  private found(binding: Binding, depth: number): Resolution {
    return this.kind === 'script' ? { where: 'script', binding } : { where: 'lexical', depth, slot: binding.slot, binding }
  }
}

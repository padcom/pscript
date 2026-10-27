// Call frames of the VM (§5.6.1).
import type { FunctionProto } from '@/compiler/function-proto'
import type { ModuleRecord } from '@/modules/module-record'
import type { ScriptBinding } from './globals'
import type { Class, Closure, Environment, ImplicitReceiver, Object as ScriptObject, Value } from '@/runtime/values'

/**
 * An exception handler pushed by `TRY` (§5.6.5).
 */
export interface Handler {
  /** catch block offset, -1 if none */
  catchTarget: number
  /** finally block offset, -1 if none */
  finallyTarget: number
  /** operand stack height to restore */
  stackHeight: number
  /** environment to restore */
  env: Environment
}

/**
 * One activation of a function.
 */
export interface Frame {
  /** the running closure; `null` for scripts and modules */
  closure: Closure | null
  /** the running code */
  proto: FunctionProto
  /** next instruction (only up to date while the frame is not on top) */
  ip: number
  /** offset of the instruction being executed, for error locations */
  opStart: number
  /** operand stack height at entry */
  base: number
  /** innermost environment */
  env: Environment
  /** `this` */
  thisValue: Value
  /** class whose body contains the code (private/protected access) */
  homeClass: Class | null
  /** object whose method this is (`super` lookups) */
  homeObject: ScriptObject | null
  /** frame of the enclosing method, whose `this` implicit member accesses use (null: this frame, §4.5.8) */
  implicitFrame: ImplicitReceiver | null
  /** module the code belongs to (imports, error locations; §5.6.8) */
  module: ModuleRecord | null
  /** active exception handlers (allocated by the first TRY) */
  handlers: Handler[] | null
  /** called through `new` */
  isConstruct: boolean
  /** class `new` was applied to */
  newTarget: Class | null
  /** script bindings found by LOAD_GLOBAL / STORE_GLOBAL, by constant index (shared by the closure's calls) */
  globalCache: ScriptBinding[]
}

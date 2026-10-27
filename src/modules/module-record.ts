// Module contract (§5.4): compiled modules and their runtime records.
import type { FunctionProto } from '@/compiler/function-proto'
import type { SourceLocation } from '@/parser/ast'
import type { PromiseObject } from '@/runtime/promises'
import type { Environment, ModuleNamespace, Value } from '@/runtime/values'

/**
 * A named import; its index is the `LOAD_IMPORT` operand.
 */
export interface ModuleImportEntry {
  /** index into `CompiledModule.requests` */
  request: number
  /** name exported by the other module, or `*` for a namespace import */
  importName: string
  /** local binding name */
  localName: string
  /** the specifier, for link errors */
  loc: SourceLocation
}

/**
 * A binding exported from the module's own top environment.
 */
export interface ModuleLocalExport {
  /** name visible to importers */
  exportName: string
  /** slot in `main`'s top environment */
  slot: number
}

/**
 * A re-export: `export { a as b } from 'm'`.
 */
export interface ModuleIndirectExport {
  /** name visible to importers */
  exportName: string
  /** index into `CompiledModule.requests` */
  request: number
  /** name exported by the other module */
  importName: string
  /** the specifier, for link errors */
  loc: SourceLocation
}

/**
 * A function declaration initialised when the module is linked, before any module body runs (cycles, §4.7.2).
 */
export interface HoistedFunction {
  /** slot in `main`'s top environment */
  slot: number
  /** index of the function's proto in `main`'s constants */
  proto: number
}

/**
 * Output of compiling a module.
 */
export interface CompiledModule {
  /** normalised module id */
  id: string
  /** kind `module`; its top environment holds all top-level bindings */
  main: FunctionProto
  /** module specifiers in source order (imports + re-exports + side-effect) */
  requests: string[]
  /** index = `LOAD_IMPORT` operand */
  imports: ModuleImportEntry[]
  /** own exported bindings */
  localExports: ModuleLocalExport[]
  /** re-exports */
  indirectExports: ModuleIndirectExport[]
  /** functions initialised at instantiation (cycle support) */
  hoistedFunctions: HoistedFunction[]
  /** source text, for error excerpts */
  source?: string
  /** the body uses top-level `await` (D51): it runs as a coroutine, like an async function */
  async?: boolean
}

/**
 * Live view of an exported binding of a PScript module, used by importers.
 */
export interface SlotCell {
  /** environment of the exporting module */
  env: Environment
  /** slot of the binding */
  slot: number
}

/**
 * Live view of a host module's export: every read converts the export's current value (§4.7.3, D9).
 */
export interface HostCell {
  /** reads the current value */
  read(): Value
}

export type BindingCell = SlotCell | HostCell

/**
 * The exports of a host module: names fixed when it was loaded, values read live from the object.
 */
export interface HostExports {
  /** export names (own enumerable keys at load time) */
  names: string[]
  /** the host's exports object */
  object: Record<string, unknown>
}

export type ModuleStatus = 'new' | 'linking' | 'linked' | 'evaluating' | 'evaluated' | 'errored'

/**
 * Runtime state of one module (a singleton per id).
 */
export interface ModuleRecord {
  /** normalised module id */
  id: string
  /** lifecycle state */
  status: ModuleStatus
  /** `null` for host modules */
  compiled: CompiledModule | null
  /** module top environment, created at link time */
  env: Environment | null
  /** resolved per `CompiledModule.imports` index */
  importCells: BindingCell[]
  /** exports of a host module */
  hostExports?: HostExports
  /** the module namespace object, created on first use (namespace imports, §4.7.2) */
  namespace?: ModuleNamespace
  /** error of an errored module, rethrown on every import */
  error?: unknown
  /** set when the evaluation of the module (or of a dependency) waits for a promise (top-level await, D51) */
  evaluation?: PromiseObject
}

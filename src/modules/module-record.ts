// Module contract (§5.4): compiled modules and their runtime records.
import type { FunctionProto } from '@/compiler/function-proto'
import type { Environment, Value } from '@/runtime/values'

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
  /** slots initialised at instantiation (cycle support) */
  hoistedFunctions: number[]
}

/**
 * Live view of an exported binding, used by importers.
 */
export interface BindingCell {
  /** environment of the exporting module */
  env: Environment
  /** slot of the binding */
  slot: number
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
  hostExports?: Map<string, Value>
  /** error of an errored module, rethrown on every import */
  error?: unknown
}

// Module records per interpreter (§4.7.2, §5.6.8): loading the graph, linking (environments, import cells, hoisted
// functions) and evaluation (depth-first, post-order; each module at most once).
import { compileModule } from '@/compiler/compiler'
import type { FunctionProto } from '@/compiler/function-proto'
import { PScriptRuntimeError, PScriptSyntaxError, formatExcerpt } from '@/errors'
import type { SourceLocation } from '@/parser/ast'
import { referenceError } from '@/runtime/script-error'
import { Environment, ModuleNamespace, UNINITIALIZED, type Closure, type Slot, type Value } from '@/runtime/values'
import { readCell } from './cells'
import { resolveSpecifier, type LoadedModule, type ModuleLoader } from './loader'
import type {
  BindingCell,
  CompiledModule,
  HostExports,
  ModuleImportEntry,
  ModuleIndirectExport,
  ModuleRecord,
} from './module-record'

/**
 * What the registry needs from the VM.
 */
export interface ModuleVM {
  /** runs a linked module's body */
  evaluateModule(record: ModuleRecord): void
  /** creates a hoisted function of a module */
  moduleFunction(record: ModuleRecord, proto: FunctionProto): Closure
  /** host values for host modules */
  interop: { toScript(value: unknown): Value }
}

/**
 * A module record with the records of its requests (same order as `CompiledModule.requests`).
 */
export interface LinkedRecord extends ModuleRecord {
  /** the requested modules */
  requested: LinkedRecord[]
}

function compiledOf(record: ModuleRecord): CompiledModule {
  return record.compiled as CompiledModule
}

// Link errors are syntax errors of the importing module, reported at the specifier (§4.7.2).
function linkError(record: ModuleRecord, reason: string, { start: { line, column } }: SourceLocation): PScriptSyntaxError {
  const { source } = compiledOf(record)
  const excerpt = source === undefined ? undefined : formatExcerpt(source, line, column)

  return new PScriptSyntaxError(reason, { fileName: record.id, line, column, excerpt })
}

function hostCell({ names, object }: HostExports, name: string, toScript: (value: unknown) => Value): BindingCell | null {
  return names.includes(name) ? { read: () => toScript(object[name]) } : null
}

function notFound(specifier: string, referrer: string | null, cause: unknown): PScriptRuntimeError {
  const from = referrer === null ? '' : ` imported from '${referrer}'`
  const detail = cause instanceof Error ? `: ${cause.message}` : ''

  return new PScriptRuntimeError('Error', `Cannot find module '${specifier}'${from}${detail}`, undefined)
}

export class ModuleRegistry {
  private records = new Map<string, LinkedRecord>()

  constructor(private loader: ModuleLoader, private vm: ModuleVM) {}

  /**
   * Loads, links and evaluates a module (once per id) and its dependencies.
   *
   * @param specifier the specifier
   * @param referrer id of the importing module, or null
   * @returns the module record
   */
  import(specifier: string, referrer: string | null): LinkedRecord {
    return this.run(this.load(specifier, referrer))
  }

  /**
   * Runs an entry module given as source text.
   *
   * @param source module source
   * @param id the module's id
   * @returns the module record
   */
  runSource(source: string, id: string): LinkedRecord {
    const existing = this.records.get(id)

    return this.run(existing ?? this.create(id, compileModule(source, id)))
  }

  private run(record: LinkedRecord): LinkedRecord {
    this.link(record)
    this.evaluate(record)

    return record
  }

  private fetch(specifier: string, referrer: string | null): LoadedModule {
    try {
      return this.loader(specifier, referrer)
    } catch (e) {
      throw notFound(specifier, referrer, e)
    }
  }

  // Modules registered with `define` (or loaded before) under the resolved specifier skip the loader.
  private load(specifier: string, referrer: string | null): LinkedRecord {
    return this.records.get(resolveSpecifier(specifier, referrer)) ?? this.loadNew(specifier, referrer)
  }

  private loadNew(specifier: string, referrer: string | null): LinkedRecord {
    const loaded = this.fetch(specifier, referrer)
    const existing = this.records.get(loaded.id)
    if (existing) return existing
    if ('exports' in loaded) return this.define(loaded.id, loaded.exports)

    return this.create(loaded.id, compileModule(loaded.source, loaded.id))
  }

  /**
   * Registers a host module (§4.7.3): its export names are the object's own enumerable keys now, its values are read
   * live on every access.
   *
   * @param id module id
   * @param object the exports
   * @returns the module record (already evaluated)
   */
  define(id: string, object: Record<string, unknown>): LinkedRecord {
    if (this.records.has(id)) throw new PScriptRuntimeError('Error', `Module '${id}' is already defined`, undefined)

    const hostExports = { names: globalThis.Object.keys(object), object }
    const record: LinkedRecord = { id, status: 'evaluated', compiled: null, env: null, importCells: [], requested: [] }

    record.hostExports = hostExports
    this.records.set(id, record)

    return record
  }

  // Registered before its requests are loaded, so cycles find it.
  private create(id: string, compiled: CompiledModule): LinkedRecord {
    const record: LinkedRecord = { id, status: 'new', compiled, env: null, importCells: [], requested: [] }

    this.records.set(id, record)
    record.requested = compiled.requests.map(specifier => this.load(specifier, id))

    return record
  }

  // Environments are created before the requests are linked, so cells of a cycle can point into them.
  private link(record: LinkedRecord) {
    if (record.status !== 'new') return
    record.status = 'linking'

    try {
      this.instantiate(record)
      record.requested.forEach(dependency => this.link(dependency))
      this.resolveImports(record)
      record.status = 'linked'
    } catch (e) {
      this.fail(record, e)
    }
  }

  private instantiate(record: LinkedRecord) {
    const { main, hoistedFunctions } = compiledOf(record)
    const env = new Environment(new globalThis.Array<Slot>(main.scopeSize).fill(UNINITIALIZED), null)

    record.env = env

    for (const { slot, proto } of hoistedFunctions) {
      env.slots[slot] = this.vm.moduleFunction(record, main.constants[proto] as FunctionProto)
    }
  }

  private resolveImports(record: LinkedRecord) {
    const compiled = compiledOf(record)

    record.importCells = compiled.imports.map(entry => this.importCell(record, entry))

    for (const { exportName } of compiled.indirectExports) this.resolveExport(record, exportName, new Set())
  }

  private importCell(record: LinkedRecord, { request, importName, loc }: ModuleImportEntry): BindingCell {
    const cell = this.cellFor(record.requested[request], importName, new Set())
    if (cell) return cell

    const specifier = compiledOf(record).requests[request]

    throw linkError(record, `Module '${specifier}' does not provide an export named '${importName}'`, loc)
  }

  /**
   * Finds the binding behind an export, following re-exports.
   *
   * @param record the exporting module
   * @param name export name
   * @param visiting re-exports being followed (cycle detection)
   * @returns the binding cell, or null when the module has no such export
   */
  resolveExport(record: LinkedRecord, name: string, visiting: Set<string>): BindingCell | null {
    if (record.hostExports) return hostCell(record.hostExports, name, value => this.vm.interop.toScript(value))

    const compiled = compiledOf(record)
    const local = compiled.localExports.find(entry => entry.exportName === name)
    if (local) return { env: record.env as Environment, slot: local.slot }

    const indirect = compiled.indirectExports.find(entry => entry.exportName === name)

    return indirect ? this.followReexport(record, indirect, visiting) : null
  }

  private followReexport(record: LinkedRecord, indirect: ModuleIndirectExport, visiting: Set<string>) {
    const key = `${record.id}\u0000${indirect.exportName}`
    if (visiting.has(key)) throw linkError(record, `circular re-export of '${indirect.exportName}'`, indirect.loc)
    visiting.add(key)

    const cell = this.cellFor(record.requested[indirect.request], indirect.importName, visiting)
    if (cell) return cell

    const specifier = compiledOf(record).requests[indirect.request]

    throw linkError(record, `Module '${specifier}' does not provide an export named '${indirect.importName}'`, indirect.loc)
  }

  // `*` stands for the namespace object (namespace imports, and exports of them).
  private cellFor(record: LinkedRecord, importName: string, visiting: Set<string>): BindingCell | null {
    if (importName !== '*') return this.resolveExport(record, importName, visiting)

    const namespace = this.namespace(record)

    return { read: () => namespace }
  }

  /**
   * The module namespace object of a module, one per record (§4.7.2).
   *
   * @param record the module
   * @returns its namespace
   */
  namespace(record: LinkedRecord): ModuleNamespace {
    record.namespace ??= new ModuleNamespace(record, this.exportNames(record), this.exportReader(record))

    return record.namespace
  }

  // Cells are resolved on first read: a namespace of a module that is still linking (cycle) may be created early.
  private exportReader(record: LinkedRecord): (name: string) => Value {
    const cells = new Map<string, BindingCell>()

    return name => {
      if (!cells.has(name)) cells.set(name, this.resolveExport(record, name, new Set()) as BindingCell)

      const value = readCell(cells.get(name) as BindingCell)
      if (value === UNINITIALIZED) throw referenceError(`Cannot access '${name}' before initialization`)

      return value
    }
  }

  // Depth-first, post-order; a module that is still evaluating (cycle) is not re-entered.
  private evaluate(record: LinkedRecord) {
    if (record.status === 'errored') throw record.error
    if (record.status !== 'linked') return
    record.status = 'evaluating'

    try {
      record.requested.forEach(dependency => this.evaluate(dependency))
      this.vm.evaluateModule(record)
      record.status = 'evaluated'
    } catch (e) {
      this.fail(record, e)
    }
  }

  // An errored module rethrows the same error on every later import (§4.7.2).
  private fail(record: LinkedRecord, error: unknown): never {
    record.status = 'errored'
    record.error = error
    throw error
  }

  /**
   * The export names of a module, sorted (namespace views, §4.7.2).
   *
   * @param record the module
   * @returns the names
   */
  exportNames(record: LinkedRecord): string[] {
    if (record.hostExports) return [...record.hostExports.names].sort()

    const { localExports, indirectExports } = compiledOf(record)

    return [...localExports, ...indirectExports].map(entry => entry.exportName).sort()
  }
}

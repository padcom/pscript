// Module records per interpreter (§4.7.2, §5.6.8): loading the graph, linking (environments, import cells, hoisted
// functions) and evaluation (depth-first, post-order; each module at most once).
import { compileModule } from '@/compiler/compiler'
import type { FunctionProto } from '@/compiler/function-proto'
import { PScriptRuntimeError, PScriptSyntaxError, formatExcerpt } from '@/errors'
import type { SourceLocation } from '@/parser/ast'
import { Environment, UNINITIALIZED, type Closure, type Slot } from '@/runtime/values'
import type { LoadedModule, ModuleLoader } from './loader'
import type { BindingCell, CompiledModule, ModuleImportEntry, ModuleIndirectExport, ModuleRecord } from './module-record'

/**
 * What the registry needs from the VM.
 */
export interface ModuleVM {
  /** runs a linked module's body */
  evaluateModule(record: ModuleRecord): void
  /** creates a hoisted function of a module */
  moduleFunction(record: ModuleRecord, proto: FunctionProto): Closure
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

  private load(specifier: string, referrer: string | null): LinkedRecord {
    const loaded = this.fetch(specifier, referrer)
    const existing = this.records.get(loaded.id)
    if (existing) return existing
    if (!('source' in loaded)) throw new PScriptRuntimeError('Error', `Host module '${loaded.id}' is not supported`, undefined)

    return this.create(loaded.id, compileModule(loaded.source, loaded.id))
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
    const cell = this.resolveExport(record.requested[request], importName, new Set())
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

    const cell = this.resolveExport(record.requested[indirect.request], indirect.importName, visiting)
    if (cell) return cell

    const specifier = compiledOf(record).requests[indirect.request]

    throw linkError(record, `Module '${specifier}' does not provide an export named '${indirect.importName}'`, indirect.loc)
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
    const { localExports, indirectExports } = compiledOf(record)

    return [...localExports, ...indirectExports].map(entry => entry.exportName).sort()
  }
}

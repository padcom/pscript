// Module records per interpreter (§4.7.2, §5.6.8): loading the graph, linking (environments, import cells, hoisted
// functions) and evaluation (depth-first, post-order; each module at most once). A module body with top-level
// `await` makes the evaluation of its importers wait for its promise, and loaders may be asynchronous (D51).
import { compileModule } from '@/compiler/compiler'
import type { FunctionProto } from '@/compiler/function-proto'
import { PScriptRuntimeError, PScriptSyntaxError, formatExcerpt, type ScriptStackFrame } from '@/errors'
import type { SourceLocation } from '@/parser/ast'
import type { PromiseObject, PromiseOps } from '@/runtime/promises'
import { ScriptThrow, referenceError } from '@/runtime/script-error'
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
  /** runs a linked module's body; a body with top-level `await` gives its promise (D51) */
  evaluateModule(record: ModuleRecord): PromiseObject | null
  /** runs the queued jobs once the module graph has been evaluated (D43) */
  settle(): void
  /** creates a hoisted function of a module */
  moduleFunction(record: ModuleRecord, proto: FunctionProto): Closure
  /** host values for host modules, and the host's view of an evaluation */
  interop: { toScript(value: unknown): Value, toHost(value: Value): unknown }
  /** promises and their jobs (D43) */
  promises: PromiseOps
  /** the value of a settled promise, or a symbol while it waits; throws the reason of a rejected one */
  outcome(promise: PromiseObject): Value | symbol
  /** the script exception a host exception stands for */
  fromHost(error: unknown): ScriptThrow
  /** what the host sees of a script exception */
  toHostError(error: unknown): unknown
}

/**
 * A module record with the records of its requests (same order as `CompiledModule.requests`).
 */
export interface LinkedRecord extends ModuleRecord {
  /** the requested modules */
  requested: LinkedRecord[]
}

type SourceModule = Exclude<LoadedModule, { exports: unknown }>

function compiledOf(record: ModuleRecord): CompiledModule {
  return record.compiled as CompiledModule
}

function compileLoaded(loaded: SourceModule): CompiledModule {
  return 'compiled' in loaded ? loaded.compiled : compileModule(loaded.source, loaded.id)
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

function isPromise(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === 'function'
}

function apiError(message: string): PScriptRuntimeError {
  return new PScriptRuntimeError('Error', message, undefined)
}

function notFound(specifier: string, referrer: string | null, cause: unknown): PScriptRuntimeError {
  const from = referrer === null ? '' : ` imported from '${referrer}'`
  const detail = cause instanceof Error ? `: ${cause.message}` : ''

  return new PScriptRuntimeError('Error', `Cannot find module '${specifier}'${from}${detail}`, undefined)
}

const ASYNC_API = 'use runModuleAsync() or importModuleAsync()'

export class ModuleRegistry {
  private records = new Map<string, LinkedRecord>()
  /** asynchronous loads of module graphs, one after another (a graph is linked only once it is complete) */
  private loads: Promise<unknown> = globalThis.Promise.resolve()

  constructor(private loader: ModuleLoader, private vm: ModuleVM) {}

  /**
   * Loads, links and evaluates a module (once per id) and its dependencies.
   *
   * @param specifier the specifier
   * @param referrer id of the importing module, or null
   * @returns the module record
   * @throws {PScriptRuntimeError} when the loader is asynchronous or a top-level `await` waits for the host (D51)
   */
  import(specifier: string, referrer: string | null): LinkedRecord {
    return this.run(this.load(specifier, referrer))
  }

  /**
   * Loads (with a synchronous or asynchronous loader), links and evaluates a module and its dependencies, waiting
   * for their top-level `await`s (D51).
   *
   * @param specifier the specifier
   * @param referrer id of the importing module, or null
   * @returns the module record, once evaluated
   */
  async importAsync(specifier: string, referrer: string | null): Promise<LinkedRecord> {
    return this.runAsync(await this.serialized(() => this.loadAsync(specifier, referrer)))
  }

  /**
   * Runs an entry module given as source text.
   *
   * @param source module source
   * @param id the module's id
   * @returns the module record
   */
  runSource(source: string, id: string): LinkedRecord {
    return this.run(this.records.get(id) ?? this.loadRequests(this.create(id, compileModule(source, id))))
  }

  /**
   * Runs an entry module given as source text; its dependencies may come from an asynchronous loader, and top-level
   * `await`s are waited for (D51).
   *
   * @param source module source
   * @param id the module's id
   * @returns the module record, once evaluated
   */
  async runSourceAsync(source: string, id: string): Promise<LinkedRecord> {
    const existing = this.records.get(id)
    const load = () => this.loadRequestsAsync(this.create(id, compileModule(source, id)))

    return this.runAsync(existing ?? await this.serialized(load))
  }

  // Jobs run after the whole graph, as in JS (a module's promise callbacks run after its importers' bodies). A
  // top-level `await` still waiting after that (for a host promise or a timer) needs the asynchronous API.
  private run(record: LinkedRecord): LinkedRecord {
    const evaluation = this.start(record)

    this.vm.settle()

    if (evaluation && typeof this.vm.outcome(evaluation) === 'symbol') {
      throw apiError(`Module '${record.id}' is still evaluating (its top-level await waits for the host); ${ASYNC_API}`)
    }

    return record
  }

  private async runAsync(record: LinkedRecord): Promise<LinkedRecord> {
    const evaluation = this.start(record)
    const done = evaluation ? this.vm.interop.toHost(evaluation) : null

    this.vm.settle()
    await done

    return record
  }

  // The caller reports a failed evaluation, so it is not an unhandled rejection.
  private start(record: LinkedRecord): PromiseObject | null {
    this.link(record)

    const evaluation = this.evaluate(record, new Set())

    if (evaluation) this.vm.promises.react(evaluation, () => {}, () => {})

    return evaluation
  }

  private async serialized<T>(load: () => Promise<T>): Promise<T> {
    const previous = this.loads
    let release = () => {}

    this.loads = new globalThis.Promise<void>(resolve => { release = resolve })

    try {
      await previous

      return await load()
    } finally {
      release()
    }
  }

  private fetch(specifier: string, referrer: string | null): LoadedModule {
    let loaded: ReturnType<ModuleLoader>

    try {
      loaded = this.loader(specifier, referrer)
    } catch (e) {
      throw notFound(specifier, referrer, e)
    }

    if (isPromise(loaded)) throw apiError(`The module loader is asynchronous (loading '${specifier}'); ${ASYNC_API}`)

    return loaded
  }

  private async fetchAsync(specifier: string, referrer: string | null): Promise<LoadedModule> {
    try {
      return await this.loader(specifier, referrer)
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

    return this.loadRequests(this.create(loaded.id, compileLoaded(loaded)))
  }

  private loadAsync(specifier: string, referrer: string | null): Promise<LinkedRecord> {
    const existing = this.records.get(resolveSpecifier(specifier, referrer))

    return existing ? globalThis.Promise.resolve(existing) : this.loadNewAsync(specifier, referrer)
  }

  private async loadNewAsync(specifier: string, referrer: string | null): Promise<LinkedRecord> {
    const loaded = await this.fetchAsync(specifier, referrer)
    const existing = this.records.get(loaded.id)
    if (existing) return existing
    if ('exports' in loaded) return this.define(loaded.id, loaded.exports)

    return this.loadRequestsAsync(this.create(loaded.id, compileLoaded(loaded)))
  }

  // The records of a module's requests; a module whose requests cannot be loaded is errored.
  private loadRequests(record: LinkedRecord): LinkedRecord {
    try {
      record.requested = compiledOf(record).requests.map(specifier => this.load(specifier, record.id))
    } catch (e) {
      this.fail(record, e)
    }

    return record
  }

  private async loadRequestsAsync(record: LinkedRecord): Promise<LinkedRecord> {
    try {
      // one after another, in source order, as the synchronous loader does
      // eslint-disable-next-line no-await-in-loop
      for (const specifier of compiledOf(record).requests) record.requested.push(await this.loadAsync(specifier, record.id))
    } catch (e) {
      this.fail(record, e)
    }

    return record
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

    return record
  }

  // Environments are created before the requests are linked, so cells of a cycle can point into them.
  private link(record: LinkedRecord) {
    if (record.status === 'errored') throw record.error
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

  // Depth-first, post-order. Returns the promise of an evaluation that waits for a top-level `await` (D51), or null
  // when it is done. A module evaluating on the current path (a cycle) is not re-entered; one that waits for its
  // dependencies or its body is waited for.
  private evaluate(record: LinkedRecord, path: Set<LinkedRecord>): PromiseObject | null {
    if (record.evaluation) return this.pendingEvaluation(record, record.evaluation, path)
    if (record.status === 'errored') throw record.error

    return record.status === 'linked' ? this.startEvaluation(record, path) : null
  }

  private pendingEvaluation(record: LinkedRecord, evaluation: PromiseObject, path: Set<LinkedRecord>): PromiseObject | null {
    return path.has(record) || evaluation.state === 'fulfilled' ? null : evaluation
  }

  private startEvaluation(record: LinkedRecord, path: Set<LinkedRecord>): PromiseObject | null {
    record.status = 'evaluating'

    return this.evaluateRequests(record, new Set(path).add(record))
  }

  // Every request is evaluated (or started) in order, as in JS; the body runs once none of them waits any more.
  // Requests evaluated before are not run again, so the continuation simply checks them all again.
  private evaluateRequests(record: LinkedRecord, path: Set<LinkedRecord>): PromiseObject | null {
    try {
      const waiting = this.startRequests(record, path)

      return waiting ? this.wait(record, waiting, () => this.evaluateRequests(record, path)) : this.body(record)
    } catch (e) {
      return this.fail(record, e)
    }
  }

  // The first request that waits, after all of them have been started.
  private startRequests(record: LinkedRecord, path: Set<LinkedRecord>): PromiseObject | null {
    let first: PromiseObject | null = null

    for (const dependency of record.requested) {
      const waiting = this.evaluate(dependency, path)

      first ??= waiting
    }

    return first
  }

  private body(record: LinkedRecord): PromiseObject | null {
    const body = this.vm.evaluateModule(record)

    return body ? this.wait(record, body, () => this.evaluated(record)) : this.evaluated(record)
  }

  private evaluated(record: LinkedRecord): null {
    record.status = 'evaluated'

    return null
  }

  // The evaluation goes on with `next` once `promise` is fulfilled. The module's own evaluation promise settles when
  // all of it is done, or is rejected with the first failure.
  private wait(record: LinkedRecord, promise: PromiseObject, next: () => PromiseObject | null): PromiseObject {
    const { promises } = this.vm
    const evaluation = record.evaluation ??= promises.create()

    promises.react(promise, () => this.resume(record, evaluation, next), (reason, frames) => {
      this.failAsync(record, evaluation, reason, frames)
    })

    return evaluation
  }

  private resume(record: LinkedRecord, evaluation: PromiseObject, next: () => PromiseObject | null) {
    try {
      if (next() === null) this.vm.promises.resolve(evaluation, null)
    } catch (e) {
      const { value, frames } = this.rejection(e)

      this.failAsync(record, evaluation, value, frames)
    }
  }

  private failAsync(record: LinkedRecord, evaluation: PromiseObject, reason: Value, frames: ScriptStackFrame[]) {
    record.status = 'errored'
    record.error = this.vm.toHostError(new ScriptThrow(reason, frames))
    this.vm.promises.reject(evaluation, reason, frames)
  }

  // A failure host code saw (a module body's uncaught exception), as the script exception it stands for.
  private rejection(error: unknown): ScriptThrow {
    if (!(error instanceof PScriptRuntimeError) || error.value === undefined) return this.vm.fromHost(error)

    return new ScriptThrow(this.vm.interop.toScript(error.value), error.scriptStack)
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

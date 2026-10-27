// The Interpreter class and the one-shot run() (§5.8).
import { compile } from '@/compiler/compiler'
import type { CompiledScript } from '@/compiler/function-proto'
import { toHost, toScript } from '@/runtime/interop'
import { createRealm, defineGlobal } from '@/runtime/realm'
import { memoryLoader, type ModuleLoader } from '@/modules/loader'
import type { BindingCell } from '@/modules/module-record'
import { ModuleRegistry, type LinkedRecord } from '@/modules/registry'
import { UNINITIALIZED, type Realm } from '@/runtime/values'
import { installStdlib } from '@/stdlib'
import { VM } from '@/vm/vm'

/**
 * Options of an `Interpreter`.
 */
export interface InterpreterOptions {
  /** extra globals; each value goes through toScript */
  globals?: Record<string, unknown>
  /** receives `print` output; default: the host's console.log */
  stdout?: (text: string) => void
  /** receives error output */
  stderr?: (text: string) => void
  /** default: Infinity (D14) */
  maxSteps?: number
  /** default: 10 000; Infinity allowed (D14) */
  maxCallDepth?: number
  /** `Math.random` override (deterministic tests) */
  random?: () => number
  /** resolves and loads modules (§4.7.3); takes precedence over `modules` */
  moduleLoader?: ModuleLoader
  /** in-memory modules for the built-in loader: source text or host exports, by id */
  modules?: Record<string, string | Record<string, unknown>>
}

/**
 * Options of `run()` and `Interpreter.run()`.
 */
export interface RunOptions {
  /** file name used in error messages */
  fileName?: string
}

/**
 * Options of `Interpreter.runModule()`.
 */
export interface ModuleRunOptions {
  /** the module's id: relative imports resolve against it, errors name it (default `main`) */
  id?: string
}

const DEFAULTS = {
  globals: {},
  stdout: (text: string) => console.log(text),
  stderr: (text: string) => console.error(text),
  maxSteps: Infinity,
  maxCallDepth: 10_000,
  random: Math.random,
  moduleLoader: undefined,
  modules: {},
} satisfies InterpreterOptions

function withDefaults(options: InterpreterOptions): typeof DEFAULTS & InterpreterOptions {
  const given = globalThis.Object.entries(options).filter(([, value]) => value !== undefined)

  return { ...DEFAULTS, ...globalThis.Object.fromEntries(given) }
}

export class Interpreter {
  private readonly realm: Realm
  private readonly vm: VM
  private readonly modules: ModuleRegistry

  constructor(options: InterpreterOptions = {}) {
    const { globals, stdout, stderr, random, maxSteps, maxCallDepth, moduleLoader, modules } = withDefaults(options)

    this.realm = createRealm()
    installStdlib(this.realm, { stdout, stderr, random })
    this.vm = new VM(this.realm, { maxSteps, maxCallDepth })
    this.modules = new ModuleRegistry(moduleLoader ?? memoryLoader(modules), this.vm)

    for (const [name, value] of globalThis.Object.entries(globals)) this.set(name, value)
  }

  /**
   * Compiles and runs a script.
   *
   * @param source source text
   * @param options file name
   * @returns the completion value (§4.4.10)
   */
  run(source: string, options: RunOptions = {}): unknown {
    return this.execute(compile(source, options))
  }

  /**
   * Runs a precompiled script.
   *
   * @param script compiled script
   * @returns the completion value (§4.4.10)
   */
  execute(script: CompiledScript): unknown {
    return toHost(this.vm.execute(script))
  }

  /**
   * Runs an entry module given as source text, after its dependencies (§4.7, D20).
   *
   * @param source module source
   * @param options the module's id
   * @returns a live, read-only view of the module's exports
   */
  runModule(source: string, options: ModuleRunOptions = {}): Record<string, unknown> {
    return this.namespaceView(this.modules.runSource(source, options.id ?? 'main'))
  }

  /**
   * Loads a module through the loader, evaluating it (and its dependencies) once.
   *
   * @param specifier module specifier
   * @returns a live, read-only view of the module's exports
   */
  importModule(specifier: string): Record<string, unknown> {
    return this.namespaceView(this.modules.import(specifier, null))
  }

  // Each property reads the export's binding on access (live, §4.7.2); uninitialised bindings read as undefined.
  private namespaceView(record: LinkedRecord): Record<string, unknown> {
    const view = globalThis.Object.create(null) as Record<string, unknown>

    for (const name of this.modules.exportNames(record)) {
      const cell = this.modules.resolveExport(record, name, new Set()) as BindingCell
      const get = () => {
        const value = cell.env.slots[cell.slot]

        return value === UNINITIALIZED ? undefined : toHost(value)
      }

      globalThis.Object.defineProperty(view, name, { get, enumerable: true })
    }

    return globalThis.Object.freeze(view)
  }

  /**
   * Reads a script-level binding (top-level declaration of an earlier `run`) or a global.
   *
   * @param name binding name
   * @returns its value, or `undefined` when there is no such binding or it is uninitialised
   */
  get(name: string): unknown {
    return toHost(this.vm.globals.peek(name))
  }

  /**
   * Defines or overwrites a global.
   *
   * @param name binding name
   * @param value host value
   */
  set(name: string, value: unknown) {
    defineGlobal(this.realm, name, toScript(value))
  }
}

/**
 * Runs a script in a fresh interpreter.
 *
 * @param source source text
 * @param options interpreter options
 * @returns the completion value
 */
export function run(source: string, options: InterpreterOptions & RunOptions = {}): unknown {
  return new Interpreter(options).run(source, { fileName: options.fileName })
}

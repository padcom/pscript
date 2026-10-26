// The Interpreter class and the one-shot run() (§5.8).
import { compile } from '@/compiler/compiler'
import type { CompiledScript } from '@/compiler/function-proto'
import { toHost, toScript } from '@/runtime/interop'
import { createRealm, defineGlobal } from '@/runtime/realm'
import type { Realm } from '@/runtime/values'
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
}

/**
 * Options of `run()` and `Interpreter.run()`.
 */
export interface RunOptions {
  /** file name used in error messages */
  fileName?: string
}

const DEFAULTS = {
  globals: {},
  stdout: (text: string) => console.log(text),
  stderr: (text: string) => console.error(text),
  maxSteps: Infinity,
  maxCallDepth: 10_000,
} satisfies Required<InterpreterOptions>

function withDefaults(options: InterpreterOptions): Required<InterpreterOptions> {
  const given = globalThis.Object.entries(options).filter(([, value]) => value !== undefined)

  return { ...DEFAULTS, ...globalThis.Object.fromEntries(given) }
}

export class Interpreter {
  private readonly realm: Realm
  private readonly vm: VM

  constructor(options: InterpreterOptions = {}) {
    const { globals, stdout, maxSteps, maxCallDepth } = withDefaults(options)

    this.realm = createRealm()
    installStdlib(this.realm, { stdout })
    this.vm = new VM(this.realm, { maxSteps, maxCallDepth })

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

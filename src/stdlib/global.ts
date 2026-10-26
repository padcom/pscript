// Global functions (§4.6.1): print, console, globalThis.
import { formatValue } from '@/runtime/format'
import { GlobalObject } from '@/runtime/global-object'
import { defineGlobal } from '@/runtime/realm'
import { NativeFunction, Object as ScriptObject, type NativeImpl, type Realm } from '@/runtime/values'
import { defineMethods, method } from './native'

/**
 * Host I/O used by the standard library.
 */
export interface StdlibIO {
  /** receives one line per `print` / `console.log` call */
  stdout: (text: string) => void
  /** receives one line per `console.error` call */
  stderr: (text: string) => void
  /** source of `Math.random` */
  random: () => number
}

function writer(output: (text: string) => void): NativeImpl {
  return (_, __, args) => {
    output(args.map(formatValue).join(' '))

    return null // natives that return nothing give null (D37)
  }
}

/**
 * Installs `print`, `console` and `globalThis` (read-only, like every stdlib global, §4.4.4).
 *
 * @param realm the realm
 * @param io host output
 */
export function installGlobals(realm: Realm, io: StdlibIO) {
  const console = new ScriptObject(realm.ObjectPrototype)

  defineGlobal(realm, 'print', new NativeFunction(realm.FunctionPrototype, 'print', 0, writer(io.stdout)), true)
  defineMethods(realm, console, {
    log: method(0, writer(io.stdout)),
    error: method(0, writer(io.stderr)),
  })
  defineGlobal(realm, 'console', console, true)
  defineGlobal(realm, 'globalThis', new GlobalObject(realm.ObjectPrototype, realm), true)
}

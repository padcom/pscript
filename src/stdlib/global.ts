// Global functions (§4.6.1).
import { formatValue } from '@/runtime/format'
import { defineGlobal } from '@/runtime/realm'
import { NativeFunction, type Realm } from '@/runtime/values'

/**
 * Host I/O used by the standard library.
 */
export interface StdlibIO {
  /** receives one line per `print` call */
  stdout: (text: string) => void
}

/**
 * Installs `print` (read-only, like every stdlib global, §4.4.4).
 *
 * @param realm the realm
 * @param io host output
 */
export function installGlobals(realm: Realm, io: StdlibIO) {
  defineGlobal(realm, 'print', new NativeFunction(realm.FunctionPrototype, 'print', 0, (_, __, args) => {
    io.stdout(args.map(formatValue).join(' '))

    return null
  }), true)
}

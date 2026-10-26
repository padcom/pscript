// Standard library installation (§4.6).
import type { Realm } from '@/runtime/values'
import { installArray } from './array'
import { installErrors } from './errors'
import { installGlobals, type StdlibIO } from './global'

export type { StdlibIO }

/**
 * Installs the standard library into a realm.
 *
 * @param realm the realm
 * @param io host output
 */
export function installStdlib(realm: Realm, io: StdlibIO) {
  installGlobals(realm, io)
  installArray(realm)
  installErrors(realm)
}

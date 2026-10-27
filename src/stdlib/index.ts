// Standard library installation (§4.6).
import { createRealm } from '@/runtime/realm'
import type { Realm } from '@/runtime/values'
import { installArray } from './array'
import { installErrors } from './errors'
import { installFunction } from './function'
import { installGenerator } from './generator'
import { installGlobals, type StdlibIO } from './global'
import { installJson } from './json'
import { installMath } from './math'
import { installNumber } from './number'
import { installObject } from './object'
import { installPromise } from './promise'
import { installString } from './string'

export type { StdlibIO }

/**
 * Installs the standard library into a realm.
 *
 * @param realm the realm
 * @param io host output and the random source (both optional for tests)
 */
export function installStdlib(realm: Realm, io: Partial<StdlibIO> & Pick<StdlibIO, 'stdout'>) {
  installGlobals(realm, { stderr: io.stdout, random: Math.random, ...io })
  installObject(realm)
  installFunction(realm)
  installArray(realm)
  installString(realm)
  installNumber(realm)
  installMath(realm, io.random ?? Math.random)
  installJson(realm)
  installErrors(realm)
  installGenerator(realm)
  installPromise(realm)
}

let globalNames: ReadonlySet<string> | null = null

/**
 * Names of the standard-library globals, for compile-time checks (the implicit-member ambiguity rule, §4.5.8).
 *
 * @returns the names
 */
export function stdlibGlobalNames(): ReadonlySet<string> {
  if (!globalNames) {
    const realm = createRealm()

    installStdlib(realm, { stdout: () => {} })
    globalNames = new Set(realm.globals.keys())
  }

  return globalNames
}

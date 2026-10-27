// Standard library installation (§4.6).
import { createRealm } from '@/runtime/realm'
import type { Realm } from '@/runtime/values'
import { installArray } from './array'
import { installErrors } from './errors'
import { installFunction } from './function'
import { installGenerator } from './generator'
import { installGlobals, type StdlibIO } from './global'
import { installHost, type HostIO } from './host'
import { installJson } from './json'
import { installMath } from './math'
import { installNumber } from './number'
import { installObject } from './object'
import { installPromise } from './promise'
import { installString } from './string'

export type { HostIO, StdlibIO }

// The host's own timers and fetch, looked up on each call (so test doubles installed later are used).
const HOST: HostIO = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: handle => globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0]),
  fetch: (input, init) => globalThis.fetch(input as Parameters<typeof fetch>[0], init as RequestInit),
}

function hostIO(io: Partial<HostIO>): HostIO {
  const given = globalThis.Object.entries(io).filter(([key, value]) => key in HOST && value !== undefined)

  return { ...HOST, ...globalThis.Object.fromEntries(given) }
}

/**
 * Installs the standard library into a realm.
 *
 * @param realm the realm
 * @param io host output, the random source, timers and fetch (all but stdout optional for tests)
 */
export function installStdlib(realm: Realm, io: Partial<StdlibIO & HostIO> & Pick<StdlibIO, 'stdout'>) {
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
  installHost(realm, hostIO(io))
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

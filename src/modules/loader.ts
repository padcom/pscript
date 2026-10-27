// Module loading (§4.7.3, D19): the host's loader resolves a specifier to a canonical id and returns the source (or
// host exports). The built-in loader serves an in-memory map with POSIX-style relative paths and the D10 extensions.
import type { CompiledModule } from './module-record'

/**
 * What a module loader returns: a PScript module (source text, or already compiled with `compileModule()`), or a host
 * module's exports.
 */
export type LoadedModule
  = | { id: string, source: string }
    | { id: string, compiled: CompiledModule }
    | { id: string, exports: Record<string, unknown> }

/**
 * Resolves `specifier` (imported from module `referrer`, null for the entry) and loads it; throws when not found.
 */
export type ModuleLoader = (specifier: string, referrer: string | null) => LoadedModule

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

function dirname(id: string): string[] {
  return id.split('/').slice(0, -1)
}

const SKIPPED_SEGMENTS = new Set(['.', ''])

function normalize(segments: string[]): string {
  const result: string[] = []

  for (const segment of segments) {
    if (segment === '..') result.pop()
    else if (!SKIPPED_SEGMENTS.has(segment)) result.push(segment)
  }

  return result.join('/')
}

/**
 * Resolves a specifier against the id of the importing module: relative specifiers (`./`, `../`) are joined with the
 * referrer's directory and normalised; bare specifiers stay as they are.
 *
 * @param specifier the import specifier
 * @param referrer id of the importing module, or null
 * @returns the module id to look up
 */
export function resolveSpecifier(specifier: string, referrer: string | null): string {
  if (!isRelative(specifier)) return specifier

  return normalize([...dirname(referrer ?? ''), ...specifier.split('/')])
}

const EXTENSIONS = ['.pscript', '.psc']

// The exact id first, then the extensions (D10); both extensions present is an error.
function findId(modules: Record<string, unknown>, id: string): string {
  if (Object.hasOwn(modules, id)) return id

  const found = EXTENSIONS.map(extension => id + extension).filter(candidate => Object.hasOwn(modules, candidate))
  if (found.length > 1) throw new Error(`ambiguous module '${id}': ${found.join(' and ')}`)
  if (found.length === 0) throw new Error(`no module '${id}'`)

  return found[0]
}

/**
 * The built-in loader over an in-memory map `{ [id]: source | exports }` (§4.7.3).
 *
 * @param modules module sources (strings) and host exports (objects), by id
 * @returns the loader
 */
export function memoryLoader(modules: Record<string, string | Record<string, unknown>>): ModuleLoader {
  return (specifier, referrer) => {
    const id = findId(modules, resolveSpecifier(specifier, referrer))
    const entry = modules[id]

    return typeof entry === 'string' ? { id, source: entry } : { id, exports: entry }
  }
}

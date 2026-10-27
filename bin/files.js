// File-system helpers of the command-line tools: PScript files are found by their exact path first, then with the
// D10 extensions.
import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

export const EXTENSIONS = ['.pscript', '.psc']

/**
 * Whether a path is an existing file.
 *
 * @param {string} path the path
 * @returns {boolean} true for a file
 */
export function isFile(path) {
  return existsSync(path) && statSync(path).isFile()
}

/**
 * Whether a path is an existing directory.
 *
 * @param {string} path the path
 * @returns {boolean} true for a directory
 */
export function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory()
}

/**
 * Finds a file: the exact path first, then with the extensions (D10); both extensions present is an error.
 *
 * @param {string} path the path, possibly without extension
 * @param {string} kind what is looked for, for error messages
 * @returns {string} the path of the file
 */
export function findFile(path, kind) {
  if (isFile(path)) return path

  const found = EXTENSIONS.map(extension => path + extension).filter(isFile)
  if (found.length !== 1) {
    throw new Error(found.length === 0 ? `no ${kind} '${path}'` : `ambiguous ${kind} '${path}': ${found.join(' and ')}`)
  }

  return found[0]
}

/**
 * Whether a module specifier is a file path (relative or absolute).
 *
 * @param {string} specifier the specifier
 * @returns {boolean} true for a path
 */
export function isPath(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../') || isAbsolute(specifier)
}

/**
 * Whether a path names a PScript file.
 *
 * @param {string} path the path
 * @returns {boolean} true for `.pscript` and `.psc` files
 */
export function isPScriptFile(path) {
  return EXTENSIONS.some(extension => path.endsWith(extension))
}

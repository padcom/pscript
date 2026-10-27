// Modules of the emitted code (P9): native ES modules, with relative specifiers pointing at the emitted `.js` files.
import type { ExportSpecifier, ImportDeclaration, ImportSpecifier, Literal, ModuleDeclaration, Node, Program } from '@/parser/ast'

const SCRIPT_EXTENSION = /\.(?:pscript|psc)$/

/** The last path segment has an extension (`./data.json`; not `./lib` or `..`). */
const HAS_EXTENSION = /\/[^/]*[^/.]\.[^/.]+$/

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

/**
 * The specifier of an import in the emitted code: a relative specifier names the emitted `.js` file (the
 * `.pscript`/`.psc` extension is replaced, an extensionless one gets `.js`); bare and `host:` specifiers stay as they
 * are.
 *
 * @param specifier the PScript specifier
 * @returns the JavaScript specifier
 */
export function outputSpecifier(specifier: string): string {
  if (!isRelative(specifier)) return specifier
  if (SCRIPT_EXTENSION.test(specifier)) return specifier.replace(SCRIPT_EXTENSION, '.js')

  return HAS_EXTENSION.test(specifier) ? specifier : `${specifier}.js`
}

/**
 * The source literal of a module declaration, with the specifier rewritten.
 *
 * @param source the specifier literal
 * @returns the quoted JavaScript specifier
 */
export function sourceText(source: Literal): string {
  const [quote] = source.raw
  const text = outputSpecifier(source.value as string)

  return quote + text.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`) + quote
}

function renamed(from: string, to: string): string {
  return from === to ? from : `${from} as ${to}`
}

/**
 * `{ a, b as c }` of an export.
 *
 * @param specifiers the exported names
 * @returns the specifier list
 */
export function exportList(specifiers: ExportSpecifier[]): string {
  const names = specifiers.map(({ local, exported }) => renamed(local.name, exported.name))

  return names.length === 0 ? '{}' : `{ ${names.join(', ')} }`
}

/**
 * The bindings of an import: `{ a, b as c }`, `* as ns`, or nothing for a side-effect import.
 *
 * @param node the import
 * @returns the import clause followed by ` from `, or an empty string
 */
export function importClause(node: ImportDeclaration): string {
  const { specifiers } = node
  if (specifiers.length === 0) return ''

  const [first] = specifiers
  if (first.type === 'ImportNamespaceSpecifier') return `* as ${first.local.name} from `

  const names = (specifiers as ImportSpecifier[]).map(({ imported, local }) => renamed(imported.name, local.name))

  return `{ ${names.join(', ')} } from `
}

/**
 * Whether a node is an `import` or `export` declaration.
 *
 * @param node a top-level node
 * @returns true for module declarations
 */
export function isModuleDeclaration(node: Node): node is ModuleDeclaration {
  return node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration'
}

/**
 * Whether a program has `import` or `export` declarations, i.e. is a module.
 *
 * @param program the program
 * @returns true for a module
 */
export function hasModuleDeclarations(program: Program): boolean {
  return program.body.some(isModuleDeclaration)
}

// The modules of one psc run (P10, T4): how their specifiers resolve to each other, which binding an import or export
// names (following re-exports, like the linker of §4.7), and the compile-time signatures of their top-level functions.
import { signatureOf, type Signature } from '@/compiler/signature'
import { PScriptSyntaxError, formatExcerpt } from '@/errors'
import { resolveSpecifier } from '@/modules/loader'
import type {
  Expression,
  Literal,
  ModuleDeclaration,
  Program,
  Statement,
  VariableDeclaration,
  VariableDeclarator,
} from '@/parser/ast'
import { boundNames } from '@/parser/patterns'
import { isModuleDeclaration } from './modules'

const EXTENSIONS = ['.pscript', '.psc']

/** `import { name } from 'specifier'` (`*` for a namespace import), or a re-export of `name`. */
interface ImportedName {
  /** the module specifier */
  specifier: string
  /** the export it names, `*` for the namespace */
  name: string
}

/** What an export of a module is: one of its own bindings, or a re-export. */
type ExportEntry = { local: string } | ImportedName

/**
 * A binding of the program: a module's own top-level binding, or a module's namespace object.
 */
export type Binding = { module: string, local: string } | { namespace: string }

/**
 * One module (or script) of the program.
 */
export interface ProgramUnit {
  /** the module id: a POSIX path, as the interpreter's in-memory loader uses */
  id: string
  /** source text */
  source: string
  /** the checked program */
  program: Program
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

/**
 * The error of a module at a node, with the code excerpt.
 *
 * @param unit the module
 * @param reason the message
 * @param line 1-based line
 * @param column 1-based column
 * @returns the error
 */
export function unitError(unit: ProgramUnit, reason: string, line: number, column = 1): PScriptSyntaxError {
  return new PScriptSyntaxError(reason, { fileName: unit.id, line, column, excerpt: formatExcerpt(unit.source, line, column) })
}

function isFunction(node: Expression | null): node is Extract<Expression, { params: unknown }> {
  return node?.type === 'FunctionExpression' || node?.type === 'ArrowFunctionExpression'
}

function constSignature({ id, init }: VariableDeclarator): [string, Signature][] {
  return isFunction(init) && id.type === 'Identifier' ? [[id.name, signatureOf(id.name, init.params)]] : []
}

// A `const` bound to a function expression has a signature, as in the compiler (D38).
function constSignatures({ kind, declarations }: VariableDeclaration): [string, Signature][] {
  if (kind !== 'const') return []

  return declarations.flatMap(constSignature)
}

function signaturesOf(statement: Statement): [string, Signature][] {
  if (statement.type === 'FunctionDeclaration') return [[statement.id.name, signatureOf(statement.id.name, statement.params)]]

  return statement.type === 'VariableDeclaration' ? constSignatures(statement) : []
}

function declaredNames(statement: Statement): string[] {
  if (statement.type === 'VariableDeclaration') {
    return statement.declarations.flatMap(({ id }) => boundNames(id)).map(({ name }) => name)
  }

  return 'id' in statement && statement.id ? [(statement.id as { name: string }).name] : []
}

/**
 * The imports, exports and top-level signatures of a module.
 */
class ModuleTables {
  readonly imports = new Map<string, ImportedName>()
  readonly exports = new Map<string, ExportEntry>()
  readonly signatures = new Map<string, Signature>()
  /** every specifier the module requests, with its declaration */
  readonly requests: { specifier: string, node: Literal }[] = []

  constructor(program: Program) {
    program.body.forEach(node => isModuleDeclaration(node) ? this.moduleDeclaration(node) : this.statement(node))
  }

  private statement(statement: Statement) {
    signaturesOf(statement).forEach(([name, signature]) => this.signatures.set(name, signature))
  }

  private moduleDeclaration(node: ModuleDeclaration) {
    if (node.source) this.requests.push({ specifier: node.source.value as string, node: node.source })
    if (node.type === 'ImportDeclaration') this.importDeclaration(node)
    else this.exportDeclaration(node)
  }

  private importDeclaration({ specifiers, source }: Extract<ModuleDeclaration, { type: 'ImportDeclaration' }>) {
    for (const specifier of specifiers) {
      const name = specifier.type === 'ImportSpecifier' ? specifier.imported.name : '*'

      this.imports.set(specifier.local.name, { specifier: source.value as string, name })
    }
  }

  private exportDeclaration({ declaration, specifiers, source }: Extract<ModuleDeclaration, { type: 'ExportNamedDeclaration' }>) {
    if (declaration) {
      this.statement(declaration)
      declaredNames(declaration).forEach(name => this.exports.set(name, { local: name }))
    }

    for (const { local, exported } of specifiers) {
      this.exports.set(exported.name, source ? { specifier: source.value as string, name: local.name } : { local: local.name })
    }
  }
}

/**
 * The modules of a program and the links between them.
 */
export class ModuleGraph {
  private readonly units = new Map<string, ProgramUnit>()
  private readonly tables = new Map<string, ModuleTables>()
  /** the module each request of a module resolves to; null for a module outside the program */
  private readonly resolved = new Map<string, Map<string, string | null>>()

  constructor(units: ProgramUnit[]) {
    units.forEach(unit => {
      this.units.set(unit.id, unit)
      this.tables.set(unit.id, new ModuleTables(unit.program))
    })
    units.forEach(unit => this.resolveRequests(unit))
  }

  /**
   * The modules' ids, in the order they were given.
   *
   * @returns the ids
   */
  ids(): string[] {
    return [...this.units.keys()]
  }

  /**
   * One module.
   *
   * @param id the module id
   * @returns the module
   */
  unit(id: string): ProgramUnit {
    return this.units.get(id)!
  }

  /**
   * The module a specifier of a module resolves to.
   *
   * @param id the importing module
   * @param specifier the specifier
   * @returns the module id, or null for a module outside the program
   */
  request(id: string, specifier: string): string | null {
    return this.resolved.get(id)?.get(specifier) ?? null
  }

  /**
   * The specifiers a module requests.
   *
   * @param id the module id
   * @returns the specifiers, in source order
   */
  requests(id: string): string[] {
    return [...this.resolved.get(id)!.keys()]
  }

  /**
   * The export names of a module.
   *
   * @param id the module id
   * @returns the names
   */
  exportNames(id: string): string[] {
    return [...this.tables.get(id)!.exports.keys()]
  }

  /**
   * The names a module imports or re-exports from a specifier (`*` for a namespace).
   *
   * @param id the importing module
   * @param specifier the specifier
   * @returns the names
   */
  importedNames(id: string, specifier: string): string[] {
    const { imports, exports } = this.tables.get(id)!
    const entries = [...imports.values(), ...exports.values()]

    return entries.flatMap(entry => 'specifier' in entry && entry.specifier === specifier ? [entry.name] : [])
  }

  /**
   * The modules in dependency order: a module comes after the modules it imports (except around cycles).
   *
   * @returns the module ids
   */
  order(): string[] {
    const order: string[] = []
    const visiting = new Set<string>()

    this.ids().forEach(id => this.visit(id, order, visiting))

    return order
  }

  private visit(id: string, order: string[], visiting: Set<string>) {
    if (visiting.has(id)) return
    visiting.add(id)

    for (const specifier of this.requests(id)) {
      const target = this.request(id, specifier)

      if (target !== null) this.visit(target, order, visiting)
    }
    order.push(id)
  }

  /**
   * The binding behind an imported name of a module.
   *
   * @param id the importing module
   * @param local the local name of the import
   * @returns the binding, or null when it is not an import or comes from outside the program
   */
  importBinding(id: string, local: string): Binding | null {
    const imported = this.tables.get(id)?.imports.get(local)

    return imported ? this.follow(id, imported, new Set()) : null
  }

  /**
   * The binding behind an export of a module, following re-exports.
   *
   * @param id the module id
   * @param name the export name
   * @param visiting exports being followed (cycles resolve to null; linking reports them)
   * @returns the binding, or null when there is none in the program
   */
  exportBinding(id: string, name: string, visiting: Set<string>): Binding | null {
    const key = `${id}\u0000${name}`
    const entry = this.tables.get(id)!.exports.get(name)
    if (!entry || visiting.has(key)) return null
    visiting.add(key)

    return this.entryBinding(id, entry, visiting)
  }

  private entryBinding(id: string, entry: ExportEntry, visiting: Set<string>): Binding | null {
    if ('specifier' in entry) return this.follow(id, entry, visiting)

    const imported = this.tables.get(id)!.imports.get(entry.local)

    return imported ? this.follow(id, imported, visiting) : { module: id, local: entry.local }
  }

  /**
   * The compile-time signature of a top-level function of a module.
   *
   * @param binding the binding
   * @returns the signature, if the binding is a function declaration or a `const` bound to a function
   */
  signature(binding: Binding | null): Signature | undefined {
    return binding && 'module' in binding ? this.tables.get(binding.module)!.signatures.get(binding.local) : undefined
  }

  private follow(id: string, { specifier, name }: ImportedName, visiting: Set<string>): Binding | null {
    const target = this.request(id, specifier)
    if (target === null) return null

    return name === '*' ? { namespace: target } : this.exportBinding(target, name, visiting)
  }

  private resolveRequests(unit: ProgramUnit) {
    const resolved = new Map<string, string | null>()

    for (const { specifier, node } of this.tables.get(unit.id)!.requests) {
      resolved.set(specifier, this.resolve(unit, specifier, node))
    }
    this.resolved.set(unit.id, resolved)
  }

  // Relative specifiers resolve like the interpreter's in-memory loader: the exact id, then the D10 extensions.
  private resolve(unit: ProgramUnit, specifier: string, node: Literal): string | null {
    if (!isRelative(specifier)) return null

    const id = resolveSpecifier(specifier, unit.id)

    return this.units.has(id) ? id : this.withExtension(unit, id, node)
  }

  private withExtension(unit: ProgramUnit, id: string, node: Literal): string | null {
    const found = EXTENSIONS.map(extension => id + extension).filter(candidate => this.units.has(candidate))
    if (found.length > 1) {
      const { line, column } = node.loc.start

      throw unitError(unit, `ambiguous module '${node.value as string}': ${found.join(' and ')}`, line, column)
    }

    return found[0] ?? null
  }
}

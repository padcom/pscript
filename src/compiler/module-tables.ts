// The import/export tables of a module being compiled (§4.7.2, §5.5 "Module goal").
import type { ExportNamedDeclaration, ExportSpecifier, ImportDeclaration, Literal, SourceLocation } from '@/parser/ast'
import type { ModuleImportEntry, ModuleIndirectExport, ModuleLocalExport } from '@/modules/module-record'
import type { Binding } from './scope'

type Fail = (reason: string, loc: SourceLocation) => Error

/**
 * Collects requests, imports and exports while a module is compiled.
 */
export class ModuleTables {
  readonly requests: string[] = []
  readonly imports: ModuleImportEntry[] = []
  readonly localExports: ModuleLocalExport[] = []
  readonly indirectExports: ModuleIndirectExport[] = []
  private exportNames = new Set<string>()

  constructor(private fail: Fail) {}

  // The same specifier always maps to the same request.
  request(source: Literal): number {
    const specifier = source.value as string
    const index = this.requests.indexOf(specifier)

    return index >= 0 ? index : this.requests.push(specifier) - 1
  }

  /**
   * Records the imports of a declaration (side-effect imports only make a request).
   *
   * @param node the import declaration
   * @returns the new entries, whose indexes are the `LOAD_IMPORT` operands
   */
  addImports(node: ImportDeclaration): ModuleImportEntry[] {
    const request = this.request(node.source)

    return node.specifiers.map(specifier => {
      const importName = specifier.type === 'ImportSpecifier' ? specifier.imported.name : '*'
      const entry = { request, importName, localName: specifier.local.name, loc: specifier.loc }

      this.imports.push(entry)

      return entry
    })
  }

  private exportName(name: string, loc: SourceLocation) {
    if (this.exportNames.has(name)) throw this.fail(`Duplicate export of '${name}'`, loc)
    this.exportNames.add(name)
  }

  /**
   * Records an exported top-level binding: a local slot, or (for an import) a re-export of the imported binding.
   *
   * @param exportName name visible to importers
   * @param binding the module-level binding
   * @param loc the export
   */
  addLocal(exportName: string, binding: Binding, loc: SourceLocation) {
    this.exportName(exportName, loc)

    if (binding.importIndex === undefined) {
      this.localExports.push({ exportName, slot: binding.slot })

      return
    }
    const { request, importName } = this.imports[binding.importIndex]

    this.indirectExports.push({ exportName, request, importName, loc })
  }

  /**
   * Records `export { a as b } from 'm'`: re-exports without a local binding.
   *
   * @param node the export declaration
   */
  addReexports(node: ExportNamedDeclaration) {
    const request = this.request(node.source as Literal)

    for (const { local, exported, loc } of node.specifiers) {
      this.exportName(exported.name, loc)
      this.indirectExports.push({ exportName: exported.name, request, importName: local.name, loc })
    }
  }

  /**
   * Records `export { a, b as c }`, checking that each name is a top-level binding of the module.
   *
   * @param specifiers the export list
   * @param lookup finds a module-level binding
   */
  addList(specifiers: ExportSpecifier[], lookup: (name: string) => Binding | undefined) {
    for (const { local, exported, loc } of specifiers) {
      const binding = lookup(local.name)
      if (!binding) throw this.fail(`Export '${local.name}' is not defined in module`, local.loc)
      this.addLocal(exported.name, binding, loc)
    }
  }
}

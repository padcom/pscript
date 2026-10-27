// Import and export declarations (§4.7.1). They are only allowed at the top level of a module: the builders record
// every declaration, and `checkModuleDeclarations` checks them once the program is complete.
import type {
  ExportNamedDeclaration,
  ExportSpecifier,
  Identifier,
  ImportDeclaration,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  Literal,
  Program,
  SourceLocation,
} from './ast'
import { toLoc, type JisonLoc } from './ast-builders'

type ModuleNode = ImportDeclaration | ExportNamedDeclaration

/**
 * How the module builders report syntax errors.
 */
export interface ModuleErrors {
  /** an error at a node */
  at(reason: string, loc: SourceLocation): Error
  /** an error at a token */
  atToken(reason: string, loc: JisonLoc): Error
}

type SourceBuilder = (raw: string, loc: JisonLoc) => Literal

const SPECIFIER_BUILDERS = {
  importSpecifier(imported: Identifier, local: Identifier, loc: JisonLoc): ImportSpecifier {
    return { type: 'ImportSpecifier', imported, local, loc: toLoc(loc) }
  },
  namespaceSpecifier(local: Identifier, loc: JisonLoc): ImportNamespaceSpecifier {
    return { type: 'ImportNamespaceSpecifier', local, loc: toLoc(loc) }
  },
  exportSpecifier(local: Identifier, exported: Identifier, loc: JisonLoc): ExportSpecifier {
    return { type: 'ExportSpecifier', local, exported, loc: toLoc(loc) }
  },
}

/**
 * Builders for the module grammar rules.
 *
 * @param errors creates syntax errors
 * @param source builds the module specifier literal
 * @returns the builders, and the declarations built so far
 */
export function moduleBuilders(errors: ModuleErrors, source: SourceBuilder) {
  const declarations: ModuleNode[] = []
  const record = <T extends ModuleNode>(node: T): T => {
    declarations.push(node)

    return node
  }

  return {
    declarations,
    fail(reason: string, loc: JisonLoc): never {
      throw errors.atToken(reason, loc)
    },
    moduleSource: source,
    importDeclaration(specifiers: ImportDeclaration['specifiers'], raw: string, rawLoc: JisonLoc, loc: JisonLoc) {
      return record<ImportDeclaration>({ type: 'ImportDeclaration', specifiers, source: source(raw, rawLoc), loc: toLoc(loc) })
    },
    ...SPECIFIER_BUILDERS,
    exportDeclaration(
      declaration: ExportNamedDeclaration['declaration'],
      specifiers: ExportSpecifier[],
      from: Literal | null,
      loc: JisonLoc,
    ): ExportNamedDeclaration {
      return record({ type: 'ExportNamedDeclaration', declaration, specifiers, source: from, loc: toLoc(loc) })
    },
  }
}

/**
 * Rejects import and export declarations in scripts and below the top level of a module.
 *
 * @param errors creates syntax errors
 * @param program the parsed program
 * @param declarations every import/export declaration of the program
 */
export function checkModuleDeclarations(errors: ModuleErrors, program: Program, declarations: ModuleNode[]) {
  const [first] = declarations
  if (first && program.sourceType === 'script') throw errors.at('import and export are only allowed in modules', first.loc)

  const misplaced = declarations.find(node => !program.body.includes(node))
  if (misplaced) throw errors.at('import and export are only allowed at the top level of a module', misplaced.loc)
}

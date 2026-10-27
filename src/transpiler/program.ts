// Printing the files of a program (T4): scripts on their own, modules after the whole-program checks (P10) and in
// dependency order, so that an imported class is known when a class extending it is printed.
import type { ClassInfo } from '@/compiler/class-info'
import type { ClassNode } from './classes'
import { checkClassDefinitions } from './class-checks'
import { Emitter, type Imported, type ProgramContext } from './emitter'
import type { Binding, ModuleGraph, ProgramUnit } from './module-graph'
import { checkProgram } from './program-checks'
import { inlineSourceMapComment, type SourceMap } from './source-map'
import type { TranspileModulesOptions, TranspileResult } from './transpile'

function baseName(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1)
}

// The emitter's output, with the source map when asked for (P11). The generated file is taken to sit next to its
// source (`lib/a.pscript` → `lib/a.js`), so the map names both by their base names.
function output(emitter: Emitter, unit: ProgramUnit, { sourceMap }: TranspileModulesOptions): TranspileResult {
  if (!sourceMap) return { code: emitter.emit() }

  const { code, mappings } = emitter.emitMapped()
  const { id, source } = unit
  const file = `${baseName(id).replace(/\.(?:pscript|psc)$/, '')}.js`
  const map: SourceMap = { version: 3, file, sources: [baseName(id)], sourcesContent: [source], names: [], mappings }

  return { code: sourceMap === 'inline' ? `${code}${inlineSourceMapComment(map)}\n` : code, map }
}

/**
 * Checks and prints a script.
 *
 * @param unit the script
 * @param options the file name used in error messages, source maps
 * @returns the JavaScript code
 */
export function transpileScript(unit: ProgramUnit, options: TranspileModulesOptions & { fileName?: string }): TranspileResult {
  const { source, program } = unit

  checkClassDefinitions(program, source, options.fileName)

  return output(new Emitter(program, source, options.fileName), unit, options)
}

/**
 * Prints the modules of a program, sharing what the printed modules define.
 */
class ProgramPrinter {
  /** the top-level classes of each printed module */
  private readonly classes = new Map<string, Map<string, ClassInfo>>()
  private readonly classNodes = new Map<ClassInfo, ClassNode>()

  constructor(private readonly graph: ModuleGraph, private readonly options: TranspileModulesOptions) {}

  print(id: string): TranspileResult {
    const unit = this.graph.unit(id)
    const emitter = new Emitter(unit.program, unit.source, id, this.context(id))
    const result = output(emitter, unit, this.options)

    this.classes.set(id, emitter.topLevelClasses())

    return result
  }

  private context(id: string): ProgramContext {
    return {
      imported: (local, member) => this.imported(id, local, member),
      classNodes: this.classNodes,
    }
  }

  private imported(id: string, local: string, member?: string): Imported {
    const binding = this.graph.importBinding(id, local)
    if (member === undefined) return this.bindingInfo(binding)
    if (!binding || !('namespace' in binding)) return {}

    return this.bindingInfo(this.graph.exportBinding(binding.namespace, member, new Set()))
  }

  // A binding's class (once its module is printed) and signature.
  private bindingInfo(binding: Binding | null): Imported {
    const info = binding && 'module' in binding ? this.classes.get(binding.module)?.get(binding.local) : undefined

    return { info, signature: this.graph.signature(binding) }
  }
}

/**
 * Checks the modules of a program together (P10) and prints its files.
 *
 * @param graph the program
 * @param options source maps
 * @returns the JavaScript code by id
 */
export function transpileProgram(graph: ModuleGraph, options: TranspileModulesOptions): Map<string, TranspileResult> {
  const modules = graph.ids().filter(id => graph.unit(id).program.sourceType === 'module')
  const printer = new ProgramPrinter(graph, options)
  const script = (id: string) => transpileScript(graph.unit(id), { ...options, fileName: id })

  checkProgram(graph, modules)

  return new Map(graph.order().map(id => [id, modules.includes(id) ? printer.print(id) : script(id)]))
}

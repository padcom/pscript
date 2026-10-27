// Printing the files of a program (T4): scripts on their own, modules after the whole-program checks (P10) and in
// dependency order, so that an imported class is known when a class extending it is printed.
import type { ClassInfo } from '@/compiler/class-info'
import type { ClassNode } from './classes'
import { checkClassDefinitions } from './class-checks'
import { Emitter, type Imported, type ProgramContext } from './emitter'
import type { Binding, ModuleGraph, ProgramUnit } from './module-graph'
import { checkProgram } from './program-checks'
import type { TranspileResult } from './transpile'

/**
 * Checks and prints a script.
 *
 * @param unit the script
 * @param fileName the file name used in error messages
 * @returns the JavaScript code
 */
export function transpileScript(unit: ProgramUnit, fileName?: string): TranspileResult {
  const { source, program } = unit

  checkClassDefinitions(program, source, fileName)

  return { code: new Emitter(program, source, fileName).emit() }
}

/**
 * Prints the modules of a program, sharing what the printed modules define.
 */
class ProgramPrinter {
  /** the top-level classes of each printed module */
  private readonly classes = new Map<string, Map<string, ClassInfo>>()
  private readonly classNodes = new Map<ClassInfo, ClassNode>()

  constructor(private readonly graph: ModuleGraph) {}

  print(id: string): TranspileResult {
    const { program, source } = this.graph.unit(id)
    const emitter = new Emitter(program, source, id, this.context(id))
    const code = emitter.emit()

    this.classes.set(id, emitter.topLevelClasses())

    return { code }
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
 * @returns the JavaScript code by id
 */
export function transpileProgram(graph: ModuleGraph): Map<string, TranspileResult> {
  const modules = graph.ids().filter(id => graph.unit(id).program.sourceType === 'module')
  const printer = new ProgramPrinter(graph)

  checkProgram(graph, modules)

  return new Map(graph.order().map(id => [id, modules.includes(id) ? printer.print(id) : transpileScript(graph.unit(id), id)]))
}

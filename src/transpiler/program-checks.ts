// Whole-program checks (P10, T4): the definitions-only skeletons of all modules (P7) are linked and run together in a
// throwaway interpreter, so the checks the VM makes when modules are linked (missing exports, circular re-exports) and
// when classes are defined (overriding and `final` across modules, `implements` of imported interfaces, inherited-name
// ambiguity) are compile-time errors with the interpreter's messages. Modules outside the program are stand-ins
// exporting the names the program imports from them.
import { compileModule } from '@/compiler/compiler'
import { PScriptRuntimeError, PScriptSyntaxError } from '@/errors'
import { Interpreter } from '@/interpreter'
import { resolveSpecifier, type LoadedModule } from '@/modules/loader'
import type { CompiledModule } from '@/modules/module-record'
import type { Program } from '@/parser/ast'
import { Skeleton } from './class-checks'
import { unitError, type ModuleGraph } from './module-graph'

function localsOf(graph: ModuleGraph, id: string): string[] {
  const { body } = graph.unit(id).program

  return body.flatMap(node => node.type === 'ImportDeclaration' ? node.specifiers.map(({ local }) => local.name) : [])
}

// The imports of a module that are classes or interfaces defined by another module's skeleton.
function importedDefinitions(graph: ModuleGraph, id: string, definitions: Map<string, Set<string>>): Set<string> {
  return new Set(localsOf(graph, id).filter(local => {
    const binding = graph.importBinding(id, local)

    return binding !== null && 'module' in binding && definitions.get(binding.module)?.has(binding.local) === true
  }))
}

// One round: every skeleton, built with the definitions of the previous round. Returns whether a module defines more.
function buildRound(graph: ModuleGraph, definitions: Map<string, Set<string>>, built: Map<string, Program>): boolean {
  let grown = false

  for (const id of built.keys()) {
    const imported = importedDefinitions(graph, id, definitions)
    const skeleton = new Skeleton(graph.unit(id).program, { module: true, importedDefinitions: imported })

    built.set(id, skeleton.build())
    grown ||= skeleton.definitions().size > definitions.get(id)!.size
    definitions.set(id, skeleton.definitions())
  }

  return grown
}

/**
 * Builds the skeletons of the modules: a class extending an imported class is defined when the other module's
 * skeleton defines that class, which can depend on further imports, so the skeletons are rebuilt until the set of
 * definitions stops growing.
 *
 * @param graph the program
 * @param modules the modules to build skeletons of
 * @returns the skeletons by module id
 */
function skeletons(graph: ModuleGraph, modules: string[]): Map<string, Program> {
  const definitions = new Map(modules.map(id => [id, new Set<string>()]))
  const built = new Map(modules.map(id => [id, graph.unit(id).program]))

  while (buildRound(graph, definitions, built));

  return built
}

function compiledOrNull(program: Program, id: string): CompiledModule | null {
  try {
    return compileModule(program, id)
  } catch (error) {
    if (error instanceof PScriptSyntaxError) return null
    throw error
  }
}

// A skeleton that does not compile is a limit of the skeleton (the module itself compiled): its module is left out,
// and the other skeletons are rebuilt without its definitions.
function compiledSkeletons(graph: ModuleGraph, modules: string[]): Map<string, CompiledModule> {
  let included = modules

  for (;;) {
    const programs = [...skeletons(graph, included)]
    const result = new Map(programs.flatMap(([id, program]) => {
      const module = compiledOrNull(program, id)

      return module ? [[id, module] as const] : []
    }))
    if (result.size === included.length) return result

    included = included.filter(id => result.has(id))
  }
}

function namesImportedFrom(graph: ModuleGraph, key: string): string[] {
  return graph.ids().flatMap(id => graph.requests(id)
    .filter(specifier => graph.request(id, specifier) === null && resolveSpecifier(specifier, id) === key)
    .flatMap(specifier => graph.importedNames(id, specifier)))
}

// Modules outside the program, and modules left out, export what the program imports from them (as null).
function standIn(graph: ModuleGraph, key: string): Record<string, unknown> {
  const names = graph.ids().includes(key) ? graph.exportNames(key) : namesImportedFrom(graph, key)

  return Object.fromEntries(names.filter(name => name !== '*').map(name => [name, null]))
}

function loader(graph: ModuleGraph, modules: Map<string, CompiledModule>) {
  return (specifier: string, referrer: string | null): LoadedModule => {
    const id = referrer === null ? specifier : graph.request(referrer, specifier) ?? resolveSpecifier(specifier, referrer)
    const module = modules.get(id)

    return module ? { id, compiled: module } : { id, exports: standIn(graph, id) }
  }
}

// Reading an import before its module ran (a cycle) is left to the program's own run: the skeleton evaluates nested
// classes earlier than the program does.
function isSkeletonError(error: unknown): error is PScriptSyntaxError | PScriptRuntimeError {
  if (error instanceof PScriptRuntimeError) return error.scriptName !== 'ReferenceError'
  if (error instanceof PScriptSyntaxError) return true
  throw error
}

// An error of the skeletons as an error of the program, at the same place, with the program's code excerpt.
function programError(graph: ModuleGraph, error: PScriptSyntaxError | PScriptRuntimeError): PScriptSyntaxError {
  const { fileName, reason, line } = error
  const unit = graph.ids().find(id => id === fileName)
  if (unit === undefined || line === undefined) return new PScriptSyntaxError(reason)

  return unitError(graph.unit(unit), reason, line, error.column)
}

function importChecked(interpreter: Interpreter, id: string): unknown {
  try {
    interpreter.importModule(id)

    return null
  } catch (error) {
    return error
  }
}

/**
 * Links and defines the classes of all modules of a program.
 *
 * @param graph the program
 * @param modules the ids of its modules (scripts are checked on their own)
 * @throws {PScriptSyntaxError} on link and class-definition errors
 */
export function checkProgram(graph: ModuleGraph, modules: string[]) {
  const interpreter = new Interpreter({ moduleLoader: loader(graph, compiledSkeletons(graph, modules)), stdout: () => {} })

  for (const id of modules) {
    const error = importChecked(interpreter, id)

    if (error !== null && isSkeletonError(error)) throw programError(graph, error)
  }
}

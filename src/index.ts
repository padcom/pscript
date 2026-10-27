// Public API of PScript (§5.8).
export { parse, type ParseOptions } from './parser/parse'

export { compile, compileModule, type CompileOptions } from './compiler/compiler'

export { disassemble } from './compiler/disassembler'

export {
  transpile,
  transpileModules,
  type TranspileModulesOptions,
  type TranspileOptions,
  type TranspileResult,
} from './transpiler/transpile'

export type { SourceMap } from './transpiler/source-map'

export { Interpreter, run, type InterpreterOptions, type ModuleRunOptions, type RunOptions } from './interpreter'

export { markAsClass } from './runtime/interop'

export { PScriptError, PScriptRuntimeError, PScriptSyntaxError } from './errors'

export type { CompiledScript, FunctionProto } from './compiler/function-proto'

export type { CompiledModule } from './modules/module-record'

export type { LoadedModule, ModuleLoader } from './modules/loader'

export type * from './parser/ast'

// Public API of PScript (§5.8).
export { parse, type ParseOptions } from './parser/parse'

export { compile, compileModule, type CompileOptions } from './compiler/compiler'

export { disassemble } from './compiler/disassembler'

export { Interpreter, run, type InterpreterOptions, type RunOptions } from './interpreter'

export { PScriptError, PScriptRuntimeError, PScriptSyntaxError } from './errors'

export type { CompiledScript, FunctionProto } from './compiler/function-proto'

export type { CompiledModule } from './modules/module-record'

export type { LoadedModule, ModuleLoader } from './modules/loader'

export type * from './parser/ast'

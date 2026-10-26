// Bytecode contract (§5.4): compiled functions, class and interface templates.
import type { Access, SourceLocation } from '@/parser/ast'

export type FunctionKind
  = 'script' | 'module' | 'function' | 'arrow' | 'method' | 'getter' | 'setter'
    | 'constructor' | 'derivedConstructor' | 'fieldInit' | 'staticInit'

/**
 * A compiled function: bytecode, constant pool and debug information.
 */
export interface FunctionProto {
  /** function name (empty when anonymous) */
  name: string
  /** what the function was compiled from */
  kind: FunctionKind
  /** formal parameters excluding rest */
  paramCount: number
  /** JS `fn.length` */
  length: number
  /** whether the last parameter is a rest parameter */
  hasRest: boolean
  /** slots in the function's top environment (params + top-level lets + hoisted functions) */
  scopeSize: number
  /** opcodes followed by their operands; jump targets are absolute offsets */
  code: number[]
  /** numbers, strings, nested `FunctionProto`s, `ClassTemplate`s, `InterfaceTemplate`s */
  constants: unknown[]
  /** flat `[offset, line, column, ...]` sorted by offset */
  locations: number[]
  /** arrows capture `this` lexically when true */
  usesThis: boolean
  /** nesting of class bodies the function is lexically in (0 = none) */
  classDepth: number
  /** debug table: offset of a LOAD/STORE/INIT instruction → binding name (for TDZ messages) */
  names?: Record<number, string>
  /** display form of the parameter list, e.g. `greet(name, greeting?)`, for arity errors (D38) */
  signature?: string
}

/**
 * A method or accessor installed by `CLASS`.
 */
export interface ClassMethodTemplate {
  /** member name */
  key: string
  /** member kind */
  kind: 'method' | 'get' | 'set'
  /** access modifier */
  access: Access
  /** `static` member */
  isStatic: boolean
  /** index of the `FunctionProto` in the enclosing proto's constants */
  protoIndex: number
  /** `override` modifier */
  override: boolean
  /** `final` modifier */
  final: boolean
  /** source location */
  loc: SourceLocation
}

/**
 * An unproven `this.x` / `C.x` reference, checked by `CLASS` (D36).
 */
export interface ClassMemberRef {
  /** member name */
  name: string
  /** reference through the class (`C.x`) rather than `this` */
  isStatic: boolean
  /** how the member is used */
  kind: 'read' | 'write' | 'call' | 'super-call'
  /** argument count for calls (arity check, D38) */
  argc?: number
  /** source location */
  loc: SourceLocation
}

/**
 * A field declaration; initialisers live in the init protos.
 */
export interface ClassFieldTemplate {
  /** field name */
  key: string
  /** access modifier */
  access: Access
  /** `static` field */
  isStatic: boolean
  /** `override` modifier */
  override: boolean
  /** `final` modifier */
  final: boolean
  /** source location */
  loc: SourceLocation
}

/**
 * A bare name used in a class body that is not a local binding (D33).
 */
export interface ImplicitName {
  /** the name */
  name: string
  /** fallback when it is not a member: an enclosing lexical binding, or global lookup */
  outer: 'lexical' | 'global'
  /** contexts that use the name (static methods/initialisers vs. the rest) */
  contexts: ('instance' | 'static')[]
  /** first use, for error messages */
  loc: SourceLocation
}

/**
 * Everything `CLASS` needs to build a class at runtime (§5.6.7).
 */
export interface ClassTemplate {
  /** class name */
  name: string
  /** whether the class has an `extends` clause */
  hasSuper: boolean
  /** explicit constructor */
  constructor: FunctionProto | null
  /** runs with `this` = instance */
  instanceFieldInit: FunctionProto | null
  /** runs with `this` = class */
  staticInit: FunctionProto | null
  /** `final class` */
  isFinal: boolean
  /** methods and accessors */
  methods: ClassMethodTemplate[]
  /** unproven member references, checked at class-definition time */
  memberRefs: ClassMemberRef[]
  /** field names */
  fields: ClassFieldTemplate[]
  /** number of interface values on the stack for `CLASS` (implements list) */
  interfaceCount: number
  /** bare names resolved by `LOAD/STORE/CALL_IMPLICIT` */
  implicitNames: ImplicitName[]
}

/**
 * One requirement of an interface.
 */
export interface InterfaceMemberTemplate {
  /** member name */
  key: string
  /** member kind */
  kind: 'method' | 'get' | 'set' | 'property'
  /** number of parameters (methods only) */
  paramCount: number
  /** whether the method has a rest parameter */
  hasRest: boolean
  /** source location */
  loc: SourceLocation
}

/**
 * Everything `INTERFACE` needs to build an interface (§4.5.7).
 */
export interface InterfaceTemplate {
  /** interface name */
  name: string
  /** own requirements */
  members: InterfaceMemberTemplate[]
}

/**
 * Output of compiling a script.
 */
export interface CompiledScript {
  /** top-level code, kind `script` */
  main: FunctionProto
  /** source text, for error excerpts */
  source?: string
  /** file name, for error messages */
  fileName?: string
}

// Human-readable bytecode listing (§5.5), used by snapshot tests, for debugging and by `pscript --disassemble` (D61).
import type { CompiledModule } from '@/modules/module-record'
import type { ClassTemplate, CompiledScript, FunctionProto } from './function-proto'
import { OPCODES, Op } from './opcodes'

function isProto(value: unknown): value is FunctionProto {
  return typeof value === 'object' && value !== null && 'code' in value && 'constants' in value
}

function protoName(proto: FunctionProto): string {
  return proto.name || '(anonymous)'
}

function isClassTemplate(value: unknown): value is ClassTemplate {
  return typeof value === 'object' && value !== null && 'methods' in value && 'fields' in value
}

function describeObject(value: unknown): string {
  if (isProto(value)) return `<function ${protoName(value)}>`

  return isClassTemplate(value) ? `<class ${value.name || '(anonymous)'}>` : '<template>'
}

function describeConstant(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)

  return typeof value === 'number' ? String(value) : describeObject(value)
}

// The functions a class template holds outside the constants: its constructor and field initialisers (D61).
function templateProtos({ constructor, instanceFieldInit, staticInit }: ClassTemplate): FunctionProto[] {
  return [constructor, instanceFieldInit, staticInit].filter(proto => proto !== null)
}

function nestedProtos(proto: FunctionProto): FunctionProto[] {
  return proto.constants.flatMap(value => {
    if (isProto(value)) return [value]

    return isClassTemplate(value) ? templateProtos(value) : []
  })
}

// `line:column` where the source of an instruction starts, when a new position starts there (D61).
function positions(proto: FunctionProto): Map<number, string> {
  const { locations } = proto
  const found = new Map<number, string>()

  for (let i = 0; i < locations.length; i += 3) found.set(locations[i], `${locations[i + 1]}:${locations[i + 2]}`)

  return found
}

function instruction(proto: FunctionProto, offset: number): [string, number] {
  const op = proto.code[offset] as Op
  const { operands } = OPCODES[op]
  const values = proto.code.slice(offset + 1, offset + 1 + operands.length)
  const constantAt = operands.indexOf('k')
  const comment = constantAt < 0 ? '' : `  ; ${describeConstant(proto.constants[values[constantAt]])}`
  const text = `${String(offset).padStart(4, '0')}  ${`${Op[op]} `.padEnd(16)}${values.join(' ')}`.trimEnd()

  return [text + comment, offset + 1 + operands.length]
}

function listing(proto: FunctionProto, located: boolean): string[] {
  const lines = [`== ${proto.kind} ${protoName(proto)} ==`]
  const at = located ? positions(proto) : new Map<number, string>()

  for (let offset = 0; offset < proto.code.length;) {
    const [text, next] = instruction(proto, offset)
    const position = at.get(offset)

    lines.push(position ? `${text.padEnd(40)}  @ ${position}` : text)
    offset = next
  }

  return lines.concat(...nestedProtos(proto).map(nested => ['', ...listing(nested, located)]))
}

/**
 * Options of `disassemble`.
 */
export interface DisassembleOptions {
  /** annotate the instructions where a new source position starts with `@ line:column` (D61) */
  locations?: boolean
}

/**
 * Disassembles compiled code, including nested functions.
 *
 * @param target a compiled script, module or function
 * @param options source positions
 * @returns the listing, one instruction per line
 */
export function disassemble(target: CompiledScript | CompiledModule | FunctionProto, options: DisassembleOptions = {}): string {
  return listing(isProto(target) ? target : target.main, options.locations === true).join('\n')
}

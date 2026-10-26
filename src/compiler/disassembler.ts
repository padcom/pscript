// Human-readable bytecode listing (§5.5), used by snapshot tests and for debugging.
import type { CompiledModule } from '@/modules/module-record'
import type { CompiledScript, FunctionProto } from './function-proto'
import { OPCODES, Op } from './opcodes'

function isProto(value: unknown): value is FunctionProto {
  return typeof value === 'object' && value !== null && 'code' in value && 'constants' in value
}

function protoName(proto: FunctionProto): string {
  return proto.name || '(anonymous)'
}

function describeConstant(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return String(value)

  return isProto(value) ? `<function ${protoName(value)}>` : '<template>'
}

function instruction(proto: FunctionProto, offset: number): [string, number] {
  const op = proto.code[offset] as Op
  const { operands } = OPCODES[op]
  const values = proto.code.slice(offset + 1, offset + 1 + operands.length)
  const constantAt = operands.indexOf('k')
  const comment = constantAt < 0 ? '' : `  ; ${describeConstant(proto.constants[values[constantAt]])}`
  const text = `${String(offset).padStart(4, '0')}  ${Op[op].padEnd(16)}${values.join(' ')}`.trimEnd()

  return [text + comment, offset + 1 + operands.length]
}

function listing(proto: FunctionProto): string[] {
  const lines = [`== ${proto.kind} ${protoName(proto)} ==`]

  for (let offset = 0; offset < proto.code.length;) {
    const [text, next] = instruction(proto, offset)

    lines.push(text)
    offset = next
  }

  return lines.concat(...proto.constants.filter(isProto).map(nested => ['', ...listing(nested)]))
}

/**
 * Disassembles compiled code, including nested functions.
 *
 * @param target a compiled script, module or function
 * @returns the listing, one instruction per line
 */
export function disassemble(target: CompiledScript | CompiledModule | FunctionProto): string {
  return listing(isProto(target) ? target : target.main).join('\n')
}

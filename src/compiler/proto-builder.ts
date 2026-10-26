// Accumulates the code, constants and locations of one FunctionProto (§5.4).
import type { SourceLocation } from '@/parser/ast'
import type { FunctionKind, FunctionProto } from './function-proto'
import type { Op } from './opcodes'

function constantKey(value: unknown): string | null {
  if (typeof value === 'string') return `s:${value}`
  if (typeof value === 'number') return `n:${Object.is(value, -0) ? '-0' : value}`

  return null
}

/**
 * Header fields of the proto being built.
 */
export interface ProtoHeader {
  /** function name */
  name: string
  /** function kind */
  kind: FunctionKind
}

export class ProtoBuilder {
  readonly code: number[] = []
  readonly constants: unknown[] = []
  readonly locations: number[] = []
  scopeSize = 0
  private constantIndex = new Map<string, number>()

  constructor(private header: ProtoHeader) {}

  /**
   * Appends an instruction.
   *
   * @param op opcode
   * @param operands inline operands
   * @returns the offset of the instruction
   */
  emit(op: Op, ...operands: number[]): number {
    const offset = this.code.length

    this.code.push(op, ...operands)

    return offset
  }

  /**
   * Adds a constant to the pool; numbers and strings are shared.
   *
   * @param value the constant
   * @returns its index
   */
  constant(value: unknown): number {
    const key = constantKey(value)
    const known = key === null ? undefined : this.constantIndex.get(key)
    if (known !== undefined) return known

    this.constants.push(value)

    if (key !== null) this.constantIndex.set(key, this.constants.length - 1)

    return this.constants.length - 1
  }

  /**
   * Records that the next instruction belongs to `loc` (used for error locations).
   *
   * @param loc source location
   */
  mark(loc: SourceLocation) {
    const { locations } = this
    const { line, column } = loc.start
    const n = locations.length
    if (n > 0 && locations[n - 2] === line && locations[n - 1] === column) return

    locations.push(this.code.length, line, column)
  }

  /**
   * Finishes the proto.
   *
   * @returns the FunctionProto
   */
  build(): FunctionProto {
    return {
      ...this.header,
      paramCount: 0,
      length: 0,
      hasRest: false,
      scopeSize: this.scopeSize,
      code: this.code,
      constants: this.constants,
      locations: this.locations,
      usesThis: false,
      classDepth: 0,
    }
  }
}

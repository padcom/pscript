// Accumulates the code, constants and locations of one FunctionProto (§5.4).
import type { SourceLocation } from '@/parser/ast'
import type { FunctionKind, FunctionProto } from './function-proto'
import { Op, POPPING_FORMS } from './opcodes'

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
  readonly names: Record<number, string> = {}
  scopeSize = 0
  private constantIndex = new Map<string, number>()
  private deferred: [number, () => number][] = []
  /** offset of the last instruction */
  private last = -1
  /** the highest jump target patched so far */
  private lastLabel = -1

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
    this.last = offset

    return offset
  }

  /**
   * Appends a jump whose target is filled in later by `patch()`.
   *
   * @param op jump opcode
   * @returns the operand position to patch
   */
  emitJump(op: Op): number {
    return this.emit(op, -1) + 1
  }

  /**
   * Points a jump emitted by `emitJump()` at `target` (default: the current end of the code).
   *
   * @param operand operand position returned by `emitJump()`
   * @param target absolute code offset
   */
  patch(operand: number, target = this.code.length) {
    this.code[operand] = target
    this.lastLabel = globalThis.Math.max(this.lastLabel, target)
  }

  /**
   * Discards the value the last instruction pushed: turns it into its popping form (same length, so no offset
   * moves) or appends a POP. A jump to the end of the code (where the POP would be) rules the former out.
   */
  emitPop() {
    const popping = POPPING_FORMS[this.code[this.last] as Op]

    if (popping === undefined || this.lastLabel === this.code.length) this.emit(Op.POP)
    else this.code[this.last] = popping
  }

  /**
   * Fills in an operand when the proto is built (e.g. an environment size that grows while its code is compiled).
   *
   * @param operand operand position
   * @param value computes the operand
   */
  defer(operand: number, value: () => number) {
    this.deferred.push([operand, value])
  }

  /**
   * Records the binding name used by the next instruction.
   *
   * @param name binding name
   */
  nameNext(name: string) {
    this.names[this.code.length] = name
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
    for (const [operand, value] of this.deferred) this.code[operand] = value()

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
      names: this.names,
    }
  }
}

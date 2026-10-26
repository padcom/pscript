import { describe, expect, it } from 'vitest'
import { OPCODES, Op } from '@/compiler/opcodes'

const opcodes = globalThis.Object.values(Op).filter((value): value is Op => typeof value === 'number')

describe('opcodes', () => {
  it('numbers the opcodes contiguously from 0', () => {
    expect(opcodes).toEqual(opcodes.map((_, i) => i))
  })

  it('describes every opcode', () => {
    expect(globalThis.Object.keys(OPCODES).map(Number)).toEqual(opcodes)
  })

  it('records operands in encoding order', () => {
    expect(OPCODES[Op.CONST].operands).toEqual(['k'])
    expect(OPCODES[Op.LOAD].operands).toEqual(['depth', 'slot'])
    expect(OPCODES[Op.CALL_IMPLICIT].operands).toEqual(['i', 'argc', 'fallbackA', 'fallbackB'])
    expect(OPCODES[Op.ADD].operands).toEqual([])
  })

  it('marks jump operands', () => {
    expect(OPCODES[Op.JUMP].jumps).toEqual([0])
    expect(OPCODES[Op.ITER_NEXT].jumps).toEqual([0])
    expect(OPCODES[Op.TRY].jumps).toEqual([0, 1])
    expect(OPCODES[Op.LOAD].jumps).toEqual([])
  })

  it('gives every opcode a stack effect', () => {
    for (const op of opcodes) expect(OPCODES[op].stack, Op[op]).toContain('→')
  })
})

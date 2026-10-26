import { describe, expect, it } from 'vitest'
import { compile } from '@/compiler/compiler'
import { disassemble } from '@/compiler/disassembler'
import { Op } from '@/compiler/opcodes'
import { parse } from '@/parser/parse'

describe('compiler', () => {
  it('compiles expression statements into the completion slot', () => {
    expect(disassemble(compile("print('a', 1 + 2 * 3)"))).toBe([
      '== script (anonymous) ==',
      '0000  UNDEFINED',
      '0001  INIT            0 0',
      '0004  LOAD_GLOBAL     0  ; "print"',
      '0006  CONST           1  ; "a"',
      '0008  CONST           2  ; 1',
      '0010  CONST           3  ; 2',
      '0012  CONST           4  ; 3',
      '0014  MUL',
      '0015  ADD',
      '0016  CALL            2',
      '0018  STORE           0 0',
      '0021  POP',
      '0022  LOAD            0 0',
      '0025  HALT',
    ].join('\n'))
  })
})

describe('compiler details', () => {
  it('shares number and string constants but keeps -0 apart from 0', () => {
    const { main } = compile("1 + 1 + '1' + '1' + 0 + -0")

    expect(main.constants).toEqual([1, '1', 0])
  })

  it('uses dedicated opcodes for keyword literals and typeof of a name', () => {
    const { code, constants } = compile('true; false; null; undefined; typeof x; typeof undefined').main

    expect(code).toEqual(expect.arrayContaining([Op.TRUE, Op.FALSE, Op.NULL, Op.TYPEOF_GLOBAL, Op.TYPEOF]))
    expect(constants).toEqual(['x'])
  })

  it('records locations for operations that can fail', () => {
    const { main } = compile('1 +\n  f()')

    // LOAD_GLOBAL f and CALL share 2:3, so one entry covers both
    expect(main.locations).toEqual([6, 2, 3, 10, 1, 1])
  })
})

describe('compiler inputs', () => {
  it('accepts a parsed program and remembers source and file name', () => {
    expect(compile(parse('1'))).toMatchObject({ source: undefined })
    expect(compile('1', { fileName: 'x.pscript' })).toMatchObject({ source: '1', fileName: 'x.pscript' })
  })

  it('reports nodes it cannot compile yet', () => {
    const program = parse('1')

    const [{ loc }] = program.body

    program.body[0] = { type: 'ThrowStatement', argument: { type: 'Literal', value: 1, raw: '1', loc }, loc }
    expect(() => compile(program)).toThrow('ThrowStatement is not supported yet')
  })
})

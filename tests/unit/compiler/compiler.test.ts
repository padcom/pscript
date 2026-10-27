import { describe, expect, it } from 'vitest'
import { compile } from '@/compiler/compiler'
import { disassemble } from '@/compiler/disassembler'
import { Op } from '@/compiler/opcodes'
import { parse } from '@/parser/parse'
import type { Statement } from '@/parser/ast'

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
      '0018  STORE_POP       0 0',
      '0021  LOAD            0 0',
      '0024  HALT',
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

    program.body[0] = { type: 'WithStatement', loc } as unknown as Statement
    expect(() => compile(program)).toThrow('WithStatement is not supported yet')
  })
})

describe('compiler: spread (D46)', () => {
  const ops = (source: string) => disassemble(compile(source)).split('\n').map(line => line.slice(6).trim())

  it('builds spread arguments as one array and calls with SPREAD_ARGC', () => {
    expect(ops('f(a, ...b, c)')).toEqual(expect.arrayContaining([
      'ARRAY           1',
      'ARRAY_SPREAD',
      'ARRAY_PUSH',
      'CALL            -1',
    ]))
  })

  it('keeps plain calls and arrays without spread unchanged', () => {
    expect(ops('f(a, b); [a, b]')).toEqual(expect.arrayContaining(['CALL            2', 'ARRAY           2']))
    expect(ops('f(a, b); [a, b]')).not.toContain('ARRAY_PUSH')
  })

  it('copies spread properties with OBJECT_SPREAD', () => {
    expect(ops('({ a: 1, ...o })')).toEqual(expect.arrayContaining(['OBJECT', 'OBJECT_SPREAD']))
  })

  it('leaves the arity of a spread call to the runtime', () => {
    expect(() => compile('function f(a) {}\nf(...[1, 2])')).not.toThrow()
    expect(() => compile('function f(a) {}\nf(1, 2)')).toThrow('expects 1 argument, got 2')
  })
})

describe('compiler: optional chaining (D47)', () => {
  const ops = (source: string) => disassemble(compile(source)).split('\n').map(line => line.slice(6).trim())

  it('drops the receiver and the function of an optional method call', () => {
    expect(ops('o.m?.(1)').some(op => /^OPTIONAL_JUMP\s+\d+ 2$/.test(op))).toBe(true)
    expect(ops('o?.m(1)').some(op => /^OPTIONAL_JUMP\s+\d+ 1$/.test(op))).toBe(true)
  })

  it('jumps past the whole chain', () => {
    const lines = ops('a?.b.c(d)')
    const jump = lines.find(op => op.startsWith('OPTIONAL_JUMP')) as string
    const target = Number(jump.split(/\s+/)[1])

    expect(disassemble(compile('a?.b.c(d)'))).toContain(`${String(target).padStart(4, '0')}  STORE_POP`)
  })
})

describe('compiler: computed keys (D48)', () => {
  const ops = (source: string) => disassemble(compile(source)).split('\n').map(line => line.slice(6).trim())

  it('names anonymous definitions and methods after the key, not other values', () => {
    expect(ops('({ [k]: () => 1 })')).toContain('DEFINE_PROP_INDEX 1')
    expect(ops('({ [k]() {} })')).toContain('DEFINE_PROP_INDEX 1')
    expect(ops('({ [k]: function f() {} })')).toContain('DEFINE_PROP_INDEX 0')
    expect(ops('({ [k]: v })')).toContain('DEFINE_PROP_INDEX 0')
  })

  it('defines accessors with computed keys', () => {
    const code = ops('({ get [k]() { return 1 }, set [k](v) {} })')

    expect(code).toEqual(expect.arrayContaining(['DEFINE_GETTER_INDEX', 'DEFINE_SETTER_INDEX']))
  })
})

describe('compiler: async generators and for await (D53)', () => {
  const ops = (source: string) => disassemble(compile(source)).split('\n').map(line => line.slice(6).trim())

  it('awaits yielded and returned values of async generators', () => {
    const code = ops('async function* g() { yield 1\nreturn 2 }')

    expect(code).toEqual(expect.arrayContaining(['ASYNC_GENERATOR', 'AWAIT', 'YIELD', 'RETURN']))
  })

  it('steps for await loops with promises and awaits return() on break', () => {
    const code = ops('async function f(xs) { for await (const x of xs) break }')

    expect(code).toEqual(expect.arrayContaining(['GET_ASYNC_ITER', 'ASYNC_ITER_NEXT', 'ASYNC_ITER_CLOSE']))
    expect(code.some(op => op.startsWith('ITER_STEP'))).toBe(true)
  })
})

describe('disassembler (D61)', () => {
  it('lists class constructors and field initialisers, and names class templates', () => {
    const listing = disassemble(compile('class A { x = 1\n constructor() { this.x = 2 } }'))

    expect(listing).toMatch(/CLASS +\d+ {2}; <class A>/)
    expect(listing).toContain('== constructor A ==')
    expect(listing).toContain('== fieldInit <initializer> ==')
  })

  it('annotates source positions on request', () => {
    expect(disassemble(compile('1 + 2'), { locations: true })).toMatch(/ADD +@ 1:1/)
    expect(disassemble(compile('1 + 2'))).not.toContain('@')
  })
})

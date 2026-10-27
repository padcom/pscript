import { describe, expect, it } from 'vitest'
import { compile } from '@/compiler/compiler'
import { disassemble } from '@/compiler/disassembler'
import { PScriptRuntimeError } from '@/errors'
import { Interpreter } from '@/index'

function listing(source: string): string[] {
  return disassemble(compile(source)).split('\n').map(line => line.slice(6).trim())
}

function inFunction(body: string): string[] {
  const lines = listing(`function f(o, i) { ${body} }`)

  return lines.slice(lines.indexOf('') + 2)
}

function failure(source: string): PScriptRuntimeError {
  try {
    new Interpreter().run(source)
  } catch (e) {
    return e as PScriptRuntimeError
  }
  throw new Error('no error')
}

describe('popping forms (H3)', () => {
  it('fuses a store with the POP that discards it', () => {
    expect(inFunction('i = 1\n o.x = 2\n g = 3')).toEqual(expect.arrayContaining([
      'STORE_POP       0 1',
      'SET_PROP_POP    2  ; "x"',
      'STORE_GLOBAL_POP 4  ; "g"',
    ]))
  })

  it('keeps the POP when a jump lands on it', () => {
    const code = inFunction('o ? i = 1 : i = 2')

    expect(code).toContain('POP')
    expect(code.filter(line => line.startsWith('STORE'))).toEqual(['STORE           0 1', 'STORE           0 1'])
  })
})

describe('INCREMENT (H3)', () => {
  it('compiles an unused x++ / x-- of a binding as one instruction', () => {
    expect(inFunction('i++\n i--')).toEqual(expect.arrayContaining(['INCREMENT       0 1 1', 'INCREMENT       0 1 -1']))
  })

  it.each([
    ['a prefix update', '++i'],
    ['a member', 'o.x++'],
    ['a global', 'g++'],
    ['a used value', 'return i++'],
  ])('leaves %s to the generic code', (_, body) => {
    expect(inFunction(body).some(line => line.startsWith('INCREMENT'))).toBe(false)
  })

  it('leaves an implicit member to the generic code', () => {
    const code = listing('class C { n = 0\n inc() { n++ } }')

    expect(code.some(line => line.startsWith('INCREMENT'))).toBe(false)
  })
})

describe('running INCREMENT (H3)', () => {
  it('updates the binding like LOAD POS INC STORE', () => {
    expect(new Interpreter().run('function f() { let a = 1\n let b = "5"\n a++\n b--\n return [a, b] }\nf()')).toEqual([2, 4])
  })

  it('reports errors where the generic code did', () => {
    const tdz = failure('function f() {\n  x++\n  let x = 1\n}\nf()')
    const object = failure('function f() {\n  let x = {}\n  x++\n}\nf()')

    expect(tdz.message).toContain("Cannot access 'x' before initialization")
    expect([tdz.line, tdz.column]).toEqual([2, 3])
    expect(object.message).toContain("Cannot apply '+' to object")
    expect([object.line, object.column]).toEqual([3, 3])
    expect(() => compile('function f() { const c = 1\n c++ }')).toThrow("Assignment to constant variable 'c'")
  })
})

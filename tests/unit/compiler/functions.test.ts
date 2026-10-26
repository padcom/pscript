import { describe, expect, it } from 'vitest'
import { compile } from '@/compiler/compiler'
import { disassemble } from '@/compiler/disassembler'
import type { FunctionProto } from '@/compiler/function-proto'

function ops(source: string): string[] {
  return disassemble(compile(source)).split('\n').map(line => line.slice(6).trim().split(/\s+/)[0])
}

describe('compiling functions', () => {
  it('hoists declarations before the first statement', () => {
    const code = ops('f()\nfunction f() {}')

    expect(code.indexOf('CLOSURE')).toBeLessThan(code.indexOf('LOAD_GLOBAL'))
    expect(code).toContain('INIT_GLOBAL')
  })

  it('records the parameter layout on the proto', () => {
    const fn = compile('function f(a, b = 1, ...c) { let d }').main.constants.find(c => typeof c === 'object') as FunctionProto

    expect(fn).toMatchObject({ name: 'f', kind: 'function', paramCount: 2, length: 1, hasRest: true, scopeSize: 4 })
    expect(fn.signature).toBe('f(a, b?, ...c)')
  })

  it('compiles defaults into a prologue with JUMP_IF_ARG', () => {
    expect(disassemble(compile('function f(a, b = a) {}'))).toMatch(/JUMP_IF_ARG {5}1 \d+/)
  })

  it('ends every function with NULL RETURN (D37)', () => {
    expect(ops('function f() {}').slice(-2)).toEqual(['NULL', 'RETURN'])
  })
})

describe('compiling function names', () => {
  it('names anonymous functions after their binding', () => {
    const { constants } = compile('let g = function () {}').main

    expect(constants).toContainEqual(expect.objectContaining({ name: 'g' }))
  })

  it('gives a named function expression its own one-slot environment', () => {
    const code = ops('let g = function h() { return h }')

    expect(code.slice(code.indexOf('PUSH_ENV'), code.indexOf('POP_ENV') + 1))
      .toEqual(['PUSH_ENV', 'CLOSURE', 'DUP', 'INIT', 'POP_ENV'])
  })
})

describe('function scope errors', () => {
  it.each([
    ['function f(a) { let a }', "Identifier 'a' has already been declared"],
    ['function f() {}\nlet f = 1', "Identifier 'f' has already been declared"],
    ['let g = function h() { h = 1 }', "Cannot assign to function 'h'"],
    ['const k = function (a) {}\nk()', 'k(a) expects 1 argument, got 0'],
    ['function f() { break }', 'Illegal break statement'],
    ['while (true) { function f() { continue } }', 'Illegal continue statement'],
  ])('%j', (source, message) => {
    expect(() => compile(source)).toThrow(message)
  })

  it('does not check arity through let bindings at compile time', () => {
    expect(() => compile('let k = function (a) {}\nk()')).not.toThrow()
  })
})

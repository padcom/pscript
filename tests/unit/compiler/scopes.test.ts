import { describe, expect, it } from 'vitest'
import { compile } from '@/compiler/compiler'
import { disassemble } from '@/compiler/disassembler'
import { Scope } from '@/compiler/scope'

function listing(source: string): string[] {
  return disassemble(compile(source)).split('\n').slice(1).map(line => line.slice(6).trim())
}

describe('compiling variables', () => {
  it('declares script-level bindings up front', () => {
    expect(listing('let a = 1\nconst b = 2').slice(0, 2)).toEqual(['DECLARE_GLOBAL  0 0  ; "a"', 'DECLARE_GLOBAL  1 1  ; "b"'])
  })

  it('gives only blocks with declarations an environment', () => {
    const code = listing('{ 1 }\n{ let x = 1\n{ x } }')

    expect(code.filter(line => line.startsWith('PUSH_ENV'))).toEqual(['PUSH_ENV        1'])
    expect(code).toContain('LOAD            0 0') // the inner block has no environment of its own
  })

  it('stores the completion value through the block environments', () => {
    expect(listing('{ let x = 1\n x }')).toContain('STORE           1 0')
  })

  it('resolves names to (depth, slot)', () => {
    const code = listing('{ let a = 1, b = 2\n { let c = 3\n a; b; c } }')

    expect(code).toEqual(expect.arrayContaining(['LOAD            1 0', 'LOAD            1 1', 'LOAD            0 0']))
  })

  it('records binding names for TDZ messages', () => {
    const { main } = compile('{ let q = 1\n q }')

    expect(Object.values(main.names ?? {})).toEqual(['q', 'q'])
  })

  it('compiles logical assignment with a short-circuit jump', () => {
    expect(listing('let a = 1\na ||= 2')).toEqual(expect.arrayContaining(['LOAD_GLOBAL     0  ; "a"', 'OR_JUMP         19']))
  })
})

describe('static errors', () => {
  it.each([
    ['const a = 1\na = 2', "Assignment to constant variable 'a'", 2],
    ['{ const a = 1\n a += 1 }', "Assignment to constant variable 'a'", 2],
    ['let a = 1\nlet a = 2', "Identifier 'a' has already been declared", 2],
    ['{ let a\nconst a = 1 }', "Identifier 'a' has already been declared", 2],
  ])('%j', (source, reason, line) => {
    expect(() => compile(source)).toThrow(expect.objectContaining({ reason, line }))
  })

  it('allows shadowing in an inner block', () => {
    expect(() => compile('const a = 1\n{ let a = 2\n a = 3 }')).not.toThrow()
  })
})

describe('Scope', () => {
  it('counts only environments that exist', () => {
    const script = new Scope(null, 'script')
    const empty = new Scope(script, 'block')
    const inner = new Scope(empty, 'block')

    script.declare('g', 'let')
    inner.declare('x', 'const')
    expect(inner.resolve('x')).toMatchObject({ where: 'lexical', depth: 0, slot: 0 })
    expect(inner.resolve('g')).toMatchObject({ where: 'script' })
    expect(inner.resolve('print')).toEqual({ where: 'global' })
    expect([script.envDepth, empty.envDepth, inner.envDepth]).toEqual([0, 0, 1])
  })
})

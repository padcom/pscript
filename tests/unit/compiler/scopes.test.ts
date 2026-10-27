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

  it('gives only blocks with declarations an environment (closures keep them unfolded)', () => {
    const code = listing('{ 1 }\n{ let x = 1\n{ x }\n() => x }')

    expect(code.filter(line => line.startsWith('PUSH_ENV'))).toEqual(['PUSH_ENV        1'])
    expect(code).toContain('LOAD            0 0') // the inner block has no environment of its own
  })

  it('stores the completion value through the block environments', () => {
    expect(listing('{ let x = 1\n x\n () => x }')).toContain('STORE_POP       1 0')
  })

  it('resolves names to (depth, slot)', () => {
    const code = listing('{ let a = 1, b = 2\n { let c = 3\n a; b; c\n () => c } }')

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

describe('folding block environments (K9)', () => {
  it('folds a block without closures into the enclosing environment', () => {
    const code = listing('{ let x = 1\n x }')

    expect(code.filter(line => line.startsWith('PUSH_ENV'))).toEqual([])
    expect(code).toEqual(expect.arrayContaining(['INIT            0 1', 'LOAD            0 1', 'STORE_POP       0 0']))
  })

  it('sizes an environment for the blocks folded into it', () => {
    const code = listing('{ let a = 1\n { let b = 2\n a + b }\n () => a }')

    expect(code).toEqual(expect.arrayContaining(['PUSH_ENV        2', 'LOAD            0 1']))
  })

  it('folds loop bodies, for-let heads and for-of bindings without closures', () => {
    const loops = 'for (let i = 0; i < 2; i++) { const d = i\n s += d }\n for (const x of xs) s += x'
    const code = listing(`function f(xs) { let s = 0\n ${loops}\n return s }`)

    expect(code.filter(line => /PUSH_ENV|POP_ENV|COPY_ENV/.test(line))).toEqual([])
  })
})

describe('keeping block environments (K9)', () => {
  it.each([
    ['a use before the declaration', '{ x; let x = 1 }'],
    ['a use in its own initialiser', '{ let x = x }'],
    ['a closure', '{ let x = 1\n print(() => x) }'],
  ])('keeps the environment of a block with %s', (_, source) => {
    expect(listing(source)).toContain('PUSH_ENV        1')
  })

  it('does not count property names as uses', () => {
    const code = listing('const o = { x: 1 }\n{ const x = o.x\n const y = { x: 2 } }')

    expect(code.some(line => line.startsWith('PUSH_ENV'))).toBe(false)
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

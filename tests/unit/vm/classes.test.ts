import { describe, expect, it } from 'vitest'
import { compile } from '@/compiler/compiler'
import type { ClassTemplate } from '@/compiler/function-proto'
import { Interpreter } from '@/index'

function run(source: string): unknown {
  return new Interpreter({ stdout: () => {} }).run(source)
}

describe('member references (§4.5.9)', () => {
  it('records unproven this.x references when the chain is not visible, and CLASS checks them', () => {
    const base = 'function base() { return class { a = 1 } }\n'
    const source = `${base}class C extends base() { m() { return this.a + this.b } }`
    const { constants } = compile(source).main
    const template = constants.find(c => typeof c === 'object' && c !== null && 'memberRefs' in c) as ClassTemplate

    expect(template.memberRefs.map(ref => ref.name)).toEqual(['a', 'b'])
    expect(() => run(source)).toThrow("Class 'C' has no member 'b'")
    expect(run(`${base}class C extends base() { m() { return this.a } }\nnew C().m()`)).toBe(1)
  })

  it('checks this.x at compile time when the chain is visible', () => {
    expect(() => compile('class A { a = 1 }\nclass B extends A { m() { return this.a + this.c } }'))
      .toThrow("Class 'B' has no member 'c'")
    expect(() => compile('class A { m() { return this.toString() } }')).not.toThrow()
  })

  it('treats arrows inside methods as the same class context', () => {
    expect(() => compile('class A { m() { return () => this.nope } }')).toThrow("Class 'A' has no member 'nope'")
    expect(() => compile('class A { m() { return function () { return this.any } } }')).not.toThrow()
  })
})

describe('construction', () => {
  it('passes constructor arguments through implied derived constructors (D38)', () => {
    expect(run('class A { v; constructor(v) { this.v = v } }\nclass B extends A {}\nnew B(7).v')).toBe(7)
    expect(() => run('class A { constructor(v) {} }\nclass B extends A {}\nnew B()')).toThrow('expects 1 argument, got 0')
  })

  it('rejects super() twice and in non-derived classes', () => {
    expect(() => run('class A {}\nclass B extends A { constructor() { super(); super() } }\nnew B()'))
      .toThrow('Super constructor may only be called once')
    expect(() => compile('class A { constructor() { super() } }')).toThrow("'super' keyword unexpected here")
    expect(() => compile('function f() { return super.x }')).toThrow("'super' keyword unexpected here")
  })

  it('makes class bindings constant', () => {
    expect(() => compile('class A {}\nA = 1')).toThrow("Assignment to constant variable 'A'")
  })
})

import { describe, expect, it } from 'vitest'
import { compile } from '@/compiler/compiler'
import type { ClassTemplate, FunctionProto } from '@/compiler/function-proto'
import { Op } from '@/compiler/opcodes'
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

function templateOf(source: string): ClassTemplate {
  return compile(source).main.constants.find(c => typeof c === 'object' && c !== null && 'memberRefs' in c) as ClassTemplate
}

function protoOps(source: string, name: string): Op[] {
  const template = templateOf(source)
  const method = template.methods.find(m => m.key === name) as ClassTemplate['methods'][number]
  const { code } = compile(source).main.constants[method.protoIndex] as FunctionProto

  return [...code] as Op[]
}

it('makes AccessError a TypeError', () => {
  const check = "e instanceof TypeError && e.name == 'AccessError'"

  expect(run(`class A { private x = 1 }\ntry { new A().x } catch (e) { ${check} }`)).toBe(true)
})

describe('access modifiers (§4.5.2, §5.6.6)', () => {
  it('emits GET_PROP_PRIV / SET_PROP_PRIV only for names an enclosing class declares private', () => {
    const ops = protoOps('class A { private x = 1\n y = 2\n m(o) { o.x = o.y; return o.x } }', 'm')

    expect(ops).toContain(Op.GET_PROP_PRIV)
    expect(ops).toContain(Op.SET_PROP_PRIV)
    expect(ops).toContain(Op.GET_PROP)
  })

  it('falls back to the generic path when the receiver lacks the private member', () => {
    expect(run('class A { private x = 1\n read(o) { return o.x } }\nnew A().read({ x: 5 })')).toBe(5)
    expect(run('class A { private x = 1\n write(o) { o.x = 3; return o.x } }\nnew A().write({})')).toBe(3)
  })

  it('keeps private fields out of reflection and shows only public fields', () => {
    const source = 'class A { private a = 1\n protected b = 2\n c = 3 }\nconst o = new A()\n'

    const reflected = 'JSON.stringify([Object.keys(o), Object.values(o), Object.entries(o)])'

    expect(run(`${source}${reflected}`)).toBe('[["c"],[3],[["c",3]]]')
    expect(run(`${source}JSON.stringify(o) + String(o)`)).toBe('{"c":3}A(c = 3)')
  })
})

describe('private members', () => {
  it('rejects assigning to private methods', () => {
    expect(() => run('class A { private m() {}\n n() { this.m = 1 } }\nnew A().n()')).toThrow("Cannot assign to method 'm'")
  })

  it('reports a private accessor without the needed half', () => {
    const getterOnly = 'class A { private get g() { return 1 }\n n() { this.g = 1 } }\nnew A().n()'

    expect(() => run(getterOnly)).toThrow('Cannot set property g of A which has only a getter')
    expect(() => run('class A { private set s(v) {}\n n() { return this.s } }\nnew A().n()')).toThrow("'s' has only a setter")
  })
})

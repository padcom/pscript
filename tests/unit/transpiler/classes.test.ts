import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { transpile } from '@/index'

function js(source: string): string {
  return transpile(source).code.trimEnd()
}

// Runs the transpiled program and returns what it printed.
function run(source: string): string[] {
  const output: string[] = []

  runInNewContext(`'use strict';\n${js(source)}`, { console: { log: (...args: unknown[]) => output.push(args.join(' ')) } })

  return output
}

describe('psc: class members', () => {
  it('prints fields, accessors, statics and constructors', () => {
    const source = 'class A {\n  x\n  static n = 1\n  constructor() { return }\n'
      + '  get v() { return 1 }\n  static make() { return new A() }\n}'

    expect(js(source)).toBe([
      'class A {',
      '  x = null;',
      '  static n = 1;',
      '  constructor() {',
      '    return;',
      '  }',
      '  get v() {',
      '    return 1;',
      '  }',
      '  static make() {',
      '    return new A();',
      '  }',
      '}',
    ].join('\n'))
  })
})

describe('psc: class modifiers', () => {
  it('erases protected, override and final', () => {
    const source = 'class A { protected m() { return 1 } }\n'
      + 'final class B extends A { protected final override m() { return super.m() + 1 } }'

    expect(js(source)).toBe([
      'class A {',
      '  m() {',
      '    return 1;',
      '  }',
      '}',
      'class B extends A {',
      '  m() {',
      '    return super.m() + 1;',
      '  }',
      '}',
    ].join('\n'))
  })

  it('makes private members JS private names', () => {
    expect(js('class A { private x = 1\n private static n = 0\n private m() { return this.x + A.n } }')).toBe([
      'class A {',
      '  #x = 1;',
      '  static #n = 0;',
      '  #m() {',
      '    return this.#x + A.#n;',
      '  }',
      '}',
    ].join('\n'))
  })
})

describe('psc: implicit members (§4.5.8)', () => {
  it('resolves bare member names to this', () => {
    const source = 'const TAX = 2\nclass A { private n = 0\n total = 0\n'
      + ' add(v) { n++; total += v * TAX; return check() }\n check() { return n } }'

    expect(js(source)).toContain('    this.#n++;\n    this.total += v * TAX;\n    return this.check();')
  })

  it('lets locals and parameters shadow members', () => {
    expect(js('class A { x = 1\n m(x) { return x }\n n() { const x = 2; return x } }')).not.toContain('this.x')
  })

  it("uses the member's this inside nested plain functions", () => {
    expect(js('class A { n = 1\n m() { return [1].map(function (v) { return v + n }) } }')).toContain([
      '  m() {',
      '    const $this = this;',
      '    return [1].map(function (v) {',
      '      return v + $this.n;',
      '    });',
    ].join('\n'))
    expect(run('class A { n = 1\n m() { return [1].map(function (v) { return v + n }) } }\nprint(new A().m()[0])')).toEqual(['2'])
  })
})

describe('psc: implicit member errors', () => {
  it('reports inherited members that are also outer names (strict rule)', () => {
    const source = 'const label = 1\nclass A { label() { return 1 } }\n'
      + 'function f() { return class B extends A { m() { return label() } } }'

    expect(() => transpile(source)).toThrow("Ambiguous name 'label' in class 'B': it is both a member (inherited from 'A')")
  })

  it('does not support implicit members in functions nested in field initialisers', () => {
    expect(() => transpile('class A { n = 1\n f = function () { return n } }')).toThrow('are not supported by psc yet')
  })
})

describe('psc: private access through other receivers (§4.5.3)', () => {
  it('checks the brand of a receiver it cannot see, then falls back to the public member', () => {
    expect(js('class A { private n = 0\n copy(o) { n = o.n; o.n++ } }')).toContain([
      '    this.#n = (#n in o ? o.#n : o.n);',
      '    (#n in o ? o.#n++ : o.n++);',
    ].join('\n'))
  })

  it('never uses a private name on a global or on another class', () => {
    expect(js('class B { static n = 1 }\nclass A { private round() {}\n private static n = 0\n m() { return Math.round(B.n) } }'))
      .toContain('return Math.round(B.n);')
  })

  it("renames a private member that an enclosing class's private member would shadow", () => {
    const source = 'class O { private s = 1\n m() { return class I { private s = 2\n get(o) { return [o.s, this.s] } } } }'

    expect(js(source)).toContain('return [(#s$2 in o ? o.#s$2 : #s in o ? o.#s : o.s), this.#s$2];')
    expect(run(`${source}\nconst o = new O()\nconst I = o.m()\nprint(new I().get(o).join())`)).toEqual(['1,2'])
  })

  it("maps `'x' in o` to brand checks", () => {
    expect(js("class A { private x = 1\n has(o) { return ['x' in this, 'x' in o] } }"))
      .toContain("return [#x in this, (#x in o || 'x' in o)];")
  })
})

describe('psc: interfaces (P8)', () => {
  const source = 'interface Named { get name() }\ninterface Shape extends Named { area() }\n'
    + 'class Sq implements Shape { get name() { return "sq" }\n area() { return 4 } }\nclass Big extends Sq {}\n'

  it('makes interfaces values and records what classes implement', () => {
    const code = js(source)

    expect(code).toContain("const Named = $interface('Named', []);")
    expect(code).toContain("const Shape = $interface('Shape', [Named]);")
    expect(code).toContain('  static { $interface.implement(this, [Shape]); }')
  })

  it('supports instanceof with interfaces (D32)', () => {
    const checks = 'const b = new Big()\n'
      + 'print(b instanceof Shape, b instanceof Named, {} instanceof Named, 1 instanceof Shape, String(Shape))'

    expect(run(source + checks)).toEqual(['true true false false [interface Shape]'])
  })
})

describe('psc: inherited accessor halves (§4.5.4)', () => {
  it('forwards the half a class does not redefine', () => {
    const source = 'class T { c = 0\n get f() { return c }\n set f(v) { c = v } }\n'
      + 'class R extends T { override get f() { return 1 + super.f } }'

    expect(js(source)).toContain('  set f(value) { super.f = value; }')
    expect(run(`${source}\nconst r = new R()\nr.f = 5\nprint(r.f, r.c)`)).toEqual(['6 5'])
  })
})

describe('psc: class-definition checks at compile time (P7)', () => {
  it.each([
    ['class A { m() {} }\nclass B extends A { m() {} }', "'m' overrides 'A.m' and must be marked 'override'"],
    ['class A { final m() {} }\nclass B extends A { override m() {} }', "Cannot override final method 'm' of class 'A'"],
    ['final class A {}\nclass B extends A {}', "Cannot extend final class 'A'"],
    ['class A { m(a) {} }\nclass B extends A { override m() {} }', "must keep the signature of 'A.m(a)'"],
    ['class A { protected m() {} }\nclass B extends A { override m() {} }', 'cannot change access'],
    ['interface I { f(a) }\nclass C implements I {}', "Class 'C' does not implement I: f(a)"],
    ['class A { m() {} }\nfunction f() { return class B extends A { m() {} } }', "'m' overrides 'A.m'"],
    ['class C { toString() {} }', "'toString' overrides"],
  ])('%s', (source, message) => {
    expect(() => transpile(source, { fileName: 'c.pscript' })).toThrow(message)
  })

  it('reports where the class is defined', () => {
    expect(() => transpile('class A { m() {} }\nclass B extends A { m() {} }', { fileName: 'c.pscript' }))
      .toThrow(/^c\.pscript:2:1 SyntaxError: .*\nclass B extends A \{ m\(\) \{\} \}\n\^$/)
  })

  it('leaves classes it cannot evaluate to runtime', () => {
    expect(() => transpile('class A { m() {} }\nfunction mix(b) { return b }\nclass B extends mix(A) { m() {} }')).not.toThrow()
    expect(() => transpile('class A { m() {} }\nfunction f(A) { return class B extends A { m() {} } }')).not.toThrow()
    expect(() => transpile('class B extends HostBase { m() {} }')).not.toThrow()
  })

  it('does not run the program', () => {
    expect(() => transpile('class A { static x = boom() }\nboom()')).not.toThrow()
  })
})

describe('psc: globals', () => {
  it('maps globalThis.print to the print helper (P6)', () => {
    expect(js("globalThis.print('x')")).toBe("const print = (...args) => console.log(...args);\nprint('x');")
  })
})

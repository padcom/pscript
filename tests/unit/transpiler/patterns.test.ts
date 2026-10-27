import { describe, expect, it } from 'vitest'
import { PScriptSyntaxError, transpile, transpileModules } from '@/index'

function js(source: string): string {
  return transpile(source).code.trimEnd()
}

describe('psc: destructuring (D40)', () => {
  it.each([
    ['const { p, q: [r, s = 1], ...t } = o', 'const { p, q: [r, s = 1], ...t } = o;'],
    ["const { 'x y': f, 1: g } = o", "const { 'x y': f, 1: g } = o;"],
    ['const {} = o, [] = o', 'const {} = o, [] = o;'],
    ['[a, b] = [b, a]', '[a, b] = [b, a];'],
    ['({ a, b = 2 } = o)', '({ a, b = 2 } = o);'],
    ['({ a: o.x, b: o[k] } = o)', '({ a: o.x, b: o[k] } = o);'],
    ['for ([a, b] of o) {}', 'for ([a, b] of o) {}'],
    ['for (const { a, ...b } of o) {}', 'for (const { a, ...b } of o) {}'],
    ['try {} catch ({ message }) {}', 'try {} catch ({ message }) {}'],
    ['const f = ({ a }, [b] = []) => a + b', 'const f = ({ a }, [b] = []) => a + b;'],
  ])('%s', (source, expected) => {
    expect(js(`let a, b, o, k\n${source}`).split('\n').slice(1).join('\n')).toBe(expected)
  })
})

describe('psc: destructuring in functions and classes (D40)', () => {
  it('prints parameter patterns', () => {
    expect(js('function testme({ x = 1, y = 2 } = {}, ...rest) { return x + y }')).toBe([
      'function testme({ x = 1, y = 2 } = {}, ...rest) {',
      '  return x + y;',
      '}',
    ].join('\n'))
  })

  it('writes implicit members of assignment patterns out, but not names bound by patterns', () => {
    expect(js('class C {\n  x = 1\n  y = 2\n  swap() { [x, y] = [y, x]; ({ x } = { x: 1 }) }\n  m({ x }) { return x }\n}')).toBe([
      'class C {',
      '  x = 1;',
      '  y = 2;',
      '  swap() {',
      '    [this.x, this.y] = [this.y, this.x];',
      '    ({ x: this.x } = { x: 1 });',
      '  }',
      '  m({ x }) {',
      '    return x;',
      '  }',
      '}',
    ].join('\n'))
  })
})

describe('psc: destructuring checks (D40)', () => {
  it('reports unknown named parameters of local and imported functions at compile time', () => {
    expect(() => transpile('function f({ a }) {}\nf({ b: 1 })')).toThrow("Unknown named parameter 'b' of f({a})")

    const modules = {
      'm.pscript': 'export const f = ({ a, pos: { x } }) => a',
      'main.pscript': "import * as m from './m'\nm.f({ a: 1, pos: { y: 1 } })",
    }

    expect(() => transpileModules(modules)).toThrow(PScriptSyntaxError)
    expect(() => transpileModules(modules)).toThrow("main.pscript:2:20 SyntaxError: Unknown named parameter 'pos.y'")
  })

  it('keeps class checks working for names bound by patterns', () => {
    expect(js('const { Base } = { Base: null }\nconst [x] = [1]\nclass A { m() { return x } }')).toContain('return x;')
  })
})

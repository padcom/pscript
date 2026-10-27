import { describe, expect, it } from 'vitest'
import { PScriptSyntaxError, transpile } from '@/index'

function js(source: string): string {
  return transpile(source).code.trimEnd()
}

describe('psc: expressions', () => {
  it.each([
    ['a == b', 'a === b;'],
    ['a != b', 'a !== b;'],
    ['(a + b) * c', '(a + b) * c;'],
    ['a + (b * c)', 'a + b * c;'],
    ['a - (b - c)', 'a - (b - c);'],
    ['-2 ** 2', '-(2 ** 2);'],
    ['(-2) ** 2', '(-2) ** 2;'],
    ['2 ** 3 ** 2', '2 ** 3 ** 2;'],
    ['(2 ** 3) ** 2', '(2 ** 3) ** 2;'],
    ['- -a', '-(-a);'],
    ['-(+a)', '-(+a);'],
    ['!(a && b)', '!(a && b);'],
    ['a ?? (b || c)', 'a ?? (b || c);'],
    ['(a ?? b) || c', '(a ?? b) || c;'],
    ['a ? b : c ? d : e', 'a ? b : c ? d : e;'],
    ['(a ? b : c) ? d : e', '(a ? b : c) ? d : e;'],
    ['a = b = 1', 'a = b = 1;'],
    ['x++ + ++y', 'x++ + ++y;'],
    ['(1).toString()', '(1).toString();'],
    ['new a.B(1)', 'new a.B(1);'],
    ['new (f())()', 'new (f())();'],
    ['o[k].m(1, 2)', 'o[k].m(1, 2);'],
  ])('%s', (source, expected) => {
    expect(js(`let a, b, c, d, e, x = 0, y = 0, o, k;\n${source}`).split('\n')[1]).toBe(expected)
  })
})

describe('psc: helpers', () => {
  it('maps typeof to a null-aware helper (D39)', () => {
    expect(js('const v = null\nv.x = typeof v')).toBe([
      'function $typeof(value) {',
      "  return value === null ? 'null' : typeof value;",
      '}',
      'const v = null;',
      'v.x = $typeof(v);',
    ].join('\n'))
  })

  it('keeps typeof of an undeclared global safe', () => {
    expect(js('typeof missing')).toContain("(typeof missing === 'undefined' ? 'undefined' : $typeof(missing));")
  })

  it('renames a helper that clashes with a program name', () => {
    expect(js('const $typeof = 1\ntypeof $typeof')).toContain('function $typeof2(value)')
  })

  it('defines print only when the global is used', () => {
    expect(js('print(1)')).toBe('const print = (...args) => console.log(...args);\nprint(1);')
    expect(js('function print(x) { return x }\nprint(1)')).not.toContain('console.log')
    expect(js('1 + 2')).toBe('1 + 2;')
  })
})

describe('psc: control flow', () => {
  it('prints control flow with braces', () => {
    expect(js('let i = 0\nwhile (i < 3) i++\nif (i == 3) i = 0\nelse if (i > 3) { i = 1 } else i = 2')).toBe([
      'let i = 0;',
      'while (i < 3) {',
      '  i++;',
      '}',
      'if (i === 3) {',
      '  i = 0;',
      '} else if (i > 3) {',
      '  i = 1;',
      '} else {',
      '  i = 2;',
      '}',
    ].join('\n'))
  })
})

describe('psc: other statements', () => {
  it('prints loops', () => {
    const source = 'for (;;) break\nfor (let i = 0, j; i < 2; i++) continue\nlet x\nfor (x of [1]) {}\nfor (const y of "ab") {}'

    expect(js(source)).toBe([
      'for (;;) {',
      '  break;',
      '}',
      'for (let i = 0, j = null; i < 2; i++) {',
      '  continue;',
      '}',
      'let x = null;',
      'for (x of [1]) {}',
      'for (const y of "ab") {}',
    ].join('\n'))
  })

  it('parenthesises `in` in a for initialiser', () => {
    expect(js("const o = {}\nfor (let a = 'x' in o; a;) break")).toContain("for (let a = ('x' in o); a;) {")
  })
})

describe('psc: exceptions and statement wrapping', () => {
  it('prints try/catch/finally', () => {
    expect(js('try { throw 1 } catch { } finally { }\ntry {} catch (e) { e }')).toBe([
      'try {',
      '  throw 1;',
      '} catch {} finally {}',
      'try {} catch (e) {',
      '  e;',
      '}',
    ].join('\n'))
  })

  it('wraps expression statements that would start with { or function', () => {
    expect(js('({}).x\n(function () {})()')).toBe('({}.x);\n(function () {}());')
  })
})

describe('psc: functions and objects', () => {
  it('prints functions, defaults, rest and bare returns (D37)', () => {
    expect(js('function f(a, b = 1, ...c) { if (a) return\n return b }')).toBe([
      'function f(a, b = 1, ...c) {',
      '  if (a) {',
      '    return null;',
      '  }',
      '  return b;',
      '}',
    ].join('\n'))
  })

  it('prints arrows', () => {
    expect(js('const f = x => ({ x })\nconst g = (a, b) => { return a }\nconst h = () => a => a')).toBe([
      'const f = x => ({ x });',
      'const g = (a, b) => {',
      '  return a;',
      '};',
      'const h = () => a => a;',
    ].join('\n'))
  })
})

describe('psc: objects and templates', () => {
  it('prints named function expressions', () => {
    expect(js('const f = function fact(n) { return fact }')).toBe('const f = function fact(n) {\n  return fact;\n};')
  })

  it('prints object literals inline, or one member per line with methods and accessors', () => {
    expect(js("const a = 1\nconst o = { a, b: 2, 'c d': 3, if: 4 }")).toContain("const o = { a, b: 2, 'c d': 3, if: 4 };")
    expect(js('const o = { x: 1, get y() { return 2 }, set y(v) {}, m() {} }')).toBe([
      'const o = {',
      '  x: 1,',
      '  get y() {',
      '    return 2;',
      '  },',
      '  set y(v) {},',
      '  m() {},',
      '};',
    ].join('\n'))
  })

  it('keeps template literals, including line breaks', () => {
    // eslint-disable-next-line no-template-curly-in-string -- PScript source
    expect(js('const a = 1\nfunction f() { return `x ${a + 1}\n  y\\n` }')).toContain('  return `x ${a + 1}\n  y\\n`;')
  })
})

describe('psc: errors', () => {
  it('reports the interpreter\'s compile-time errors (P1)', () => {
    expect(() => transpile('const a = 1\na = 2')).toThrow("Assignment to constant variable 'a'")
    expect(() => transpile('function f(a) {}\nf()')).toThrow(PScriptSyntaxError)
  })

  it('rejects names JavaScript reserves in strict mode', () => {
    const message = "a.pscript:1:5 SyntaxError: 'arguments' cannot be used"

    expect(() => transpile('let arguments = 1', { fileName: 'a.pscript' })).toThrow(message)
  })
})

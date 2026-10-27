import { describe, expect, it } from 'vitest'
import { PScriptSyntaxError, transpile } from '@/index'
import { outputSpecifier } from '@/transpiler/modules'

function js(source: string): string {
  return transpile(source, { fileName: 'main.pscript' }).code.trimEnd()
}

describe('psc: module specifiers (P9)', () => {
  it.each([
    ['./m', './m.js'],
    ['./m.pscript', './m.js'],
    ['../lib/m.psc', '../lib/m.js'],
    ['./data.json', './data.json'],
    ['./m.js', './m.js'],
    ['../v1.2/m', '../v1.2/m.js'],
    ['./.hidden', './.hidden.js'],
    ['lodash', 'lodash'],
    ['host:fs', 'host:fs'],
  ])('%s → %s', (specifier, expected) => {
    expect(outputSpecifier(specifier)).toBe(expected)
  })
})

describe('psc: imports and exports', () => {
  it('prints imports with rewritten specifiers', () => {
    expect(js("import { a, b as c } from './m'\nimport * as ns from \"../n.pscript\"\nimport 'host:x'\nprint(a, c, ns)")).toBe([
      "import { a, b as c } from './m.js';",
      'import * as ns from "../n.js";',
      "import 'host:x';",
      'const print = (...args) => console.log(...args);',
      'print(a, c, ns);',
    ].join('\n'))
  })

  it('prints exported declarations', () => {
    expect(js('export let x\nexport const y = 1\nexport function f() {}\nexport class C {}\nexport interface I {}')).toBe([
      'const $interface = (() => {',
      ...js('interface J {}').split('\n').slice(1, -1),
      'export let x = null;',
      'export const y = 1;',
      'export function f() {}',
      'export class C {}',
      "export const I = $interface('I', []);",
    ].join('\n'))
  })

  it('prints export lists and re-exports', () => {
    expect(js("let a, b\nexport { a, b as c }\nexport { d as e, f } from './m.psc'")).toBe([
      'let a = null, b = null;',
      'export { a, b as c };',
      "export { d as e, f } from './m.js';",
    ].join('\n'))
  })
})

describe('psc: module names', () => {
  it('treats imported names as declared', () => {
    expect(js("import { print } from './p'\nprint(1)")).toBe("import { print } from './p.js';\nprint(1);")
  })

  it('gives `this` outside functions the value null', () => {
    expect(js('export const t = this\nexport const f = () => this\nexport function g() { return this }')).toBe([
      'export const t = null;',
      'export const f = () => null;',
      'export function g() {',
      '  return this;',
      '}',
    ].join('\n'))
  })
})

describe('psc: module goal', () => {
  it('compiles a source with import/export declarations as a module', () => {
    expect(js("import { a } from './m'\na")).toBe("import { a } from './m.js';\na;")
  })

  it('compiles a source without them as a script, unless asked for a module', () => {
    expect(() => transpile('export const x = 1', { goal: 'script' })).toThrow('import and export are only allowed in modules')
    expect(transpile('const x = 1', { goal: 'module' }).code).toBe('const x = 1;\n')
  })

  it('reports the module checks of compileModule() (P1)', () => {
    expect(() => js("import { x } from './o'\nx = 2")).toThrow(PScriptSyntaxError)
    expect(() => js("import { x } from './o'\nx = 2")).toThrow("main.pscript:2:1 SyntaxError: Cannot assign to import 'x'")
    expect(() => js('export { nope }')).toThrow("Export 'nope' is not defined in module")
  })

  it('checks the classes of a module, leaving out imported superclasses', () => {
    expect(js("import { Base } from './b'\nexport class C extends Base {}")).toContain('export class C extends Base {}')
    expect(() => js('class A { final m() {} }\nexport class B extends A { override m() {} }')).toThrow(/final/)
  })
})

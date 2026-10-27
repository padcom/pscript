import { describe, expect, it } from 'vitest'
import { PScriptSyntaxError, transpileModules } from '@/index'

function code(modules: Record<string, string>, id = 'main.pscript'): string {
  return transpileModules(modules)[id].code.trimEnd()
}

function error(modules: Record<string, string>): string {
  try {
    transpileModules(modules)
  } catch (e) {
    if (e instanceof PScriptSyntaxError) return e.message.split('\n')[0]
    throw e
  }

  return 'no error'
}

describe('psc programs: modules outside the program', () => {
  it('lets them export what the program imports', () => {
    expect(error({
      'main.pscript': "import { a, b } from 'host:x'\nimport * as y from './y.js'\nexport { a as c } from 'pkg'\nprint(a, b, y)",
      'other.pscript': "import { c } from './main'\nimport { d } from 'host:x'\nprint(c, d)",
    })).toBe('no error')
  })

  it('does not check classes extending their classes', () => {
    expect(code({ 'main.pscript': "import { Base } from 'host:ui'\nexport class Button extends Base { m() {} }" })).toContain(
      'export class Button extends Base {',
    )
  })

  it('does not take imported non-classes for classes', () => {
    expect(error({
      'base.pscript': 'function make() { return class {} }\nexport const Base = make()\nexport let Other',
      'main.pscript': "import { Base, Other } from './base'\nclass A extends Base {}\nclass B extends Other {}",
    })).toBe('no error')
  })
})

describe('psc programs: resolution', () => {
  it('reports an ambiguous specifier', () => {
    expect(error({ 'a.pscript': 'export const x = 1', 'a.psc': 'export const x = 2', 'main.pscript': "import { x } from './a'" }))
      .toBe("main.pscript:1:19 SyntaxError: ambiguous module './a': a.pscript and a.psc")
  })

  it('resolves specifiers relative to the importing module', () => {
    expect(error({
      'lib/a.pscript': "export { b } from '../shared/b.pscript'",
      'shared/b.psc': 'export const b = 1',
      'main.pscript': "import { b } from './lib/a'\nimport { nope } from './shared/b'",
    })).toBe("main.pscript:2:10 SyntaxError: Module './shared/b' does not provide an export named 'nope'")
  })

  it('compiles files without imports and exports as scripts, which export nothing', () => {
    expect(error({ 'util.pscript': 'let x = 1', 'main.pscript': "import './util'" })).toBe('no error')
    expect(error({ 'util.pscript': 'let x = 1', 'main.pscript': "import { x } from './util'" }))
      .toBe("main.pscript:1:10 SyntaxError: Module './util' does not provide an export named 'x'")
  })

  it('leaves reading an import too early in a cycle to the program', () => {
    expect(error({
      'a.pscript': "import { B } from './b'\nexport class A {}\nexport function f() { return class extends B {} }",
      'b.pscript': "import { A } from './a'\nexport class B extends A {}",
      'main.pscript': "import './a'",
    })).toBe('no error')
  })
})

describe('psc programs: imported functions', () => {
  it('checks the arity of functions imported under another name or re-exported', () => {
    expect(error({
      'math.pscript': 'export function add(a, b = 0) { return a + b }',
      'api.pscript': "import { add } from './math'\nexport { add as sum }",
      'main.pscript': "import { sum } from './api'\nsum(1, 2, 3)",
    })).toBe('main.pscript:2:1 SyntaxError: add(a, b?) expects 1-2 arguments, got 3')
  })

  it('does not check names that shadow an import, or functions that are not constants', () => {
    expect(error({
      'math.pscript': 'export function add(a, b) {}\nexport let sub = (a, b) => a - b',
      'main.pscript': "import { add, sub } from './math'\nfunction f(add) { add(1) }\nsub(1)",
    })).toBe('no error')
  })
})

describe('psc programs: imported classes', () => {
  it('forwards the accessor half a subclass does not redefine', () => {
    expect(code({
      'base.pscript': 'export class Base {\n  value = 0\n  get v() { return value }\n  set v(x) { value = x }\n}',
      'main.pscript': "import { Base } from './base'\nclass Child extends Base {\n  override get v() { return 1 }\n}",
    })).toContain('set v(value) { super.v = value; }')
  })

  it('checks classes extending classes imported through namespaces only at runtime', () => {
    expect(error({
      'base.pscript': 'export class Base { final m() {} }',
      'main.pscript': "import * as base from './base'\nclass C extends base.Base { override m() {} }",
    })).toBe('no error')
  })
})

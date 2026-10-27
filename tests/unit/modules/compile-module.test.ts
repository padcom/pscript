import { describe, expect, it } from 'vitest'
import { compileModule } from '@/compiler/compiler'
import { Op } from '@/compiler/opcodes'
import { parse } from '@/parser/parse'

const SOURCE = [
  "import { a, b as c } from './m'",
  "import './side'",
  'export { a as reexported, later as renamed }',
  "export { x as y } from './m'",
  'export const local = 1',
  'export function f() { return c }',
  'let later = 2',
].join('\n')

describe('compileModule (§5.5 module goal)', () => {
  it('builds request, import and export tables', () => {
    const compiled = compileModule(SOURCE, 'main')

    expect(compiled.requests).toEqual(['./m', './side'])
    expect(compiled.imports.map(({ request, importName, localName }) => [request, importName, localName])).toEqual([
      [0, 'a', 'a'],
      [0, 'b', 'c'],
    ])
    expect(compiled.localExports.map(entry => entry.exportName)).toEqual(['renamed', 'local', 'f'])
    expect(compiled.indirectExports.map(({ exportName, request, importName }) => [exportName, request, importName])).toEqual([
      ['reexported', 0, 'a'],
      ['y', 0, 'x'],
    ])
    expect(compiled.hoistedFunctions).toHaveLength(1)
  })

  it('reads imports through LOAD_IMPORT and keeps top-level bindings out of the globals', () => {
    const { main } = compileModule("import { a } from './m'\nlet b = a", 'main')

    expect(main.kind).toBe('module')
    expect(main.code).toContain(Op.LOAD_IMPORT)
    expect(main.code).not.toContain(Op.DECLARE_GLOBAL)
  })
})

describe('module compile errors', () => {
  it.each([
    ["import { a } from './m'\na = 1", "Cannot assign to import 'a'"],
    ["import { a } from './m'\nlet a = 1", "Identifier 'a' has already been declared"],
    ["import { a, b as a } from './m'", "Identifier 'a' has already been declared"],
    ['export { nope }', "Export 'nope' is not defined in module"],
    ['const a = 1\nexport { a, a }', "Duplicate export of 'a'"],
    ['export const a = 1\nexport { a }', "Duplicate export of 'a'"],
  ])('rejects %j', (source, message) => {
    expect(() => compileModule(source, 'main')).toThrow(message)
  })
})

describe('module syntax (§4.7.1)', () => {
  it.each([
    ["import x from 'm'", 'default imports are not supported'],
    ["import x, { y } from 'm'", 'default imports are not supported'],
    ['export default 1', 'export default is not supported'],
    ["export * from 'm'", 'export * is not supported'],
    ["import('m')", 'import() is not supported'],
    ['import.meta', 'import.meta is not supported'],
    ["export { a as 'b c' }", 'string export names are not supported'],
    ["{ import 'm' }", 'only allowed at the top level of a module'],
    ['function f() { export const a = 1 }', 'only allowed at the top level of a module'],
  ])('rejects %j', (source, message) => {
    expect(() => parse(source, { goal: 'module' })).toThrow(message)
  })

  it('rejects import and export in scripts', () => {
    expect(() => parse("import 'm'")).toThrow('import and export are only allowed in modules')
  })

  it('keeps as and from ordinary names outside module clauses', () => {
    const source = "import { a } from 'm'\nconst from = a\nconst as = from\nexport { from as alias }"

    expect(() => parse(source, { goal: 'module' })).not.toThrow()
  })
})

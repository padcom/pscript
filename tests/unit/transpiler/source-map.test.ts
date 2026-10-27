import { readFileSync, readdirSync } from 'node:fs'
import { SourceMap as NodeSourceMap } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { transpile, transpileModules, type SourceMap } from '@/index'
import { encodeVlq } from '@/transpiler/source-map'

interface Entry {
  originalLine?: number
  originalColumn?: number
}

function findEntry(map: SourceMap, line: number, column: number): Entry {
  return new NodeSourceMap({ file: '', sourceRoot: '', sourcesContent: [], ...map }).findEntry(line, column) as Entry
}

// The original position (1-based line and column) of a generated position, as Node decodes the map.
function original(map: SourceMap, code: string, needle: string): string {
  const lines = code.split('\n')
  const line = lines.findIndex(text => text.includes(needle))
  const { originalLine, originalColumn } = findEntry(map, line, lines[line].indexOf(needle))

  return `${originalLine! + 1}:${originalColumn! + 1}`
}

const SOURCE = [
  '// comment',
  'function f(o) {',
  '  let x = 1',
  '',
  '  return o.deep.value',
  '}',
  'class C {',
  '  m() { return f(null) }',
  '}',
  'new C().m()',
  '',
].join('\n')

describe('psc source maps: VLQ', () => {
  it.each([
    [0, 'A'],
    [1, 'C'],
    [-1, 'D'],
    [15, 'e'],
    [16, 'gB'],
    [123, '2H'],
    [-123, '3H'],
    [1024, 'ggC'],
  ])('%d → %s', (value, expected) => {
    expect(encodeVlq(value)).toBe(expected)
  })
})

describe('psc source maps', () => {
  it('maps statements, members, calls and property reads to their source positions', () => {
    const { code, map } = transpile(SOURCE, { fileName: 'lib/main.pscript', sourceMap: true })

    expect(map).toMatchObject({ version: 3, file: 'main.js', sources: ['main.pscript'], sourcesContent: [SOURCE], names: [] })
    expect(original(map!, code, 'function f')).toBe('2:1')
    expect(original(map!, code, 'let x')).toBe('3:3')
    expect(original(map!, code, 'return o.deep')).toBe('5:3')
    expect(original(map!, code, 'o.deep.value')).toBe('5:10')
    expect(original(map!, code, 'm() {')).toBe('8:3')
    expect(original(map!, code, 'f(null)')).toBe('8:16')
    expect(original(map!, code, 'new C().m()')).toBe('10:1')
  })

  it('embeds the map in the code when asked for an inline map', () => {
    const { code, map } = transpile(SOURCE, { sourceMap: 'inline' })
    const [, encoded] = /\/\/# sourceMappingURL=data:application\/json;charset=utf-8;base64,(?<map>\S+)\n$/.exec(code)!

    expect(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))).toEqual(map)
    expect(map!.sources).toEqual(['<script>'])
  })
})

describe('psc source maps: options', () => {
  it('gives every module of a program its map', () => {
    const modules = { 'lib/a.pscript': 'export const a = 1', 'main.psc': "import { a } from './lib/a'\nprint(a)" }
    const results = transpileModules(modules, { sourceMap: true })

    expect(results['lib/a.pscript'].map).toMatchObject({ file: 'a.js', sources: ['a.pscript'] })
    expect(results['main.psc'].map!.sources).toEqual(['main.psc'])
    expect(original(results['main.psc'].map!, results['main.psc'].code, 'print(a)')).toBe('2:1')
  })

  it('gives no mappings to a source containing the marker characters', () => {
    const { code, map } = transpile("print('﷐')", { sourceMap: true })

    expect(code).toContain("print('﷐');")
    expect(map!.mappings).toBe('')
  })
})

const root = join(import.meta.dirname, '..', '..', 'programs')
const programs = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter(file => file.endsWith('.pscript'))
  .map(file => ({ file, source: readFileSync(join(root, file), 'utf8') }))
  .sort((a, b) => a.file.localeCompare(b.file))

function transpiled(source: string, sourceMap: boolean) {
  try {
    return transpile(source, { sourceMap })
  } catch {
    return null
  }
}

describe('psc source maps of the program corpus', () => {
  it.for(programs)('$file', ({ source }, { skip }) => {
    const plain = transpiled(source, false)
    if (!plain) {
      skip('psc rejects the program')

      return
    }
    const { code, map } = transpiled(source, true)!
    const sourceLines = source.split('\n')

    // the markers leave no trace, and every mapping points into the source
    expect(code).toBe(plain.code)

    for (const line of code.split('\n').keys()) {
      const { originalLine, originalColumn } = findEntry(map!, line, 0)

      if (originalLine !== undefined) expect(sourceLines[originalLine].length).toBeGreaterThanOrEqual(originalColumn!)
    }
  })
})

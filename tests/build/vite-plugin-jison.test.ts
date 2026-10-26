import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileGrammar, jison } from '../../build/vite-plugin-jison'

function fixture(name: string) {
  return readFileSync(new URL(`../fixtures/jison/${name}`, import.meta.url), 'utf8')
}

describe('compileGrammar', () => {
  it('generates an ES module with a default export', () => {
    const code = compileGrammar(fixture('calc.jison'))

    expect(code).toMatch(/export default pscriptParser\n$/)
  })

  it('rejects a grammar with unresolved conflicts', () => {
    expect(() => compileGrammar(fixture('conflict.jison'), 'conflict.jison'))
      .toThrow(/conflict\.jison: grammar has \d+ unresolved conflict\(s\)/)
  })

  it('reports the conflicting states', () => {
    expect(() => compileGrammar(fixture('conflict.jison')))
      .toThrow(/lookahead token is +\s*\+ in state/)
  })
})

describe('jison plugin', () => {
  const plugin = jison()
  const transform = plugin.transform as (code: string, id: string) => { code: string } | null

  it('ignores files that are not grammars', () => {
    expect(transform('export default 1', 'file.ts')).toBeNull()
  })

  it('transforms .jison files', () => {
    expect(transform(fixture('calc.jison'), 'calc.jison')?.code).toContain('export default pscriptParser')
  })

  it('fails on a conflicting grammar', () => {
    expect(() => transform(fixture('conflict.jison'), 'conflict.jison')).toThrow(/unresolved conflict/)
  })
})

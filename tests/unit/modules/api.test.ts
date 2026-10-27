import { describe, expect, it } from 'vitest'
import { Interpreter, PScriptRuntimeError } from '@/index'

function caught(f: () => unknown): unknown {
  try {
    f()
  } catch (e) {
    return e
  }

  return null
}

function interpreter(modules: Record<string, string>, output: string[] = []) {
  return new Interpreter({ modules, stdout: text => output.push(text) })
}

describe('runModule / importModule (§5.8)', () => {
  it('returns a live, frozen, sorted view of the exports', () => {
    const ns = interpreter({}).runModule('export let b = 1\nexport const a = 2\nexport function inc() { b++ }')

    expect(Object.keys(ns)).toEqual(['a', 'b', 'inc'])
    expect(ns.b).toBe(1)
    expect(Object.isFrozen(ns)).toBe(true)
  })

  it('evaluates each module once per interpreter', () => {
    const output: string[] = []
    const modules = { 'counter.pscript': "print('loaded')\nexport let n = 0\nexport function inc() { n++ }" }
    const host = interpreter(modules, output)

    host.runModule("import { inc } from './counter'\ninc()")
    host.runModule("import { inc } from './counter'\ninc()", { id: 'second' })

    expect(output).toEqual(['loaded'])
    expect(host.importModule('./counter').n).toBe(2)
  })

  it('resolves relative imports against the entry id', () => {
    const host = interpreter({ 'lib/a.pscript': 'export const a = 1' })

    expect(host.runModule("import { a } from './a'\nexport const b = a + 1", { id: 'lib/main' }).b).toBe(2)
  })
})

describe('module errors', () => {
  it('reports missing modules with the importer', () => {
    expect(() => interpreter({}).runModule("import './nope'")).toThrow("Cannot find module './nope' imported from 'main'")
    expect(() => interpreter({}).importModule('nope')).toThrow(PScriptRuntimeError)
  })

  it('rethrows the error of an errored module', () => {
    const host = interpreter({ 'bad.pscript': "throw new Error('boom')" })
    const first = caught(() => host.importModule('./bad'))

    expect(first).toBeInstanceOf(PScriptRuntimeError)
    expect(() => host.importModule('./bad')).toThrow(first as Error)
  })

  it('uses a custom loader', () => {
    const host = new Interpreter({ moduleLoader: specifier => ({ id: specifier, source: `export const name = '${specifier}'` }) })

    expect(host.importModule('virtual').name).toBe('virtual')
  })
})

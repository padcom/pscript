import { describe, expect, it } from 'vitest'
import { Interpreter, PScriptRuntimeError, type InterpreterOptions } from '@/index'

const later = (value: string, ms = 5) => `await new Promise(resolve => setTimeout(() => resolve(${value}), ${ms}))`

function interpreter(options: InterpreterOptions = {}, output: string[] = []) {
  return new Interpreter({ ...options, stdout: text => output.push(text) })
}

describe('top-level await in scripts (D51)', () => {
  it('gives the completion value when the awaits settle while run() drains the jobs', () => {
    const host = interpreter()

    expect(host.run('let x = await Promise.resolve(41); x + 1')).toBe(42)
    expect(host.get('x')).toBe(41)
  })

  it('gives a promise of the completion value when an await waits for the host', async () => {
    const result = interpreter().run(`${later('5')} * 2`)

    expect(result).toBeInstanceOf(Promise)
    await expect(result).resolves.toBe(10)
  })

  it('waits with runAsync() and reports exceptions as runtime errors', async () => {
    const host = interpreter()

    await expect(host.runAsync(`const v = ${later("'later'")}; v`)).resolves.toBe('later')
    await expect(host.runAsync(`${later('1')}\nthrow new RangeError('late')`)).rejects.toThrow(PScriptRuntimeError)
    expect(() => host.run('await null\nthrow new Error("early")')).toThrow('early')
  })
})

const modules = {
  slow: `export const value = ${later("'slow'")}\nprint('slow')`,
  quick: "export const value = await Promise.resolve('quick')\nprint('quick')",
  main: "import { value as a } from './slow'\nimport { value as b } from './quick'\nexport const both = a + ' ' + b",
}

describe('top-level await in modules (D51)', () => {
  it('evaluates a module whose awaits settle while the jobs drain with the synchronous API', () => {
    expect(interpreter({ modules }).importModule('quick').value).toBe('quick')
  })

  it('asks for the asynchronous API when an await waits for the host', async () => {
    const output: string[] = []
    const host = interpreter({ modules }, output)

    expect(() => host.importModule('main')).toThrow("Module 'main' is still evaluating")
    await expect(host.importModuleAsync('main')).resolves.toMatchObject({ both: 'slow quick' })
    expect(output).toEqual(['quick', 'slow'])
  })

  it('evaluates each module once, also for concurrent imports', async () => {
    const output: string[] = []
    const host = interpreter({ modules }, output)
    const [first, second] = await Promise.all([host.importModuleAsync('main'), host.importModuleAsync('./slow')])

    expect(first.both).toBe('slow quick')
    expect(second.value).toBe('slow')
    expect(output).toEqual(['quick', 'slow'])
  })

  it('runs entry modules given as source', async () => {
    const source = "import { both } from './main'\nexport const n = both.length"
    const ns = await interpreter({ modules }).runModuleAsync(source, { id: 'entry' })

    expect(ns.n).toBe(10)
  })
})

describe('failing top-level await in modules (D51)', () => {
  it('rejects every import of a module whose top-level await failed', async () => {
    const host = interpreter({ modules: { bad: "await null\nthrow new TypeError('bad module')", user: "import './bad'" } })

    await expect(host.importModuleAsync('bad')).rejects.toThrow('bad module')
    await expect(host.importModuleAsync('bad')).rejects.toThrow('bad module')
    await expect(host.importModuleAsync('user')).rejects.toThrow('bad module')
  })
})

describe('asynchronous module loaders (D51)', () => {
  const sources: Record<string, string> = {
    main: "import { twice } from './lib'\nexport const four = twice(2)",
    lib: 'export function twice(x) { return 2 * x }',
  }
  const moduleLoader = async (specifier: string) => {
    await new Promise(resolve => { setTimeout(resolve, 1) })
    const id = specifier.replace(/^\.\//, '')
    if (!(id in sources)) throw new Error('no such file')

    return { id, source: sources[id] }
  }

  it('loads module graphs with the asynchronous API', async () => {
    const host = interpreter({ moduleLoader })

    await expect(host.importModuleAsync('main')).resolves.toMatchObject({ four: 4 })
    await expect(host.runModuleAsync("import { four } from './main'\nexport const eight = four * 2", { id: 'entry' }))
      .resolves.toMatchObject({ eight: 8 })
  })

  it('reports missing modules and refuses the synchronous API', async () => {
    const host = interpreter({ moduleLoader })

    await expect(host.importModuleAsync('nope')).rejects.toThrow("Cannot find module 'nope': no such file")
    expect(() => host.importModule('main')).toThrow('The module loader is asynchronous')
  })
})

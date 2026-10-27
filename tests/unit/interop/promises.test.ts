// Promises across the boundary and the job queue (D43, §5.6.10).
import { describe, expect, it } from 'vitest'
import { Interpreter, PScriptRuntimeError } from '@/index'

function interpreter(options: ConstructorParameters<typeof Interpreter>[0] = {}) {
  return new Interpreter({ stdout: () => {}, ...options })
}

describe('jobs run before run() returns', () => {
  it('settles script-only async work synchronously', () => {
    const host = interpreter()

    const source = 'let result = null\nasync function f() { return 1 + await 2 }\nf().then(v => { result = v })\nresult'

    expect(host.run(source)).toBe(null)
    expect(host.get('result')).toBe(3)
  })

  it('reports an unhandled rejection as an uncaught error of run()', () => {
    expect(() => interpreter().run("Promise.reject(new TypeError('lost'))")).toThrow(PScriptRuntimeError)
    expect(() => interpreter().run("Promise.reject(new TypeError('lost'))")).toThrow('TypeError: lost')
    expect(interpreter().run("Promise.reject(new TypeError('handled')).catch(() => null)\n1")).toBe(1)
  })

  it('stops an endless async loop at the step limit', () => {
    const host = interpreter({ maxSteps: 10_000 })

    expect(() => host.run('async function spin() { while (true) await null }\nspin()')).toThrow('step limit')
  })
})

describe('jobs of modules', () => {
  it('run after the whole module graph', () => {
    const lines: string[] = []
    const host = interpreter({
      stdout: line => lines.push(line),
      modules: { dep: "Promise.resolve().then(() => print('dep job'))\nprint('dep body')\nexport const x = 1" },
    })

    host.runModule("import { x } from 'dep'\nprint('main body', x)")
    expect(lines).toEqual(['dep body', 'main body 1', 'dep job'])
  })
})

describe('script promises seen by the host', () => {
  it('become host promises that settle with converted values', async () => {
    const host = interpreter()
    const promise = host.run('async function f() { return [1, 2] }\nf()') as Promise<number[]>

    expect(promise).toBeInstanceOf(Promise)
    expect(await promise).toEqual([1, 2])
  })

  it('reject with PScriptRuntimeError', async () => {
    const source = "const p = Promise.reject(new RangeError('bad'))\np.catch(() => null)\np"
    const promise = interpreter().run(source) as Promise<unknown>

    await expect(promise).rejects.toThrow(PScriptRuntimeError)
    await expect(promise).rejects.toThrow('RangeError: bad')
  })
})

describe('host promises seen by scripts', () => {
  it('can be awaited; jobs then run in a host microtask', async () => {
    const lines: string[] = []
    const fetchValue = (x: number) => new Promise(resolve => { setTimeout(() => resolve(x * 2), 1) })
    const host = interpreter({ globals: { fetchValue }, stdout: line => lines.push(line) })
    const result = host.run('async function main() { const v = await fetchValue(21); print(v); return v }\nmain()')

    expect(lines).toEqual([])
    expect(await result).toBe(42)
    expect(lines).toEqual(['42'])
  })

  it('reject into script catch blocks with the host error as cause', async () => {
    const fail = () => Promise.reject(new TypeError('host failed'))
    const host = interpreter({ globals: { fail } })
    const source = "async function main() {\n  try { await fail() } catch (e) { return e.name + ': ' + e.message }\n}"
    const result = host.run(`${source}\nmain()`)

    expect(await result).toBe('TypeError: host failed')
  })
})

describe('host promises seen by scripts, continued', () => {
  it('keep their identity', () => {
    const shared = Promise.resolve(1)
    const host = interpreter({ globals: { shared } })

    expect(host.run('shared == shared && shared instanceof Promise')).toBe(true)
    host.run('function identity(x) { return x }')
    expect(host.call('identity', shared)).toBe(shared)
  })

  it('reports unhandled rejections of background jobs through stderr', async () => {
    const errors: string[] = []
    const later = () => new Promise(resolve => { setTimeout(resolve, 1) })
    const host = interpreter({ globals: { later }, stderr: line => errors.push(line) })

    host.run("async function main() { await later(); throw new Error('too late') }\nmain()\n1")
    await new Promise(resolve => { setTimeout(resolve, 20) })
    expect(errors.join('\n')).toContain('Error: too late')
  })
})

// setTimeout / clearTimeout and fetch (D44, §4.6.1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Interpreter } from '@/index'

function interpreter(options: ConstructorParameters<typeof Interpreter>[0] = {}) {
  const lines: string[] = []
  const errors: string[] = []
  const host = new Interpreter({ stdout: line => lines.push(line), stderr: line => errors.push(line), ...options })

  return { host, lines, errors }
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
afterEach(() => { vi.useRealTimers() })

describe('setTimeout and clearTimeout', () => {
  it('runs callbacks after run() returns, by delay, with the extra arguments', () => {
    const { host, lines } = interpreter()

    host.run("setTimeout((a, b) => print('second', a, b), 20, 'x', 'y')\nsetTimeout(() => print('first'), 10)\nprint('sync')")
    expect(lines).toEqual(['sync'])
    vi.advanceTimersByTime(10)
    expect(lines).toEqual(['sync', 'first'])
    vi.advanceTimersByTime(10)
    expect(lines).toEqual(['sync', 'first', 'second x y'])
  })
})

describe('timer ids', () => {
  it('returns numeric ids that clearTimeout cancels; unknown ids are ignored', () => {
    const { host, lines } = interpreter()

    const source = "const id = setTimeout(() => print('never'))\nclearTimeout(id)\nclearTimeout(id)\nclearTimeout(null)\nid"

    expect(host.run(source)).toBe(1)
    vi.runAllTimers()
    expect(lines).toEqual([])
  })
})

describe('timers and jobs', () => {
  it('runs the jobs a callback queues before the next timer', () => {
    const { host, lines } = interpreter()

    host.run(`
      setTimeout(() => { print('t1'); Promise.resolve().then(() => print('job')) })
      setTimeout(() => print('t2'))
    `)
    vi.runAllTimers()
    expect(lines).toEqual(['t1', 'job', 't2'])
  })
})

describe('timer callbacks', () => {
  it('works with promises and await', async () => {
    const { host, lines } = interpreter()

    host.run(`
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
      async function main() {
        await sleep(100)
        print('woke')
      }
      main()
    `)
    await vi.advanceTimersByTimeAsync(100)
    expect(lines).toEqual(['woke'])
  })

  it('reports an exception or an unhandled rejection of a callback to stderr', () => {
    const { host, errors } = interpreter()

    host.run("setTimeout(() => { throw new TypeError('boom') })\nsetTimeout(() => { Promise.reject(new Error('lost')) })")
    vi.runAllTimers()
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('TypeError: boom')
    expect(errors[1]).toContain('Error: lost')
  })
})

describe('timer arguments', () => {
  it('treats a missing or NaN delay as 0 and rejects code strings', () => {
    const { host, lines } = interpreter()

    host.run("setTimeout(() => print('a'), null)\nsetTimeout(() => print('b'), NaN)")
    vi.advanceTimersByTime(0)
    expect(lines).toEqual(['a', 'b'])
    expect(() => host.run("setTimeout('print(1)')")).toThrow('code strings are not supported')
    expect(() => host.run('setTimeout(1)')).toThrow('setTimeout: number is not a function')
  })

  it('gives each callback a new step budget', () => {
    const { host, errors } = interpreter({ maxSteps: 1_000 })

    // each loop fits in the budget, both together would not
    const loop = 'for (let i = 0; i < 100; i++) {}'

    host.run(`setTimeout(() => { ${loop} }, 1)\nsetTimeout(() => { ${loop} }, 2)`)
    vi.runAllTimers()
    expect(errors).toEqual([])
  })
})

describe('fetch', () => {
  it('passes the resource and options to the host fetch and returns a promise of its response', () => {
    const fetch = (url: string, init?: { method: string, headers: Record<string, string> }) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ url, method: init?.method, type: init?.headers['Content-Type'] }),
    })
    const { host, lines } = interpreter({ fetch })

    host.run(`
      async function main() {
        const response = await fetch('https://example.com/api', { method: 'POST', headers: { 'Content-Type': 'text/plain' } })
        const data = await response.json()
        print(response.ok, data.url, data.method, data.type)
      }
      main()
    `)

    return vi.waitFor(() => expect(lines).toEqual(['true https://example.com/api POST text/plain']))
  })
})

describe('fetch results', () => {
  it('returns a script promise', () => {
    const { host } = interpreter({ fetch: () => Promise.resolve(null) })

    expect(host.run("fetch('x') instanceof Promise")).toBe(true)
  })

  it('rejects (instead of throwing) when the host fetch fails, even synchronously', () => {
    const { host, lines } = interpreter({ fetch: () => { throw new TypeError('bad url') } })

    host.run("fetch('nope').catch(e => print(e.name, e.message))")
    expect(lines).toEqual([])

    return vi.waitFor(() => expect(lines).toEqual(['TypeError bad url']))
  })
})

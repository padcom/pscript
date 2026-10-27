// setTimeout / clearTimeout, setInterval / clearInterval, queueMicrotask (D44, D45) and fetch (D44, §4.6.1).
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

describe('setInterval and clearInterval', () => {
  it('runs the callback every delay until it is cleared, even from inside the callback', () => {
    const { host, lines } = interpreter()

    host.run(`
      let n = 0
      const id = setInterval(label => {
        n++
        print(label, n)
        if (n == 3) clearInterval(id)
      }, 10, 'tick')
    `)
    vi.advanceTimersByTime(25)
    expect(lines).toEqual(['tick 1', 'tick 2'])
    vi.advanceTimersByTime(100)
    expect(lines).toEqual(['tick 1', 'tick 2', 'tick 3'])
  })
})

describe('interval ids and errors', () => {
  it('shares ids with setTimeout: clearTimeout and clearInterval are interchangeable', () => {
    const { host, lines } = interpreter()

    expect(host.run(`
      const a = setInterval(() => print('a'), 10)
      const b = setTimeout(() => print('b'), 10)
      clearTimeout(a)
      clearInterval(b)
      [a, b]
    `)).toEqual([1, 2])
    vi.advanceTimersByTime(50)
    expect(lines).toEqual([])
  })

  it('keeps running after an exception, which goes to stderr', () => {
    const { host, errors } = interpreter()

    host.run("const id = setInterval(() => { throw new Error('again') }, 10)")
    vi.advanceTimersByTime(30)
    expect(errors).toHaveLength(3)
    host.run('clearInterval(id)')
    vi.advanceTimersByTime(30)
    expect(errors).toHaveLength(3)
    expect(() => host.run("setInterval('print(1)')")).toThrow('setInterval: code strings are not supported')
  })
})

describe('queueMicrotask', () => {
  it('runs the callback as a job, in order with promise reactions, before run() returns', () => {
    const { host, lines } = interpreter()

    host.run(`
      Promise.resolve().then(() => print('then 1'))
      queueMicrotask(() => {
        print('micro')
        queueMicrotask(() => print('nested'))
      })
      Promise.resolve().then(() => print('then 2'))
      print('sync')
    `)
    expect(lines).toEqual(['sync', 'then 1', 'micro', 'then 2', 'nested'])
  })
})

describe('queueMicrotask errors', () => {
  it('throws an exception of the callback from run() after the other jobs ran', () => {
    const { host, lines } = interpreter()

    expect(() => host.run(`
      queueMicrotask(() => { throw new RangeError('bad') })
      queueMicrotask(() => print('still runs'))
    `)).toThrow('RangeError: bad')
    expect(lines).toEqual(['still runs'])
    expect(() => host.run('queueMicrotask(1)')).toThrow('queueMicrotask: number is not a function')
  })

  it('reports an exception to stderr when it runs in a timer task', () => {
    const { host, errors } = interpreter()

    host.run("setTimeout(() => queueMicrotask(() => { throw new Error('late') }))")
    vi.runAllTimers()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Error: late')
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

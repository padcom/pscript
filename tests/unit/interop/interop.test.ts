import { describe, expect, it } from 'vitest'
import { Interpreter, PScriptRuntimeError, markAsClass } from '@/index'

function interpreter(globals: Record<string, unknown> = {}) {
  return new Interpreter({ globals, stdout: () => {} })
}

describe('host values (§5.8.1)', () => {
  it('passes primitives through and rejects bigint and symbol', () => {
    expect(interpreter({ n: 1, s: 'x', b: true }).run('n + s + b')).toBe('1xtrue')
    expect(() => interpreter({ big: 1n })).toThrow('bigint')
    expect(() => interpreter({ sym: Symbol('s') })).toThrow('symbol')
  })

  it('calls host functions with converted arguments; undefined results become null', () => {
    const host = interpreter({ add: (a: number, b: number) => a + b, nothing: () => undefined })

    expect(host.run('add(2, 3)')).toBe(5)
    expect(host.run('nothing()')).toBe(null)
    expect(host.run('typeof add')).toBe('function')
    expect(() => host.run('new add(1, 2)')).toThrow('is not a class')
  })

  it('calls host methods with the target as this', () => {
    const counter = {
      n: 0,
      inc() {
        this.n++

        return this.n
      },
    }

    expect(interpreter({ counter }).run('counter.inc(); counter.inc()')).toBe(2)
  })
})

describe('blocked keys', () => {
  it('blocks prototype and constructor keys', () => {
    const host = interpreter({ o: {} })

    expect(host.run('o.constructor')).toBeUndefined()
    expect(host.run('o.__proto__')).toBeUndefined()
    expect(() => host.run('o.__proto__ = {}')).toThrow("Cannot assign to '__proto__' of a host object")
  })
})

describe('host objects', () => {
  it('reads and writes host objects live', () => {
    const config: Record<string, unknown> = { count: 1, nested: { name: 'n' } }
    const host = interpreter({ config })

    expect(host.run('config.count')).toBe(1)
    host.run('config.count = 5; config.extra = true')
    expect(config).toMatchObject({ count: 5, extra: true })
    config.count = 7

    const read = "config.count + ' ' + config.nested.name + ' ' + ('count' in config) + ' ' + config.missing"

    expect(host.run(read)).toBe('7 n true undefined')
    expect(host.run('Object.keys(config).join()')).toBe('count,nested,extra')
  })
})

describe('host arrays and iterables', () => {
  it('treats host arrays as arrays with host methods', () => {
    const list = [1, 2, 3]
    const host = interpreter({ list })

    expect(host.run('Array.isArray(list) + " " + list.length + " " + list[1]')).toBe('true 3 2')
    host.run('list.push(4); list[0] = 10')
    expect(list).toEqual([10, 2, 3, 4])
    expect(host.run('list.map(x => x * 2).join()')).toBe('20,4,6,8')
    expect(host.run('let sum = 0\nfor (const x of list) sum += x\nsum')).toBe(19)
  })

  it('iterates host iterables', () => {
    const map = new Map([['a', 1], ['b', 2]])

    expect(interpreter({ map }).run('let keys = ""\nfor (const entry of map) keys += entry[0]\nkeys')).toBe('ab')
  })

  it('preserves identity in both directions', () => {
    const shared = {}
    const host = interpreter({ a: shared, b: shared, same: (x: unknown) => x === shared })

    expect(host.run('a == b')).toBe(true)
    expect(host.run('same(a)')).toBe(true)

    const fn = host.run('const f = () => 1\nf')

    expect(host.run('f') === fn).toBe(true)
  })
})

class Point {
  constructor(public x: number, public y: number) {}

  norm() { return Math.abs(this.x) + Math.abs(this.y) }
}

describe('host classes (D25)', () => {
  it('constructs host classes and checks instanceof', () => {
    const host = interpreter({ Point })

    expect(host.run('const p = new Point(1, -2)\np.norm()')).toBe(3)
    expect(host.run('p instanceof Point')).toBe(true)
    expect(host.get('p')).toBeInstanceOf(Point)
    expect(() => host.run('Point(1, 2)')).toThrow()
  })
})

describe('marked host classes', () => {
  it('treats marked functions as classes', () => {
    function Legacy(this: { v: number }, v: number) { this.v = v }

    function Plain(this: { v: number }, v: number) { this.v = v }
    const host = interpreter({ Legacy: markAsClass(Legacy), Plain })

    expect(host.run('new Legacy(4).v')).toBe(4)
    expect(() => host.run('new Plain(4)')).toThrow('is not a class')
  })

  it('lets script classes extend host classes', () => {
    const source = [
      'class Named extends Point {',
      '  label',
      '  constructor(x, y, label) { super(x, y); this.label = label }',
      "  describe() { return this.label + ':' + this.norm() + ':' + this.x }",
      '}',
      "const n = new Named(3, 4, 'p')",
      'n.describe() + " " + (n instanceof Point) + " " + (n instanceof Named)',
    ].join('\n')

    expect(interpreter({ Point }).run(source)).toBe('p:7:3 true true')
  })
})

describe('script functions and classes for the host', () => {
  it('exposes script functions as callable, non-constructable proxies', () => {
    const add = interpreter().run('(a, b) => a + b') as (a: number, b?: number, c?: number) => number

    expect(add(1, 2, 99)).toBe(3)
    expect(typeof add).toBe('function')
    expect(() => new (add as unknown as new () => object)()).toThrow(TypeError)
    expect(() => add(1)).toThrow(PScriptRuntimeError)
  })

  it('exposes script classes with new and instanceof', () => {
    const PointClass = interpreter().run('class P { x; constructor(x) { this.x = x } }\nP') as new (x: number) => { x: number }
    const point = new PointClass(5)

    expect(point.x).toBe(5)
    expect(point instanceof PointClass).toBe(true)
    expect({} instanceof PointClass).toBe(false)
    expect(() => (PointClass as unknown as () => void)()).toThrow("Class constructor P cannot be invoked without 'new'")
  })
})

describe('script objects for the host', () => {
  it('exposes script arrays live', () => {
    const host = interpreter()
    const list = host.run('const list = [1, 2]\nlist') as number[]

    list.push(3)
    expect(Array.isArray(list)).toBe(true)
    expect(host.run('list.length')).toBe(3)
    expect([...list]).toEqual([1, 2, 3])
    expect(JSON.stringify(list)).toBe('[1,2,3]')
  })

  it('exposes script objects with public members only', () => {
    const source = 'class A { private secret = 1\n balance = 2\n get double() { return balance * 2 } }\nnew A()'
    const account = interpreter().run(source) as Record<string, unknown>

    expect(account.balance).toBe(2)
    expect(account.double).toBe(4)
    expect(account.undeclared).toBeUndefined()
    expect(Object.keys(account)).toEqual(['balance'])
    expect(() => account.secret).toThrow("Cannot access private member 'secret'")
    expect(() => { account.nope = 1 }).toThrow(PScriptRuntimeError)
  })
})

describe('script objects changed by the host', () => {
  it('lets the host modify plain script objects', () => {
    const host = interpreter()
    const object = host.run('const o = { a: 1 }\no') as Record<string, unknown>

    object.b = 2
    delete object.a
    expect(host.run('JSON.stringify(o)')).toBe('{"b":2}')
    expect('b' in object).toBe(true)
  })

  it('unwraps round trips', () => {
    expect(interpreter({ identity: (x: unknown) => x }).run('const o = {}\nidentity(o) == o')).toBe(true)
  })
})

describe('host exceptions (§5.8.2)', () => {
  it('turns host errors into catchable script errors with the original as cause', () => {
    const host = interpreter({ failing: () => { throw new RangeError('too big') } })
    const describeError = 'try { failing() } catch (e) { e.name + ": " + e.message + " " + (e instanceof RangeError) }'

    expect(host.run(describeError)).toBe('RangeError: too big true')
    expect(host.run('try { failing() } catch (e) { e.cause.message }')).toBe('too big')
  })

  it('passes non-Error throws as values', () => {
    const thrower = () => {
      // eslint-disable-next-line no-throw-literal -- the host may throw anything
      throw 42
    }

    expect(interpreter({ thrower }).run('try { thrower() } catch (e) { e }')).toBe(42)
  })
})

describe('script exceptions for the host', () => {
  it('reports script exceptions to the host with their value', () => {
    const fail = interpreter().run('() => { throw { code: 7 } }') as () => void

    try {
      fail()
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(PScriptRuntimeError)
      expect(((e as PScriptRuntimeError).value as { code: number }).code).toBe(7)
    }
  })

  it('keeps script exceptions intact through host code', () => {
    const host = interpreter({ callIt: (f: () => unknown) => f() })

    expect(host.run("try { callIt(() => { throw 'inner' }) } catch (e) { e }")).toBe('inner')
  })
})

describe('Interpreter.call', () => {
  it('calls script functions by name or reference', () => {
    const host = interpreter()

    host.run('function add(a, b) { return a + b }')
    expect(host.call('add', 1, 2)).toBe(3)
    expect(host.call(host.get('add') as (...args: unknown[]) => unknown, 3, 4)).toBe(7)
  })

  it('reports unknown names', () => {
    expect(() => interpreter().call('nope')).toThrow('nope is not defined')
  })
})

describe('generators across the boundary (D42)', () => {
  it('gives the host a JS iterator over a script generator', () => {
    const host = interpreter()
    const gen = host.run('function* g(n) { for (let i = 0; i < n; i++) yield i * 10 }\ng(3)') as Iterable<number>

    expect([...gen]).toEqual([0, 10, 20])
    expect(String(gen)).toBe('[object Generator]')
  })

  it('forwards next(value), return() and throw() and converts values', () => {
    const host = interpreter()
    const gen = host.run(`function* g() {
      try {
        const x = yield [1]
        yield x.a
      } finally {
        print('finally')
      }
    }
    g()`) as Generator<unknown, unknown, unknown>

    expect(gen.next().value).toEqual([1])
    expect(gen.next({ a: 'host' })).toEqual({ value: 'host', done: false })
    expect(gen.return(5)).toEqual({ value: 5, done: true })
    expect(gen.next()).toEqual({ value: null, done: true })
  })
})

describe('generators across the boundary (D42), continued', () => {
  it('reports script exceptions from a resumed generator as PScriptRuntimeError', () => {
    const gen = interpreter().run('function* g() { yield 1 }\ng()') as Generator

    gen.next()
    expect(() => gen.throw('boom')).toThrow(PScriptRuntimeError)
  })

  it('lets scripts iterate host generators', () => {
    function* hostGen() {
      yield 'a'
      yield 'b'
    }

    expect(interpreter({ hostGen }).run('const out = []\nfor (const x of hostGen()) out.push(x)\nout.join()')).toBe('a,b')
    expect(interpreter({ hostGen }).run('function* g() { yield* hostGen() }\nArray.from(g()).join()')).toBe('a,b')
  })
})

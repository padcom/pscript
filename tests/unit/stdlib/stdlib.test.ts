import { describe, expect, it } from 'vitest'
import { Interpreter } from '@/index'
import { toStringIn } from '@/runtime/conversions'
import { createRealm } from '@/runtime/realm'
import { Object as ScriptObject, type AccessContext } from '@/runtime/values'
import { stringify } from '@/stdlib/json'

function run(source: string, options = {}): unknown {
  return new Interpreter({ stdout: () => {}, ...options }).run(source)
}

describe('ToString with toString() methods (§4.4.3)', () => {
  const ctx: AccessContext = { realm: createRealm(), homeClass: null, callFunction: () => 'unused' }

  it('rejects objects without a usable toString', () => {
    expect(() => toStringIn(ctx, new ScriptObject(null))).toThrow('Cannot convert object to string')
  })

  it('requires a primitive result', () => {
    expect(() => run("'' + { toString() { return {} } }")).toThrow('toString() returned object, not a primitive')
  })

  it('is used by +, join, String() and sort', () => {
    const source = "const o = { toString() { return 'O' } }\n[o + '', [o].join(), String(o), [o, 'A'].sort().join()].join(' ')"

    expect(run(source)).toBe('O O O A,O')
  })
})

describe('globals', () => {
  it('globalThis reflects host globals added later', () => {
    const interpreter = new Interpreter()

    interpreter.set('late', 42)
    expect(interpreter.run('globalThis.late')).toBe(42)
  })

  it('Math.random is injectable', () => {
    expect(run('Math.random() + Math.random()', { random: () => 0.5 })).toBe(1)
  })

  it('console.error writes to stderr', () => {
    const errors: string[] = []

    run("console.error('bad', 1)", { stderr: (text: string) => errors.push(text) })
    expect(errors).toEqual(['bad 1'])
  })

  it('stdlib namespaces are not classes', () => {
    expect(() => run('new Math()')).toThrow('is not a class')
    expect(() => run('[] instanceof Object')).toThrow("Right-hand side of 'instanceof' is not a class")
  })
})

describe('JSON.stringify', () => {
  it('rejects replacer functions and handles indent strings', () => {
    expect(() => stringify(1, 1, undefined)).toThrow('replacers are not supported')
    expect(stringify(1, null, 'abcdefghijklmnop')).toBe('1')
  })
})

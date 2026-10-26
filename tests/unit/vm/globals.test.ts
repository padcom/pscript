import { describe, expect, it } from 'vitest'
import { Interpreter } from '@/index'

function interpreter() {
  return new Interpreter({ stdout: () => {} })
}

describe('script-level bindings persist across run() (REPL behaviour)', () => {
  it('keeps let and const from earlier runs', () => {
    const repl = interpreter()

    repl.run('let count = 1\nconst name = "x"')
    repl.run('count += 1')
    expect(repl.run('name + count')).toBe('x2')
    expect(repl.get('count')).toBe(2)
  })

  it('reports redeclaration in a later run', () => {
    const repl = interpreter()

    repl.run('let a = 1')
    expect(() => repl.run('let a = 2')).toThrow("SyntaxError: Identifier 'a' has already been declared")
    expect(repl.get('a')).toBe(1)
  })

  it('rejects assignment to a const from an earlier run at runtime', () => {
    const repl = interpreter()

    repl.run('const k = 1')
    expect(() => repl.run('k = 2')).toThrow("TypeError: Assignment to constant variable 'k'")
  })
})

describe('script-level bindings after errors', () => {
  it('leaves a binding in the TDZ when its run failed before initialising it', () => {
    const repl = interpreter()

    expect(() => repl.run('missing\nlet late = 1')).toThrow('missing is not defined')
    expect(repl.get('late')).toBeUndefined()
    expect(() => repl.run('late')).toThrow("Cannot access 'late' before initialization")
  })
})

describe('globals', () => {
  it('lets script bindings shadow globals', () => {
    const repl = new Interpreter({ globals: { x: 1 } })

    expect(repl.run('let x = 2\nx')).toBe(2)
    expect(repl.get('x')).toBe(2)
  })

  it('allows assigning host globals but not stdlib globals', () => {
    const repl = new Interpreter({ globals: { x: 1 } })

    expect(repl.run('x = x + 1')).toBe(2)
    expect(repl.get('x')).toBe(2)
    expect(() => repl.run('print = 1')).toThrow("TypeError: Cannot assign to read-only global 'print'")
  })

  it('reports assignment to undeclared names', () => {
    expect(() => interpreter().run('y = 1')).toThrow('ReferenceError: y is not defined')
  })

  it('evaluates typeof of a TDZ script binding as an error, of an undeclared name as undefined', () => {
    expect(interpreter().run('typeof nope')).toBe('undefined')
    expect(() => interpreter().run('typeof t\nlet t = 1')).toThrow("Cannot access 't' before initialization")
  })
})

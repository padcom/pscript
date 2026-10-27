import { describe, expect, it } from 'vitest'
import { Interpreter, PScriptRuntimeError } from '@/index'

describe('maxSteps (D14)', () => {
  it('stops runaway loops with a RangeError', () => {
    const interpreter = new Interpreter({ maxSteps: 1000 })

    expect(() => interpreter.run('while (true) {}')).toThrow(PScriptRuntimeError)
    expect(() => interpreter.run('while (true) {}')).toThrow('RangeError: Execution step limit exceeded')
  })

  it('counts per run', () => {
    const interpreter = new Interpreter({ maxSteps: 600 })
    const loop = 'let n = 0; for (let i = 0; i < 10; i++) n += i; n'

    expect(interpreter.run(loop)).toBe(45)
    expect(interpreter.run('n')).toBe(45) // the earlier run's steps do not count
  })

  it('is unlimited by default', () => {
    expect(new Interpreter().run('let n = 0; while (n < 100000) n++; n')).toBe(100000)
  })

  it('cannot be caught by the script', () => {
    const interpreter = new Interpreter({ maxSteps: 500 })

    const source = 'while (true) { try { while (true) {} } catch (e) {} }'

    expect(() => interpreter.run(source)).toThrow('Execution step limit exceeded')
  })
})

describe('maxSteps across entries from the host', () => {
  it('gives every host call and module a new budget', () => {
    const modules = { 'loop.pscript': 'let n = 0\nwhile (n < 20) n++\nexport { n }' }
    const interpreter = new Interpreter({ maxSteps: 400, modules })
    const step = interpreter.run('let total = 0\n() => { for (let i = 0; i < 10; i++) total++; return total }') as () => number

    for (let i = 0; i < 20; i++) step()
    expect(step()).toBe(210)
    expect(interpreter.importModule('./loop').n).toBe(20)
    expect(() => interpreter.call(interpreter.run('() => { while (true) {} }') as () => void)).toThrow('step limit')
  })
})

describe('internal errors (§5.6.5)', () => {
  it('reports unexpected host exceptions from the runtime as uncatchable InternalErrors', () => {
    const interpreter = new Interpreter({ stdout: () => { throw new Error('stdout broke') } })

    expect(() => interpreter.run("try { print('x') } catch (e) { 'caught' }")).toThrow('InternalError: stdout broke')
  })
})

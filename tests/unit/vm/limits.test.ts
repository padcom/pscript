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
})

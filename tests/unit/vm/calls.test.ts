import { describe, expect, it } from 'vitest'
import { compile } from '@/compiler/compiler'
import { Interpreter, PScriptRuntimeError } from '@/index'
import { createRealm, defineGlobal } from '@/runtime/realm'
import { NativeFunction, type AccessContext, type Value } from '@/runtime/values'
import { installStdlib } from '@/stdlib'
import { VM } from '@/vm/vm'

function error(source: string, options = {}): PScriptRuntimeError {
  try {
    new Interpreter({ stdout: () => {}, ...options }).run(source, { fileName: 'stack.pscript' })
  } catch (e) {
    return e as PScriptRuntimeError
  }
  throw new Error('expected an error')
}

describe('stack traces', () => {
  it('lists the script frames, innermost first', () => {
    const e = error('function inner(x) {\n  return x * print\n}\nfunction outer() {\n  return inner(2)\n}\nouter()')

    expect(e.scriptStack).toEqual([
      { functionName: 'inner', line: 2, column: 10 },
      { functionName: 'outer', line: 5, column: 10 },
      { functionName: '<script>', line: 7, column: 1 },
    ])
    expect(e.message).toMatch(/^stack\.pscript:2:10 TypeError: Cannot apply '\*' to number and function/)
  })

  it('names anonymous functions', () => {
    expect(error('(function () { null * print })()').scriptStack[0].functionName).toBe('<anonymous>')
  })
})

describe('maxCallDepth (D14)', () => {
  it('limits recursion', () => {
    expect(error('function f(n) { return f(n + 1) }\nf(0)', { maxCallDepth: 50 }).message)
      .toContain('RangeError: Maximum call stack size exceeded')
  })

  it('allows recursion up to the limit', () => {
    const interpreter = new Interpreter({ maxCallDepth: 101 })

    expect(interpreter.run('function f(n) { return n == 0 ? 0 : 1 + f(n - 1) }\nf(100)')).toBe(100)
  })

  it('accepts Infinity', () => {
    const interpreter = new Interpreter({ maxCallDepth: Infinity })

    expect(interpreter.run('function f(n) { return n == 0 ? 0 : 1 + f(n - 1) }\nf(20000)')).toBe(20000)
  })
})

describe('re-entrancy (§5.6.4)', () => {
  it('lets natives call script functions', () => {
    const realm = createRealm()
    const vm = new VM(realm, { maxSteps: Infinity, maxCallDepth: 100 })

    installStdlib(realm, { stdout: () => {} })
    const callWith = (ctx: AccessContext, fn: Value, n: number) => ctx.callFunction(fn, null, [n]) as number

    const sumOfCalls = (ctx: AccessContext, _: Value, [fn]: Value[]) => callWith(ctx, fn, 1) + callWith(ctx, fn, 2)
    const twice = new NativeFunction(realm.FunctionPrototype, 'twice', 1, sumOfCalls)

    defineGlobal(realm, 'twice', twice)
    expect(vm.execute(compile('function f(x) { return x * 10 }\ntwice(f) + 1'))).toBe(31)
    expect(() => vm.execute(compile('twice(function () {})'))).toThrow('anonymous() expects 0 arguments, got 1')
    expect(() => vm.execute(compile('twice(1)'))).toThrow('number is not a function')
  })
})

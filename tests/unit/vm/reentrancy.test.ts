import { describe, expect, it } from 'vitest'
import { compile } from '@/compiler/compiler'
import { Interpreter } from '@/index'
import { createRealm } from '@/runtime/realm'
import { Closure, Environment, NativeFunction, type Value } from '@/runtime/values'
import { callBack, compareResult, requireCallback } from '@/stdlib/callbacks'
import { installStdlib } from '@/stdlib'
import { VM } from '@/vm/vm'

function vm(): VM {
  const realm = createRealm()

  installStdlib(realm, { stdout: () => {} })

  return new VM(realm, { maxSteps: Infinity, maxCallDepth: Infinity })
}

describe('re-entrancy (§5.6.4)', () => {
  it('leaves the VM clean after an exception crosses a native', () => {
    const machine = vm()

    expect(machine.execute(compile("let r = 'none'\ntry { [1, 2].map(x => { throw x }) } catch (e) { r = e }\nr"))).toBe(1)
    expect(machine.frames).toHaveLength(0)
    expect(machine.stack).toHaveLength(0)
  })

  it('catches inside the callback without disturbing the native', () => {
    const source = '[1, 2, 3].map(x => { try { if (x == 2) throw 0 } catch (e) { return -1 } return x }).join()'

    expect(vm().execute(compile(source))).toBe('1,-1,3')
  })

  it('reports host stack exhaustion as a catchable RangeError', () => {
    const source = [
      'function deep(n) { return [n].map(x => deep(x + 1))[0] }',
      'let r',
      'try { deep(0) } catch (e) { r = e.name + ": " + e.message }',
      'r',
    ].join('\n')

    expect(new Interpreter({ maxCallDepth: Infinity }).run(source)).toBe('RangeError: Maximum call stack size exceeded')
  })
})

describe('callback helpers', () => {
  const realm = createRealm()
  const ctx = { realm, homeClass: null, callFunction: (_: Value, __: Value, args: Value[]) => args.length }

  it('pass a closure only the arguments it declares, natives and rest closures all of them', () => {
    const proto = (paramCount: number, hasRest: boolean) => ({ paramCount, hasRest, name: '', length: 0 }) as Closure['fnProto']
    const env = new Environment([], null)
    const closure = (paramCount: number, hasRest = false) => new Closure(null, proto(paramCount, hasRest), env, null)

    expect(callBack(ctx, closure(1), null, [1, 2, 3])).toBe(1)
    expect(callBack(ctx, closure(1, true), null, [1, 2, 3])).toBe(3)
    expect(callBack(ctx, new NativeFunction(null, 'n', 0, () => null), null, [1, 2, 3])).toBe(3)
  })

  it('reject non-functions and treat NaN comparator results as 0', () => {
    expect(() => requireCallback(1, 'Array.prototype.map')).toThrow('Array.prototype.map: number is not a function')
    expect([compareResult(-1), compareResult(0 / 0), compareResult('2')]).toEqual([-1, 0, 2])
  })
})

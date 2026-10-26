import { describe, expect, it } from 'vitest'
import { compile } from '@/compiler/compiler'
import type { FunctionProto } from '@/compiler/function-proto'
import { createRealm, defineGlobal } from '@/runtime/realm'
import { NativeFunction, type Value } from '@/runtime/values'
import { installStdlib } from '@/stdlib'
import { VM } from '@/vm/vm'

// `withThis(fn, value)` calls fn with `this` = value, like a method call (M9 brings real ones).
function vm(): VM {
  const realm = createRealm()
  const machine = new VM(realm, { maxSteps: Infinity, maxCallDepth: 100 })
  const withThis = (_: unknown, __: Value, [fn, value]: Value[]) => machine.callFunction(fn, value, [])

  installStdlib(realm, { stdout: () => {} })
  defineGlobal(realm, 'withThis', new NativeFunction(realm.FunctionPrototype, 'withThis', 2, withThis))

  return machine
}

describe('lexical this (§4.4.5)', () => {
  it('arrows see the this of the enclosing function', () => {
    expect(vm().execute(compile("withThis(function () { return (() => this)() }, 'outer')"))).toBe('outer')
  })

  it('nested arrows capture through each other', () => {
    expect(vm().execute(compile("withThis(function () { return (() => () => this)()() }, 'deep')"))).toBe('deep')
  })

  it('ignores the this an arrow is called with', () => {
    expect(vm().execute(compile("const f = withThis(function () { return () => this }, 'captured')\nwithThis(f, 'ignored')")))
      .toBe('captured')
  })

  it('functions keep a dynamic this', () => {
    expect(vm().execute(compile("withThis(function () { return withThis(function () { return this }, 'inner') }, 'outer')")))
      .toBe('inner')
  })

  it('marks only arrows that read this', () => {
    const protos = (source: string) => compile(source).main.constants.filter(c => typeof c === 'object') as FunctionProto[]

    expect(protos('const a = () => this')[0]).toMatchObject({ kind: 'arrow', usesThis: true })
    expect(protos('const b = () => 1')[0]).toMatchObject({ kind: 'arrow', usesThis: false })
    expect(protos('const c = function () { return this }')[0]).toMatchObject({ kind: 'function', usesThis: false })
  })
})

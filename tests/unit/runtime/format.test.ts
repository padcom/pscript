import { describe, expect, it } from 'vitest'
import type { ClassTemplate, FunctionProto } from '@/compiler/function-proto'
import { formatNested, formatValue } from '@/runtime/format'
import { Array as ScriptArray, Class, Closure, Environment, NativeFunction, Object as ScriptObject } from '@/runtime/values'

const template = { name: 'P' } as ClassTemplate

describe('print formatting (D18)', () => {
  it('prints top-level strings raw and nested strings quoted', () => {
    expect(formatValue('say "hi"')).toBe('say "hi"')
    expect(formatNested('say "hi"')).toBe('"say \\"hi\\""')
  })

  it('prints primitives with String()', () => {
    expect([42, -0, 0.0015, true, null, undefined, NaN].map(value => formatValue(value)))
      .toEqual(['42', '0', '0.0015', 'true', 'null', 'undefined', 'NaN'])
  })

  it('prints functions and classes', () => {
    const base = new Class(null, template, null, new ScriptObject(null))
    const derived = new Class(null, { name: 'Q' } as ClassTemplate, base, new ScriptObject(null))
    const anonymous = new Closure(null, { name: '' } as FunctionProto, new Environment([], null), null)

    expect(formatValue(new NativeFunction(null, 'print', 0, () => null))).toBe('[Function: print]')
    expect(formatValue(anonymous)).toBe('[Function (anonymous)]')
    expect(formatValue(base)).toBe('[class P]')
    expect(formatValue(derived)).toBe('[class Q extends P]')
  })
})

describe('print formatting of objects and arrays (§4.6.2)', () => {
  it('prints objects and arrays', () => {
    const object = new ScriptObject(null)
    const array = new ScriptArray(null, [1, 'a', null])

    object.props.set('a', 1).set('full name', 'Ann').set('list', array)
    expect(formatValue(new ScriptObject(null))).toBe('{}')
    expect(formatValue(new ScriptArray(null, []))).toBe('[]')
    expect(formatValue(object)).toBe('{a: 1, "full name": "Ann", list: [1, "a", null]}')
  })

  it('marks cycles and limits depth', () => {
    const object = new ScriptObject(null)
    const deep = new ScriptArray(null, [new ScriptArray(null, [new ScriptArray(null, [new ScriptArray(null, [1])])])])

    object.props.set('self', object)
    expect(formatValue(object)).toBe('{self: [Circular]}')
    expect(formatValue(deep)).toBe('[[[[Array]]]]')
  })
})

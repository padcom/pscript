import { describe, expect, it } from 'vitest'
import type { ClassTemplate, FunctionProto } from '@/compiler/function-proto'
import { formatNested, formatValue } from '@/runtime/format'
import { Class, Closure, Environment, NativeFunction, Object as ScriptObject } from '@/runtime/values'

const template = { name: 'P' } as ClassTemplate

describe('print formatting (D18)', () => {
  it('prints top-level strings raw and nested strings quoted', () => {
    expect(formatValue('say "hi"')).toBe('say "hi"')
    expect(formatNested('say "hi"')).toBe('"say \\"hi\\""')
  })

  it('prints primitives with String()', () => {
    expect([42, -0, 0.0015, true, null, undefined, NaN].map(formatValue))
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

  it('prints other objects as [Object] until their formats are implemented', () => {
    expect(formatValue(new ScriptObject(null))).toBe('[Object]')
  })
})

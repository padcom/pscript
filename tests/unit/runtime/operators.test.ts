import { describe, expect, it } from 'vitest'
import type { FunctionProto } from '@/compiler/function-proto'
import { add, arithmetic, kindOf, toNumber, toString, truthy, typeOf } from '@/runtime/operators'
import { Array as ScriptArray, Closure, Environment, NativeFunction, Object as ScriptObject } from '@/runtime/values'

const fn = new NativeFunction(null, 'f', 0, () => null)
const object = new ScriptObject(null)
const array = new ScriptArray(null, [])
const anonymous = new Closure(null, { name: '' } as FunctionProto, new Environment([], null), null)

describe('typeOf and kindOf', () => {
  it.each([
    [1, 'number', 'number'],
    ['a', 'string', 'string'],
    [true, 'boolean', 'boolean'],
    [null, 'null', 'null'],
    [undefined, 'undefined', 'undefined'],
    [fn, 'function', 'function'],
    [object, 'object', 'object'],
    [array, 'object', 'array'],
  ])('%s', (value, type, kind) => {
    expect(typeOf(value)).toBe(type)
    expect(kindOf(value)).toBe(kind)
  })
})

describe('conversions', () => {
  it.each([[0, false], [-0, false], [NaN, false], ['', false], [null, false], [undefined, false], ['0', true], [object, true]])(
    'truthy(%s) is %s', (value, expected) => {
      expect(truthy(value)).toBe(expected)
    },
  )

  it('converts primitives to numbers as JS does and rejects objects', () => {
    expect([null, undefined, true, ' 12 ', ''].map(v => toNumber(v, '+'))).toEqual([0, NaN, 1, 12, 0])
    expect(() => toNumber(array, '-')).toThrow("Cannot apply '-' to array")
  })

  it('converts to strings', () => {
    expect([1.5, -0, null, undefined, true].map(toString)).toEqual(['1.5', '0', 'null', 'undefined', 'true'])
    expect(toString(fn)).toBe('[Function: f]')
    expect(toString(object)).toBe('[object Object]')
    expect(toString(new ScriptArray(null, [1, null, 'a', undefined]))).toBe('1,,a,')
    expect(anonymous.name).toBe('')
  })
})

describe('arithmetic (D5)', () => {
  it('adds numbers and concatenates strings', () => {
    expect(add(1, 2)).toBe(3)
    expect(add('a', 1)).toBe('a1')
    expect(add(null, 1)).toBe(1)
    expect(add('f: ', fn)).toBe('f: [Function: f]')
  })

  it('applies - * / % ** to primitives', () => {
    expect(arithmetic('-', '5', 2)).toBe(3)
    expect(arithmetic('*', '3', 2)).toBe(6)
    expect(arithmetic('/', 1, 0)).toBe(Infinity)
    expect(arithmetic('%', 7, 3)).toBe(1)
    expect(arithmetic('**', 2, 10)).toBe(1024)
  })

  it('rejects object operands', () => {
    expect(() => add(array, object)).toThrow("Cannot apply '+' to array and object")
    expect(() => arithmetic('*', 2, fn)).toThrow("Cannot apply '*' to number and function")
  })
})

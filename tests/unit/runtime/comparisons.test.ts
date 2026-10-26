import { describe, expect, it } from 'vitest'
import type { ClassTemplate } from '@/compiler/function-proto'
import { compare, hasProperty, instanceOf, strictEquals } from '@/runtime/operators'
import { Array as ScriptArray, Class, Interface, NativeFunction, Object as ScriptObject } from '@/runtime/values'

function makeClass(name: string, superClass: Class | null = null): Class {
  return new Class(null, { name } as ClassTemplate, superClass, new ScriptObject(null))
}

const Base = makeClass('Base')
const Derived = makeClass('Derived', Base)
const Other = makeClass('Other')
const Shape = new Interface(null, 'Shape', [])
const instance = new ScriptObject(null)

instance.klass = Derived
Derived.interfaces.add(Shape)

describe('strictEquals and compare (D1, D5)', () => {
  it('compares objects by identity', () => {
    const object = new ScriptObject(null)

    expect(strictEquals(object, object)).toBe(true)
    expect(strictEquals(object, new ScriptObject(null))).toBe(false)
  })

  it('rejects objects in relational comparisons', () => {
    expect(() => compare('<', new ScriptArray(null, []), 1)).toThrow("Cannot apply '<' to array and number")
    expect(() => compare('>=', 1, Base)).toThrow("Cannot apply '>=' to number and class")
  })
})

describe('instanceOf (D26, D32)', () => {
  it('matches the class, its superclasses and implemented interfaces', () => {
    expect([Derived, Base, Shape].map(type => instanceOf(instance, type))).toEqual([true, true, true])
    expect(instanceOf(instance, Other)).toBe(false)
  })

  it('is false for primitives and plain objects', () => {
    expect(instanceOf(1, Base)).toBe(false)
    expect(instanceOf(new ScriptObject(null), Base)).toBe(false)
    expect(instanceOf(null, Shape)).toBe(false)
  })

  it('requires a class or interface on the right', () => {
    const fn = new NativeFunction(null, 'f', 0, () => null)

    expect(() => instanceOf(instance, fn)).toThrow("Right-hand side of 'instanceof' is not a class")
    expect(() => instanceOf(instance, 1)).toThrow('is not a class')
  })
})

describe('hasProperty (in)', () => {
  it('looks along the prototype chain', () => {
    const proto = new ScriptObject(null)
    const object = new ScriptObject(proto)

    proto.props.set('inherited', 1)
    object.props.set('own', 2)
    expect(['own', 'inherited', 'missing'].map(key => hasProperty(key, object))).toEqual([true, true, false])
  })

  it('checks array indices and length', () => {
    const array = new ScriptArray(null, [10, 20])

    expect([0, 1, 2, '1', '01', -1, 1.5, 'length'].map(key => hasProperty(key, array)))
      .toEqual([true, true, false, true, false, false, false, true])
  })

  it('rejects primitives on the right', () => {
    expect(() => hasProperty('length', 'abc')).toThrow("Cannot use 'in' operator to search for a key in string")
  })
})

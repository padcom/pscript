import { describe, expect, it } from 'vitest'
import { getProperty, propertyKey, setProperty } from '@/runtime/properties'
import { createRealm } from '@/runtime/realm'
import { Array as ScriptArray, NativeFunction, Object as ScriptObject, type AccessContext } from '@/runtime/values'

const realm = createRealm()
const ctx: AccessContext = { realm, homeClass: null, callFunction: () => null }

describe('getProperty', () => {
  it('reads own and inherited properties; missing ones are undefined (D37)', () => {
    const proto = new ScriptObject(null)
    const object = new ScriptObject(proto)

    proto.props.set('inherited', 1)
    object.props.set('own', 2)
    expect(['own', 'inherited', 'nope'].map(key => getProperty(ctx, object, key))).toEqual([2, 1, undefined])
  })

  it('reads array indices and length; out of range is a RangeError', () => {
    const array = new ScriptArray(realm.ArrayPrototype, ['a', 'b'])

    expect([getProperty(ctx, array, '0'), getProperty(ctx, array, 'length')]).toEqual(['a', 2])
    expect(() => getProperty(ctx, array, '2')).toThrow('Index 2 out of range for length 2')
  })

  it('reads string length and characters', () => {
    expect([getProperty(ctx, 'abc', 'length'), getProperty(ctx, 'abc', '2')]).toEqual([3, 'c'])
    expect(() => getProperty(ctx, 'abc', '3')).toThrow('Index 3 out of range for length 3')
  })
})

describe('getProperty on functions and primitives', () => {
  it('reads function name and length', () => {
    const fn = new NativeFunction(realm.FunctionPrototype, 'f', 2, () => null)

    expect([getProperty(ctx, fn, 'name'), getProperty(ctx, fn, 'length')]).toEqual(['f', 2])
  })

  it('rejects null and undefined receivers', () => {
    expect(() => getProperty(ctx, null, 'x')).toThrow("Cannot read properties of null (reading 'x')")
    expect(() => getProperty(ctx, undefined, 'x')).toThrow("Cannot read properties of undefined (reading 'x')")
  })
})

describe('setProperty', () => {
  it('creates own properties in insertion order', () => {
    const object = new ScriptObject(null)

    setProperty(ctx, object, 'b', 1)
    setProperty(ctx, object, 'a', 2)
    expect([...object.props.keys()]).toEqual(['b', 'a'])
  })

  it('fills array gaps with null (D37) and truncates through length', () => {
    const array = new ScriptArray(null, [1])

    setProperty(ctx, array, '3', 4)
    expect(array.items).toEqual([1, null, null, 4])
    setProperty(ctx, array, 'length', 1)
    expect(array.items).toEqual([1])
  })

  it('rejects primitives, non-extensible objects and function name/length', () => {
    const sealed = new ScriptObject(null)

    sealed.extensible = false
    expect(() => setProperty(ctx, 1, 'x', 1)).toThrow("Cannot create property 'x' on number")
    expect(() => setProperty(ctx, null, 'x', 1)).toThrow("Cannot set properties of null (setting 'x')")
    expect(() => setProperty(ctx, sealed, 'x', 1)).toThrow("Cannot add property 'x', object is not extensible")
    expect(() => setProperty(ctx, new NativeFunction(null, 'f', 0, () => null), 'name', 'g')).toThrow("read only property 'name'")
  })

  it('converts computed keys to strings', () => {
    expect([propertyKey(1), propertyKey(-0), propertyKey(true), propertyKey('k')]).toEqual(['1', '0', 'true', 'k'])
  })
})

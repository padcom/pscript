import { describe, expect, it } from 'vitest'
import type { ClassTemplate, FunctionProto } from '@/compiler/function-proto'
import {
  Accessor,
  Array as ScriptArray,
  Class,
  Closure,
  Environment,
  Function,
  Interface,
  NativeFunction,
  Object,
  PrivateKey,
  UNINITIALIZED,
} from '@/runtime/values'

const proto: FunctionProto = {
  name: 'f',
  kind: 'function',
  paramCount: 2,
  length: 2,
  hasRest: false,
  scopeSize: 2,
  code: [],
  constants: [],
  locations: [],
  usesThis: false,
  classDepth: 0,
}

const template: ClassTemplate = {
  name: 'C',
  hasSuper: false,
  constructor: null,
  instanceFieldInit: null,
  staticInit: null,
  isFinal: false,
  methods: [],
  memberRefs: [],
  fields: [],
  interfaceCount: 0,
  implicitNames: [],
}

describe('values', () => {
  it('shadows the host built-ins without replacing them', () => {
    expect(Object).not.toBe(globalThis.Object)
    expect(ScriptArray).not.toBe(globalThis.Array)
    expect(Function).not.toBe(globalThis.Function)
  })

  it('creates extensible objects with ordered own properties', () => {
    const object = new Object(null)

    object.props.set('b', 1).set('a', 2)
    expect([...object.props.keys()]).toEqual(['b', 'a'])
    expect(object.extensible).toBe(true)
  })

  it('makes every non-primitive an Object', () => {
    const env = new Environment([UNINITIALIZED, null], null)
    const closure = new Closure(null, proto, env, null)

    expect(new ScriptArray(null, [1])).toBeInstanceOf(Object)
    expect(closure).toBeInstanceOf(Function)
    expect(closure).toMatchObject({ name: 'f', length: 2, homeClass: null })
    expect(new NativeFunction(null, 'print', 0, () => null)).toBeInstanceOf(Function)
  })
})

describe('classes', () => {
  it('keys private storage by class and name', () => {
    const cls = new Class(null, template, null, new Object(null))

    expect(cls).toBeInstanceOf(Function)
    expect(cls.name).toBe('C')
    expect(new PrivateKey(cls, 'x')).not.toBe(new PrivateKey(cls, 'x'))
  })
})

describe('interfaces and accessors', () => {
  it('creates frozen interfaces that are their own ancestor', () => {
    const iface = new Interface(null, 'I', [])

    expect(iface.extensible).toBe(false)
    expect(iface.ancestors.has(iface)).toBe(true)
  })

  it('starts accessors empty', () => {
    expect(new Accessor()).toEqual({ get: null, set: null })
  })
})

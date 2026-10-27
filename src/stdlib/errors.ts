// The built-in error classes (§4.6.1, D3): the standard library's only classes (D25).
// Constructed natively; script subclasses (`class E extends Error {}`) arrive with classes (M15).
import type { ClassTemplate } from '@/compiler/function-proto'
import type { ScriptStackFrame } from '@/errors'
import { errorToString, toString } from '@/runtime/operators'
import { defineGlobal } from '@/runtime/realm'
import { Class, Object as ScriptObject, type AccessContext, type Realm, type Value } from '@/runtime/values'
import { defineMethods, method } from './native'

export const ERROR_CLASSES = ['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError'] as const

/**
 * The template of a class implemented natively (built-in errors, host classes).
 *
 * @param name class name
 * @param hasSuper whether it extends another class
 * @returns the template
 */
export function builtinTemplate(name: string, hasSuper: boolean): ClassTemplate {
  return {
    name,
    hasSuper,
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
}

function stackText(error: ScriptObject, frames: ScriptStackFrame[]): string {
  const lines = frames.map(({ functionName, line, column }) => `    at ${functionName} (${line}:${column})`)

  return [errorToString(error), ...lines].join('\n')
}

/**
 * Creates an instance of a built-in error class (or of a class extending one).
 *
 * @param ctx access context (for the stack)
 * @param cls the class being constructed
 * @param message the message argument
 * @returns the error object
 */
export function createError(ctx: AccessContext, cls: Class, message: Value): ScriptObject {
  const error = new ScriptObject(cls.prototype)

  error.klass = cls
  error.props.set('message', message === undefined ? '' : toString(message))
  error.props.set('stack', stackText(error, ctx.captureStack?.() ?? []))

  return error
}

function errorClass(realm: Realm, name: string, superClass: Class | null, prototype: ScriptObject): Class {
  const cls = new Class(realm.FunctionPrototype, builtinTemplate(name, superClass !== null), superClass, prototype)

  cls.length = 1
  cls.native = { construct: (ctx, target, [message]) => createError(ctx, target, message) }
  prototype.props.set('name', name)
  defineGlobal(realm, name, cls, true)

  return cls
}

/**
 * Installs `Error` and its subclasses.
 *
 * @param realm the realm
 */
export function installErrors(realm: Realm) {
  const base = errorClass(realm, 'Error', null, realm.ErrorPrototype)

  // declared members of Error instances (§4.5.9): `message` and `stack` are set by the constructor
  realm.ErrorPrototype.props.set('message', '').set('stack', '').set('cause', null)
  defineMethods(realm, realm.ErrorPrototype, {
    toString: method(0, (_, self) => errorToString(self as ScriptObject)),
  })

  const classes = ERROR_CLASSES.map(name => errorClass(realm, name, base, new ScriptObject(realm.ErrorPrototype)))
  const [typeErrorClass] = classes

  // AccessError is a TypeError (§4.5.2)
  errorClass(realm, 'AccessError', typeErrorClass, new ScriptObject(typeErrorClass.prototype))
}

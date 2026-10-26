// Function.prototype (§4.6.5): toString, bind (SHOULD), call and apply (COULD).
import { typeError } from '@/runtime/script-error'
import {
  Array as ScriptArray,
  Class,
  Function as ScriptFunction,
  NativeFunction,
  type AccessContext,
  type NativeImpl,
  type Realm,
  type Value,
} from '@/runtime/values'
import { callBack } from './callbacks'
import { defineMethods, method } from './native'

function callable(value: Value, name: string): ScriptFunction {
  if (!(value instanceof ScriptFunction) || value instanceof Class) {
    throw typeError(`Function.prototype.${name} called on a non-function`)
  }

  return value
}

function functionToString(self: Value): string {
  return self instanceof Class ? `[class ${self.name}]` : `[Function: ${(self as ScriptFunction).name}]`
}

/**
 * A partial application (`fn.bind(thisArg, ...args)`).
 */
interface Binding {
  /** the bound function */
  target: ScriptFunction
  /** `this` for every call */
  thisArg: Value
  /** leading arguments */
  args: Value[]
}

function bind(realm: Realm, { target, thisArg, args }: Binding): NativeFunction {
  const length = Math.max(0, target.length - args.length)
  // like a native callback (D38): the target receives only the arguments it declares
  const call: NativeImpl = (ctx, __, more) => callBack(ctx, target, thisArg, [...args, ...more])

  return new NativeFunction(realm.FunctionPrototype, `bound ${target.name}`, length, call)
}

function binding(self: Value, name: string, [thisArg, ...args]: Value[]): Binding {
  return { target: callable(self, name), thisArg: thisArg ?? null, args }
}

function invoke(ctx: AccessContext, { target, thisArg, args }: Binding): Value {
  return ctx.callFunction(target, thisArg, args)
}

function argumentList(args: Value): Value[] {
  if (args === undefined || args === null) return []
  if (!(args instanceof ScriptArray)) throw typeError('Function.prototype.apply: arguments must be an array')

  return args.items
}

/**
 * Installs the `Function.prototype` methods.
 *
 * @param realm the realm
 */
export function installFunction(realm: Realm) {
  defineMethods(realm, realm.FunctionPrototype, {
    toString: method(0, (_, self) => functionToString(self)),
    bind: method(1, (_, self, args) => bind(realm, binding(self, 'bind', args))),
    call: method(1, (ctx, self, args) => invoke(ctx, binding(self, 'call', args))),
    apply: method(2, (ctx, self, [thisArg, args]) => invoke(ctx, binding(self, 'apply', [thisArg, ...argumentList(args)]))),
  })
}

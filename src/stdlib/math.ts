// The Math namespace (§4.6.1). `Math.random` is injectable (InterpreterOptions.random) for deterministic tests.
import { toNumber } from '@/runtime/operators'
import { defineProperty } from '@/runtime/properties'
import { defineGlobal } from '@/runtime/realm'
import { Object as ScriptObject, type NativeImpl, type Realm, type Value } from '@/runtime/values'
import { defineMethods, method } from './native'

const UNARY = [
  'abs',
  'floor',
  'ceil',
  'round',
  'trunc',
  'sign',
  'sqrt',
  'cbrt',
  'exp',
  'log',
  'log2',
  'log10',
  'sin',
  'cos',
  'tan',
  'atan',
] as const
const VARIADIC = ['min', 'max', 'hypot'] as const

function numbers(args: Value[], name: string): number[] {
  return args.map(arg => toNumber(arg, `Math.${name}`))
}

/**
 * Installs `Math`.
 *
 * @param realm the realm
 * @param random source of random numbers in [0, 1)
 */
export function installMath(realm: Realm, random: () => number) {
  const math = new ScriptObject(realm.ObjectPrototype)
  const methods: Record<string, [number, NativeImpl]> = {
    pow: method(2, (_, __, args) => {
      const [base, exponent] = numbers(args.slice(0, 2), 'pow')

      return base ** exponent
    }),
    atan2: method(2, (_, __, args) => Math.atan2(...(numbers(args.slice(0, 2), 'atan2') as [number, number]))),
    random: method(0, () => random()),
  }

  for (const name of UNARY) methods[name] = method(1, (_, __, args) => Math[name](numbers(args.slice(0, 1), name)[0]))

  for (const name of VARIADIC) methods[name] = method(2, (_, __, args) => Math[name](...numbers(args, name)))
  defineProperty(math, 'PI', Math.PI)
  defineProperty(math, 'E', Math.E)
  defineMethods(realm, math, methods)
  defineGlobal(realm, 'Math', math, true)
}

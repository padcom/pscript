// Number, Boolean and the global conversion helpers (§4.6.1). Number and Boolean are plain
// conversion functions, not classes; Number also carries the number constants.
import { toStringIn } from '@/runtime/conversions'
import { toNumber, truthy } from '@/runtime/operators'
import { defineProperty } from '@/runtime/properties'
import { defineGlobal } from '@/runtime/realm'
import { rangeError, typeError } from '@/runtime/script-error'
import { NativeFunction, type NativeImpl, type Realm, type Value } from '@/runtime/values'
import { defineMethods, integerArgument, method } from './native'

function number(self: Value, name: string): number {
  if (typeof self !== 'number') throw typeError(`Number.prototype.${name} called on a non-number`)

  return self
}

function toFixed(self: Value, digits: Value): string {
  const count = integerArgument(digits) ?? 0
  if (count < 0 || count > 100) throw rangeError('toFixed() digits argument must be between 0 and 100')

  return number(self, 'toFixed').toFixed(count)
}

function numberToString(self: Value, radix: Value): string {
  const base = integerArgument(radix) ?? 10
  if (base < 2 || base > 36) throw rangeError('toString() radix must be between 2 and 36')

  return number(self, 'toString').toString(base)
}

const parseIntImpl: NativeImpl = (ctx, __, [s, radix]) => parseInt(toStringIn(ctx, s), integerArgument(radix))

function native(realm: Realm, name: string, length: number, impl: NativeImpl): NativeFunction {
  return new NativeFunction(realm.FunctionPrototype, name, length, impl)
}

function installNumberFunction(realm: Realm) {
  const fn = native(realm, 'Number', 1, (_, __, args) => (args.length === 0 ? 0 : toNumber(args[0], 'Number')))
  const constants: Record<string, number> = {
    MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
    MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
    EPSILON: Number.EPSILON,
    MAX_VALUE: Number.MAX_VALUE,
    MIN_VALUE: Number.MIN_VALUE,
  }

  for (const [name, value] of Object.entries(constants)) defineProperty(fn, name, value)
  defineMethods(realm, fn, {
    isInteger: method(1, (_, __, [value]) => Number.isInteger(value)),
  })
  defineGlobal(realm, 'Number', fn, true)
}

/**
 * Installs Number, Boolean, parseInt, parseFloat, isNaN, isFinite, NaN and Infinity.
 *
 * @param realm the realm
 */
export function installNumber(realm: Realm) {
  installNumberFunction(realm)
  defineMethods(realm, realm.NumberPrototype, {
    toFixed: method(1, (_, self, [digits]) => toFixed(self, digits)),
    toString: method(1, (_, self, [radix]) => numberToString(self, radix)),
  })
  defineMethods(realm, realm.BooleanPrototype, {
    toString: method(0, (_, self) => String(self)),
  })
  defineGlobal(realm, 'Boolean', native(realm, 'Boolean', 1, (_, __, [value]) => truthy(value)), true)
  defineGlobal(realm, 'parseInt', native(realm, 'parseInt', 2, parseIntImpl), true)

  const helpers: Record<string, NativeImpl> = {
    parseFloat: (ctx, __, [s]) => parseFloat(toStringIn(ctx, s)),
    isNaN: (_, __, [value]) => Number.isNaN(toNumber(value, 'isNaN')),
    isFinite: (_, __, [value]) => Number.isFinite(toNumber(value, 'isFinite')),
  }

  for (const [name, impl] of Object.entries(helpers)) defineGlobal(realm, name, native(realm, name, 1, impl), true)
  defineGlobal(realm, 'NaN', NaN, true)
  defineGlobal(realm, 'Infinity', Infinity, true)
}

// Array.prototype methods with callbacks (§4.6.4), run through the VM's re-entrant callFunction (§5.6.4).
// They delegate to the JS algorithms on the live `items` array, so mutation during iteration behaves as in JS.
import { toStringIn } from '@/runtime/conversions'
import { truthy } from '@/runtime/operators'
import { typeError } from '@/runtime/script-error'
import {
  Array as ScriptArray,
  type AccessContext,
  type Function as ScriptFunction,
  type NativeImpl,
  type Realm,
  type Value,
} from '@/runtime/values'
import { callBack, compareResult, requireCallback } from './callbacks'
import { orNull } from './native'

/**
 * A bound callback method call: the receiver array and the callback, called as `(element, index, array)`.
 */
interface Iteration {
  /** the receiver */
  array: ScriptArray
  /** calls the callback */
  call: (element: Value, index: number) => Value
  /** calls the callback and takes the result's truthiness */
  test: (element: Value, index: number) => boolean
}

function receiver(self: Value, method: string): ScriptArray {
  if (!(self instanceof ScriptArray)) throw typeError(`Array.prototype.${method} called on a non-array`)

  return self
}

function iteration(ctx: AccessContext, self: Value, [fn, thisArg]: Value[], method: string): Iteration {
  const array = receiver(self, method)
  const callback = requireCallback(fn, `Array.prototype.${method}`)
  const call = (element: Value, index: number) => callBack(ctx, callback, thisArg ?? null, [element, index, array])

  return { array, call, test: (element, index) => truthy(call(element, index)) }
}

type Method = (it: Iteration) => Value

const ITERATION_METHODS: Record<string, Method> = {
  forEach: ({ array, call }) => {
    array.items.forEach(call)

    return null
  },
  some: ({ array, test }) => array.items.some(test),
  every: ({ array, test }) => array.items.every(test),
  find: ({ array, test }) => orNull(array.items.find(test)), // not found → null (D37)
  findLast: ({ array, test }) => orNull(array.items.findLast(test)),
  findIndex: ({ array, test }) => array.items.findIndex(test),
}

function reducer(ctx: AccessContext, callback: ScriptFunction, array: ScriptArray) {
  return (total: Value, element: Value, index: number) => callBack(ctx, callback, null, [total, element, index, array])
}

function reduce(ctx: AccessContext, self: Value, [fn, ...initial]: Value[], method: 'reduce' | 'reduceRight'): Value {
  const array = receiver(self, method)
  const callback = requireCallback(fn, `Array.prototype.${method}`)
  if (array.items.length === 0 && initial.length === 0) throw typeError('Reduce of empty array with no initial value')

  const step = reducer(ctx, callback, array)

  return initial.length > 0 ? array.items[method](step, initial[0]) : array.items[method](step)
}

function compareStrings(x: string, y: string): number {
  if (x === y) return 0

  return x < y ? -1 : 1
}

// Stable (V8's sort is); sorts a copy so that a throwing comparator leaves the array unchanged.
function sort(ctx: AccessContext, self: Value, [fn]: Value[]): Value {
  const array = receiver(self, 'sort')
  const callback = fn === undefined ? null : requireCallback(fn, 'Array.prototype.sort')
  const byString = (a: Value, b: Value) => compareStrings(toStringIn(ctx, a), toStringIn(ctx, b))
  const compare = callback ? (a: Value, b: Value) => compareResult(callBack(ctx, callback, null, [a, b])) : byString

  array.items.splice(0, array.items.length, ...[...array.items].sort(compare))

  return array
}

function flatten(values: Value[]): Value[] {
  return values.flatMap(value => (value instanceof ScriptArray ? value.items : [value]))
}

type ArrayOf = (values: Value[]) => Value

function arrayResult(method: string, transform: (it: Iteration) => Value[], array: ArrayOf): [number, NativeImpl] {
  return [1, (ctx, self, args) => array(transform(iteration(ctx, self, args, method)))]
}

/**
 * The callback methods of `Array.prototype`.
 *
 * @param realm the realm (for result arrays)
 * @returns name → [length, implementation]
 */
export function callbackMethods(realm: Realm): Record<string, [number, NativeImpl]> {
  const array = (values: Value[]) => new ScriptArray(realm.ArrayPrototype, values)
  const mapped = (method: string, transform: (it: Iteration) => Value[]) => arrayResult(method, transform, array)
  const methods: Record<string, [number, NativeImpl]> = {
    map: mapped('map', it => it.array.items.map(it.call)),
    filter: mapped('filter', it => it.array.items.filter(it.test)),
    flatMap: mapped('flatMap', it => flatten(it.array.items.map(it.call))),
    reduce: [1, (ctx, self, args) => reduce(ctx, self, args, 'reduce')],
    reduceRight: [1, (ctx, self, args) => reduce(ctx, self, args, 'reduceRight')],
    sort: [1, sort],
  }

  for (const [name, method] of Object.entries(ITERATION_METHODS)) {
    methods[name] = [1, (ctx, self, args) => method(iteration(ctx, self, args, name))]
  }

  return methods
}

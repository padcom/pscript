// String.prototype methods (§4.6.3) and the String conversion function. Strings are immutable:
// writing an index is a TypeError (property writes on primitives already are).
import { toStringIn } from '@/runtime/conversions'
import { defineGlobal } from '@/runtime/realm'
import { typeError } from '@/runtime/script-error'
import {
  Array as ScriptArray,
  NativeFunction,
  type AccessContext,
  type NativeImpl,
  type Realm,
  type Value,
} from '@/runtime/values'
import { defineMethods, integerArgument, method, orNull } from './native'

type StringMethod = (ctx: AccessContext, text: string, args: Value[]) => Value

function text(self: Value, name: string): string {
  if (typeof self !== 'string') throw typeError(`String.prototype.${name} called on a non-string`)

  return self
}

function str(ctx: AccessContext, value: Value): string {
  return toStringIn(ctx, value)
}

function optionalStr(ctx: AccessContext, value: Value): string | undefined {
  return value === undefined ? undefined : str(ctx, value)
}

// replace / replaceAll with string patterns only: no `$&`-style replacement patterns.
function replaceFirst(source: string, pattern: string, replacement: string): string {
  const at = source.indexOf(pattern)

  return at < 0 ? source : source.slice(0, at) + replacement + source.slice(at + pattern.length)
}

function split(ctx: AccessContext, source: string, [separator, limit]: Value[]): string[] {
  const parts = separator === undefined ? [source] : source.split(str(ctx, separator))

  return limit === undefined ? parts : parts.slice(0, Math.max(0, integerArgument(limit) ?? 0))
}

function stringMethod(length: number, impl: StringMethod): [number, StringMethod] {
  return [length, impl]
}

const STRING_METHODS: Record<string, [number, StringMethod]> = {
  charAt: [1, (_, s, [i]) => s.charAt(integerArgument(i) ?? 0)],
  charCodeAt: [1, (_, s, [i]) => s.charCodeAt(integerArgument(i) ?? 0)],
  at: [1, (_, s, [i]) => orNull(s.at(integerArgument(i) ?? 0))],
  indexOf: [1, (ctx, s, [search, from]) => s.indexOf(str(ctx, search), integerArgument(from))],
  lastIndexOf: [1, (ctx, s, [search, from]) => s.lastIndexOf(str(ctx, search), integerArgument(from))],
  includes: [1, (ctx, s, [search, from]) => s.includes(str(ctx, search), integerArgument(from))],
  startsWith: [1, (ctx, s, [search, from]) => s.startsWith(str(ctx, search), integerArgument(from))],
  endsWith: [1, (ctx, s, [search, end]) => s.endsWith(str(ctx, search), integerArgument(end))],
  slice: [2, (_, s, [start, end]) => s.slice(integerArgument(start), integerArgument(end))],
  substring: [2, (_, s, [start, end]) => s.substring(integerArgument(start) ?? 0, integerArgument(end))],
  toUpperCase: [0, (_, s) => s.toUpperCase()],
  toLowerCase: [0, (_, s) => s.toLowerCase()],
  trim: [0, (_, s) => s.trim()],
  trimStart: [0, (_, s) => s.trimStart()],
  trimEnd: [0, (_, s) => s.trimEnd()],
  padStart: [2, (ctx, s, [length, fill]) => s.padStart(integerArgument(length) ?? 0, optionalStr(ctx, fill))],
  padEnd: [2, (ctx, s, [length, fill]) => s.padEnd(integerArgument(length) ?? 0, optionalStr(ctx, fill))],
  repeat: [1, (_, s, [count]) => s.repeat(integerArgument(count) ?? 0)],
  replace: [2, (ctx, s, [pattern, replacement]) => replaceFirst(s, str(ctx, pattern), str(ctx, replacement))],
  replaceAll: [2, (ctx, s, [pattern, replacement]) => s.split(str(ctx, pattern)).join(str(ctx, replacement))],
  concat: [1, (ctx, s, args) => s + args.map(arg => str(ctx, arg)).join('')],
  toString: stringMethod(0, (_, s) => s),
}

/**
 * Installs `String.prototype` methods and the `String` conversion function.
 *
 * @param realm the realm
 */
export function installString(realm: Realm) {
  const methods: Record<string, [number, NativeImpl]> = {}

  for (const [name, [length, impl]] of Object.entries(STRING_METHODS)) {
    methods[name] = method(length, (ctx, self, args) => impl(ctx, text(self, name), args))
  }
  methods.split = method(2, (ctx, self, args) => new ScriptArray(realm.ArrayPrototype, split(ctx, text(self, 'split'), args)))
  defineMethods(realm, realm.StringPrototype, methods)

  const convert: NativeImpl = (ctx, __, args) => (args.length === 0 ? '' : str(ctx, args[0]))

  defineGlobal(realm, 'String', new NativeFunction(realm.FunctionPrototype, 'String', 1, convert), true)
}

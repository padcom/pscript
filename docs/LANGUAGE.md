# The PScript language

PScript is a strict subset-and-variant of JavaScript. Programs look like JavaScript, many simple JavaScript programs
run unchanged, and everything that differs is either removed or made an error instead of a silent surprise. This
document describes the language as implemented; the design rationale is in `docs/PLAN.md` (decisions D1–D60).

- [Lexical structure](#lexical-structure)
- [Values and types](#values-and-types)
- [Variables and scope](#variables-and-scope)
- [Operators](#operators)
- [Statements](#statements)
- [Functions](#functions)
- [Objects and arrays](#objects-and-arrays)
- [Destructuring](#destructuring)
- [Generators](#generators)
- [Async functions and promises](#async-functions-and-promises)
- [Classes](#classes)
- [Interfaces](#interfaces)
- [Exceptions](#exceptions)
- [Modules](#modules)
- [Standard library](#standard-library)
- [Host interop](#host-interop)
- [Differences from JavaScript](#differences-from-javascript)

## Lexical structure

- Source is Unicode text; identifiers are ASCII letters, digits, `_` and `$` (not starting with a digit).
- Comments: `// line` and `/* block */`.
- Numbers: decimal (`1`, `1.5`, `.5`, `1e3`), `0x`, `0o` and `0b`. Legacy octal (`010`) and numeric separators
  (`1_000`) are syntax errors.
- Strings: `'…'` and `"…"` with the JavaScript escapes (`\n`, `\t`, `\xHH`, `\uHHHH`, `\u{…}`). Octal escapes are
  errors.
- Template literals: `` `a ${b} c` ``. Tagged templates (`` tag`x` ``) are not supported.
- **Semicolons are optional.** Automatic semicolon insertion is simpler and safer than in JavaScript: a line break
  ends a statement when the line could end there and the next line cannot continue it. A line starting with `(` or
  `[` starts a new statement (no accidental calls or indexing of the previous line); a line starting with `.`, an
  operator, `,`, `?`, `:` or `=>` continues the previous one.
- Reserved for the future (always errors as names): `var`, `enum`, `package`.
- `get`, `set`, `as`, `from`, `final`, `override` and `abstract` are keywords only where they have a meaning; elsewhere they are
  ordinary names. Keywords may be used as property names (`o.class`, `{ if: 1 }`).

## Values and types

| Type | Values | `typeof` |
|---|---|---|
| undefined | `undefined` | `'undefined'` |
| null | `null` | `'null'` |
| boolean | `true`, `false` | `'boolean'` |
| number | IEEE-754 doubles, `NaN`, `Infinity` | `'number'` |
| string | UTF-16 strings | `'string'` |
| object | objects, arrays, class instances, interfaces, module namespaces | `'object'` |
| function | functions, arrow functions, methods, classes | `'function'` |

- Truthiness is as in JavaScript: `false`, `0`, `NaN`, `''`, `null` and `undefined` are falsy, every object is truthy.
- `null` is the "no value" of PScript: functions without `return` return `null`, fields without initialiser start as
  `null`, host functions returning `undefined` give `null`. `undefined` remains for missing properties of plain
  objects.

## Variables and scope

```js
let count = 0
const LIMIT = 10
count += 1
```

- `let` and `const` are block-scoped with a temporal dead zone (using a binding before its declaration is a
  `ReferenceError`). There is no `var`.
- Function declarations are hoisted within their block and are **constant** (`f = 1` is an error).
- Top-level declarations of a script persist across `Interpreter.run()` calls; redeclaring one is an error.
- Globals (the standard library and host globals) are read-only from scripts; `globalThis` exposes every global
  by name (`globalThis.print(…)`).

## Operators

Precedence and associativity follow JavaScript, with these rules:

- `==` and `!=` are **strict** (like `===` / `!==`); `===` and `!==` do not exist.
- Arithmetic and comparison operators never convert objects: `[] + 1`, `{} < 1` and `[1] * 2` are `TypeError`s.
  Primitives convert as in JavaScript (`'3' * 2` is `6`, `'a' + 1` is `'a1'`).
- `-x ** 2` means `-(x ** 2)`.
- `typeof`, `instanceof`, `in`, `!`, `?:`, `&&`, `||`, `??`, `++`, `--`, `void` and compound assignments (`+=`, `&&=`,
  `??=` …) work as in JavaScript.
- `delete o.x` / `delete o[k]` removes an own property of a **plain object** (or a host object) and gives `true`.
  Class instances, arrays, functions, classes, frozen objects and primitives keep their shape: deleting from them is
  a `TypeError` (use `splice` for arrays). `delete x` and `delete 1` are syntax errors.
- Spread `...x` works as in JavaScript in calls (`f(...xs)`, `new C(...xs)`, `super(...xs)`), array literals
  (`[0, ...xs]`) and object literals (`{ ...defaults, verbose: true }`). Arguments and array elements take anything
  iterable; object spread copies own enumerable public properties. Strict arity still applies, checked at runtime
  for calls with a spread argument.
- Optional chaining `a?.b`, `a?.[k]`, `f?.(x)` works as in JavaScript: when the value before `?.` is `null` or
  `undefined`, the rest of the chain is skipped and the result is `undefined`. In a class body, call an implicit
  member optionally as `this.m?.()`.
- Bitwise operators `& | ^ ~ << >> >>>` and their compound assignments work as in JavaScript (32-bit integers,
  JavaScript precedence: `a & b == c` is `a & (b == c)`); like arithmetic, they reject objects.
- The comma operator works as in JavaScript: `for (let i = 0, j = n; i < j; i++, j--)`, `(a(), b())`.

## Statements

- `if`/`else`, `while`, `do … while`, `for (init; test; update)` (with a fresh `let` binding per iteration),
  `for (const x of iterable)`, `switch`, `break`, `continue`, `return`, `throw`, `try`/`catch`/`finally`, blocks
  and expression statements.
- `switch` compares with `==` (which is strict), falls through until `break`, and may have its `default` anywhere.
  Its clauses share one block scope; `continue` inside it continues the enclosing loop.
- `for…of` iterates arrays (live: elements pushed during the loop are visited), strings (by UTF-16 code unit),
  generators and host iterables. The loop variable may be a pattern (see [Destructuring](#destructuring)).
- `for (const key in object)` visits the own keys of an object (array and string indices, class-instance fields) in
  insertion order. As in JavaScript, an `in` operator inside a `for` initialiser needs parentheses.
- No labels or `with`.
- A script's value is the value of the last expression statement executed (as with `eval`).

## Functions

```js
function greet(name, greeting = 'Hello') { return greeting + ', ' + name }
const twice = x => 2 * x
const sum = (...xs) => xs.reduce((a, b) => a + b, 0)
```

- **Strict arity:** every parameter without a default must be passed, and extra arguments are an error unless the
  function has a rest parameter. Defaults apply only to omitted arguments; required parameters come before optional
  ones. Calls with a known callee are checked at compile time.
- Parameters can be object and array patterns; object patterns are strict named parameters (see
  [Destructuring](#destructuring)).
- Arrow functions capture `this` lexically. A plain function called without a receiver gets `this === null`.
- Functions are values: they have `name`, `length`, `call`, `apply` and `bind`.
- The call depth is limited (`maxCallDepth`, default 10 000); exceeding it is a `RangeError`.

## Objects and arrays

```js
const point = { x: 1, y: 2, move(dx) { this.x += dx; return this }, get norm() { return this.x + this.y } }
const list = [1, 2, 3]
```

- Object literals: properties, shorthand properties, methods, getters and setters, spread (`...o`) and computed keys
  (`[k]: v`, `[k]() {}`, `get [k]() {}`). Class members and destructuring patterns have no computed keys.
- Reading a missing property of a plain object gives `undefined`; writing creates it.
- Arrays have integer indices only. Reading an index outside `0 … length-1` (including negative) is a `RangeError`;
  writing past the end fills the gap with `null`. Assigning `length` truncates or extends.
- Keys are listed in insertion order (integer-like keys are not moved first).

## Destructuring

```js
function testme({ x = 1, y = 2 } = {}) { return x + y }   // named parameters
testme()                    // 3
testme({ y: 5 })            // 6
// testme({ z: 1 })         // SyntaxError: Unknown named parameter 'z' of testme({x?, y?}?)

const { name, address: { city = '?' }, ...others } = person
let [first, second = 0, ...tail] = list
for (const [key, value] of Object.entries(map)) print(key, value)
;[a, b] = [b, a]
;({ x, y } = point)
```

- Object and array patterns work as in JavaScript wherever a name is bound or assigned: parameters, `let`/`const`,
  `for … of`, `catch`, and the left side of `=`. Patterns nest, take defaults and a final `...rest`. Keys are
  names, strings or numbers (no computed keys); array patterns have no holes.
- A default applies when the value is `undefined`: a missing property or a missing array element. Destructuring
  `null` or `undefined` is a `TypeError`; an array pattern needs an iterable (array, string, host iterable).
- A pattern reads properties like `o.x`, so an undeclared member of a class instance is an error.
- **Named parameters are strict.** An object pattern in a parameter (also nested) accepts only the keys it names,
  unless it has `...rest`: passing a plain object with other keys is an error, at compile time for an object
  literal passed to a known function, otherwise at runtime. Patterns in declarations, loops and assignments pick
  the properties they name and ignore the rest, as in JavaScript.
- A pattern parameter without a default is a required parameter; `= {}` makes it optional (strict arity applies).

## Generators

```js
function* naturals() {
  let n = 0
  while (true) yield n++
}

function* take(iterable, count) {
  for (const item of iterable) {
    if (count-- <= 0) return
    yield item
  }
}

print(Array.from(take(naturals(), 3)))     // [0, 1, 2]

class Tree {
  *walk() {
    yield this.value
    for (const child of this.children) yield* child.walk()
  }
}
```

- `function*` declarations and expressions, and `*method()` in classes and object literals (also `static`), work as
  in JavaScript: calling one binds the arguments and returns a generator object; `next(v)`, `return(v)` and
  `throw(e)` resume it. `yield* iterable` delegates to another generator, an array, a string or a host iterable.
- Generators are iterable (`for … of`, array patterns, `Array.from`, `yield*`). Leaving a `for … of` early (`break`,
  `return`, an exception) closes the generator, so its `finally` blocks run.
- `yield` is only allowed directly in a generator body (not in nested functions or arrows).
- Where JavaScript has `undefined`, generators have `null`: a bare `yield` yields `null`, `next()` without an
  argument makes `yield` give `null`, and a finished generator answers `{ value: null, done: true }`.
- A class field followed by a `*method()` on the next line needs a `;` (as in JavaScript).
- User-defined iterables work as in JavaScript: give an object or a class a `[Symbol.iterator]()` method (often
  `*[Symbol.iterator]() { … }`), or `[Symbol.asyncIterator]()` for `for await`. These two are the only symbols, and
  the only bracketed member names classes accept.
- Async generators (`async function*`, `async *method()`) work as in JavaScript: `next()` / `return()` / `throw()`
  return promises of `{ value, done }`, `yield` and `return` await their value, and `for await (const x of …)`
  iterates them (as well as host async iterables, and any iterable with each value awaited). `yield*` delegates with
  everything forwarded, and leaving a `for await` early awaits the iterator's `return()`, as in JavaScript.

## Async functions and promises

```js
async function loadAll(ids) {
  const users = await Promise.all(ids.map(id => fetchUser(id)))
  return users.filter(user => user.active)
}

const later = value => new Promise(resolve => resolve(value))

loadAll([1, 2])
  .then(users => print(users.length))
  .catch(e => print('failed:', e.message))
```

- `async function`, `async` arrows and `async` methods (also `static`) return promises; `await` pauses until a
  promise settles, giving its value or throwing its reason (so `try`/`catch`/`finally` work). `await` is only allowed
  inside async functions and at the top level of scripts and modules (see [Modules](#modules)); so is
  `for await`. Async generators: see [Generators](#generators).
- `Promise` works as in JavaScript: `new Promise((resolve, reject) => …)`, `then`, `catch`, `finally`,
  `Promise.resolve`, `reject`, `all`, `allSettled`, `race`, `any` (with `AggregateError`) and `withResolvers`.
  Callbacks run in the same order as in JavaScript.
- Callbacks run when no other script code runs. `run()` runs them before it returns, so async code that only waits
  for other script code is finished when `run()` returns; code waiting for the host continues when the host's promise
  settles.
- A rejected promise that nobody handles is an error: `run()` throws it like an uncaught exception (later ones go to
  `stderr`).
- `setTimeout(callback, delay?, ...args)` and `clearTimeout(id)` work as in JavaScript: the callback runs on the host's
  event loop after `run()` has returned (the callback receives the extra arguments it declares), and the promise
  callbacks it queues run right after it. Ids are numbers. An exception in a timer callback goes to `stderr`. Code
  strings are not supported.
- `setInterval(callback, delay?, ...args)` and `clearInterval(id)` repeat the callback every `delay` milliseconds until
  it is cleared (the callback may clear its own interval; an exception does not stop it). Timer ids are shared, so
  `clearTimeout` and `clearInterval` are interchangeable, as in JavaScript.
- `queueMicrotask(callback)` queues the callback as a job, in order with promise callbacks. An exception in it is
  reported like an unhandled rejection: `run()` throws it after the other jobs have run (later ones go to `stderr`).
- `fetch(resource, options?)` calls the host's `fetch` (or the one given in the interpreter's `fetch` option) and
  returns a promise of its `Response`, which scripts use like any host object (`await response.json()`).

```js
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function poll(url) {
  while (true) {
    const response = await fetch(url)
    if (response.ok) return await response.json()
    await sleep(1000)
  }
}
```
- Differences: only real promises are adopted — an object with a `then` method is just a value; `Promise` cannot be
  extended; missing values are `null` (`resolve()`, an async function without `return`); `print(p)` shows
  `Promise(<pending>)`, `Promise(value)` or `Promise(<rejected> reason)`.

## Classes

```js
class Animal {
  protected name
  constructor(name) { this.name = name }
  speak() { return name + ' makes a sound' }
}

final class Dog extends Animal {
  override speak() { return name + ' barks' }
}
```

- Fields (`x`, `x = expr`, `static x`), methods, accessors (`get x()`, `set x(v)`), `static` members and one
  `constructor`. A derived constructor must call `super(…)` before using `this`. Without a constructor, a derived
  class takes exactly the arguments of its superclass constructor.
- **Closed instances:** an instance has exactly the members its class chain declares. Reading or writing anything
  else is an error, reported at compile time when the class chain is visible (`this.z` in a class without `z`),
  otherwise when the class is defined or at runtime.
- **Sealed classes:** classes have no `prototype` property, cannot get new static members, and methods cannot be
  reassigned (on the class or on instances). Fields stay writable.
- **Access modifiers:** `public` (default), `protected` (usable on the same inheritance line) and `private`
  (usable only by code of the declaring class and of classes nested in it; per class, not per instance). Violations
  throw `AccessError` (a `TypeError`). A subclass member may reuse a superclass's private name without clashing.
  Reflection (`Object.keys`, `JSON.stringify`, `print`) shows public members only; `k in o` only accessible ones.
- **Overriding:** redefining an inherited public or protected member requires `override`; `override` on something
  that is not inherited is an error. Overrides must keep the kind (method / accessor / field), the access and the
  signature. `final` members cannot be redefined; `final class` cannot be extended. Accessor halves are inherited
  separately (overriding only the getter keeps the inherited setter). Members of `Object.prototype` count as
  inherited (`override toString()`).
- **Implicit member access:** inside a class body, members can be used without `this.` (`count++`, `recalc()`).
  Local variables and parameters shadow members. A bare name that is both a member and an outer definition (a
  variable, function, import or global) is rejected — write `this.x` for the member, or rename the outer binding
  (for globals, use `globalThis.x`). Nested functions inside methods use the method's `this` for implicit accesses.
- `instanceof` checks the class chain (and interfaces). `print(instance)` shows `ClassName(field = value, …)` unless
  the class defines `toString()`.
- Built-in error classes can be extended: `class HttpError extends Error { override name = 'HttpError' }`.
- **Constructor access:** `private constructor()` (or `protected`) allows `new` only inside the class (static factory
  methods, singletons); a class with a private constructor can only be extended by classes nested in it.
- **Abstract classes:** `abstract class Shape { abstract area(); abstract get sides(); … }` cannot be instantiated;
  abstract members have no body (end them with `;`) and every concrete subclass must implement them (no `override`
  needed), keeping their signatures.

## Interfaces

```js
interface Shape extends Named {
  area()
  color                 // readable and writable: a public field, or a get+set pair
  get label()           // readable
}
class Circle implements Shape { … }
```

- Members are method signatures `m(a, b)` / `m(...rest)`, `get x()`, `set x(v)` and properties `x`. All are public;
  modifiers, bodies, initialisers and defaults are errors.
- A class that `implements` an interface must provide every member through public members (own or inherited), with
  exactly the declared parameters. Missing members are listed in one `TypeError` when the class is defined.
- Implementing is not overriding (no `override` needed). Subclasses inherit their superclass's interfaces.
- `x instanceof Shape` checks the class's interfaces. Interfaces print as `[interface Shape]` and cannot be called
  or constructed.
- `x implements Shape` checks structurally: it is `true` for any object (also an object literal or a host object)
  that has every member the interface requires, with the right number of parameters, whatever its class declares.

## Exceptions

- `throw` any value; `try`/`catch (e)`/`finally` as in JavaScript (the catch parameter may be omitted:
  `catch { … }`).
- Built-in errors: `Error`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `AccessError` (all with
  `name`, `message`, `stack` and `cause`).
- An exception that leaves the script reaches the host as `PScriptRuntimeError` with the script stack, the location
  and an excerpt of the source.

## Modules

```js
// math.pscript
export const PI = 3.14159
export function area(r) { return PI * r * r }
export { area as circleArea }
export { round } from './util'

// main.pscript
import { PI, area } from './math'
import * as math from './math'
import './setup'
```

- Named imports and exports only (`import { a, b as c }`, `import * as ns`, `import 'm'`, `export` declarations,
  `export { a as b }`, `export { a } from 'm'`). Default exports, `export *` and `import.meta` are errors.
- `import(specifier)` returns a promise of the module's namespace, as in JavaScript (in scripts too; relative
  specifiers resolve against the calling module). The module is loaded and evaluated once; failures reject.
- Imports are live, read-only views of the exporter's bindings. Each module is evaluated once per interpreter;
  dependencies run first (depth-first, in import order). Cycles work as in JavaScript (hoisted functions are
  available early; reading an uninitialised binding is a `ReferenceError`).
- Module code has its own top-level scope and `this === null`; globals stay visible.
- Specifiers are resolved by the host's loader. The built-in loader resolves `./` and `../` against the importing
  module and tries the exact id, then `.pscript`, then `.psc`.
- Namespace objects (`import * as ns`) list the exports in sorted order, are frozen and print as `[Module] {…}`.
- **Top-level `await`** works in modules (and in scripts): `export const config = await loadConfig()`. As in
  JavaScript, dependencies start in import order and a module runs once its dependencies have finished.
  `runModule()` / `importModule()` work when the awaits only wait for script code; when they wait for the host
  (timers, `fetch`), use `runModuleAsync()` / `importModuleAsync()` (and `runAsync()` for scripts), which return
  promises. Module loaders may be asynchronous too (asynchronous API only). The CLI waits for top-level `await`.
- Host modules (`interpreter.defineModule('host:fs', { … })`) export the properties of a host object, read live.

## Standard library

- Globals: `print`, `console.log`/`console.error`, `globalThis`, `String`, `Number`, `Boolean`, `parseInt`,
  `parseFloat`, `isNaN`, `isFinite`, `NaN`, `Infinity`, `Math`, `JSON`, `Object`, `Array`, `Promise`, `Map`, `Set`,
  `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `queueMicrotask`, `fetch` and the error classes (including `AggregateError`).
- `Object.keys`, `values`, `entries`, `assign`, `freeze`; `obj.hasOwnProperty(k)`, `toString()`.
- Arrays: `push`, `pop`, `shift`, `unshift`, `slice`, `splice`, `concat`, `join`, `reverse`, `at`, `indexOf`,
  `lastIndexOf`, `includes`, `flat`, `fill`, `sort`, `map`, `filter`, `reduce`, `reduceRight`, `forEach`, `find`,
  `findIndex`, `findLast`, `some`, `every`, `flatMap`; `Array.isArray`, `Array.of`, `Array.from`.
  Callbacks receive only the arguments they declare.
- Strings: `charAt`, `charCodeAt`, `at`, `indexOf`, `lastIndexOf`, `includes`, `startsWith`, `endsWith`, `slice`,
  `substring`, `split`, `trim`, `trimStart`, `trimEnd`, `padStart`, `padEnd`, `repeat`, `replace` and `replaceAll`
  (string patterns), `toUpperCase`, `toLowerCase`, `concat`.
- `Map` and `Set` work as in JavaScript (insertion order, `NaN`-safe keys, live iteration), except that
  `map.get(missing)` is `null`, and both classes are final. They print as `Map(1) {"a" => 1}` / `Set(2) {1, 2}`.
- `Math` (functions and constants), `Number` helpers (`isInteger`, `isFinite`, `isNaN`, `parseFloat`, `EPSILON`,
  `toFixed`, `toString(radix)`), `JSON.parse`/`stringify`.
- `print` formats values readably: strings inside containers are quoted, nested containers are abbreviated after two
  levels, cycles print as `[Circular]`, functions as `[Function: name]`, classes as `[class Name]`.

## Host interop

Values cross the boundary by reference and identity is kept in both directions.

- Host functions are callable (`this` and arguments converted); host classes (declared with `class`, or marked with
  `markAsClass(fn)`) can be constructed and extended; other host functions cannot be used with `new`.
- Host objects and arrays are live: reads, writes, `in`, `Object.keys`, `for…of` and host methods all act on the
  real object. Host exceptions become script errors (`cause` holds the original).
- Script functions, classes, arrays and objects given to the host are live proxies. The host has no home class, so
  private and protected members stay inaccessible; undeclared members of class instances read as `undefined`.
- Promises cross as promises: a script promise is a JS `Promise` for the host (rejections arrive as
  `PScriptRuntimeError`), and host promises can be awaited by scripts. Script generators are JS iterators for the host.
- The keys `constructor`, `prototype`, `__proto__` and the legacy accessor helpers are blocked on host objects.
  **Interop is not a security sandbox**: a script can do anything the host values it receives allow.

## Differences from JavaScript

| JavaScript | PScript |
|---|---|
| `==` converts types; `===` is strict | `==` is strict; `===` does not exist |
| `typeof null === 'object'` | `typeof null == 'null'` |
| `[] + {}`, `{} < 1`, `[1] * 2` convert objects | `TypeError` (primitives still convert) |
| Missing arguments are `undefined`, extra ones ignored | Strict arity: both are errors |
| Destructured parameters ignore extra keys | Object patterns in parameters reject unknown keys (named parameters) |
| Functions return `undefined` by default | Functions return `null` |
| `arr[10]`, `arr[-1]` give `undefined` | `RangeError`; writing past the end fills with `null` |
| Objects are open bags, also class instances | Class instances and classes are closed and sealed |
| `#private`, no `protected` | `private` / `protected` / `public` keywords, `AccessError` |
| Overriding is implicit | `override` required; `final` members and classes |
| No abstract classes | `abstract class` with `abstract` members (as in TypeScript) |
| No interfaces | `interface`, `implements`, `instanceof Interface` |
| `this.` required for members | Members usable without `this.` inside class bodies |
| ASI quirks (`(`/`[` continue the previous line) | A line starting with `(` or `[` starts a new statement |
| `delete` leaves holes in arrays, ignores frozen objects | `delete` works on plain objects only; elsewhere `TypeError` |
| `var`, labels, `with` | Not available |
| Computed keys in classes and destructuring patterns | Not available (object literals only) |
| Tagged templates | Not available |
| Generators give `undefined` for missing values | Generators give `null` (`yield`, `next()`, finished steps) |
| Any object with a `then` method is a thenable | Only promises are adopted; `Promise` is final |
| Top-level `await` only in modules | In modules and scripts |
| Symbols | Only `Symbol.iterator` and `Symbol.asyncIterator` |
| BigInt, getters on the global object | Not available |
| Default exports, `export *` | Named exports only |
| Integer-like keys are listed first | Insertion order for all keys |
| `map.get(missing)` is `undefined`; `Map`/`Set` can be extended | `null`; `Map` and `Set` are final |
| `-2 ** 2` is a syntax error | `-2 ** 2` is `-(2 ** 2)` |
| Module top-level `this` is `undefined` | `this` is `null` |

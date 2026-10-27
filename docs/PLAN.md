# PScript — Requirements & Implementation Plan

> Status: **Decisions confirmed (2026-10-26)**, see §2. Nothing is implemented yet.
> Audience: (1) the project owner; (2) a later Claude Code session (coordinator plus parallel agents) that implements it.
>
> This document is the spec. Where it and JavaScript disagree, §2 lists every intentional deviation.

---

## Table of contents

0. Commit strategy
1. Goals, scope, priorities
2. Decisions (confirmed)
3. Tooling & project setup
4. Language specification
   - 4.1 Lexical grammar
   - 4.2 Optional semicolons (ASI) and the token filter
   - 4.3 Syntactic grammar
   - 4.4 Semantics
   - 4.5 Classes, access control and interfaces
   - 4.6 Standard library
   - 4.7 Modules (`import` / `export`)
5. Architecture
   - 5.1 Pipeline
   - 5.2 Source layout
   - 5.3 AST contract
   - 5.4 Bytecode contract (instruction set)
   - 5.5 Compiler design
   - 5.6 VM design
   - 5.7 Runtime value model
   - 5.8 Public API
   - 5.9 Errors
6. Testing strategy
7. Multi-agent work breakdown (and the sequential milestone path, §7.12)
8. Risks & mitigations
9. Reference program
10. Feature examples
11. `psc`: the PScript-to-JavaScript transpiler

---

## 0. Commit strategy

Whenever the code compiles and passes the tests please commit automatically.

## 1. Goals, scope, priorities

### 1.1 Goal

PScript is a JavaScript-inspired scripting language, shipped as a TypeScript library (`@padcom/pscript`). It runs in browsers and Node. It:

- parses source with a **Jison**-generated LALR(1) parser into an ESTree-like AST,
- compiles the AST to **bytecode**,
- executes that bytecode on a **stack-based virtual machine**.

It is built with **Vite** using `@padcom/vite-config-lib` and linted with `@padcom/eslint-config-typescript`.

### 1.2 Priority levels

Each feature in this document has one of these tags:

- **MUST**: explicitly requested. v1 is incomplete without it.
- **SHOULD**: not requested, but needed for a usable language (`if`/`else`, `let`/`const`, operators, `this`, `new`, `extends`/`super`, comments, …). Planned for v1.
- **COULD**: nice to have. Planned for Phase 3 or later. The design must not prevent it.
- **WON'T (v1)**: explicitly out of scope.

### 1.3 Requested features (MUST)

| # | Feature | Spec section |
|---|---------|--------------|
| R1 | Strings | 4.1.5 |
| R2 | Numbers: integer, floating point, e-notation | 4.1.4 |
| R3 | Booleans | 4.1.3 |
| R4 | Object literals including method shorthand `{ m() { … } }` | 4.3, 4.4.6 |
| R5 | Lambdas (arrow functions) | 4.3, 4.4.5 |
| R6 | Optional semicolons | 4.2 |
| R7 | Function definitions with argument lists and `return` | 4.3, 4.4.5 |
| R8 | Arrays | 4.4.7 |
| R9 | `for (init; test; update)` loop | 4.4.8 |
| R10 | `while` loop | 4.4.8 |
| R11 | `for (let x of items)` loop | 4.4.8 |
| R12 | Classes with `public` / `protected` / `private` access modifiers on fields, accessors and methods (D30) | 4.5.2 |
| R13 | Stack-based interpreter | 5.4, 5.6 |
| R14 | Grammar defined in Jison | 3.4, 4.3 |
| R15 | Vite build via `@padcom/vite-config-lib`; lint via `@padcom/eslint-config-typescript` | 3 |
| R16 | Modules: `import` / `export` with **named exports only** (no default exports) | 4.7 |
| R17 | Getters and setters in classes (`get x()`, `set x(v)`, including static, private and protected accessors) | 4.5.4 |
| R18 | Getters and setters in object literals (`{ get x() {}, set x(v) {} }`) (D21) | 4.4.6 |
| R19 | Namespace imports `import * as ns from 'm'` (D22) and re-exports (D23) | 4.7 |
| R20 | Completion value returned by `run()` (D12) | 4.4.10 |
| R21 | Live host interop proxies (D9) | 5.8.1 |
| R23 | Explicit `override`, `final` members and classes, sealed classes (D28, D29) | 4.5.6 |
| R24 | Interfaces: declarations, `extends` between interfaces, `implements` on classes, `instanceof` with interfaces (D31, D32) | 4.5.7 |
| R26 | Template literals with `${}` interpolation, and multiline strings (D34) | 4.1.8 |
| R27 | Closed class instances with early undeclared-member errors (D36); `undefined` only for missing object-literal properties, `null` elsewhere (D37) | 4.5.9, 4.4.12 |
| R28 | Strict arity (D38) and `typeof null == 'null'` (D39) | 4.4.13, 4.4.1 |
| R25 | Implicit member access without `this.`, with the strict ambiguity rule (D33) | 4.5.8 |
| R22 | Only classes are constructable; `instanceof` works only with classes and class-constructed objects (D25–D27) | 4.5.5 |
| R29 | Destructuring: object and array patterns (nested, defaults, rest) in parameters, declarations, `for…of`, `catch` and assignments; object patterns in parameters are strict named parameters (D40) | 4.4.14 |
| R30 | `do … while`, `switch`, `void` and `delete` (D41) | 4.4.15 |
| R31 | Generators: `function*`, generator methods, `yield`, `yield*`, `next`/`return`/`throw` (D42) | 4.4.16 |
| R32 | `async`/`await` and `Promise` (D43) | 4.4.17 |
| R33 | `setTimeout` / `clearTimeout` and `fetch` (D44) | 4.6.1 |
| R34 | `setInterval` / `clearInterval` and `queueMicrotask` (D45) | 4.6.1 |
| R35 | Spread `...x` in calls, `new`, `super(...)`, array literals and object literals (D46) | 4.4.18 |
| R36 | Optional chaining `a?.b`, `a?.[k]`, `f?.(x)` (D47) | 4.4.19 |
| R37 | Computed keys in object literals: `{ [k]: v, [k]() {}, get [k]() {} }` (D48) | 4.4.6 |

### 1.4 SHOULD (planned for v1)

- Comments: `//` and `/* */`.
- `let` and `const` with block scope and TDZ. Per-iteration bindings in `for` loops.
- `if`/`else`, `break`, `continue`.
- The full operator set in §4.4.3: arithmetic, comparison, logical, `??`, ternary, compound assignment, `++`/`--`, `typeof`, `instanceof`, `in`.
- `null`, `undefined`.
- Function expressions; hoisted function declarations; closures.
- `this`, `new`, `extends`, `super(...)`, `super.method()`, static members, field initializers.
- `throw`, `try`/`catch`/`finally`, an `Error` hierarchy (see D3).
- Default parameter values.
- Shorthand properties `{ a }`.
- Keywords allowed as property names (`obj.of`, `{ class: 1 }`).
- A small standard library (§4.6), including `JSON.stringify` (needed by the test harness).
- A host API: globals, native functions, calling script functions from the host, execution limits.

### 1.5 COULD (Phase 3+)

~~Rest parameters and spread (`...`)~~ (done, D46), ~~optional chaining `?.`~~ (done, D47), ~~computed keys `{ [k]: v }`~~ (done, D48), the comma operator in `for` headers, ~~`do … while`, `switch`~~ (done, D41), `for … in`, bitwise operators, hex/binary/octal literals, ~~destructuring~~ (done, D40), user-defined iterables, abstract classes (`abstract` is reserved), a structural `x implements I` operator (D32), `private constructor`, Map/Set, a CLI/REPL, a disassembler CLI, source maps for errors.

### 1.6 WON'T (v1)

`var`, ~~generators~~ (done, D42), **default exports and default imports** (`export default`, `import x from`), `export * from`, `export * as ns from`, `import.meta`, regular-expression literals, labels, `with`, `eval`, symbols, BigInt, **tagged templates and `String.raw`** (D34, excluded for good), Unicode identifiers (ASCII only in v1).

Planned for v2 (§1.7): ~~`async`/`await`~~ (done, D43), an asynchronous module loader, top-level `await`, dynamic `import()`, async generators and `for await`.

### 1.7 v2 roadmap and constraints on v1 (D19)

v2 adds ~~`async` functions, `await`, Promises~~ (done early: D43, §4.4.17), an asynchronous `ModuleLoader`, top-level `await` in modules, and probably dynamic `import()`. v1 does not implement any of it, but must keep these doors open:

- **Suspendable execution.** Script-to-script calls must never recurse on the host JS stack (already required by §5.6.2). All frame state (operand stack slice, ip, environments, handlers, completion records) lives in heap objects, so a frame can later be suspended at an `await` and resumed from a microtask.
- **Re-entrancy is the exception.** Native→script callbacks (`Array.prototype.map`, getters called from natives, host calls through proxies) use the re-entrant `callFunction`. In v2, `await` inside such a nested run is only allowed when the async function itself was called from the script (the usual case). The VM design must keep "nested run loop" an explicit, detectable state (`vm.nestingDepth`).
- **Module records use the spec's state machine.** `ModuleStatus` (§5.4) is designed so v2 can add `evaluating-async` and `[[AsyncEvaluation]]` ordering without changing the linker structure.
- **Loader shape.** v2's loader may return `Promise<LoaderResult>`. v1 code that calls the loader is concentrated in one function (`fetchModule`) so it can become async without touching linking or evaluation.
- **Reserved words.** `async` and `await` are already reserved (§4.1.2), so v2 does not break v1 programs.
- **Host API.** v2 adds `runAsync`, `runModuleAsync` and `importModuleAsync`. v1's synchronous methods stay.

### 1.8 Native runtime (future, not part of v1)

Goal: a standalone `pscript` executable for Windows, macOS and Linux that does not need Node.js, while the language stays usable from Node and browsers. Three routes, from cheapest to most expensive:

| Route | What it is | Effort | Result |
|---|---|---|---|
| **N1. Bundle the TS implementation** | `bun build --compile` (or `deno compile`, or Node's single-executable apps) packs the existing library plus a small CLI (H5) into one binary per OS | days | no Node install needed; binaries are large (~50–100 MB) because a JS engine is embedded; identical behaviour everywhere |
| **N2. Embed a small JS engine** | run the same compiled library on QuickJS and build it into a C executable (`qjsc`), with native file-system bindings for the module loader | 1–2 weeks | small binaries (~1–3 MB), still one codebase; slower than V8 |
| **N3. Native reimplementation** | rewrite lexer, token filter, parser, compiler, VM, runtime, stdlib and a **garbage collector** in Rust (or C/C++), and compile the same code to WebAssembly for Node and browsers | several times the v1 effort | fastest and smallest; one native core for CLI, Node and browser |

Notes on N3:

- **Parser generator**: the grammar is plain LALR(1), so it ports almost mechanically. Bison targets C/C++ (and Java/D), not Rust; for Rust, LALRPOP is the closest equivalent. The token filter (§4.2) and grammar actions must be rewritten either way.
- **The garbage collector is the biggest new piece.** The TS implementation borrows the JS engine's GC; a native VM needs its own (tracing GC, or reference counting plus cycle collection).
- **Interop is the hardest part**: live proxies (D9) across a WebAssembly boundary need handle tables, JS glue code and `FinalizationRegistry` to avoid leaks between the two heaps.
- **What carries over**: this spec, the bytecode design (§5.4) and the whole test corpus (`*.pscript` + `*.out` files are implementation-neutral), so a native port can be validated against the same tests.

**Recommendation**: build v1 in TypeScript as planned (the reference implementation). Ship standalone binaries with N1 as part of the CLI work (H5). Decide on N3 later, based on real performance and size needs. To keep N3 possible, v1 keeps the bytecode free of JS-specific values (constants are numbers, strings, templates and protos only) and keeps the test corpus independent of the host language.

---

## 2. Decisions (confirmed 2026-10-26)

The owner reviewed every decision. The rest of this document applies them. In the last column, *yes* means the behaviour differs from JavaScript, so tests for it are tagged `// @pscript-only` and excluded from differential testing (§6.3).

| ID | Topic | Decision | Deviates from JS? |
|----|-------|----------|-------------------|
| D1 | Equality | **`==` / `!=` are strict**, exactly like JS `===` / `!==`: no type coercion, values of different types are never equal (`1 == '1'` and `null == undefined` are `false`), numbers by IEEE value (`NaN != NaN`, `0 == -0`), strings by content, everything else by identity. **`===` and `!==` do not exist**: they are a `SyntaxError` suggesting `==` / `!=` | yes |
| D2 | Newline before `(` or `[` | **Ends the statement** (a `;` is inserted). `a\n(b)()` is two statements | yes |
| D3 | Exceptions | **`throw` / `try` / `catch` / `finally` are in v1** | no |
| D4 | Protected members | **As specified in §4.5.2**: accessible from the declaring class and every class on the same inheritance line; denied for unrelated classes and outside code. The owner considers this a key feature: it addresses one of JavaScript's bigger limitations. Treat its tests as first-class. (Originally `$name`; now the `protected` keyword, D30) | n/a |
| D5 | Arithmetic and comparison on objects, arrays and functions | **`TypeError`**, except `+` with a string operand (string conversion). Primitives coerce as in JS | yes |
| D6 | `undefined` | **Keyword literal**, not assignable | minor |
| D7 | `of`, `static` | **Reserved words** (still allowed as property names) | minor |
| D8 | Object representation | **Own object model.** The class is named **`Object`**, not `PSObject`. For consistency the other runtime classes drop the prefix too: `Array`, `Function`, `Closure`, `NativeFunction`, `Class` (§5.7) | n/a |
| D9 | Host interop | **Live proxies in both directions** (§5.8.1). No deep copies | n/a |
| D10 | File extensions | **`.pscript` and `.psc`**. The default loader tries both (§4.7.3). The test corpus uses `.pscript` | n/a |
| D11 | Static class members | **Yes**, in v1 | no |
| D12 | Completion value | **Yes.** `run()` returns the value of the last evaluated expression statement. The owner considers this essential: treat it as a MUST and test it thoroughly (§4.4.10) | n/a |
| D13 | Jison flavour | **`jison@0.4.18`** | n/a |
| D14 | Execution limits | **Yes**: `maxSteps` and `maxCallDepth`. Either may be set to `Infinity` (no limit) | n/a |
| D15 | `-2 ** 2` | **Parsed as `-(2 ** 2)`** | yes |
| D16 | Build output | **ES modules only.** For now, override `build.lib.formats` locally; later the upstream `@padcom/vite-config-lib` will drop UMD | n/a |
| D17 | `.5` and `5.` | **Allowed** | no |
| D18 | `print` formatting | **Own simple format** (§4.6.2), shared with the default class `toString()`: double-quoted strings inside arrays and objects, `[1, "a"]`, `{a: 1}` | yes (output format) |
| D19 | Module loading | **Synchronous in v1.** v2 adds `async`/`await`, an asynchronous module loader and top-level `await`. v1 must not make those hard (§1.7) | n/a |
| D20 | Script vs module | **Two entry points:** `run()` for scripts (`import`/`export` are a SyntaxError); `runModule()` / `importModule()` for modules | no |
| D21 | Getters/setters in object literals | **In v1** (MUST, R18) | no |
| D22 | `import * as ns from 'm'` | **In v1** (MUST, R19) | no |
| D23 | Re-exports `export { a, b as c } from 'm'` | **In v1** | no |
| D24 | Module-level `this` | **`null`** (D37) | yes |
| D25 | What `new` accepts | **Only classes.** Functions (declarations, expressions, arrows, methods, accessors) are never constructors: `new f()` → `TypeError: f is not a class`. Functions have no `prototype` property. Constructable things are script classes, built-in classes (the `Error` family) and host classes (§5.8.1). `extends` also requires a class (`extends null` is not allowed). Details in §4.5.5 | yes |
| D26 | What `instanceof` accepts | **Only classes, and only class-constructed objects match.** The right-hand side must be a class, otherwise `TypeError: Right-hand side of 'instanceof' is not a class`. The result is `true` only when the left-hand side was constructed by `new` from that class or a subclass. Primitives, object literals, arrays and functions always give `false`. Details in §4.5.5 | yes |
| D27 | Constructors returning a value | **`return expr` inside a constructor is a SyntaxError**; only a bare `return` is allowed. This follows from D25/D26: in JS, a constructor that returns an object makes `new C()` produce something that is not a `C`. *Confirmed by the owner.* | yes |
| D28 | Overriding | **Methods are always virtual, but overriding is explicit** (option B + C). Redefining an inherited member requires the `override` modifier; `override` on a member that has nothing to override is an error. `final` seals a member (it cannot be overridden) or a whole class (it cannot be extended). Checked once, when the class is defined. Details in §4.5.6 | yes |
| D30 | Access modifier syntax | **Keywords `public`, `protected`, `private`** (C#/Java style) on fields, accessors and methods, static or not. Replaces JS `#name` (removed: `#` is a lexer error) and the `$name` convention (`$` is now an ordinary identifier character). Private is per class, resolved with the caller's home class (§4.5.3) | yes |
| D31 | Interfaces | **`interface` declarations** with method, getter, setter and property requirements; no implementation. Interfaces can extend several interfaces; classes `implements` several interfaces; conformance is checked when the class is defined. Details in §4.5.7 | yes |
| D32 | Checking interfaces at runtime | **`instanceof` works with interfaces** (nominal: true iff the object's class declares `implements` of it, directly or through a superclass or sub-interface), as in Java/C#. No separate `implements` operator in v1 (a structural one stays COULD). *Confirmed by the owner.* | yes |
| D33 | Member access without `this.` | **Java-style implicit member access** inside class bodies for fields, accessors and methods (instance and static, any access level). **Strict ambiguity rule**: if a bare name matches both a member (own or inherited) and an outside definition (variable, function, class, interface, import, global), the class is rejected and the code must say `this.x`, rename/alias the outer binding, or use `globalThis.x`. Locals and parameters may shadow members. Details in §4.5.8 | yes |
| D34 | Template literals | **In v1**: backtick strings, multiline, `${expr}` interpolation with nesting, JS escapes; interpolation uses `ToString` (objects call `toString()`, no D5 TypeError). A template at the start of a line begins a new statement (as D2). **Tagged templates and `String.raw` are excluded from the language** (not planned for any version). Details in §4.1.8 | minor (newline before a template) |
| D35 | Default string form of class instances | **`ClassName(field = value, …)`**: the inherited default `toString()` of every class instance lists its public data fields, with strings in double quotes. Classes can still `override toString()`. `print` shows class instances through their `toString()`. Details in §4.4.11 | yes |
| D36 | Closed class instances | **Class instances and classes have only their declared members.** Reading, writing or calling an undeclared member is an error, reported as early as possible: compile time when provable, class-definition time for inherited members, runtime otherwise. Details in §4.5.9 | yes |
| D37 | `null` vs `undefined` | **`undefined` only means "missing property of an object literal"** (or host object). Uninitialised fields, `let x`, missing arguments, bare `return`, `this` in plain calls and "not found" results are `null`; out-of-range array/string indexes throw `RangeError`. Details in §4.4.12 | yes |
| D38 | Arity | **Strict, as in Java/C#/Delphi**: required parameters must be passed, extra arguments are an error (unless a rest parameter exists), defaults apply only to omitted arguments, required parameters come before optional ones. Checked at compile time when the callee is known, otherwise at class-definition time, link time or runtime. Function declarations become constant bindings; overrides keep their signature. Details in §4.4.13 | yes |
| D39 | `typeof null` | **`'null'`** (JS gives `'object'`) | yes |
| D40 | Destructuring and named parameters | **JavaScript destructuring, with strict named parameters**: object and array patterns everywhere a binding or assignment target is allowed. An object pattern inside a *parameter* rejects an argument object that has properties the pattern does not name (unless the pattern has `...rest`): at compile time for object literals passed to a known callee, otherwise at runtime. Details in §4.4.14 | yes |
| D41 | `do … while`, `switch`, `void`, `delete` | **As in JavaScript, with two PScript rules**: `switch` compares with `==`, which is strict (D1), so it behaves like JS's `===` matching; `delete` removes own properties of **plain objects** (and host objects) only: on class instances, arrays, functions, classes, namespaces, frozen objects and primitives it is a `TypeError` (JS would leave a hole in an array or silently fail), and `delete x` / `delete 1` are `SyntaxError`s. `void x` gives `undefined`. Details in §4.4.15 | minor (delete errors) |
| D42 | Generators | **JavaScript generators**: `function*`, `*method()` (classes and object literals, static too), `yield`, `yield*`, generator objects with `next`, `return` and `throw`, iterable by `for…of`, array patterns and `Array.from`; leaving a `for…of` early (`break`, `return`, an exception) or destructuring closes the generator (its `finally` blocks run), as in JS. **"No value" is `null` (D37)**: a bare `yield` yields `null`, `next()` without an argument makes the paused `yield` give `null`, a finished generator gives `{ value: null, done: true }`. No async generators. Generator objects print as `[Generator]`. Details in §4.4.16 | minor (null instead of undefined) |
| D43 | `async` / `await` and Promises | **JavaScript semantics, including the order of callbacks**: `async` functions, arrows and methods, `await` (only inside async functions: no top-level `await` yet, no async generators or `for await`), and a built-in **final** class `Promise` with `then`/`catch`/`finally`, `resolve`, `reject`, `all`, `allSettled`, `race`, `any` and `withResolvers` (plus `AggregateError`). Jobs (microtasks) run when the script stack is empty: **`run()` drains them before it returns**, so script-only async code completes synchronously; jobs queued later (a host promise settled) run in a host microtask. An unhandled rejection left after `run()`'s drain is thrown like an uncaught exception. **Only `Promise` instances are adopted** (an object with a `then` method is a plain value; host thenables are converted at the boundary). "No value" is `null` (D37). Details in §4.4.17 | minor (thenables, null, final `Promise`) |
| D44 | `setTimeout`, `clearTimeout`, `fetch` | **The JavaScript interface, backed by the host**: `setTimeout(callback, delay?, ...args)` returns a numeric id (as in browsers) that `clearTimeout` cancels; the callback runs as a **task** of the host's event loop (after `run()` returned), with a new step budget, followed by the jobs it queued (as JS drains microtasks after each task); its exception or an unhandled rejection goes to `stderr`, since there is no caller. Code strings are a `TypeError`. `fetch(resource, options?)` calls the host's `fetch` through interop (arguments `toHost`, the result `toScript`), so it returns a script promise of a host `Response`; a synchronous failure of the host's fetch rejects. The host's functions are looked up per call; `InterpreterOptions.fetch` replaces fetch (tests, sandboxing). `setInterval` came with D45. Details in §4.6.1, §5.6.10 | minor (no code strings; errors to stderr) |
| D45 | `setInterval`, `clearInterval`, `queueMicrotask` | **The JavaScript interface, completing D44**: `setInterval(callback, delay?, ...args)` shares ids with `setTimeout` (so `clearTimeout` and `clearInterval` are interchangeable, as in browsers); it is built on the host's `setTimeout`, re-armed before each run, so the callback can clear its own interval, and an exception (to `stderr`) does not stop it. `queueMicrotask(callback)` queues a job (`AccessContext.enqueueJob`), ordered with promise reactions; an exception in the callback rejects an internal promise, so it is reported like an unhandled rejection (thrown by `run()` after the queue drained, or to `stderr` in the background) and the other jobs still run. Details in §4.6.1 | minor (no code strings) |
| D46 | Spread `...x` | **As in JavaScript**: `f(...xs)`, `new C(...xs)`, `super(...xs)`, `[...xs]` take what an iterable produces (arrays, strings, generators, host iterables; anything else is a `TypeError`); `{ ...o }` copies the own enumerable public properties (getters run, later keys win; `null`, `undefined` and non-string primitives add nothing). Spread arguments keep **strict arity (D38) and named parameters (D40)** but move their check to runtime (`TypeError`), since the count is not known at compile time; the arguments before the first spread are still checked against named parameters at compile time. A spread in a literal that becomes an assignment pattern is its rest element, which must be a name. Details in §4.4.18 | no |
| D47 | Optional chaining | **As in JavaScript**: `a?.b`, `a?.[k]`, `f?.(x)` and `o.m?.(x)`; when the value before `?.` is `null` or `undefined`, the rest of the chain (including its arguments) is skipped and the chain gives **`undefined`** (not `null`, D37: like a missing property, it is JavaScript's "nothing read"). Only the base is tested: an undeclared member of a class instance is still an error (D36). A chain is not an assignment, `++`/`--` or `delete` target. Inside a class body, an optional call of a bare name that may be an implicit member (`m?.()`, D33) is a `SyntaxError` (write `this.m?.()`). `?.` followed by a digit is `?` and a number, as in JS. Details in §4.4.19 | no |
| D48 | Computed keys | **In object literals, as in JavaScript**: `[k]: v`, `[k]() {}`, `*[k]() {}`, `async [k]() {}`, `get [k]() {}`, `set [k](v) {}`. The key is evaluated before its value and converted like `o[k]` (ToString); later keys replace earlier ones; an anonymous function, arrow, class, method or accessor defined there is named after the key at runtime. **Not in classes** (class members are declared, D29, D36) **nor in destructuring patterns** (`SyntaxError`). Details in §4.4.6 | no |
| D29 | Classes are sealed after definition | **A class's methods, accessors and prototype cannot be changed after the class is defined.** There is no script-visible `prototype` property, classes are non-extensible (static *fields* stay writable), and instances never gain properties beyond their declared members (D36). This turns method lookup into a per-class flattened method table (§5.6.7). Details in §4.5.6 | yes |

Phase 0 also fixes the `package.json` description typo: "inspierd" → "inspired".

---

## 3. Tooling & project setup

Verified against the published packages as of 2026-10-26.

### 3.1 Toolchain facts (verified)

- `@padcom/vite-config-lib@0.13.1` exports `defineLibConfig(pkg, overrides)`. It:
  - uses entry `./src/index.ts`, lib `name` = the last segment of `pkg.name`, `fileName: 'index'`;
  - adds `vite-plugin-dts` with `rollupTypes`;
  - marks `dependencies`, `peerDependencies` and `optionalDependencies` as externals.
  - It wraps `@padcom/vite-config-default` (a **peer dependency**). That package:
    - adds `vite-plugin-eslint`;
    - adds the alias `@` → `./src`;
    - configures Vitest with `setupFiles: ['./vitest.setup.js']` (**the file must exist**) and v8 coverage.
  - The default config's peers are `eslint >=9`, `typescript >=5.8 <6.0.0` (**TypeScript must stay on 5.x**, currently 5.9.3) and `vite >=6`.
- `@padcom/eslint-config-typescript@0.20.2` exports `{ typescript, 'flat/browser', 'flat/node' }` flat-config arrays. Its peer is `eslint ^10`. Its style:
  - **no semicolons**, single quotes, 2-space indent, trailing commas on multiline;
  - `no-explicit-any` off, `no-shadow` via TS.
- The interpreter source is platform-neutral, so `src/**` uses `flat/browser`. Build scripts and config files use `flat/node`.
- Latest versions: vite 8.3.5, vitest 5.0.5, eslint 10.13.0, jison 0.4.18, acorn 8.19.0. Node in the dev environment is v26.

### 3.2 `package.json` (target state after Phase 0)

```jsonc
{
  "name": "@padcom/pscript",
  "version": "0.0.1",
  "description": "PScript - a JavaScript-inspired scripting engine",
  "type": "module",
  "files": ["dist"],
  "engines": { "node": ">=24" },
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "scripts": {
    "build": "vite build",                    // ES output only (D16)
    "dev": "vite build --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "check": "npm run lint && npm run typecheck && npm test"
  },
  "devDependencies": {
    "@padcom/eslint-config-typescript": "^0.20.2",
    "@padcom/vite-config-default": "*",
    "@padcom/vite-config-lib": "^0.13.1",
    "@types/node": ">=22",
    "acorn": "^8",          // test oracle only (§6.2)
    "eslint": "^10",
    "jison": "0.4.18",      // build-time only; the generated parser is bundled
    "typescript": "~5.9",
    "vite": "^8",
    "vitest": "*"           // pinned to whatever @padcom/vite-config-default resolves
  }
}
```

The library has **no runtime dependencies**. The Jison runtime is inlined into the generated parser. Phase 0 must confirm the actual dist file names from `vite build` output and correct `main`, `module` and `exports` to match.

### 3.3 Config files

`vite.config.ts`

```ts
import { defineConfig } from 'vite'
import { defineLibConfig } from '@padcom/vite-config-lib'
import pkg from './package.json' with { type: 'json' }
import { jison } from './build/vite-plugin-jison'

export default defineConfig(defineLibConfig(pkg, {
  plugins: [jison()],
  build: {
    lib: {
      entry: './src/index.ts',
      formats: ['es'],          // D16: ES only, until upstream drops UMD
    },
  },
}))
```

The base config sets no `formats`, so the override applies as is. Phase 0 must confirm that the build emits only `dist/index.js` and `dist/index.d.ts`.

`eslint.config.js`

```js
import config from '@padcom/eslint-config-typescript'

export default [
  { ignores: ['dist/**', 'coverage/**'] },
  ...config['flat/browser'],
  // node-flavoured overrides for build/ and *.config.* if required
]
```

Also in Phase 0:

- `vitest.setup.js`: required by the default config. Registers custom matchers if needed; otherwise empty.
- `tsconfig.json`: `strict: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `resolveJsonModule: true`, `noEmit: true`, `types: ["vitest/globals"]` only if globals are enabled, `paths: { "@/*": ["./src/*"] }`.
- `.gitignore`: `node_modules`, `dist`, `coverage`.
- `.nvmrc`: `24.22.1` (current Node LTS "Krypton" as of 2026-10-26), and `"engines": { "node": ">=24" }` in `package.json`. Revisit when Node 26 becomes LTS.
- `git init`. The project is **not yet a git repository**.

### 3.4 Jison integration: `build/vite-plugin-jison.ts`

A small local Vite plugin that turns `import parser from './pscript.jison'` into an ES module at build and test time. Vitest uses the same Vite config, so tests use it too. No generated files are committed.

- `transform(code, id)` for ids ending in `.jison`:
  1. `const gen = new jison.Generator(code, { moduleType: 'js', moduleName: 'pscriptParser' })`.
  2. If `gen.conflicts > 0`, **fail the build** and report the conflicts. The grammar must be conflict-free. Precedence declarations may resolve shift/reduce conflicts, but nothing may be left unresolved.
  3. Return `gen.generate() + '\nexport default pscriptParser\n'`.
- Provide `src/grammar/jison.d.ts` with `declare module '*.jison' { const parser: JisonParserModule; export default parser }`. It must type `parser.Parser` (constructor), `parser.yy`, `parser.lexer` and `parse()`.
- The lexer (`%lex … /lex`) and the grammar live in **one file**: `src/grammar/pscript.jison`.
- The generated parser shares state. `parse()` must create a fresh `new parser.Parser()` per call and install a fresh `yy` (AST builders plus the error hook) and the token-filtering lexer (§4.2).

---

## 4. Language specification

### 4.1 Lexical grammar

#### 4.1.1 Whitespace and comments

- Whitespace: space, tab, `\r`, `\v`, `\f`, U+00A0, U+FEFF.
- Line terminators: `\n`, `\r\n`, `\r`, U+2028, U+2029. The lexer emits a **`NEWLINE`** token. The token filter consumes it (§4.2) and the parser never sees it.
- `// …` to end of line.
- `/* … */`, non-nesting. If a block comment contains a line terminator, it counts as a NEWLINE for ASI.
- Unterminated block comment → `SyntaxError`.

#### 4.1.2 Identifiers, private names, keywords

- `IDENT`: `[A-Za-z_$][A-Za-z0-9_$]*`. `$` is an ordinary identifier character with no special meaning (D30).
- `#` is not a valid character: `SyntaxError: Unexpected '#'. Use the 'private' modifier for private members`.
- Keywords (reserved): `let const function return if else for of while break continue class extends new this super true false null undefined typeof instanceof in throw try catch finally static import export public protected private interface implements do switch case default delete void yield async await` (`do`…`void` since D41, `yield` since D42, `async` and `await` since D43).
- **Contextual keywords** (ordinary identifiers everywhere else; the token filter turns them into keyword tokens only in the positions below, §4.2.5):
  - `get`, `set`: in a class member-name or object-literal key position when followed by another member name → `GET` / `SET`. A method *named* `get` (`get() {}`) stays an identifier.
  - `as`: inside an import/export specifier list, or right after `import *` → `AS`.
  - `override`, `final`: in a class member-name position when followed by another modifier, `get`/`set`, or a member name → `OVERRIDE` / `FINAL`. `final` directly before `class` (at statement start, after `export`, or in expression position) → `FINAL`. Elsewhere both are ordinary identifiers (`let final = 1` works).
  - `from`: after the closing `}` of an import/export specifier list, or after `import * as IDENT` → `FROM`.
- Reserved for the future (always a `SyntaxError` as an identifier): `var enum package abstract`.
- Keywords are allowed as **property names** after `.` and as object-literal or class-member keys. The token filter rewrites them to `IDENT` in those positions (§4.2.4).

#### 4.1.3 Literals: booleans, null, undefined

`true`, `false`, `null`, `undefined`. `undefined` is a keyword (D6). In the AST it is `Identifier{name:'undefined'}`, for ESTree/acorn compatibility. Assigning to it is a `SyntaxError`.

#### 4.1.4 Numbers (R2)

All numbers are IEEE-754 doubles, as in JS.

```
NUMBER  := ( DIGITS '.' DIGITS? | '.' DIGITS | DIGITS ) EXPONENT?
DIGITS  := [0-9]+
EXPONENT:= [eE] [+-]? DIGITS
```

Examples: `0`, `42`, `3.14`, `.5`, `5.`, `1e10`, `1E-7`, `6.022e+23`.

- Numeric value: `Number(text)`.
- Leading zeros such as `012` → `SyntaxError` (avoids legacy octal). A lone `0` and `0.x` are fine.
- An identifier character right after a number (`3in`, `1e`) → `SyntaxError`.
- COULD: `0x`, `0b`, `0o`, numeric separators `1_000`.

#### 4.1.5 Strings (R1)

- Delimited by `'…'` or `"…"`. Strings may not contain raw line terminators.
- Escapes: `\n \r \t \b \f \v \0 \\ \' \"`, `\xHH`, `\uHHHH`, `\u{H…}`, and backslash-newline (line continuation).
  - An unknown escape `\q` yields `q` (as in JS).
- Unterminated string → `SyntaxError` at the opening quote.
- The lexer decodes escapes. The AST `Literal.value` holds the decoded string; `raw` keeps the source text.
- Multiline text and interpolation: template literals (§4.1.8).

#### 4.1.6 Punctuators

```
{ } ( ) [ ] ; , . ... ? ?. : =>
= += -= *= /= %= **= &&= ||= ??=
+ - * / % ** ++ --
== != < <= > >=
! && || ??
` ${            (template delimiters, §4.1.8)
```

Bitwise operators are COULD. With no regex literals, `/` is always division.

#### 4.1.7 Token locations

Every token carries `{ first_line, first_column, last_line, last_column, range }` (the Jison `yylloc`). The AST converts these to **1-based line, 1-based column**. Multiline template tokens advance the line count by the newlines they contain.

#### 4.1.8 Template literals and multiline strings (R26, D34)

```js
const name = 'Ann', items = [1, 2]
print(`Hello, ${name}!`)                       // → Hello, Ann!
print(`${items.length} items, total ${items.reduce((a, b) => a + b, 0)}`)   // → 2 items, total 3
const html = `
  <ul>
    ${items.map(i => `<li>${i}</li>`).join('')}
  </ul>`                                         // multiline, with a nested template
```

**Syntax**

- Delimited by backticks. A template may span lines: line terminators are part of the string. `\r\n` and `\r` are normalised to `\n` (as in JS).
- `${ expression }` interpolates any expression, including object literals, arrow functions, strings with `}` in them, and **nested templates**.
- Escapes: everything strings support (§4.1.5) plus `` \` ``, `\$` and `\{`. Backslash-newline is a line continuation (the newline is removed). An invalid escape (`\x4`, `\u{110000}`, a bad `\u`) → `SyntaxError`. Legacy octal escapes such as `\1` → `SyntaxError`, as in JS.
- A literal `$` not followed by `{` is ordinary text: `` `cost: $5` ``.
- Unterminated template or interpolation → `SyntaxError` at the opening backtick or `${`.

**Lexing.** Template text cannot be tokenised with plain regex rules because `}` either closes an interpolation or a nested block/object inside it. The Jison lexer uses an exclusive start condition `TEMPLATE` plus a stack of brace counters kept on `yy`:

- In `INITIAL`: `` ` `` enters `TEMPLATE`. A `{` increments the counter on top of the stack; a `}` with the counter at 0 while inside an interpolation pops back into `TEMPLATE` instead of producing `}`.
- In `TEMPLATE`: text up to `` ` `` or `${` becomes one token; `${` pushes a new counter and returns to `INITIAL`.
- Token kinds (ESTree naming): `TEMPLATE_FULL` (`` `text` ``, no interpolation), `TEMPLATE_HEAD` (`` `text${ ``), `TEMPLATE_MIDDLE` (`}text${`), `TEMPLATE_TAIL` (`` }text` ``). Each carries both the **cooked** value (escapes decoded) and the **raw** text.
- Newlines inside template text never produce `NEWLINE` tokens, so they never trigger ASI. Newlines inside `${ … }` are inside a bracket pair (§4.2.6) and are ignored for ASI too.

**Semantics**

- `` `a${x}b${y}c` `` evaluates `x`, then `y`, left to right, converts each with **`ToString`** (§4.4.3), and concatenates the pieces. The result is always a string.
- `ToString` follows JS for primitives (`${null}` → `null`, `${1e21}` → `1e+21`). Objects call their `toString()` method, so `` `${point}` `` uses a class's `override toString()`. Unlike `+` (D5), interpolating an object never throws a `TypeError` for being an object; it only throws if the object has no usable `toString` (e.g. a module namespace).
- Strings in `'…'` and `"…"` stay single-line, as in JS. Multiline text uses templates.

**Excluded** (D34): tagged templates (`` html`<b>${x}</b>` ``) and `String.raw` are not part of PScript, now or later: the syntax is easy to misread and the feature is rarely needed. Writing an expression directly followed by a template (`` tag`x` `` on one line) → `SyntaxError: tagged templates are not supported; call a function with a template instead: tag(`x`)`. A template at the **start of a line** begins a new statement, consistent with D2 for `(` and `[`.


### 4.2 Optional semicolons (ASI) and the token filter (R6)

An LALR grammar cannot see newlines. A TypeScript **token filter** (`src/parser/token-filter.ts`) therefore sits between the Jison lexer and the parser. It implements the lexer interface Jison expects (`setInput`, `lex`, `yytext`, `yylloc`, `yylineno`, `showPosition`). It is the **only** place where newline-sensitive and context-sensitive decisions are made. It does four jobs:

#### 4.2.1 Automatic semicolon insertion

The filter tracks:

- `prev`: the last *significant* token emitted, including inserted `;`;
- `sawNewline`: whether a NEWLINE (or a multi-line comment) came between `prev` and the current token;
- a **bracket stack** whose entries are `(`, `[`, `{block}`, `{object}`.

Definitions:

- **ENDERS** (tokens that may end a statement): `IDENT`, `NUMBER`, `STRING`, `TEMPLATE_FULL`, `TEMPLATE_TAIL`, `true`, `false`, `null`, `undefined`, `this`, `super`, `)`, `]`, `}`, `++`, `--`, `return`, `break`, `continue`.
- **CONTINUERS** (tokens that may not start a statement and therefore continue the previous line): `.`, `?.`, `,`, `?`, `:`, `=>`, every assignment operator, every binary operator **including `+` and `-`**, `&&`, `||`, `??`, `instanceof`, `in`, `of`, `extends`, `implements`, `else`, `catch`, `finally`, `)`, `]`, `}`, `;`.
  - `(` and `[` are **not** continuers (D2).
  - `++`, `--` and `!` are not continuers. `a\n++b` means `a; ++b`, as in JS.

Insert a virtual `;` before the current token T when **all** of these hold:

1. `sawNewline`, **and**
2. the top of the bracket stack is empty or `{block}` (no insertion inside `(…)`, `[…]` or object literals), **and**
3. `prev ∈ ENDERS`, **and**
4. `T ∉ CONTINUERS`.

Also insert `;`:

- **before `}`** when that `}` closes a `{block}` and `prev ∈ ENDERS` (JS rule: `{ a() }`);
- **at EOF** when `prev ∈ ENDERS`.

JS restricted productions follow from the rules above: `return\nx` means `return; x;` because `return` is an ENDER and `x` is not a CONTINUER. The same applies to `break` and `continue`.

Consequences, all of which become tests:

| Source | Parsed as |
|---|---|
| `let a = 1\nlet b = 2` | two declarations |
| `x = a\n  .map(f)` | one statement (method chain) |
| `x = a\n  + b` | `x = a + b` |
| `foo()\n(bar)()` | **two statements** (D2) |
| `if (c) {\n}\nelse {\n}` | if/else |
| `return\n42` | `return; 42;` |
| `let o = {\n a: 1\n}` | object literal; no `;` inserted inside it |
| `f(\n a,\n b\n)` | one call |
| `let f = () => {\n}\nf()` | two statements |
| `class A {\n x = 1\n m() {}\n}` | field `x` ends with an inserted `;` |

The grammar therefore requires `;` after expression statements, declarations, `return`, `break`, `continue`, `throw` and class fields. It also accepts an `EmptyStatement` (`;`) everywhere a statement or class element may appear. That makes stray inserted `;` after `}` harmless.

#### 4.2.2 Brace classification

The filter emits `BLOCK_LBRACE` or `OBJ_LBRACE` for `{` and pushes the matching stack entry. `{` is a **block** when `prev` is one of:

- *none* (start of input), `;`, `BLOCK_LBRACE`, `}`;
- `)`: function, method and arrow bodies, plus `if`, `for` and `while` bodies;
- `=>`: arrow body, as in JS, so `() => ({})` is needed for object results;
- `else`, `try`, `finally`;
- the class-body position: when `class` is seen, remember the current bracket depth. The next `{` at that same depth is the class body, so `extends mixin({…}) {` works.

Every other `{` is an **object literal** (`OBJ_LBRACE`). Typical cases: after `=`, `(`, `[`, `,`, `:`, `?`, `return`, or an operator.

#### 4.2.3 Arrow-function detection

- `IDENT` immediately followed by `=>` → emit `ARROW_IDENT`.
- `(` whose matching `)` is immediately followed by `=>` → emit `ARROW_LPAREN` instead of `(`. The filter buffers lookahead tokens and replays them.
  - A newline between `)` and `=>` is a `SyntaxError`, as in JS.
  - Nested parens: find the match by depth counting. Worst-case O(n²) is acceptable; the filter may memoize match positions as an optimisation.

This makes arrow functions conflict-free. The parser never has to choose between a parenthesised expression and a parameter list.

#### 4.2.4 Keywords as property names

Emit the keyword as `IDENT` (keeping `yytext`) when:

- `prev` is `.` or `?.`; or
- the top of the stack is `{object}`, the token is in key position (`prev` is `OBJ_LBRACE` or `,`), and the next token is `:`, `(`, `,` or `}`; or
- the top of the stack is the class body and the token is in member-name position, followed by `(`, `=`, `;` or a newline.
  - `static` itself is handled first: `static` followed by a name stays the keyword `static`.
  - Interface bodies are tracked like class bodies: after `interface`, the next `{` at the same depth is a block-type brace, so ASI separates member declarations.
  - Modifiers `final` and `override` are recognised in the same position by the same lookahead rule as `get`/`set` (§4.2.5). A member literally *named* `final` or `override` (`final() {}`, `override = 1`) stays an `IDENT`.
- inside an import/export specifier list (§4.2.5), a keyword in name position becomes `IDENT`. As in JS, *exported/imported names* may be reserved words (`export { x as class }`, `import { class as k } from 'm'`), but the builder rejects reserved words used as *local* binding names (`import { class } from 'm'` → SyntaxError).

#### 4.2.5 Contextual keywords and module braces

- **`get` / `set`**: when the top of the stack is a class body, the token is in member-name position (`prev` is the class `BLOCK_LBRACE`, `;`, `}` of a previous member, `public`/`protected`/`private`, `static`, `FINAL` or `OVERRIDE`), the text is `get`/`set`, and the **next** token is a member name (`IDENT`, keyword-as-name, `STRING`, `NUMBER`) on the **same line** → emit `GET` / `SET`. Otherwise it is an ordinary `IDENT` (so `get() {}`, `get = 1` and `get\n x() {}` behave as in JS).
  - The same rule applies inside an **object literal** (top of stack `{object}`, `prev` is `OBJ_LBRACE` or `,`): `{ get x() {} }` → `GET`, while `{ get: 1 }`, `{ get() {} }` and shorthand `{ get }` stay `IDENT`.
- **`import {` / `export {`**: the `{` right after `import` or `export` is pushed as a `{specifiers}` stack entry and emitted as `SPEC_LBRACE`. No ASI inside it. Inside, `IDENT 'as'` → `AS`. The `IDENT 'from'` immediately after its closing `}` → `FROM`.
- **`import * as ns from 'm'`**: after `import` `*`, `IDENT 'as'` → `AS`; after the following `IDENT`, `IDENT 'from'` → `FROM`. (`*` after `import` is otherwise a syntax error, so there is no ambiguity.)
- **`import 'm'`** (side-effect import) needs no special handling.
- `import` and `export` are not CONTINUERS and not ENDERS. A newline right after `export` or `import` does not insert `;`.

#### 4.2.6 Template literals

- `TEMPLATE_HEAD` pushes a `{template}` entry on the bracket stack; `TEMPLATE_MIDDLE` keeps it; `TEMPLATE_TAIL` pops it. Inside the entry there is no ASI (like `(…)`), and a `{` right after `TEMPLATE_HEAD`/`TEMPLATE_MIDDLE` is an object literal (`${ {a: 1}.a }`).
- A template token (`TEMPLATE_FULL`/`TEMPLATE_HEAD`) is not a CONTINUER, so a template starting a line ends the previous statement when `prev` is an ENDER (D34).

### 4.3 Syntactic grammar (R14)

Informal EBNF follows. The Jison file implements it as LALR(1), using `%left`, `%right` and `%nonassoc` for binary operators, and a `%nonassoc` pair to resolve dangling `else`. Grammar actions must be **thin**: they call typed builders on `yy.ast`, e.g. `$$ = yy.ast.binary($2, $1, $3, @$)`. All real logic stays in TypeScript.

```ebnf
Program         := ModuleItem* EOF                       (script goal: ModuleItem must be a Statement)
ModuleItem      := ImportDecl | ExportDecl | Statement

ImportDecl      := 'import' SPEC_LBRACE ( ImportSpec ( ',' ImportSpec )* ','? )? '}' FROM STRING ';'
                 | 'import' '*' AS IDENT FROM STRING ';'  (namespace import, D22)
                 | 'import' STRING ';'                    (side-effect only)
ImportSpec      := IDENT ( AS IDENT )?
ExportDecl      := 'export' VariableDecl ';'
                 | 'export' FunctionDecl
                 | 'export' ClassDecl
                 | 'export' InterfaceDecl
                 | 'export' SPEC_LBRACE ( ExportSpec ( ',' ExportSpec )* ','? )? '}' ( FROM STRING )? ';'
ExportSpec      := IDENT ( AS IDENT )?
                                                         ('export default …', 'export * …', 'import x from'
                                                          → SyntaxError with a clear message)

Statement       := Block
                 | VariableDecl ';'
                 | FunctionDecl
                 | ClassDecl
                 | InterfaceDecl
                 | 'if' '(' Expr ')' Statement ( 'else' Statement )?
                 | 'while' '(' Expr ')' Statement
                 | 'for' '(' ForInit? ';' Expr? ';' Expr? ')' Statement
                 | 'for' '(' ('let' | 'const')? IDENT 'of' AssignExpr ')' Statement
                 | 'return' Expr? ';'
                 | 'break' ';'
                 | 'continue' ';'
                 | 'throw' Expr ';'                       (no newline after throw: SyntaxError)
                 | 'try' Block ( 'catch' ( '(' IDENT ')' )? Block )? ( 'finally' Block )?
                                                         (needs at least one of catch/finally)
                 | Expr ';'
                 | ';'

Block           := BLOCK_LBRACE Statement* '}'
ForInit         := VariableDecl | Expr
VariableDecl    := ('let' | 'const') Declarator ( ',' Declarator )*
Declarator      := IDENT ( '=' AssignExpr )?             (const without initializer: SyntaxError)

FunctionDecl    := 'function' IDENT '(' ParamList? ')' Block
FunctionExpr    := 'function' IDENT? '(' ParamList? ')' Block
ParamList       := Param ( ',' Param )* ','?
Param           := IDENT ( '=' AssignExpr )?             (default values: SHOULD)
                 | '...' IDENT                           (rest, last only: COULD)

ClassDecl       := FINAL? 'class' IDENT ClassHeritage BLOCK_LBRACE ClassElement* '}'
ClassExpr       := FINAL? 'class' IDENT? ClassHeritage BLOCK_LBRACE ClassElement* '}'
ClassHeritage   := ( 'extends' LeftHandSideExpr )? ( 'implements' TypeRef ( ',' TypeRef )* )?
TypeRef         := IDENT ( '.' IDENT )*                       (an interface binding or namespace member)

InterfaceDecl   := 'interface' IDENT ( 'extends' TypeRef ( ',' TypeRef )* )? BLOCK_LBRACE InterfaceMember* '}'
InterfaceMember := MemberName '(' SigParams? ')' ';'                 (method requirement)
                 | GET MemberName '(' ')' ';'                       (readable)
                 | SET MemberName '(' IDENT ')' ';'                 (writable)
                 | MemberName ';'                                   (property: readable and writable)
                 | ';'
SigParams       := IDENT ( ',' IDENT )* ( ',' '...' IDENT )? | '...' IDENT
ClassElement    := Modifiers MemberName '(' ParamList? ')' Block      (method; IDENT 'constructor' → ctor)
                 | Modifiers GET MemberName '(' ')' Block             (getter: no parameters)
                 | Modifiers SET MemberName '(' Param ')' Block       (setter: exactly one parameter, no rest)
                 | Modifiers MemberName ( '=' AssignExpr )? ';'      (field)
                 | ';'
Modifiers       := Access? 'static'? FINAL? OVERRIDE?                (fixed order: access static final override)
Access          := 'public' | 'protected' | 'private'
MemberName      := IDENT | STRING | NUMBER

Expr            := AssignExpr                               (comma operator: COULD)
AssignExpr      := ConditionalExpr
                 | ArrowFunction
                 | LeftHandSideExpr AssignOp AssignExpr       (target validity checked in builder)
AssignOp        := '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '**=' | '&&=' | '||=' | '??='
ConditionalExpr := BinaryExpr ( '?' AssignExpr ':' AssignExpr )?
BinaryExpr      := UnaryExpr ( BinOp UnaryExpr )*             (precedence table §4.4.3)
UnaryExpr       := ( '!' | '-' | '+' | 'typeof' ) UnaryExpr
                 | ( '++' | '--' ) UnaryExpr
                 | PostfixExpr
PostfixExpr     := LeftHandSideExpr ( '++' | '--' )?
LeftHandSideExpr:= NewExpr | CallExpr | OptionalChain
OptionalChain   := ( MemberExpr | CallExpr ) OptionalLink        (D47; one ChainExpression)
                 | OptionalChain ( OptionalLink | '.' IDENT | '[' Expr ']' | Arguments )
OptionalLink    := '?.' IDENT | '?.' '[' Expr ']' | '?.' Arguments
NewExpr         := MemberExpr | 'new' NewExpr
CallExpr        := MemberExpr Arguments
                 | 'super' Arguments
                 | CallExpr Arguments
                 | CallExpr '.' IDENT | CallExpr '[' Expr ']'
MemberExpr      := PrimaryExpr
                 | MemberExpr '.' IDENT | MemberExpr '[' Expr ']'
                 | 'super' '.' IDENT | 'super' '[' Expr ']'
                 | 'new' MemberExpr Arguments
Arguments       := '(' ( Argument ( ',' Argument )* ','? )? ')'
Argument        := AssignExpr | '...' AssignExpr                (spread, D46)

PrimaryExpr     := IDENT | 'this' | NUMBER | STRING | 'true' | 'false' | 'null' | 'undefined'
                 | ArrayLiteral | ObjectLiteral | FunctionExpr | ClassExpr | TemplateLiteral
                 | '(' Expr ')'
TemplateLiteral := TEMPLATE_FULL
                 | TEMPLATE_HEAD Expr ( TEMPLATE_MIDDLE Expr )* TEMPLATE_TAIL
ArrayLiteral    := '[' ( Element ( ',' Element )* ','? )? ']'   (holes [1,,2]: SyntaxError)
Element         := AssignExpr | '...' AssignExpr                (spread, D46)
ObjectLiteral   := OBJ_LBRACE ( Property ( ',' Property )* ','? )? '}'
Property        := PropName ':' AssignExpr
                 | PropName '(' ParamList? ')' Block              (method shorthand, R4)
                 | GET PropName '(' ')' Block                     (getter, R18)
                 | SET PropName '(' Param ')' Block               (setter, R18)
                 | IDENT                                          (shorthand { a }: SHOULD)
                 | '...' AssignExpr                               (spread, D46)
                 | '[' AssignExpr ']' ':' AssignExpr              (computed keys, D48: also with methods,
                                                                  generators, async methods and accessors)
PropName        := IDENT | STRING | NUMBER

ArrowFunction   := ARROW_IDENT '=>' ArrowBody
                 | ARROW_LPAREN ParamList? ')' '=>' ArrowBody
ArrowBody       := Block | AssignExpr
```

Static (early) errors are raised by the **builders** or the **compiler**, never by grammar conflicts:

- invalid assignment target (`1 = 2`, `a + b = c`, `f() = 1`);
- assignment to `const`, `undefined` or `this`;
- `const` without an initializer;
- duplicate `let`/`const` in one scope;
- `break`/`continue` outside a loop;
- `return` outside a function;
- `super(...)` outside a derived-class constructor, and `super.x` outside a method;
- duplicate constructor;
- a required parameter after an optional one; more than one rest parameter, or a rest parameter that is not last;
- a call with the wrong number of arguments to a callee known at compile time (D38, §4.4.13);
- assignment to a function declaration's binding (D38);
- a member name declared twice in one class with the same static-ness (exception: one `get x` plus one `set x` pair);
- `return expr` inside a class constructor (D27);
- a bare name in a class body that matches both an own member and an outside lexical binding or stdlib global (D33);
- in interfaces: bodies, initialisers, default parameter values, access modifiers, `static`/`final`/`override`, duplicate member names, a member named `constructor`;
- modifiers out of order or repeated; `override`/`final` on a constructor or on a `private` member (private members are never inherited); access modifiers on a constructor;
- a getter or setter named `constructor`; a getter with parameters; a setter without exactly one parameter;
- `import`/`export` in script goal, or anywhere other than the module top level;
- duplicate exported names; exporting a name that is not declared in the module; duplicate import bindings, or an import binding that clashes with a top-level declaration;
- assignment to an imported binding (imports are read-only).

### 4.4 Semantics

The rule for anything not listed here: **behave like strict-mode JavaScript**, except for the deviations listed in §2.

#### 4.4.1 Types

`undefined`, `null`, `boolean`, `number`, `string`, `object` (plain objects, arrays, class instances) and `function` (closures, native functions, classes). `typeof` returns the same strings as JS except for `null`: **`typeof null == 'null'`** (D39). A class gives `'function'`, an interface `'object'`.

#### 4.4.2 Truthiness

As in JS. Falsy values: `false`, `0`, `-0`, `NaN`, `''`, `null`, `undefined`. Everything else is truthy.

#### 4.4.3 Operators and precedence (lowest to highest)

| Level | Operators | Assoc |
|---|---|---|
| 1 | `=>` (arrow) | right |
| 2 | `= += -= *= /= %= **= &&= \|\|= ??=` | right |
| 3 | `? :` | right |
| 4 | `??` | left |
| 5 | `\|\|` | left |
| 6 | `&&` | left |
| 7 | `== !=` | left |
| 8 | `< <= > >= instanceof in` | left |
| 9 | `+ -` | left |
| 10 | `* / %` | left |
| 11 | `**` | right |
| 12 | prefix `! - + typeof void delete await ++ --` | right |
| 13 | postfix `++ --` | — |
| 14 | `new`, call, `.`, `[]` | left |

Unlike JS, mixing `??` with `&&` or `||` without parentheses is allowed.

Semantics:

- `+`:
  - if either operand is a string, convert both with `ToString` and concatenate (objects use their `toString()` method, see below);
  - else, if both are primitives, `ToNumber` both and add;
  - else (an object, array or function with no string operand) → `TypeError` (D5).
- `- * / % **`: `ToNumber` on primitives as in JS (`'3' * 2 == 6`, `null + 1 == 1`, `undefined + 1` is `NaN`). Object operands → `TypeError` (D5).
- `== !=` (D1, strict like JS `===`): no coercion. Different types → not equal. Numbers: IEEE comparison (`NaN != NaN`, `0 == -0`). Strings: by content. `null == null`, `undefined == undefined`, but `null != undefined`. Objects, arrays and functions: by identity (host proxies compare by the identity of the wrapped object, §5.8.1). `===` and `!==` are not operators: the lexer reports `SyntaxError: '===' is not supported; use '=='` (and likewise for `!==`).
- `< <= > >=`: both strings → lexicographic comparison by code unit. Otherwise `ToNumber` on both primitives. Object, array or function operand → `TypeError` (D5).
- `&& || ??`: short-circuit, returning an operand value as in JS. The compound forms `&&= ||= ??=` short-circuit as in JS.
- `!`: boolean negation of truthiness. Unary `-`/`+`: `ToNumber`.
- `typeof x` on an undeclared identifier returns `'undefined'` (no ReferenceError).
- `void x` evaluates `x` and gives `undefined`; `delete o.k` / `delete o[k]` see §4.4.15 (D41).
- `a instanceof T` (D26, D32): `T` must be a class (script, built-in or host) or an interface, otherwise `TypeError`. The result is `true` iff `a` was constructed from `T` or a subclass of `T`, or (for an interface) from a class that implements `T` (§4.5.5). Everything else is `false`, including primitives, object literals and arrays (use `Array.isArray`).
- `k in o`: the property exists on `o` or its prototype chain. A non-object `o` → `TypeError`.
  - For an array, `k in arr` checks indices and `length`.
  - **Hidden members**: `in` reports private and protected members only to code that may access them (§4.5.2).
- `++`/`--`: the operand must be an identifier or member expression. The operand goes through `ToNumber`. Prefix returns the new value, postfix the old.
- `ToString(number)` must match JS `String(n)`. Use the host `String()`; it is acceptable to rely on the host for number formatting.
- **`ToString(object)`** (used by `+` with a string operand, template literals, `String(v)`, `join`, `sort`): look up `toString` with the normal member resolution (public); if it is callable, call it with `this` = the object and require a primitive result (else `TypeError`). No usable `toString` (module namespaces, interfaces) → `TypeError: Cannot convert object to string`. Built-in results: class instances `ClassName(field = value, …)` (§4.4.11), plain objects `[object Object]`, arrays `a.join(',')`, functions `[Function: name]` / classes `[class Name]` (no source text), errors `Name: message`.

#### 4.4.4 Variables and scope

- `let` and `const` are block-scoped and in the TDZ until initialised. Reading or writing a binding before initialisation → `ReferenceError: Cannot access 'x' before initialization`.
- `const` reassignment is a **compile-time** `SyntaxError`, because resolution is static.
- Function declarations are **hoisted** to the top of their block or function scope and initialised before the first statement, so mutual recursion works.
- Class declarations behave like `let`: they are in the TDZ until evaluated.
- Name resolution order:
  1. lexical scopes (resolved at compile time to `(depth, slot)`);
  2. script-level bindings (the top-level scope of the current `run`, persistent across `run` calls on the same `Interpreter`, see 5.8);
  3. **globals**: stdlib plus host-provided.
  4. Not found → `ReferenceError: x is not defined` at runtime.
- Assigning to an undeclared name → `ReferenceError` (strict mode). Assigning to an existing global is allowed unless it is marked read-only (stdlib globals are read-only).
- Closures capture bindings **by reference**.
- In `for (let i = 0; …; i++)` each iteration has a **fresh copy** of `i` (JS semantics). Closures created in different iterations see different values.

#### 4.4.5 Functions and lambdas (R5, R7)

- Parameters: positional, with **strict arity** (D38, §4.4.13): every parameter without a default must be passed, and extra arguments are an error unless there is a rest parameter.
- Default values are evaluated at call time, left to right, in the parameter scope. They apply only when the argument is omitted.
- `return expr;` returns the value; `return;` or falling off the end returns `null` (D37).
- Function declarations, function expressions and methods get a dynamic `this`:
  - a method call `o.m()` → `o`;
  - a plain call → `null` (D37).
- **Functions are not constructors (D25).** `new f()` on any function → `TypeError: f is not a class`. Functions have no `prototype` property. Use a class instead.
- Arrow functions capture `this` (and the home class, §4.5) lexically.
- Functions are objects with `name` and `length` (number of required parameters).
- Function declarations are constant bindings (D38): `f = …` after `function f` → `SyntaxError`.
- There is no `arguments` object. COULD: `call`/`apply`/`bind` in the function prototype (SHOULD for `bind`).
- `maxCallDepth` (default 10 000; `Infinity` = no limit, D14) → `RangeError: Maximum call stack size exceeded`. Even with `Infinity`, a host stack overflow during native re-entrancy is caught and reported as the same `RangeError`.

#### 4.4.6 Objects (R4, R18)

- Literal: `{ a: 1, 'b c': 2, 3: 'x', d, m(x) { return this.a + x }, get full() { return this.a + 1 }, set full(v) { this.a = v - 1 } }`.
- **Accessors in object literals** (D21) follow §4.5.4: `get`/`set` with the same key combine into one **own** accessor property of the object. Unlike class accessors, they are own properties, so (as in JS):
  - `Object.keys` lists them;
  - `JSON.stringify` calls the getter;
  - `print` shows `[Getter]`, `[Setter]` or `[Getter/Setter]` without calling it.
- Later definitions with the same key replace earlier ones (a data property after an accessor replaces it, and vice versa), as in JS.
- **Computed keys** (D48): `{ [k]: v, [k]() {}, *[k]() {}, async [k]() {}, get [k]() {}, set [k](v) {} }`. The key expression is evaluated before the value, in source order, and converted like `o[k]`. Anonymous functions, arrows, classes, methods and accessors defined under a computed key are named after the key (`{ [k]() {} }[k].name == k`), as in JS. Class members and destructuring patterns have no computed keys.
- Keys are strings; number keys are converted to strings. Insertion order is preserved; integer-like keys are **not** reordered (a deviation from JS; document it).
- Methods defined by shorthand are ordinary closures with dynamic `this`. They are not constructible.
- Access: `o.k`, `o['k']`. A missing property gives `undefined` (the one place `undefined` comes from, D37). Object literals stay open: properties can be added at any time. Property access on `null`/`undefined` → `TypeError: Cannot read properties of null (reading 'k')`.
- The prototype of an object literal is `Object.prototype` (stdlib).
- Duplicate keys: last wins.

#### 4.4.7 Arrays (R8)

- Literal `[1, 'a', [2]]`; trailing comma allowed; no holes.
- `a[i]`: reads out of range (`i < 0` or `i >= length`) → `RangeError` (D37). Writing at `i >= length` extends the array, filling the gap with `null` (no holes).
  - Non-integer keys on arrays → `TypeError` (keeps arrays simple).
- `length` can be read. Writing `length` truncates or extends.
- Methods in §4.6.

#### 4.4.8 Loops (R9, R10, R11)

- `while (test) body`.
- `for (init; test; update) body`:
  - all three clauses are optional; a missing `test` means `true`;
  - `init` may be a `let`/`const` declaration (per-iteration bindings, §4.4.4) or an expression.
- `for (let x of iterable) body`, also with `const x` or a bare `x` (an existing binding).
  - **Iterables in v1**: arrays (iterated live, by index, while `i < length`), strings (by UTF-16 code unit in v1; COULD: by code point), generator objects (D42, §4.4.16), and host proxies of iterable host values (JS arrays, Maps, Sets, anything with `Symbol.iterator`), iterated through the host iterator (§5.8.1).
  - Anything else → `TypeError: x is not iterable`.
  - The binding is fresh per iteration.
  - COULD: a user-defined protocol (an object with an `iterator()` method returning `{ next() }`).
- `do body while (test)` (D41): the body runs before the first test. ASI as in JS: the statement ends after the `)` even on the same line (`do x++; while (c) y()`).
- `break` and `continue` apply to the innermost loop (`break` also leaves a `switch`, §4.4.15). Labels are WON'T.
- `maxSteps` (default `Infinity`) counts executed instructions → `RangeError: Execution step limit exceeded`. The check costs one comparison per instruction; with `Infinity` the VM may skip counting entirely.

#### 4.4.9 Exceptions (D3)

- `throw expr` accepts any value.
- `try`/`catch (e)`/`finally` follows JS semantics, including `finally` running on `return`, `break` and `continue`, and a `return` inside `finally` overriding.
- Runtime errors raised by the VM are catchable inside scripts as `Error` objects (`name`, `message`, `stack` string).
- An uncaught exception surfaces to the host as `PScriptRuntimeError` (§5.9).

#### 4.4.10 Completion value (R20, D12)

`run(source)` returns the **completion value** of the script, with exactly the semantics of JavaScript's `eval` / Node's `vm.runInContext`. Node is therefore the test oracle (§6.3). The compiler implements it with a hidden *completion register* in the script frame:

| Statement (reachable from top-level code, not inside function bodies) | Effect on the register |
|---|---|
| expression statement | set to the expression's value |
| `if`, `while`, `for`, `for…of`, `try` | set to `undefined` **on entry**, then updated by the statements they execute |
| `try … finally` | the `finally` block's own statements do not change the result: save the register before `finally`, restore it after the block completes normally |
| block, `let`/`const`, function and class declarations, `import`/`export`, empty statement | no change |
| `break` / `continue` | no change (the loop's value is the last value its body produced) |
| `throw` | no completion value; the exception propagates |

Examples (all checked against Node in the test suite):

| Source | Result |
|---|---|
| `1 + 2` | `3` |
| `let x = 5` | `undefined` |
| `let x = 5; x * 2` | `10` |
| `1; let y = 2` | `1` |
| `1; if (true) {}` | `undefined` |
| `1; {}` | `1` |
| `if (true) { 'a' } else { 'b' }` | `'a'` |
| `let i = 0; while (i < 3) { i++ }` | `2` (value of the last `i++`) |
| `try { 1 } finally { 2 }` | `1` |
| `function f() {}` | `undefined` |

- Each `run()` starts with `undefined` in the register. Script-level bindings persist across `run()` calls on the same `Interpreter` (REPL behaviour); the completion value does not.
- The value is returned to the host through the interop layer (§5.8.1): primitives as-is, objects as live proxies.
- Modules have no completion value; `runModule()` returns the module's namespace (§4.7).

#### 4.4.11 Default `toString()` of class instances (D35)

Every class instance inherits a `toString()` that produces a debugging-friendly form:

```js
class Address { city = 'Oslo' }
class User {
  name = 'Ann'
  age = 30
  tags = ['admin', "x\"y"]
  address = new Address()
  private pin = 1234
}
print(`${new User()}`)
// → User(name = "Ann", age = 30, tags = ["admin", "x\"y"], address = Address(city = "Oslo"))
```

- **Format**: `ClassName(` + `name = value` pairs joined by `, ` + `)`. An instance without public fields prints `ClassName()`.
- **Class name**: the name of the instance's actual class (`klass.name`, so a subclass instance shows the subclass). Anonymous class expressions show `anonymous`.
- **Fields**: the instance's **public own data properties**, in insertion order. That is declared public fields (superclass fields first, because they are initialised first), followed by properties added later (e.g. `this.r = r` without a declaration). Private and protected fields are never shown, whoever calls `toString()`. Accessors are not called (they may have side effects) and methods are not listed.
- **Values**:
  - strings: in **double quotes**, with JSON-style escapes (`\"`, `\\`, `\n`, `\t`, control characters as `\uXXXX`);
  - numbers, booleans, `null`, `undefined`: as `String(v)`;
  - nested class instances: their own `toString()` (so overrides are respected);
  - arrays: `[` + elements in this same value format joined by `, ` + `]`;
  - plain objects: `{a: 1, b: "x"}` (keys unquoted when they are identifiers, otherwise double-quoted);
  - functions and classes: `[Function: name]`, `[class Name]`; host proxies: `[Host Name]`;
  - cycles: `[Circular]` (tracked per top-level `toString()` call).
- **Where it lives**: `Object.prototype.toString` checks the receiver: a class instance gets this format, anything else gets `[object Object]`. So classes `override toString()` to replace it, exactly like the `Money` example in §10.2, and `super.toString()` gives back the default form.
- **Built-in classes keep their own `toString`**: errors print `Name: message` (subclasses of `Error` included).
- **Used everywhere a string is needed**: template literals, `+` with a string, `String(v)`, `join`, and `print` (§4.6.2).

#### 4.4.12 `null` and `undefined` (D37)

In PScript, **`undefined` means exactly one thing: "this object literal has no such property"**. Everything else that JavaScript reports as `undefined` is `null`, or an error.

| Situation | JavaScript | PScript |
|---|---|---|
| reading a missing property of an object literal / plain object | `undefined` | `undefined` (the only source) |
| reading a missing property of a host object (§5.8.1) | `undefined` | `undefined` (host objects are bags too) |
| uninitialised class field (`name`, `private owner`) | `undefined` | `null` |
| `let x` without initialiser | `undefined` | `null` |
| missing function argument | `undefined` | error: strict arity (D38, §4.4.13) |
| bare `return`, or falling off the end of a function | `undefined` | `null` |
| `this` in a plain call (`f()`), `this` at module top level | `undefined` | `null` |
| natives that return nothing (`forEach`, `print`, …) and host functions returning `undefined` | `undefined` | `null` |
| "not found" results: `find`, `findLast`, `pop`/`shift` on an empty array, `at()` out of range | `undefined` | `null` |
| array or string index out of range (`xs[10]`, `'abc'[5]`) | `undefined` | `RangeError: Index 10 out of range for length 4` |
| writing an array index beyond `length` | fills holes with `undefined` | fills the gap with `null` |
| missing member of a class instance or class | `undefined` | error (§4.5.9) |
| a setter-only accessor read | `undefined` | object literal: `undefined`; class: `TypeError: 'x' has only a setter` |

- The `undefined` keyword stays (D6), so scripts can test for a missing literal property: `if (options.color == undefined) …`. It can also be passed explicitly, e.g. to trigger a parameter default.
- `typeof undefined` is `'undefined'`, and `typeof` of an undeclared name is still `'undefined'` (it is a type name, not a value).
- **Host-facing values keep JS conventions**: the completion value (§4.4.10) is `undefined` when there is none, and script `null` stays `null` on the host side.
- Programs that observe any of these differences are `@pscript-only` in the test corpus.

#### 4.4.13 Strict arity (D38)

Every call must supply every parameter that has no default value, and no more arguments than the function declares, as in Java, C# and Delphi.

```js
function greet(name, greeting = 'Hello') { return `${greeting}, ${name}` }
greet('Ann')                 // OK: greeting uses its default
greet('Ann', 'Hi')           // OK
// greet()                   // SyntaxError: greet(name, greeting?) expects 1-2 arguments, got 0
// greet('Ann', 'Hi', '!')   // SyntaxError: greet(name, greeting?) expects 1-2 arguments, got 3

function log(level, ...parts) { print(level, parts.join(' ')) }   // rest parameter (when rest lands, §1.5)
log('info')                  // OK: rest may be empty
// log()                     // SyntaxError: log(level, ...parts) expects at least 1 argument, got 0
```

**Parameter lists**

- Three kinds, in this order: **required** (`a`), **optional** with a default (`b = 1`), and at most one **rest** parameter (`...c`, COULD) at the end. A required parameter after an optional one → `SyntaxError` (C# rule).
- A call is valid iff `required ≤ argumentCount`, and `argumentCount ≤ required + optional` unless there is a rest parameter.
- A default value applies only when its argument is **omitted**. Passing `null` or `undefined` explicitly passes that value.
- `fn.length` is the number of required parameters.

**When the error is reported** (as early as possible, like D36)

1. **Compile time** (`SyntaxError`) when the compiler knows the callee:
   - a function declaration in scope, or a `const` bound directly to a function expression or arrow;
   - a method called on `this` (or implicitly, D33), or a static method called on a class declaration, when the whole class chain is visible (§4.5.9);
   - `new C(...)` and `super(...)` when the class (and, for implied constructors, its superclass chain) is visible.
2. **Class-definition time** (`TypeError`) for `this.m(...)`, `super(...)` and `super.m(...)` calls whose target lives in a superclass the compiler cannot see. They are recorded in the template's `memberRefs` with their argument count and checked by `CLASS`.
3. **Link time** (`SyntaxError`, before any module code runs) for calls to imported functions declared with `export function` (§4.7).
4. **Runtime** (`TypeError`, same message) for everything else, e.g. calls through `let` variables, object properties, callbacks and host-provided values. The VM checks `argc` against the callee's parameter counts on every call; this is one comparison.

**Consequences**

- **Function declarations are constant bindings**: assigning to a function declared with `function f` → `SyntaxError`. This is what makes the compile-time and link-time checks reliable.
- **Overrides keep the signature**: an `override` method must have the same number of required and optional parameters (and the same rest-ness) as the method it overrides; otherwise `TypeError` when the class is defined. A call checked against the base method is therefore valid for every override.
- **Interfaces**: interface method signatures have no defaults, so a class method implements `m(a, b)` only with exactly 2 required parameters (rest only if the interface declares rest).
- **Constructors**: a class without a constructor takes no arguments, or for a derived class exactly the arguments of its superclass constructor (the implied `constructor(...args) { super(...args) }` has the superclass constructor's signature).
- **Callbacks from the standard library**: natives such as `map`, `filter`, `forEach`, `reduce`, `find`, `sort` call a script callback with **as many of their arguments as the callback declares** (`(element)`, `(element, index)` or `(element, index, array)`). A callback that requires more parameters than the native provides → `TypeError`.
- **Host → script calls** (§5.8.1): the host may pass *more* arguments than declared (extras are dropped, so script functions work as JS event handlers or `Array.prototype.map` callbacks), but missing required arguments → `TypeError`.
- **Getters** take no arguments and **setters** exactly one, already enforced by the grammar.

#### 4.4.14 Destructuring and named parameters (D40)

```js
function testme({ x = 1, y = 2 } = {}) { return x + y }
testme()                  // 3
testme({ y: 5 })          // 6
// testme({ z: 1 })       // SyntaxError: Unknown named parameter 'z' of testme({x?, y?}?)

const { name, address: { city = '?' }, ...others } = person
let [first, second = 0, ...tail] = list
for (const [key, value] of Object.entries(map)) print(key, value)
[a, b] = [b, a]
({ x, y } = point)        // parentheses: a statement starting with `{` is a block
```

**Where**: patterns are allowed wherever a name is bound or assigned: parameters (functions, arrows, methods, setters), `let`/`const` declarations (a pattern needs an initialiser), `for (let|const <pattern> of …)`, `for (<target> of …)`, `catch (<pattern>)`, and the left side of `=`. In assignments the targets are names, member expressions (`[o.a, o.b] = …`) or nested patterns; in bindings only names and nested patterns.

**Syntax**: object patterns `{ a, b: target, c = default, d: target = default, 'key': target, ...rest }`; array patterns `[target, target = default, ...rest]`. Keys are identifiers (keywords too), strings or numbers; computed keys are not supported. Array patterns have no holes (like array literals); the rest element is a name and comes last. A shorthand `{ a = 1 }` inside an object *literal* is only valid when the literal becomes an assignment pattern.

**Semantics** (as in JavaScript unless noted):

- An object pattern reads each key with the usual property access (so an undeclared member of a class instance is an error, D36; a missing property of a plain object is `undefined`). `...rest` gets a new plain object with the remaining own enumerable public properties.
- An array pattern iterates the value like `for…of` (arrays, strings, host iterables); a missing element is `undefined`; `...rest` gets a new array with the remaining elements.
- A default applies when the value read is `undefined` (a missing property or element). Defaults are evaluated left to right, when needed, and may refer to names bound earlier in the same pattern or parameter list.
- Destructuring `null` or `undefined` → `TypeError` (`Cannot destructure null`).
- Parameters: a pattern parameter without a default is **required** (D38); `{ … } = {}` makes it optional. As with every parameter default, `= {}` applies only when the argument is omitted (passing `undefined` passes `undefined`, which then cannot be destructured).

**Strict named parameters**: an object pattern that is a parameter, or nested inside one, accepts only the keys it names, unless it has a `...rest` element. Unknown keys of a **plain object** argument are an error: at compile time (`SyntaxError`) when the callee is known (D38's rule) and the argument is an object literal (nested literals are checked against nested patterns), otherwise at runtime (`TypeError`), with the message `Unknown named parameter 'z' of testme({x?, y?}?)` (a nested key is named by its path, `'pos.z'`). Class instances, arrays and host objects are not checked (class instances are closed anyway). Patterns in declarations, `for…of`, `catch` and assignments pick properties like JavaScript and never complain about extra keys.

**Signatures**: patterns appear in signatures as `{x, y?}` / `[a, b?]` (`?` marks a default), e.g. `testme({x?, y?}?)`.

#### 4.4.15 `do … while`, `switch`, `void` and `delete` (D41)

```js
do line = next() while (line != null)

switch (command) {
  case 'start':
  case 'run':
    start()
    break
  case 'stop':
    stop()
    break
  default:
    print(`unknown: ${command}`)
}

delete options.verbose      // plain objects only
const ignored = void f()    // undefined
```

**`switch`** works as in JavaScript: the discriminant is evaluated once, then the `case` expressions in source order until one is `==` (strict, D1) to it; execution starts at that clause (or at `default`, wherever it is, when none matches) and falls through the following clauses until `break`. `continue` inside a `switch` belongs to the enclosing loop (without one it is a `SyntaxError`). The clauses share one block scope: a `let` declared in one clause is visible (and in its TDZ) in the others; function declarations are hoisted to the start of the block. More than one `default` is a `SyntaxError`. The completion value (§4.4.10) is reset on entry, like other statements.

**`do … while`** runs the body, then tests; `continue` jumps to the test. The body is a single statement (a declaration needs a block). ASI ends the statement after its `)` even without a newline, as in JS.

**`void x`** evaluates `x` and gives `undefined` (the "missing property" value of JS; D37's `null` rules are not involved).

**`delete o.k` / `delete o[k]`** removes an own property and gives `true` (also when there is no such property). Only **plain objects** (object literals, `Object.create`, `JSON.parse` results, …) and host objects (through the host, `Reflect.deleteProperty`) can lose properties. Everything else keeps its shape, so `delete` is a **`TypeError`**: class instances (D36: their members are declared), arrays (no holes, §4.4.7; use `splice`), functions and classes (D29), interfaces, module namespaces, `globalThis`, frozen objects, primitives, `null` and `undefined` (`Cannot delete property 'x' of a class instance`). The operand must be a member expression: `delete x` (`Delete of an unqualified identifier is not allowed`, as in strict mode), `delete 1`, `delete f()` and `delete super.x` are `SyntaxError`s.

#### 4.4.16 Generators (D42)

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

for (const n of take(naturals(), 3)) print(n)   // 0 1 2

class Tree {
  *walk() {
    yield this.value
    for (const child of this.children) yield* child.walk()
  }
}
```

**Syntax**: `function* name(…) {}` (declaration and expression), `*name(…) {}` methods in classes (also `static *name`) and object literals. Keywords work as generator method names (`static *of()`). Arrows, getters, setters and constructors cannot be generators. `yield` is a keyword (D42): `yield`, `yield expr` and `yield* expr` are expressions with the lowest precedence of an operand (`yield a + b` yields the sum; `(yield a) + b` needs the parentheses); they are allowed only in the body of a generator — not in its parameters, nor in functions or arrows nested in it (`SyntaxError: 'yield' is only valid in generator functions`). A line break after `yield` ends the statement unless the next line continues it (§4.2.1). As in JS, a class field followed by a `*method()` on the next line needs a `;` (`x\n*m() {}` reads as a multiplication).

**Semantics** (as in JavaScript):

- Calling a generator function binds its parameters (strict arity, D38; defaults evaluated at call time) and returns a **generator object** without running the body.
- `next(v)` runs the body until the next `yield`, giving `{ value, done: false }`, or until it returns, giving `{ value: <returned>, done: true }`; `v` becomes the value of the paused `yield` (the first `next`'s argument is ignored). `return(v)` resumes as if the paused `yield` were a `return v`: `finally` blocks run (they may yield again), `catch` blocks do not; the result is `{ value: v, done: true }`. `throw(e)` throws `e` at the paused `yield`. A generator that has not started completes at once on `return` / `throw`. Resuming a running generator (from inside itself) → `TypeError: Generator is already running`. `next`, `return` and `throw` take at most one argument.
- `yield* iterable` yields everything the iterable produces and evaluates to its return value. For a generator, `next(v)`, `throw(e)` and `return(v)` are forwarded to it; other iterables (arrays, strings, host iterables) only advance, `throw` closes them and fails with a `TypeError`, `return` closes them and returns.
- Generator objects are iterable (`for…of`, array patterns, `Array.from`, `yield*`) and are their own iterators: a partly consumed generator continues where it was.
- **Closing**: leaving a `for…of` over a generator before it is done — `break`, `continue` of an outer loop, `return`, or an exception — calls `return()` on it, so its `finally` blocks run (an exception thrown by that cleanup replaces a `break`/`return`, but not an exception already propagating). An array pattern closes the generator after taking its elements.
- **No value is `null` (D37)**: a bare `yield` yields `null`; `next()` without an argument makes the paused `yield` give `null`; falling off the end or a bare `return` completes with `null`, and a finished generator keeps answering `{ value: null, done: true }`. JavaScript uses `undefined` in all these places.
- `typeof g == 'object'`; generator objects have no own properties and print as `[Generator]`; `String(g)` is `[object Generator]`; `delete` on them is a `TypeError` (D41). Generator functions are ordinary functions otherwise (not classes, D25).

**Host interop** (§5.8.1): a script generator reaches the host as a JS iterator (`next`/`return`/`throw`, `Symbol.iterator`); host generators and other host iterables work in `for…of` and `yield*`.

**Not supported**: async generators and `for await` (§4.4.17).

#### 4.4.17 `async` / `await` and Promises (D43)

```js
async function loadAll(ids) {
  const users = await Promise.all(ids.map(id => fetchUser(id)))   // fetchUser: a host function returning a promise
  return users.filter(user => user.active)
}

const delay = value => new Promise(resolve => resolve(value))

class Repository {
  async find(id) {
    try {
      return await this.load(id)
    } catch (e) {
      return null
    } finally {
      this.release()
    }
  }
}

loadAll([1, 2]).then(users => print(users.length))
```

**Syntax**: `async function` (declarations and expressions), `async` arrows (`async x => …`, `async (a, b) => …`), `async` methods in classes (also `static async`) and object literals. `async` and `await` are keywords (D43); `async()` and `{ async: 1 }` still work as names. No line break is allowed after `async`. `await x` is a prefix operator (unary precedence: `await a + await b`) allowed only directly in an async function body — not in its parameters, in nested non-async functions, or at the top level of scripts and modules (`SyntaxError: 'await' is only valid in async functions`; top-level `await` comes with the asynchronous module loader of v2). Async generators (`async function*`, `async *m()`), `for await` and async constructors, getters and setters are `SyntaxError`s.

**Promises** (`Promise` is a built-in **final** class: `instanceof Promise` works, it cannot be extended, instances are closed, D36):

- `new Promise(executor)` calls `executor(resolve, reject)` synchronously (it receives the arguments it declares, §4.6.4); an exception it throws rejects the promise. `resolve` / `reject` work once; a missing argument is `null` (D37).
- `then(onFulfilled?, onRejected?)`, `catch(onRejected)`, `finally(onFinally)` as in JS (non-callable handlers pass the value or reason on; `finally` callbacks get no arguments and keep the original outcome unless they throw or return a rejected promise).
- Statics: `Promise.resolve(v)` (a promise is returned as is), `Promise.reject(r)`, `all`, `allSettled` (`{ status, value }` / `{ status, reason }` objects), `race`, `any` (rejects with an `AggregateError` whose `errors` lists the reasons), `withResolvers()` (`{ promise, resolve, reject }`). The combinators take any iterable (arrays, generators, host iterables); a non-iterable rejects the result with a `TypeError`.
- **Resolution** adopts the state of a PScript promise (one extra job, as JS's thenable job) and fulfills with anything else. **An object with a `then` method is not a thenable** (PScript objects are closed and `then` is not special); host promises and host thenables are converted to PScript promises at the boundary (§5.8.1). Resolving a promise with itself rejects it with a `TypeError`.
- `print(p)` shows `Promise(<pending>)`, `Promise(value)` or `Promise(<rejected> reason)`; `String(p)` is `[object Promise]`.

**Async functions** return a promise. The body runs synchronously until its first `await`; `await v` suspends it until `Promise.resolve(v)` settles and then resumes with the value, or throws the reason at the `await` (so `try`/`catch`/`finally` work). Returning a value resolves the function's promise (adopting a returned promise), an exception rejects it. A body without `return` resolves with `null` (D37). Arrows keep the enclosing `this`.

**Jobs and ordering**: reactions and `await` continuations are jobs (microtasks) queued in the order JavaScript queues them (PerformPromiseThen, reaction jobs, the extra job for adopting a promise, one job for `await` of a settled promise), so the output of a program matches Node's line for line. Jobs run when no script code is on the stack:

- **`run()` / `runModule()` / `importModule()` drain the queue before returning** (for modules: after the whole graph has been evaluated, as in JS), including jobs queued by jobs. Script-only async code therefore finishes inside `run()`; a completion value that is a still-pending promise reaches the host as a JS `Promise` (§5.8.1) to `await`.
- Jobs queued while nothing runs (a host promise settled, a host call into a script function) are drained in a host microtask (`queueMicrotask`).
- `maxSteps` (D14) covers a drain as a whole: an endless async loop ends with the step-limit `RangeError`.
- **Unhandled rejections**: a rejected promise without handlers when a drain ends is an error. After `run()`'s drain it is thrown to the host as the uncaught exception (`PScriptRuntimeError`, like a `throw` at the top level); after a background drain it goes to `stderr` (`InterpreterOptions.stderr`).

#### 4.4.18 Spread (D46)

```js
function sum(a, b, c) { return a + b + c }
const xs = [1, 2, 3]
sum(...xs)                          // 6
Math.max(...xs, 0)                  // natives too
new Point(...coords)                // constructors and super(...args)
const all = [0, ...xs, ...'ab']     // [0, 1, 2, 3, 'a', 'b']
const merged = { ...defaults, ...options, verbose: true }
```

**Where**: in argument lists (calls, method calls, implicit member calls, `new`, `super(...)`), array literals and object literals. The operand is any expression of assignment precedence.

**Semantics** (as in JavaScript):

- Arguments and array elements: the spread value is iterated like `for…of` (arrays, strings, generators, host iterables); a non-iterable is a `TypeError` (`number is not iterable`). Elements are evaluated left to right, each spread fully before the next element.
- Object literals: `{ ...v }` copies the own enumerable public properties of `v`, as `Object.entries` sees them (plain objects, the fields of class instances, the indices of arrays and strings), calling getters; properties defined later replace earlier ones. `null`, `undefined`, numbers and booleans add nothing. The result is a plain object (methods of a class instance are not copied; the object is open).
- **Strict arity (D38)**: a call with a spread argument has its argument count only at runtime, so the compile-time and link-time checks skip it and the runtime check reports it (`TypeError: sum(a, b, c) expects 3 arguments, got 2`). Likewise strict named parameters (D40) are checked at runtime, except for object literals passed before the first spread argument, which are still checked at compile time.
- A spread in an object or array literal that becomes an assignment pattern (`[a, ...rest] = list`) is the pattern's rest element; it must be a name (`SyntaxError: A rest element must be a name`).

#### 4.4.19 Optional chaining (D47)

```js
const port = config?.server?.port ?? 8080
const first = list?.[0]
callbacks.onDone?.(result)          // called only when onDone is not null or undefined
const name = user?.profile.name     // undefined when user is nullish; profile must exist otherwise
```

**Syntax**: `?.` before a property name (keywords too), a computed key `?.[k]` or an argument list `?.(args)`. The chain continues with `.x`, `[k]` and calls; a parenthesized chain ends it (`(a?.b).c` reads `c` of the result). `?.` immediately followed by a digit is the conditional operator and a number (`x?.5:1`).

**Semantics** (as in JavaScript): the expression before each `?.` is evaluated once; if it is `null` or `undefined`, the rest of the chain is not evaluated (no property reads, no calls, no argument evaluation) and the whole chain gives `undefined`. Otherwise the chain continues normally, so a later `.x` on `null` still throws, and an undeclared member of a class instance is still an error (D36). `o.m?.(x)` calls `m` with `this = o`. A chain cannot be assigned to, incremented or deleted (`SyntaxError`), and `new a?.b()` is a syntax error. In a class body, `m?.()` on a bare name that may be an implicit member (§4.5.8) is a `SyntaxError`; write `this.m?.()`.

### 4.5 Classes, access control and interfaces (R12, R24)

#### 4.5.1 Syntax and basic semantics

```js
class Animal {
  private id = 0                 // private field (D30)
  protected sound = '...'        // protected field
  name                           // public field (public is the default), null until assigned (D37)
  public static count = 0        // `public` may be written explicitly

  constructor(name) { this.name = name; Animal.count++ }
  speak() { return this.name + ' says ' + this.sound }
  private secret() { return this.id }           // private method
  protected describe() { return 'animal' }      // protected method
  static create(n) { return new Animal(n) }
}

final class Dog extends Animal implements Pet {          // final: nothing can extend Dog (D28); Pet is an interface (§4.5.7)
  override protected sound = 'woof'                       // redefining an inherited field needs `override`
  constructor(name) { super(name) }
  override protected describe() { return 'dog, ' + super.describe() }
  final info() { return this.describe() }                 // OK: subclass may access protected
  play() { return this.name + ' plays' }                  // implements Pet.play()
}
```

- A class is the **only** kind of constructor (D25). `typeof C === 'function'`, but calling it without `new` → `TypeError: Class constructor C cannot be invoked without 'new'`.
- **Member modifiers** come in a fixed order: `(public | private | protected)? static? final? override? (get | set)? name`. Default access is `public`.
- Fields:
  - **Instance fields** are initialised in declaration order, each with `this` = the instance.
    - In a base class this happens before the constructor body.
    - In a derived class it happens right after `super(...)` returns.
  - **Static fields** are initialised when the class is defined.
- Methods live in the class's internal method table; static methods live on `C`. Neither can be changed after the class is defined (D29, §4.5.6).
- `extends`:
  - The expression must evaluate to a class (script, built-in or host class); otherwise `TypeError: Class extends value f is not a class`. `extends null` is not allowed (D25).
  - Statics are inherited.
- `implements I1, I2, …` (§4.5.7): each expression must evaluate to an interface. The class must provide every member of every listed interface when it is defined.
- Derived constructors:
  - They must call `super(...)` before using `this` → `ReferenceError: Must call super constructor before accessing 'this'`.
  - A missing constructor is implied: `constructor(...args) { super(...args) }`.
- `super.m(...)` calls the superclass's method with the current `this`. In static methods, `super.m()` refers to the superclass's statics.
- Class bodies are always strict, and class names are const inside the body.
- Prototypes are internal. There is no `__proto__` and no `C.prototype` (D29).
- Class instances only have their declared members (D36, §4.5.9). Fields without an initialiser start as `null` (D37).
- **Constructors cannot return values (D27).** `return expr` inside a constructor is a compile-time `SyntaxError: Constructors cannot return a value`; a bare `return` is fine. `new C(...)` therefore always yields a fresh instance of `C`.
- Access modifiers on a constructor are a SyntaxError in v1 (COULD: `private constructor` for factory/singleton patterns).

#### 4.5.2 Access modifiers: `public`, `protected`, `private` (D30, D4)

Access is declared with keywords, as in C# and Java. The JS `#name` syntax does not exist (`#` is a lexer error that points to `private`), and `$` is an ordinary identifier character with no meaning.

Modifiers apply to every kind of class member: fields, methods, getters/setters, and their `static` forms. The **home class** of a piece of code is the class whose body lexically contains it (method, accessor, field initialiser). Arrow functions and nested function expressions inherit the home class lexically, so `this.items.map(x => this.format(x))` can reach a private `format`. Code may also use the private and protected members of **lexically enclosing** classes (nested classes, as in Java). Top-level code, plain functions and the host have no home class.

| Modifier | Who may access it | Inherited? | Can be overridden? |
|---|---|---|---|
| `public` (default) | everyone | yes | yes, with `override` (D28) |
| `protected` | code whose home class is on the **same inheritance line** as the declaring class `D`: `D` itself, any subclass of `D`, or any superclass of `D` (so a base-class template method can call a hook that only a subclass declares). Unrelated classes and code outside any class are denied (D4) | yes | yes, with `override`; the override must stay `protected` |
| `private` | code whose home class is the declaring class (or a class lexically nested in it) | no | no: a subclass may declare its own member with the same name, which is a **different** member |

- Private is **per class, not per instance**: a method of `C` may read the private members of any instance of `C` (as in Java, C# and JS `#x`).
- **Overrides keep access**: an `override` must have the same access as the member it overrides (C# rule). Widening `protected` to `public` or narrowing `public` to `protected` → `TypeError` at class definition.
- **Private names don't collide**: a subclass may declare a member (of any access) with the same name as a superclass's private member. It is a new, unrelated member, and no `override` is involved (§4.5.3 shows how each is resolved).
- **Accessor halves may differ in access** (C# style): `get total()` public and `protected set total(v)`. Reads check the getter's access, writes check the setter's.
- **Violations** throw **`AccessError`** (a subclass of `TypeError`), at runtime, when the access happens:
  - `Cannot access private member 'x' of class 'Account'`;
  - `Cannot access protected member 'x' of class 'Animal' from outside its class hierarchy`.
- **What is checked**: reads, writes, calls, compound assignments and updates, `super.x`, computed access (`o['x']` follows exactly the same rules as `o.x`), and `in`.
- **Hidden from reflection**: `Object.keys`, `Object.values`, `Object.entries`, `JSON.stringify`, `print` and host proxies only ever show **public** members, whoever calls them. `k in o` is `true` only for members the caller can access.
- **Static check where possible**: the compiler knows the private member names of all lexically enclosing classes, which lets it emit a fast path (§5.4: `GET_PROP_PRIV`). Everything else is checked at runtime, because the receiver's class is not known statically.

#### 4.5.3 Member resolution

Because `this.x` can refer to a private member of the current class *or* to an unrelated public `x` declared by a subclass, member access is resolved with the caller's home class. For `o.x` (or `o['x']`) evaluated in code with home class `H` and lexically enclosing classes `H1, H2, …`:

1. **Private first.** For `E` in `H, H1, H2, …` (innermost first): if `E` declares a private member `x` (instance or static, matching the receiver) and `o` is an instance of `E` (or `o` is `E` itself, for statics), the access targets `E`'s private member. Done.
2. **Class members.** Look `x` up in the member index of `o`'s class (§5.6.7). If it is found:
   - `public` → allowed;
   - `protected` → allowed iff `H` (or an enclosing class) is on the same inheritance line as the declaring class, else `AccessError`;
   - then read the field (own data property of the instance), call the getter, or return the method.
3. **Own properties of non-class objects.** Data and accessor properties of object literals and other plain objects. (Class instances have no properties beyond their declared members, D36.)
4. **Hidden private member.** If some class in `o`'s chain declares a private `x` that step 1 did not select → `AccessError` (a clearer error than silently returning `undefined`). Writes to such a name never create a public property.
5. Otherwise the member does not exist. For class instances and classes this is an error (D36, §4.5.9), reported at compile time or class-definition time when possible, else now: `TypeError: Point has no member 'z'`. For object literals and other plain objects, reads give `undefined` and writes create the property (D37).

Example of why step 1 matters:

```js
class Base {
  private x = 'base private'
  show() { return this.x }          // always Base's private x
}
class Derived extends Base {
  x = 'derived public'               // a new public member, no `override` (Base.x is private)
}
const d = new Derived()
print(d.show(), d.x)                 // base private derived public
```

#### 4.5.4 Getters and setters (R17)

```js
class Temperature {
  private celsius = 0
  private static instances = 0
  get fahrenheit() { return this.celsius * 9 / 5 + 32 }
  set fahrenheit(f) { this.celsius = (f - 32) * 5 / 9 }
  private get raw() { return this.celsius }          // private accessor
  protected get unit() { return 'C' }                // protected accessor
  get kelvin() { return this.celsius + 273.15 }
  protected set kelvin(k) { this.celsius = k - 273.15 }  // halves with different access
  static get count() { return Temperature.instances }       // static getter reading a private static field
}
```

Semantics follow JS, plus the access rules above:

- An accessor defines an **accessor member** of the class (or of `C` for `static`). A `get` and a `set` with the same name and the same `static`-ness combine into one member. A name may be declared only once per class and static-ness, except for that get/set pair.
- **Read** `o.x`: if resolution (§4.5.3) finds an accessor, call its getter with `this = o` (the original receiver, also through `super.x`). An accessor with no getter reads as `undefined`.
- **Write** `o.x = v`: if resolution finds an accessor, call its setter with `this = o`; the expression value is `v`. An accessor with no setter → `TypeError: Cannot set property x of Temperature which has only a getter`.
- Compound assignment and update (`o.x += 1`, `o.x++`) call the getter once, then the setter once.
- Accessors are **not own properties of instances**, so they do not appear in `Object.keys(instance)`, `JSON.stringify(instance)` or `print(instance)` (as in JS). `k in o` is `true` for an accessible accessor.
- Getters and setters run as ordinary VM frames (via re-entrant `callFunction`), so exceptions, step limits and stack traces work inside them.

#### 4.5.5 Construction and `instanceof` (D25, D26, D32)

This is a deliberate break from JavaScript, chosen because "any function can be a constructor" makes code hard to reason about.

**What can be constructed.** Exactly three kinds of values are classes:

| Kind | Examples | Notes |
|---|---|---|
| script classes | `class A {}`, `class B extends A {}`, class expressions | the normal case |
| built-in classes | `Error`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `AccessError` | implemented natively, extendable (`class MyErr extends Error {}`) |
| host classes | host functions marked as classes when they enter the script (§5.8.1) | e.g. a host `Date`, `Map` or an ES class supplied through `globals` |

Everything else is not constructable, with `TypeError: X is not a class`:

- function declarations, function expressions, arrows, methods, getters/setters;
- interfaces (`TypeError: Shape is an interface`);
- stdlib functions, including the conversion functions `String`, `Number`, `Boolean` (callable only: `String(5)`), and `Object`, `Array`, `Math`, `JSON` (namespaces of static functions, not classes);
- host functions that are not host classes.

**Brand, not prototype.** Each instance records the class it was constructed from (its `klass`, the `newTarget` of the `new` expression). Prototypes are internal and scripts cannot change them, so walking `klass → superClass` is equivalent to walking prototypes, but cheaper and impossible to spoof.

**`a instanceof T`**:

1. If `T` is neither a class nor an interface → `TypeError: Right-hand side of 'instanceof' is not a class or interface`.
2. If `T` is a script or built-in class: `true` iff `a` is an object with a `klass`, and `T` is `a.klass` or one of its superclasses. Otherwise `false`.
3. If `T` is an **interface** (D32): `true` iff `a` is an object with a `klass`, and `a.klass` or one of its superclasses declares `implements` of `T` or of an interface that extends `T` (nominal check, precomputed per class, O(1)). Object literals, arrays, functions, primitives and host objects are never instances of an interface.
4. If `T` is a host class: `true` iff `a` is a host object and the host's own `target instanceof T.target` is `true`. Script objects are never instances of host classes, and host objects are never instances of script classes.
   - Exception: a script class that `extends` a host class produces script instances whose `klass` chain includes the host class, so `instanceof` is `true` for both.

Consequences, all covered by `@pscript-only` tests:

| Expression | Result |
|---|---|
| `new (function () {})()` | `TypeError: anonymous function is not a class` |
| `new (() => 1)()` | `TypeError` |
| `new Shape()` (an interface) | `TypeError: Shape is an interface` |
| `new String('a')`, `new Number(1)`, `new Array(3)`, `new Object()` | `TypeError` (use literals, `Array.from`, conversion calls) |
| `[] instanceof Array`, `({}) instanceof Object` | `TypeError` (`Array` and `Object` are not classes) |
| `5 instanceof Error`, `({}) instanceof Error` | `false` |
| `new Dog() instanceof Animal` (Dog extends Animal) | `true` |
| `new Dog() instanceof Pet` (Dog implements Pet) | `true` |
| `({ play() {} }) instanceof Pet` | `false` (nominal: only classes that declare `implements`) |
| `e instanceof TypeError` for a runtime error caught by `catch` | `true` (runtime errors are instances of the built-in classes) |
| `f instanceof Function` | `TypeError` (`Function` is not exposed as a class) |

#### 4.5.6 Overriding, `final` and sealed classes (D28, D29)

**Virtual by default, explicit to override.** Every inherited public or protected method, accessor and field can be redefined in a subclass, but the redefinition must say `override`:

```js
class Shape {
  area() { return 0 }
  final describe() { return 'shape with area ' + this.area() }   // template method, sealed
  protected hook() {}                                             // protected hook
  override toString() { return '[Shape]' }    // Object.prototype.toString is inherited, so `override` is required
}

class Circle extends Shape {
  r = 1
  override area() { return Math.PI * this.r ** 2 }    // OK
  override protected hook() { print('circle hook') }   // OK: access stays protected
  // area2() {}                  fine: new member
  // describe() {}               TypeError: Cannot override final method 'describe' of class 'Shape'
  // override volume() {}        TypeError: 'volume' does not override anything in 'Shape'
  // area() {}                   TypeError: 'area' overrides 'Shape.area' and must be marked 'override'
  // override hook() {}          TypeError: cannot change access of 'hook' from protected to public
}

final class Square extends Shape { override area() { return 1 } }
// class Cube extends Square {}   TypeError: Cannot extend final class 'Square'
```

**Rules**

- **Which members participate**: public and protected members, instance and static (checked separately: instance members against the superclass's instance chain, static members against its static chain). Private members never participate: they are not inherited, so `override`/`final` on a private member is a SyntaxError, and a subclass may freely reuse the name.
- **Inherited means anywhere up the chain**, including `Object.prototype` methods (`toString`, `hasOwnProperty`), built-in classes (`Error`'s `name`, `message`, `toString`), and host superclasses (a member exists if `name in HostClass.prototype` or, for statics, `name in HostClass`). So `class MyErr extends Error { override name = 'MyErr' }`.
- **`override` is required** when a member's name matches an inherited public/protected member; **`override` is forbidden** when nothing is inherited under that name. Implementing an **interface** member is not an override (§4.5.7).
- **Kinds must match**: a method overrides a method, an accessor overrides an accessor, a field overrides a field. Anything else (`override x = 1` over a method `x()`) → `TypeError: Cannot override method 'x' with a field`.
- **Access must match** (§4.5.2).
- **Signatures must match** (D38): same number of required and optional parameters, same rest-ness.
- **Accessor halves are inherited separately.** If a subclass overrides only `get x`, the superclass's `set x` stays in effect (and vice versa). This fixes a JS pitfall where overriding only the getter silently makes the property read-only. Both halves need `override` when they redefine an inherited half.
- **`final` on a member**: no subclass at any depth may redefine that name (any kind, instance or static according to where the final member lives). `final override m()` both overrides and seals. `final` on a field means "cannot be redeclared by subclasses", **not** "read-only".
- **`final` on a class**: `extends` of it → `TypeError: Cannot extend final class 'X'`. Built-in error classes are not final; host classes are never final.
- **`constructor`** is not an inherited member: no `override`/`final` on it.
- **When checked**: when the `class` declaration or expression is evaluated (the `CLASS` instruction), because `extends` and `implements` take arbitrary expressions. The error is a `TypeError` with the class name and the member's source location. Checks run once per class definition, never per call. COULD: the compiler reports the same errors at compile time when the superclass is declared in the same file.

**Sealed classes (D29)**

- Classes have **no script-visible `prototype` property**. `C.prototype` is an undeclared member (D36) → error.
- A class object is **non-extensible**: `C.newStatic = 1` → `TypeError`. Existing static *fields* stay writable (`Account.count++` works). Static methods and accessors cannot be reassigned.
- **Instances cannot shadow class methods or accessors.** Assigning to a name that resolves to a method on the instance's class chain → `TypeError: Cannot assign to method 'speak' of class 'Animal'`. Assigning to an accessor name calls the setter as usual (or `TypeError` if there is none). Instances never get properties beyond their declared members (D36); declared fields stay writable.
- Together with D25–D27 this makes the shape of a class fixed for its lifetime, which is what enables the flattened method table (§5.6.7).

#### 4.5.7 Interfaces (D31, D32)

Interfaces describe a set of **public** members a class promises to provide. They contain declarations only, no implementation, in the spirit of Java and C#.

```js
interface Named {
  get name()                 // must be readable (a getter or a public field)
}

interface Comparable {
  compareTo(other)           // a method taking one argument
}

interface Shape extends Named, Comparable {
  area()
  color                      // a property: readable and writable (a public field, or a get+set pair)
  set label(v)               // must be writable (a setter or a public field)
}

class Circle implements Shape {
  color = 'red'
  r
  text
  constructor(r) { this.r = r }
  get name() { return 'circle' }
  set label(v) { this.text = v }
  area() { return Math.PI * this.r ** 2 }
  compareTo(other) { return this.area() - other.area() }
}

const c = new Circle(2)
print(c instanceof Shape, c instanceof Comparable)   // true true
// class Bad implements Shape { area() {} }          // TypeError: Class 'Bad' does not implement Shape: name (getter), color, label (setter), compareTo(other)
```

**Declarations**

- `interface Name ( extends I1, I2, … )? { members }`. Allowed at statement level, exportable (`export interface Shape { … }`) and importable like any binding. Interface declarations behave like `let` (TDZ, not hoisted). No interface expressions in v1.
- Member forms (one per line or separated by `;`, with the usual ASI):
  - `name(params)`: a method. Params are plain names, optionally with a final `...rest`. No defaults, no body.
  - `get name()` / `set name(v)`: a readable / writable requirement.
  - `name`: a property, meaning both readable and writable.
- All interface members are implicitly public. Access modifiers, `static`, `final`, `override`, bodies, initialisers and duplicate names → SyntaxError.
- `extends` lists interfaces (evaluated when the declaration runs; each must be an interface, otherwise `TypeError`). Members are merged. The same name inherited from two parents must have the same form (method with the same parameter count, or compatible accessor/property requirements, which are merged); otherwise `TypeError` at definition.
- An interface is a runtime value: `typeof Shape === 'object'`, `print(Shape)` shows `[interface Shape]`. It is frozen, not callable and not constructable.

**Implementing**

- `class C extends B implements I1, I2 { … }`. Each expression must evaluate to an interface. When the class is defined, every member of each interface (including inherited interface members) must be provided by a **public** member of `C` (own or inherited from a superclass):

| Interface member | Satisfied by |
|---|---|
| `m(a, b)` | a public method `m` with exactly 2 parameters, both required (D38); a rest parameter only if the interface declares one |
| `get x()` | a public getter `x` or a public field `x` |
| `set x(v)` | a public setter `x` or a public field `x` |
| `x` | a public field `x`, or a public getter **and** setter `x` |

- Fields count by declaration (the class template lists them), not by runtime presence.
- Missing or mismatched members → one `TypeError` at class definition listing all of them.
- Implementing an interface member does **not** need `override`. (If the member also overrides a superclass member, `override` is required as usual.)
- A subclass inherits its superclass's interfaces: `class D extends C {}` is an instance of everything `C` implements.
- Host classes cannot implement interfaces. Script classes extending host classes can, and host-inherited public members count.
- **No abstract classes in v1**: a class that declares `implements` must implement everything. COULD: `abstract class` with `abstract` members (the word is already reserved).

**Checking at runtime (D32).** `instanceof` is extended to interfaces (nominal, §4.5.5). Every class stores the transitive set of interfaces it implements, so the check is O(1). COULD (structural check): a separate operator `x implements I` that returns `true` for *any* value that currently has all the members of `I` (object literals and host objects included), without needing an `implements` clause. It is listed as COULD because it introduces a second, weaker notion of "implements"; `implements` is already a reserved word, so adding it later does not break programs.

**Differential testing.** Access modifiers, `override` and `final` are not JS, so the differential harness strips them before running a program in Node. Stripping keeps behaviour identical except for access violations and private-name clashes, which are tested in `@pscript-only` programs. Programs that declare or use interfaces are `@pscript-only`.

#### 4.5.8 Implicit member access (D33)

Inside a class body, members can be used **without `this.`**, as in Java. The class must not leave any doubt about what a bare name means.

```js
import { format } from './text'
const VERSION = 2

class Invoice {
  private items = []
  total = 0                                        // field
  get count() { return items.length }              // implicit private field
  add(item) {
    items.push(item)                               // implicit field read
    total += item.price                            // implicit field write (this.total += …)
    recalc()                                       // implicit method call, `this` bound
    return count                                   // implicit accessor read
  }
  protected recalc() { print('v' + VERSION) }      // VERSION and print are not members: outer/global
  label() { return format(total) }                 // `format` is an import, not a member: fine
  static create() { return new Invoice() }
}
```

**Resolution order for a bare name `x`** used anywhere in a class body (methods, accessors, constructor, field initialisers, and closures inside them):

1. **Local bindings** of the code itself: parameters and `let`/`const`/function declarations of the method and of closures inside it. These may shadow members, as in Java; `constructor(name) { this.name = name }` is the idiom.
2. **Class members** of the home class: own and inherited fields, accessors and methods, `public`, `protected`, and `private` members of the home class itself (superclasses' private members are not candidates). In a static context, static members.
3. **Outside definitions**: bindings in the scopes around the class (enclosing functions, module or script top level: `let`, `const`, functions, classes, interfaces, imports), then globals (stdlib and host).

**The strict rule.** If `x` is used as a bare name in the class body and step 2 finds a member `x` **and** step 3 would also find an outside definition `x`, the class is rejected. This applies to **every kind of member** (field, accessor, method; instance or static; any access level, own or inherited) and **every kind of outside definition** (variables, functions, classes, interfaces, imports, script-level bindings, globals).

- Own members vs. outside *lexical* bindings and stdlib globals → compile-time `SyntaxError` (both are known statically).
- Inherited members, and members vs. host globals → `TypeError` when the class is defined (the `CLASS` instruction), because the superclass and host globals are only known then.
- Message: `Ambiguous name 'format' in class 'Invoice': it is both a member (inherited from 'Document') and an imported binding. Write 'this.format' for the member, or rename/alias the outer binding.`
- Only names actually **used bare** count. Declaring a member called `print` is fine as long as the class's code calls it as `this.print(...)`, and a bare `print(...)` in a class without a `print` member is fine too.

**Disambiguating**

- Member: write `this.x` (or `ClassName.x` for statics). Explicit `this.x` is always allowed and always means the member.
- Outer variable or import: rename it, or import it under an alias (`import { format as fmt }`).
- Global: use the new read-only stdlib namespace **`globalThis`** (`globalThis.print(...)`), which exposes every global by name.

**Other rules**

- **Calls bind `this`**: `recalc()` is `this.recalc()`. Virtual dispatch is preserved: whether `x` is a member is decided against the home class, but the actual lookup uses the receiver's class, so overrides win.
- **Writes**: `total = 0` assigns the member (through its setter for accessors; `TypeError` for methods, D29). Compound assignment and `++`/`--` work as with `this.total`.
- **Static context**: in static methods, static accessors and static field initialisers, only static members are candidates. A bare name that only matches an *instance* member → `TypeError: Cannot access instance member 'x' from a static context` (the strict rule still applies if an outside definition also matches).
- **Closures**: an implicit member reference uses the `this` of the enclosing method/constructor/accessor/field initialiser, even inside a nested `function` expression (Java semantics). Explicit `this` inside a nested `function` keeps its own dynamic value.
- **Derived constructors**: implicit member access before `super()` → `ReferenceError: Must call super constructor before accessing 'this'`.
- **Field initialisers** may refer to earlier fields: `b = a + 1`.
- **Nested classes** only see their own class's members implicitly (there is no outer instance, unlike Java inner classes). Members of an enclosing class are not candidates.
- **Late globals**: the decision for each bare name is made once, when the class is defined. A host global added later with a member's name does not change anything (the member keeps winning, no error).
- **`typeof x`** on a bare name follows the same resolution.
- **Object literals** are unaffected: methods in object literals still need `this.`.

**Testing.** Implicit access is not JS, so programs that use it are `@pscript-only`. The general class corpus keeps using explicit `this.` so it stays differential; implicit access has its own `implicit-members/` directory.

#### 4.5.9 Closed class instances and undeclared members (D36)

Class instances and classes are **not bags of properties**. They have exactly the members their class chain declares (fields, accessors, methods; statics for the class object), nothing more. Reading, writing or calling anything else is an error, and it is reported **as early as possible**.

```js
class Point {
  x = 0
  y = 0
  move(dx) {
    this.x += dx
    // this.z = 1        // SyntaxError (compile time): Class 'Point' has no member 'z'
  }
}
const p = new Point()
// p.color = 'red'      // TypeError (runtime): Point has no member 'color'
// print(p.z)           // TypeError (runtime): Point has no member 'z'
print('z' in p)         // → false   (`in` and reflection never throw)

const bag = { x: 1 }
bag.color = 'red'       // object literals stay open (D37)
print(bag.size)         // → undefined
```

**When the error is reported**

1. **Compile time** (`SyntaxError`) when the compiler can prove the member does not exist:
   - the receiver is `this` in an instance context of a class body (methods, accessors, constructor, field initialisers, and arrows inside them), or a bare name that resolves to a class declaration (`Point.z`, statics); and
   - the whole class chain is visible to the compiler: no superclass, or every superclass is a class declared in the same file and named directly in `extends`.
2. **Class-definition time** (`TypeError`, in the `CLASS` instruction, before any instance exists) for the same receivers when the chain includes a superclass the compiler cannot see (imported, host class, or an `extends` expression). The compiler records these unproven `this.x` / static references in the class template (`memberRefs`), and `CLASS` checks them against the complete member index (§5.6.7). This is the same moment as the D28 and D33 checks.
3. **Runtime** (`TypeError`) for every other receiver (`other.x`, `list[0].x`, computed `o[k]`, `this` inside a nested plain `function`), at the moment of access.

**Rules**

- Applies to reads, writes, compound assignments, updates and calls, for instance and static members, regardless of access level.
- Fields must be declared to exist. A field without initialiser holds `null` until assigned (D37). Constructor assignments such as `this.r = r` therefore need a declared field `r`.
- `k in obj`, `Object.keys`, `JSON.stringify` and `print` never throw for missing members.
- **Host side** (§5.8.1): reading an undeclared member through a class-instance proxy returns `undefined` (JS conventions, e.g. `JSON.stringify` probing `toJSON`); writing one throws `TypeError`.
- Built-in classes declare their members (`Error`: `name`, `message`, `stack`, `cause`).
- This replaces D29's earlier allowance of "new own data properties on instances": class instances never gain properties.

### 4.6 Standard library (SHOULD)

The stdlib is implemented as native functions registered as read-only globals. All methods follow JS semantics unless noted.

#### 4.6.1 Globals

- Output and printing:
  - `print(...args)`: writes `args.map(format).join(' ')` plus a newline to the `stdout` callback.
  - `console.log` is an alias of `print`; `console.error` writes to `stderr`.
- Conversion and number helpers: `String(v)`, `Number(v)`, `Boolean(v)`, `parseInt(s, radix?)`, `parseFloat(s)`, `isNaN(v)`, `isFinite(v)`.
- Number constants:
  - `NaN`, `Infinity` (read-only globals);
  - `Number.MAX_SAFE_INTEGER`, `Number.MIN_SAFE_INTEGER`, `Number.EPSILON`;
  - `Number.isInteger`;
  - number methods: `toFixed(digits)`, `toString(radix?)`.
- `Math`: `PI E abs floor ceil round trunc sign min max pow sqrt cbrt exp log log2 log10 sin cos tan atan atan2 random hypot`.
  - `Math.random` is injectable via options so tests are deterministic.
- `Object`:
  - `keys`, `values`, `entries`, `assign`, `freeze` (COULD).
  - `Object.prototype`: `hasOwnProperty`, `toString` (`ClassName(field = value, …)` for class instances, D35; `[object Object]` otherwise).
  - `toString` on the other built-in prototypes: arrays (`join(',')`), functions and classes (`[Function: name]`, `[class Name]`), errors (`Name: message`). See `ToString` in §4.4.3.
- `Array.isArray`.
- `globalThis`: read-only namespace object exposing every global by name (stdlib and host), used to name a global explicitly inside classes (D33). It reflects host globals added later. Assigning through it → `TypeError`.
- `JSON.stringify(value, null?, indent?)` (SHOULD; required by the differential tests). `JSON.parse` (COULD).
- `Promise` (D43, §4.4.17): a final built-in class.
- `setTimeout(callback, delay?, ...args)`, `clearTimeout(id)` and `fetch(resource, options?)` (D44): the host's timers and fetch with the JavaScript interface (`src/stdlib/host.ts`). A missing, `null` or `NaN` delay is 0; the callback receives the extra arguments it declares (§4.6.4); unknown ids are ignored by `clearTimeout`. `setInterval(callback, delay?, ...args)`, `clearInterval(id)` and `queueMicrotask(callback)` (D45) complete the set; timer ids are shared by both kinds. `fetch` arguments and results cross the boundary like any host call (§5.8.1); `InterpreterOptions.fetch` replaces the host's fetch.
- Errors (D3): `Error`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `AccessError`, `AggregateError` (D43: `new AggregateError(errors, message)`, with `errors`). These and `Promise` are the stdlib's only classes (D25): constructable, extendable (`class MyErr extends Error {}`), with `name`, `message` and `stack`. Calling them without `new` → `TypeError` (unlike JS).
- `String`, `Number` and `Boolean` are plain conversion functions; `Object`, `Array`, `Math` and `JSON` are namespaces of static functions. None of them is a class (§4.5.5).

#### 4.6.2 `print` formatting (D18)

| Value | Output |
|---|---|
| string at top level | raw text |
| number, boolean, null, undefined | `String(v)` (`-0` → `0`) |
| string nested in an array or object | double-quoted with JSON-style escapes: `"a"`, `"say \"hi\""` |
| array | `[1, 2, "x"]` (`[]` if empty) |
| object | `{a: 1, b: "x", "full name": "Ann"}` (`{}` if empty; keys unquoted when they are identifiers) |
| class instance | its `toString()`, so the default form `ClassName(a = 1, b = "x")` (D35) or the class's override |
| function | `[Function: name]` / `[Function (anonymous)]`; classes `[class Name]`, `[class Name extends Base]` |
| own accessor property | `[Getter]`, `[Setter]`, `[Getter/Setter]` (the getter is not called) |
| module namespace | `[Module] {a: 1}` |
| host proxy (§5.8.1) | formatted like the equivalent script value (array, object, function); host class instances as `[Host Date]` |
| cycles | `[Circular]` |
| depth > 2 | `[Object]` / `[Array]` |

Nested values use exactly the same format as the default class `toString()` (§4.4.11), so arrays, objects and class instances look the same wherever they appear.

#### 4.6.3 Strings (prototype methods)

`length`, index access `s[i]`, `charAt`, `charCodeAt`, `at`, `indexOf`, `lastIndexOf`, `includes`, `startsWith`, `endsWith`, `slice`, `substring`, `toUpperCase`, `toLowerCase`, `trim`, `trimStart`, `trimEnd`, `padStart`, `padEnd`, `repeat`, `split(sep: string, limit?)`, `replace(str, str)` / `replaceAll(str, str)` (string patterns only), `concat`, `toString`.

Strings are immutable; writing an index is silently ignored, as in non-strict JS. Alternatively, raise `TypeError` (strict-mode behaviour) — **pick TypeError**.

#### 4.6.4 Arrays (prototype methods)

- Mutating and accessor methods: `push`, `pop`, `shift`, `unshift`, `slice`, `splice`, `concat`, `join`, `reverse`, `indexOf`, `lastIndexOf`, `includes`, `at`, `fill`, `flat` (depth 1).
- Callback methods: `sort(compareFn?)`, `forEach`, `map`, `filter`, `reduce`, `reduceRight`, `find`, `findIndex`, `findLast`, `some`, `every`, `flatMap`.
- Statics: `Array.from(iterable | {length})`, `Array.of`.
- Methods that return nothing in JS return `null`; "not found" results (`find`, `findLast`, `pop`/`shift` on an empty array, `at` out of range) are `null` (D37).
- Callback-taking methods call script closures through the VM's re-entrant `callFunction` (§5.6.4). The callback receives as many of `(element, index, array)` as it declares (D38).
- `sort()` without a comparator sorts by `ToString` (JS semantics); it must be stable.

#### 4.6.5 Functions

- `fn.name`, `fn.length`.
- `bind(thisArg, ...args)`: SHOULD.
- `call` and `apply`: COULD.

### 4.7 Modules (R16)

#### 4.7.1 Syntax (named exports only)

```js
// math.pscript
export const PI = 3.14159
export function area(r) { return PI * r * r }
export class Vector { x; y; constructor(x, y) { this.x = x; this.y = y } }
let counter = 0
export function next() { return ++counter }
export { counter, counter as count }           // export list, with renaming
export { area as circleArea } from './geometry' // re-export (D23)

// main.pscript
import { PI, area as circleArea, Vector, counter, next } from './math'
import * as math from './math'                  // namespace import (D22)
import './polyfills'                            // side-effect only import
next()
print(counter, math.counter)                    // 1 1 — live bindings
```

Not supported (SyntaxError with a message naming the alternative): `export default`, `import x from`, `import x, { … } from`, `import x, * as ns from`, `export * from`, `export * as ns from`, `import()` (v2), `import.meta`, string export names (`export { a as 'b c' }`).

#### 4.7.2 Semantics (ES-module semantics restricted to named exports)

- **Module goal**: module code is always strict, has its own top-level scope (top-level declarations are **not** globals and are invisible to other modules unless exported), and `this` at top level is `null` (D24). Globals (stdlib and host) remain visible.
- **Hoisting**: import declarations are hoisted. All of a module's dependencies are loaded, linked and evaluated before the module's own body runs. Function declarations are hoisted and initialised at instantiation, so they can be called by a cyclic importer before the module body runs, as in JS.
- **Live bindings**: an import is a read-only **view of the exporter's binding**, not a copy. If the exporter later reassigns an exported `let`, importers see the new value. Assigning to an import → compile-time SyntaxError (`Assignment to constant variable` style message: `Cannot assign to import 'x'`).
- **Export forms**: `export let/const/function/class …` exports the declared names. `export { a, b as c }` exports existing top-level bindings of the module (local names must be declared somewhere in the module, before or after the export statement). `export { a as b } from 'm'` re-exports `a` from `m` as `b` without creating a local binding.
- **Export names** must be unique per module (SyntaxError). Import local names must be unique and must not clash with the module's other top-level declarations (SyntaxError).
- **Resolution errors**: importing a name the target module does not export → `SyntaxError: Module './math' does not provide an export named 'x'`, raised at link time, before any code of the graph runs.
- **Singletons**: each module, identified by the **resolved id** returned by the loader, is instantiated and evaluated **at most once** per `Interpreter`. Later imports reuse the same instance.
- **Evaluation order**: depth-first, post-order over import declarations in source order (as in JS). Side-effect-only imports participate in ordering.
- **Cycles**: supported, as in JS. A module that is still evaluating is not re-entered. Reading one of its `let`/`const`/`class` bindings before it was initialised throws the usual TDZ `ReferenceError`; hoisted functions are already available.
- **Errors**: if a module throws during evaluation, it is marked *errored*, the error propagates to the importer, and every later import of that module rethrows the same error.
- **Re-export cycles** (`a` re-exports from `b` which re-exports from `a`) that never reach a real binding → SyntaxError at link time (`circular re-export of 'x'`).
- **Namespace imports** (D22): `import * as ns from 'm'` binds `ns` (read-only) to the **module namespace object** of `m`. As in JS:
  - it has a `null` prototype and exactly one property per export name, listed in **sorted** order by `Object.keys`;
  - each property is a **live** view of the export (reads go through the binding cell, including the TDZ check);
  - it is frozen: assigning, adding or deleting properties → `TypeError`;
  - there is one namespace object per module record, so two namespace imports of the same module are `==`;
  - `typeof ns` is `'object'`; `print(ns)` shows `[Module] {a: 1, b: [Function: b]}`.
  - A namespace of a module that is still evaluating (cycle) is available; reading a not-yet-initialised export throws the TDZ `ReferenceError`.

#### 4.7.3 Loading and host integration (D19)

- The interpreter does not read files. It asks the host's **module loader**:

  ```ts
  type ModuleLoader = (specifier: string, referrer: string | null) =>
    | { id: string, source: string }            // a PScript module
    | { id: string, compiled: CompiledModule }  // a PScript module compiled with compileModule() (psc, T4)
    | { id: string, exports: Record<string, unknown> }   // a host ("native") module
  ```

  `referrer` is the importing module's `id` (`null` for the entry module). The loader resolves the specifier (relative paths, extensions, aliases …) and returns the canonical `id`. Not found → the loader throws; the interpreter wraps it as `PScriptRuntimeError` (`Cannot find module './x' imported from 'main'`).
  - v1 calls the loader synchronously. All calls go through one internal function (`fetchModule`) so that v2 can accept a `Promise`-returning loader (§1.7).
- **Built-in default loader** (used when `options.modules` is given instead of `moduleLoader`): an in-memory map `{ [id]: source | exportsObject }`.
  - Relative specifiers (`./`, `../`) are resolved against the referrer's id using POSIX-style path normalisation. Bare specifiers are looked up as-is.
  - **Extensions (D10)**: try the exact id first, then `id + '.pscript'`, then `id + '.psc'`. If both extension variants exist → loader error (`ambiguous module './x': x.pscript and x.psc`).
- **Host modules** (`{ exports }`, or `interpreter.defineModule(id, exports)`): this is the recommended way to expose host APIs (`import { readFile } from 'host:fs'`).
  - The export *names* are fixed when the module is loaded (the own enumerable keys of `exports` at that moment).
  - The export *values* are **live** (D9): each binding reads `exports[name]` through the interop layer on every access, so a host that reassigns `exports.count` is seen by scripts. Host-module bindings are read-only for scripts.
- A Node-only file-system loader (`createFsLoader(rootDir)`) is **not** part of the browser-safe library; it can live in the CLI (H5).

---

## 5. Architecture

### 5.1 Pipeline

```
source ──► Jison lexer ──► TokenFilter ──► Jison LALR parser ──(yy.ast builders)──► AST
                     (NEWLINE, ASI,         (pscript.jison)                    │
                      braces, arrows)                                          ▼
                                                    Compiler (scopes, static checks, codegen)
                                                                               │
                                                     CompiledScript { main: FunctionProto, … }
                                                                               ▼
                         VM (operand stack, call frames, environments, handlers) ◄── Runtime (values,
                                                                               │       operators, objects,
                                                                               ▼       classes, access)
                                                                       completion value / output
                                                                         ▲
                                                                   Stdlib (natives)
```

Module code adds a **module linker** between the compiler and the VM:

```
importModule(specifier) ──► ModuleLoader (host) ──► parse(goal: module) ──► compile ──► ModuleRecord
                                     ▲                                                      │
                                     └──────── for each import/re-export, recursively ◄────┘
                           link (resolve export names → binding cells) ──► evaluate (DFS post-order, VM)
```

### 5.2 Source layout and ownership

```
pscript/
├─ package.json, tsconfig.json, vite.config.ts, eslint.config.js, vitest.setup.js, .gitignore, README.md
├─ build/
│  └─ vite-plugin-jison.ts            P0
├─ docs/
│  ├─ PLAN.md                         (this document)
│  └─ LANGUAGE.md                     Phase 3: user-facing language reference
├─ src/
│  ├─ index.ts                        P0 (exports), Integration (wiring)
│  ├─ grammar/
│  │  ├─ pscript.jison                WP-A  (%lex rules + grammar)
│  │  └─ jison.d.ts                   P0
│  ├─ parser/
│  │  ├─ ast.ts                       P0  ◄ CONTRACT
│  │  ├─ tokens.ts                    P0  ◄ CONTRACT (token names, ENDERS, CONTINUERS)
│  │  ├─ token-filter.ts              WP-A
│  │  ├─ ast-builders.ts              WP-A
│  │  └─ parse.ts                     WP-A  (parse(source, options) → Program)
│  ├─ compiler/
│  │  ├─ opcodes.ts                   P0  ◄ CONTRACT (enum + operand counts + stack effects)
│  │  ├─ function-proto.ts            P0  ◄ CONTRACT (FunctionProto, ClassTemplate, CompiledScript)
│  │  ├─ scope.ts                     WP-B
│  │  ├─ compiler.ts                  WP-B
│  │  └─ disassembler.ts              WP-B
│  ├─ vm/
│  │  ├─ vm.ts                        WP-C
│  │  ├─ frame.ts                     WP-C
│  │  └─ assembler.ts                 WP-C  (test helper: text → FunctionProto)
│  ├─ runtime/
│  │  ├─ values.ts                    P0  ◄ CONTRACT (Value, Object, Array, Function, Closure, NativeFunction, Class, Interface, Accessor, PrivateKey, ModuleNamespace, HostObject, HostFunction, Environment)
│  │  ├─ realm.ts                     P0 interface, WP-D impl (intrinsics: ObjectPrototype, ArrayPrototype, …)
│  │  ├─ operators.ts                 WP-D  (add, sub, compare, strictEquals, typeOf, toNumber, toString, truthy …)
│  │  ├─ properties.ts                WP-D  (getProperty, setProperty, hasProperty, ownKeys) incl. protected checks
│  │  ├─ classes.ts                   WP-D  (defineClass, construct helpers, brand checks)
│  │  ├─ format.ts                    WP-D  (print formatting)
│  │  └─ interop.ts                   WP-G  (toScript / toHost, live proxies, HostObject/HostFunction behaviour)
│  ├─ stdlib/
│  │  ├─ index.ts, global.ts, math.ts, object.ts, array.ts, string.ts, function.ts, json.ts, errors.ts   WP-D
│  ├─ modules/
│  │  ├─ module-record.ts             P0  ◄ CONTRACT (ModuleRecord, ModuleLoader, BindingCell types)
│  │  ├─ loader.ts                    WP-F  (default in-memory loader, path normalisation, host modules)
│  │  └─ linker.ts                    WP-F  (graph loading, export resolution, cycles, evaluation order)
│  └─ errors.ts                       P0  ◄ CONTRACT (PScriptSyntaxError, PScriptRuntimeError, …)
└─ tests/
   ├─ helpers/                        P0  (runProgram, expectOutput, expectError, nodeReference)
   ├─ unit/{lexer,filter,parser,compiler,vm,runtime,stdlib}/   owned by the matching WP
   ├─ programs/<feature>/*.pscript + *.out | *.err             WP-E
   └─ differential.test.ts            WP-E
```

**Contracts** (marked ◄) are written in Phase 0 and frozen. A work package that needs a contract change:

1. writes the request into `docs/contract-changes.md`;
2. if it is blocked, implements against a local adapter;
3. the coordinator approves and applies the change.

### 5.3 AST contract (`src/parser/ast.ts`)

ESTree subset, so acorn can serve as a test oracle (§6.2). Every node has `type` and `loc: { start: { line, column }, end: { line, column } }`, both 1-based. PScript extensions: `access`, `override` and `final` on class members, `final` and `implements` on classes, and `InterfaceDeclaration`.

```ts
export interface Position { line: number, column: number }
export interface SourceLocation { start: Position, end: Position }
interface NodeBase { loc: SourceLocation }

export type Access = 'public' | 'protected' | 'private'

export interface Program extends NodeBase {
  type: 'Program', sourceType: 'script' | 'module', body: (Statement | ModuleDeclaration)[]
}

export type ModuleDeclaration = ImportDeclaration | ExportNamedDeclaration
export interface ImportDeclaration extends NodeBase {
  type: 'ImportDeclaration', specifiers: (ImportSpecifier | ImportNamespaceSpecifier)[], source: Literal   // source.value: string
}
export interface ImportNamespaceSpecifier extends NodeBase { type: 'ImportNamespaceSpecifier', local: Identifier }
export interface ImportSpecifier extends NodeBase { type: 'ImportSpecifier', imported: Identifier, local: Identifier }
export interface ExportNamedDeclaration extends NodeBase {
  type: 'ExportNamedDeclaration',
  declaration: VariableDeclaration | FunctionDeclaration | ClassDeclaration | null,
  specifiers: ExportSpecifier[],
  source: Literal | null                                                       // non-null for re-exports
}
export interface ExportSpecifier extends NodeBase { type: 'ExportSpecifier', local: Identifier, exported: Identifier }

export type Statement =
  | VariableDeclaration | FunctionDeclaration | ClassDeclaration | InterfaceDeclaration | ReturnStatement | IfStatement
  | ForStatement | ForOfStatement | WhileStatement | DoWhileStatement | SwitchStatement | BreakStatement
  | ContinueStatement | ThrowStatement | TryStatement | BlockStatement | ExpressionStatement | EmptyStatement

export type Expression =
  | Identifier | Literal | ArrayExpression | ObjectExpression | FunctionExpression
  | ArrowFunctionExpression | ClassExpression | UnaryExpression | UpdateExpression
  | BinaryExpression | LogicalExpression | AssignmentExpression | ConditionalExpression
  | CallExpression | NewExpression | MemberExpression | ThisExpression | TemplateLiteral

export type Pattern = Identifier | AssignmentPattern | RestElement

export interface Identifier extends NodeBase { type: 'Identifier', name: string }   // includes 'undefined'
export interface Literal extends NodeBase { type: 'Literal', value: string | number | boolean | null, raw: string }
export interface Super extends NodeBase { type: 'Super' }
export interface ThisExpression extends NodeBase { type: 'ThisExpression' }

export interface VariableDeclaration extends NodeBase {
  type: 'VariableDeclaration', kind: 'let' | 'const', declarations: VariableDeclarator[]
}
export interface VariableDeclarator extends NodeBase { type: 'VariableDeclarator', id: Identifier, init: Expression | null }

interface FunctionBase { id: Identifier | null, params: Pattern[], body: BlockStatement }
export interface FunctionDeclaration extends NodeBase, FunctionBase { type: 'FunctionDeclaration', id: Identifier }
export interface FunctionExpression extends NodeBase, FunctionBase { type: 'FunctionExpression' }
export interface ArrowFunctionExpression extends NodeBase {
  type: 'ArrowFunctionExpression', id: null, params: Pattern[], body: BlockStatement | Expression, expression: boolean
}
export interface AssignmentPattern extends NodeBase { type: 'AssignmentPattern', left: Identifier, right: Expression }
export interface RestElement extends NodeBase { type: 'RestElement', argument: Identifier }

interface ClassBase {
  id: Identifier | null, superClass: Expression | null, body: ClassBody, final: boolean,
  implements: (Identifier | MemberExpression)[]          // PScript extension (D31)
}
export interface ClassDeclaration extends NodeBase, ClassBase { type: 'ClassDeclaration', id: Identifier }
export interface ClassExpression extends NodeBase, ClassBase { type: 'ClassExpression' }
export interface ClassBody extends NodeBase { type: 'ClassBody', body: (MethodDefinition | PropertyDefinition)[] }
export interface MethodDefinition extends NodeBase {
  type: 'MethodDefinition', key: Identifier | Literal, computed: false,
  kind: 'constructor' | 'method' | 'get' | 'set', static: boolean, value: FunctionExpression, access: Access,
  override: boolean, final: boolean
}
export interface PropertyDefinition extends NodeBase {
  type: 'PropertyDefinition', key: Identifier | Literal, computed: false,
  value: Expression | null, static: boolean, access: Access, override: boolean, final: boolean
}

// PScript extension (D31)
export interface InterfaceDeclaration extends NodeBase {
  type: 'InterfaceDeclaration', id: Identifier, extends: (Identifier | MemberExpression)[], body: InterfaceMember[]
}
export interface InterfaceMember extends NodeBase {
  type: 'InterfaceMember', key: Identifier | Literal,
  kind: 'method' | 'get' | 'set' | 'property',
  params: Identifier[], hasRest: boolean                  // methods only; empty otherwise
}

export interface ReturnStatement extends NodeBase { type: 'ReturnStatement', argument: Expression | null }
export interface IfStatement extends NodeBase { type: 'IfStatement', test: Expression, consequent: Statement, alternate: Statement | null }
export interface ForStatement extends NodeBase {
  type: 'ForStatement', init: VariableDeclaration | Expression | null,
  test: Expression | null, update: Expression | null, body: Statement
}
export interface ForOfStatement extends NodeBase {
  type: 'ForOfStatement', left: VariableDeclaration | Identifier, right: Expression, body: Statement, await: false
}
export interface WhileStatement extends NodeBase { type: 'WhileStatement', test: Expression, body: Statement }
export interface BreakStatement extends NodeBase { type: 'BreakStatement', label: null }
export interface ContinueStatement extends NodeBase { type: 'ContinueStatement', label: null }
export interface ThrowStatement extends NodeBase { type: 'ThrowStatement', argument: Expression }
export interface TryStatement extends NodeBase {
  type: 'TryStatement', block: BlockStatement, handler: CatchClause | null, finalizer: BlockStatement | null
}
export interface CatchClause extends NodeBase { type: 'CatchClause', param: Identifier | null, body: BlockStatement }
export interface BlockStatement extends NodeBase { type: 'BlockStatement', body: Statement[] }
export interface ExpressionStatement extends NodeBase { type: 'ExpressionStatement', expression: Expression }
export interface EmptyStatement extends NodeBase { type: 'EmptyStatement' }

export interface TemplateLiteral extends NodeBase {
  type: 'TemplateLiteral', quasis: TemplateElement[], expressions: Expression[]   // quasis.length === expressions.length + 1
}
export interface TemplateElement extends NodeBase {
  type: 'TemplateElement', value: { raw: string, cooked: string }, tail: boolean
}
export interface ArrayExpression extends NodeBase { type: 'ArrayExpression', elements: Expression[] }
export interface ObjectExpression extends NodeBase { type: 'ObjectExpression', properties: Property[] }
export interface Property extends NodeBase {
  type: 'Property', key: Identifier | Literal | Expression, value: Expression, kind: 'init' | 'get' | 'set',
  method: boolean, shorthand: boolean, computed: boolean
}
export interface UnaryExpression extends NodeBase { type: 'UnaryExpression', operator: '!' | '-' | '+' | 'typeof', prefix: true, argument: Expression }
export interface UpdateExpression extends NodeBase { type: 'UpdateExpression', operator: '++' | '--', prefix: boolean, argument: Identifier | MemberExpression }
export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '**' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'instanceof' | 'in'
export interface BinaryExpression extends NodeBase { type: 'BinaryExpression', operator: BinaryOperator, left: Expression, right: Expression }
export interface LogicalExpression extends NodeBase { type: 'LogicalExpression', operator: '&&' | '||' | '??', left: Expression, right: Expression }
export type AssignmentOperator = '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '**=' | '&&=' | '||=' | '??='
export interface AssignmentExpression extends NodeBase { type: 'AssignmentExpression', operator: AssignmentOperator, left: Identifier | MemberExpression, right: Expression }
export interface ConditionalExpression extends NodeBase { type: 'ConditionalExpression', test: Expression, consequent: Expression, alternate: Expression }
export interface CallExpression extends NodeBase { type: 'CallExpression', callee: Expression | Super, arguments: Expression[], optional: false }
export interface NewExpression extends NodeBase { type: 'NewExpression', callee: Expression, arguments: Expression[] }
export interface MemberExpression extends NodeBase {
  type: 'MemberExpression', object: Expression | Super, property: Expression | Identifier,
  computed: boolean, optional: false
}
```

D43 adds `AwaitExpression { argument }` and sets `async` on functions. D42 adds `YieldExpression { argument: Expression | null, delegate }` and `generator` / `async` flags on every function node (ESTree; arrows have `generator: false`). D41 adds `DoWhileStatement { body, test }`, `SwitchStatement { discriminant, cases: SwitchCase[] }`, `SwitchCase { test: Expression | null, consequent: Statement[] }` and the unary operators `'void'` and `'delete'` (ESTree shapes).

COULD extensions (`SpreadElement`, `ChainExpression`, `SequenceExpression`) must be additive.

### 5.4 Bytecode contract (`src/compiler/opcodes.ts`, `function-proto.ts`)

**Encoding.**

- A `FunctionProto` has `code: number[]`: an opcode followed by its operands, each operand one number.
- Jump operands are **absolute** offsets into `code`.
- Constants live in the proto's `constants: unknown[]` pool: numbers, strings, nested `FunctionProto`s, `ClassTemplate`s.
- `lines: Int32Array`/`number[]` maps each code offset to `[line, column]` for errors. A packed form is acceptable.

```ts
export interface FunctionProto {
  name: string
  kind: 'script' | 'function' | 'arrow' | 'method' | 'constructor' | 'derivedConstructor' | 'fieldInit' | 'staticInit'
  paramCount: number          // formal params excluding rest
  length: number              // JS fn.length
  hasRest: boolean
  scopeSize: number           // slots in the function's top environment (params + top-level lets + hoisted fns)
  code: number[]
  constants: unknown[]
  locations: number[]         // flat [offset, line, column, ...] sorted by offset
  usesThis: boolean           // arrows capture this lexically when true
  classDepth: number          // nesting of class bodies the function is lexically in (0 = none)
}

export interface ClassTemplate {
  name: string
  hasSuper: boolean
  constructor: FunctionProto | null
  instanceFieldInit: FunctionProto | null   // runs with this = instance
  staticInit: FunctionProto | null          // runs with this = class
  isFinal: boolean
  methods: { key: string, kind: 'method' | 'get' | 'set', access: Access, isStatic: boolean, protoIndex: number,
             override: boolean, final: boolean, loc: SourceLocation }[]
  memberRefs: { name: string, isStatic: boolean, kind: 'read' | 'write' | 'call' | 'super-call', argc?: number, loc: SourceLocation }[]   // unproven this.x / C.x references, checked by CLASS (D36)
  fields: { key: string, access: Access, isStatic: boolean, override: boolean, final: boolean, loc: SourceLocation }[]   // names only; initialisers live in the init protos
  interfaceCount: number                    // number of interface values on the stack for CLASS (implements list)
  implicitNames: {                          // bare names used in the class body that are not local bindings (D33)
    name: string
    outer: 'lexical' | 'global'             // what step 3 resolves to: an enclosing lexical binding, or global lookup
    contexts: ('instance' | 'static')[]     // which contexts use the name (static methods/initialisers vs. the rest)
    loc: SourceLocation                     // first use, for error messages
  }[]
}

export interface InterfaceTemplate {
  name: string
  members: { key: string, kind: 'method' | 'get' | 'set' | 'property', paramCount: number, hasRest: boolean, loc: SourceLocation }[]
}

export interface CompiledScript { main: FunctionProto, source?: string, fileName?: string }

// src/modules/module-record.ts (contract)
export interface CompiledModule {
  id: string
  main: FunctionProto                         // kind 'module'; its top env holds all top-level bindings
  requests: string[]                          // module specifiers in source order (imports + re-exports + side-effect)
  imports: { request: number, importName: string, localName: string }[]   // index = LOAD_IMPORT operand
  localExports: { exportName: string, slot: number }[]                    // slot in main's top env
  indirectExports: { exportName: string, request: number, importName: string }[]  // re-exports
  hoistedFunctions: number[]                  // slots initialised at instantiation (cycle support)
}
export interface BindingCell { env: Environment, slot: number }   // live view used by importers
export type ModuleStatus = 'new' | 'linking' | 'linked' | 'evaluating' | 'evaluated' | 'errored'
export interface ModuleRecord {
  id: string
  status: ModuleStatus
  compiled: CompiledModule | null             // null for host modules
  env: Environment | null                     // module top environment, created at link time
  importCells: BindingCell[]                  // resolved per CompiledModule.imports index
  hostExports?: Map<string, Value>
  error?: unknown
}
```

`FunctionProto.kind` gains `'module'` and `'getter' | 'setter'`.

**Instruction set.** Stack effects are written `before → after`, with the top of stack rightmost. The operand column lists inline operands.

| Opcode | Operands | Stack | Notes |
|---|---|---|---|
| `CONST` | k | → v | push `constants[k]` |
| `UNDEFINED` `NULL` `TRUE` `FALSE` | — | → v | |
| `POP` | — | v → | |
| `DUP` | — | a → a a | |
| `DUP2` | — | a b → a b a b | compound member assignment |
| `SWAP` | — | a b → b a | |
| `ROT3` | — | a b c → c a b | postfix member update |
| `ROT4` | — | a b c d → d a b c | postfix computed-member update |
| `LOAD` | depth slot | → v | TDZ check (`UNINITIALIZED` → ReferenceError; name via debug table) |
| `STORE` | depth slot | v → v | assignment; TDZ check |
| `INIT` | depth slot | v → | initialise let/const/class/function binding |
| `LOAD_GLOBAL` | k(name) | → v | script bindings, then globals; ReferenceError if missing |
| `STORE_GLOBAL` | k(name) | v → v | ReferenceError if undeclared; TypeError if read-only |
| `DECLARE_GLOBAL` | k(name) flags | → | top-level let/const/class/function of a script; flags: const |
| `INIT_GLOBAL` | k(name) | v → | |
| `TYPEOF_GLOBAL` | k(name) | → s | `typeof undeclared` |
| `LOAD_IMPORT` | i | → v | `frame.module.importCells[i]` → read the exporter's slot; TDZ check (live binding) |
| `PUSH_ENV` | size | → | new block environment |
| `POP_ENV` | — | → | |
| `COPY_ENV` | — | → | per-iteration copy of the innermost env (for-let) |
| `GET_PROP` | k(name) | obj → v | via `runtime.getProperty` with the frame's home class (§4.5.3 steps 2–5) |
| `SET_PROP` | k(name) | obj v → v | |
| `GET_INDEX` | — | obj key → v | |
| `SET_INDEX` | — | obj key v → v | |
| `GET_PROP_PRIV` | depth k(name) | obj → v | emitted when `name` is declared private by the enclosing class `depth` hops out from the home class: try that private member first (§4.5.3 step 1), else fall back to `GET_PROP` |
| `SET_PROP_PRIV` | depth k(name) | obj v → v | same for writes |
| `GET_SUPER` | k(name) | → v | lookup on the home object's parent prototype, `this` unaffected |
| `GET_SUPER_INDEX` | — | key → v | |
| `ADD` `SUB` `MUL` `DIV` `MOD` `POW` | — | a b → r | `runtime.operators` |
| `EQ` `NE` `LT` `LE` `GT` `GE` | — | a b → bool | EQ/NE strict, no coercion (D1) |
| `INSTANCEOF` `IN` | — | a b → bool | `INSTANCEOF` accepts classes and interfaces (D32); `IN` applies the access rules (§4.5.2) |
| `NEG` `POS` `NOT` `TYPEOF` | — | a → r | `POS` = ToNumber |
| `TO_STRING` | — | v → s | `ToString` (§4.4.3); may call a script `toString()` |
| `CONCAT` | n | s1…sn → s | concatenates `n` strings (template literals: cooked parts as `CONST`, substitutions via `TO_STRING`) |
| `INC` `DEC` | — | n → n±1 | operand already ToNumber'd via `POS` |
| `JUMP` | target | → | |
| `OPTIONAL_JUMP` | target n | x1…xn → x1…xn \| undefined | `?.` (D47): when xn is null or undefined, drops x1…xn, pushes `undefined` and jumps to the end of the chain (n = 2 for an optional method call: receiver and function) |
| `JUMP_IF_FALSE` | target | v → | pops |
| `JUMP_IF_TRUE` | target | v → | pops |
| `AND_JUMP` | target | v → v \| (popped) | if falsy: keep and jump; else pop |
| `OR_JUMP` | target | v → v \| (popped) | if truthy: keep and jump; else pop |
| `NULLISH_JUMP` | target | v → v \| (popped) | if NOT nullish: keep and jump; else pop |
| `ARRAY` | n | v1…vn → arr | |
| `OBJECT` | — | → obj | |
| `DEFINE_PROP` | k(name) | obj v → obj | object literal init; sets home object for methods |
| `DEFINE_PROP_INDEX` | named | obj key v → obj | computed keys (D48); `named` = 1: v is a function defined there, which takes the key as its name |
| `DEFINE_GETTER_INDEX` / `DEFINE_SETTER_INDEX` | — | obj key fn → obj | accessors with a computed key (D48), named after the key |
| `DEFINE_GETTER` / `DEFINE_SETTER` | k(name) | obj fn → obj | object-literal accessors (R18); combines with an existing accessor of the same key |
| `CLOSURE` | k(proto) | → fn | captures current env, `this` (if arrow), home class/object |
| `CALL` | argc | fn a1…an → r | `this = null` (D37). In all calls (`CALL`, `CALL_METHOD`, `CALL_IMPLICIT`, `NEW`, `SUPER_CALL`), argc `SPREAD_ARGC` (−1) means the arguments are one array (built with `ARRAY`, `ARRAY_PUSH` and `ARRAY_SPREAD`) that the VM spreads onto the stack (D46) |
| `CALL_METHOD` | argc | recv fn a1…an → r | `this = recv` |
| `NEW` | argc | ctor a1…an → obj | |
| `SUPER_CALL` | argc | a1…an → this | binds `this`, runs field initialisers |
| `RETURN` | — | v → | |
| `THIS` | — | → this | ReferenceError in a derived ctor before `super()` |
| `CLASS` | k(template) | superclass\|EMPTY i1…in → cls | `n` = `template.interfaceCount`. Builds the class, its member indexes and private storage keys; installs methods **and accessors**; runs override, access and interface-conformance checks (§5.6.7) |
| `LOAD_IMPLICIT` | i | → v | bare name #i of the home class's `implicitNames`: if the class-definition table marks it as a member, read it like `this.name` (or `C.name` in static context); else perform the recorded fallback (`LOAD` depth slot / `LOAD_GLOBAL`). Fallback operands follow `i` |
| `STORE_IMPLICIT` | i | v → v | same for writes |
| `CALL_IMPLICIT` | i argc | a1…an → r | member: method call with `this`; fallback: plain call |
| `INTERFACE` | k(template) n | p1…pn → iface | builds an interface from its template and `n` parent interfaces (§4.5.7) |
| `GET_ITER` | — | iterable → iter | arrays/strings; else TypeError |
| `ITER_NEXT` | target | iter → iter v \| (pops iter, jumps) | |
| `ITER_VALUE` | — | iter → iter v | array patterns: the next value, `undefined` when done (D40) |
| `ITER_REST` | — | iter → arr | array pattern rest: the remaining values (D40) |
| `CHECK_PATTERN` | k \| -1 | v → v | object patterns: TypeError for null/undefined; with k (JSON `{ keys, path }`), unknown keys of a plain object are a TypeError (strict named parameters, D40) |
| `OBJECT_REST` | k | v → obj | object pattern rest: a plain object with the own public properties not listed in k (JSON array of keys) (D40) |
| `DELETE_PROP` | k | obj → bool | `delete obj.k` (D41): plain and host objects only, otherwise `TypeError` |
| `DELETE_INDEX` | — | obj key → bool | `delete obj[key]` (D41) |
| `ARRAY_PUSH` | — | arr v → arr | an element after a spread element (D46) |
| `ARRAY_SPREAD` | — | arr iterable → arr | appends what the iterable produces (`[...x]`, spread arguments); TypeError if not iterable (D46) |
| `OBJECT_SPREAD` | — | obj v → obj | `{ ...v }`: copies the own enumerable public properties of v (D46) |
| `GENERATOR` | — | → | generator prologue (D42), after the parameters are bound: the frame becomes a suspended coroutine and the call returns a generator object |
| `YIELD` | — | v → sent | suspends the generator with v; resuming pushes the value sent by `next()` (or throws / returns there) |
| `ASYNC` | — | → | async prologue (D43), after the parameters are bound: the frame becomes a coroutine, the body runs until its first `await`, and the call returns the function's promise |
| `AWAIT` | — | v → result | suspends the async function until `PromiseResolve(v)` settles; resumes with the value or throws the reason |
| `YIELD_DELEGATE` | — | iter sent → iter \| result | one step of `yield*`: forwards the resumption mode to the delegate; when the delegate is not done, suspends with its value and runs again on resumption |
| `ITER_CLOSE` | — | iter → | pops a value; closes it if it is a generator iterator that is not done (`break`, array patterns) |
| `CLOSE_ITERS` | — | v → v | `return` inside `for…of`: closes the iterators on the frame's stack below the returned value |
| `THROW` | — | v → | |
| `TRY` | catchTarget finallyTarget | → | push handler (−1 = none); records stack height and env depth |
| `END_TRY` | — | → | pop handler |
| `ENTER_FINALLY` / `END_FINALLY` | — | | completion-record handling (see §5.6.5) |
| `HALT` | — | v → | end of script; `v` is the completion value |
| `STORE_POP` / `STORE_GLOBAL_POP` / `SET_PROP_POP` | as `STORE` / `STORE_GLOBAL` / `SET_PROP` | v → / obj v → | superinstructions (H3): the store and the `POP` discarding its result; the compiler rewrites the store in place, unless a jump targets the `POP` |
| `INCREMENT` | depth slot delta | → | superinstruction (H3): an unused postfix `x++` / `x--` of a lexical binding (`LOAD POS INC/DEC STORE POP`) |

The table is a *contract*, but the compiler and VM agents may jointly propose additions through `docs/contract-changes.md`, such as a fused `LOAD_LOCAL0`, `CALL_PROP`, or a `PUSH_EMPTY` sentinel for "no superclass".

### 5.5 Compiler design (WP-B)

- **Single pass over the AST, with a pre-scan per scope** for hoisting:
  1. collect `let`/`const`/`class`/function declarations;
  2. assign slots;
  3. emit `CLOSURE`+`INIT` for hoisted functions at scope entry.
- **Environments**:
  - Every function has one top environment (params plus top-level body declarations).
  - Each block that declares bindings gets `PUSH_ENV`/`POP_ENV`. Blocks without declarations get no env, an important optimisation.
  - Folded blocks (H3, K9): a block, `catch`, for-let head or for-of binding whose code creates no closure, and whose bindings are not used before their declaration, has no env of its own: its bindings take extra slots of the enclosing env (whose `PUSH_ENV` size or `scopeSize` grows accordingly). Without a closure nothing can tell the envs apart, and without an early use no stale value from an earlier iteration can be read where the TDZ would throw.
  - Resolution is static: `(depth, slot)`.
- **Script top level**: declarations become `DECLARE_GLOBAL` script bindings, so that later `run()` calls on the same `Interpreter` see them (REPL behaviour). Inner scopes use environments.
- **for-let**: init env → loop: test, body, `COPY_ENV`, update. This matches the spec's CreatePerIterationEnvironment closely enough.
- **for-of**: `GET_ITER`; at the loop head `ITER_NEXT exit`; per-iteration env; `INIT` binding; body; `JUMP head`; at `exit` the iterator is already popped. `break` must pop the iterator (the compiler tracks the stack depth per loop). `continue` jumps to the head.
- **Break/continue/return through `finally`**: the compiler keeps a control stack. Jumps that cross `try` with `finally` are compiled into finally-trampolines (§5.6.5). Crossing env boundaries emits the right number of `POP_ENV`s.
- **Expressions**:
  - `&&` → `AND_JUMP`; `||` → `OR_JUMP`; `??` → `NULLISH_JUMP`; ternary → `JUMP_IF_FALSE`/`JUMP`.
  - Compound logical assignment (`a ||= b`) only assigns when needed.
- **Member calls**: `o.m(x)` → `<o> DUP GET_PROP m <x> CALL_METHOD 1`. `super.m(x)` → `THIS GET_SUPER m <x> CALL_METHOD 1`.
- **Classes**: compile a `ClassTemplate`:
  - constructor proto; synthesised default constructor;
  - one `fieldInit` proto with the instance field initialisers in order;
  - one `staticInit` proto with the static field initialisers;
  - each method as its own proto.
  - Code: `<superclass or EMPTY> CLASS k INIT <binding>`.
  - Private names resolve against the compiler's class stack → `(depth, name)`. An unknown name is a SyntaxError.
- **Completion value** (§4.4.10, D12): the script proto reserves a completion slot. Expression statements reachable from top-level code store into it; `if`/loops/`try` store `undefined` on entry; `finally` saves and restores it. `HALT` returns it. The compiler emits these stores only in script-goal top-level code, never in function bodies.
- **Accessors**: each `get`/`set` compiles to its own proto (`kind: 'getter' | 'setter'`) referenced from the `ClassTemplate.methods` entry with the matching `kind`. Compound assignment and `++`/`--` on members need no special opcodes: `GET_PROP` and `SET_PROP` already dispatch to accessors in the runtime.
- **Module goal** (`compileModule(program, id) → CompiledModule`):
  - top-level declarations go into the module proto's top env (not `DECLARE_GLOBAL`);
  - each import specifier becomes a compile-time binding of kind *import*; reads emit `LOAD_IMPORT i`, writes are a SyntaxError;
  - export declarations compile like the plain declaration plus an entry in `localExports`; `export { … }` lists only produce entries (checking that each local is a top-level binding, which may be an import — then it is recorded as an indirect export of that import);
  - re-exports produce `indirectExports` entries and a request, no code;
  - import/export statements anywhere other than the top level, or in script goal → SyntaxError.
- **Static errors** (§4.3) carry `loc`.
- **Disassembler**: `disassemble(proto)` gives human-readable output. It is used in compiler snapshot tests and is a public debugging API.

### 5.6 VM design (WP-C)

#### 5.6.1 State

- `stack: Value[]`: a single operand stack shared by frames. Each frame records `base`.
- `frames: Frame[]`, where a Frame is `{ closure, proto, ip, base, env, thisValue, homeClass, homeObject, handlers: Handler[], isConstruct, newTarget }`.
- Counters: `steps`, plus the limits `maxSteps` and `maxCallDepth`.
- `realm`: intrinsics and globals.

#### 5.6.2 Dispatch

- The main loop is a `switch (code[ip++])` inside `run(untilFrameDepth)`.
- Hot locals (`code`, `ip`, `stack`) are cached in local variables and written back on calls and returns.
- No recursion on the JS stack for script→script calls. Only native→script callbacks re-enter (§5.6.4).

#### 5.6.3 Calls

`CALL`, `CALL_METHOD` and `NEW` check the callee, and check `argc` against its parameter counts (D38; natives declare theirs too):

- `Closure`: push a new frame. Create the function env (`scopeSize`), bind params, evaluate defaults (compiled into the callee's prologue), then set `thisValue`, home class and home object.
- `NativeFunction`: call `impl(ctx, thisValue, args)` synchronously and push the result. `HostFunction`: call through the interop layer (§5.8.1). `ctx` gives access to `vm.callFunction`, the caller's home class (for `Object.keys` visibility) and the realm.
- `Class` via `NEW`:
  - **base class**: create an instance with proto `C.prototype`, run `fieldInit`, then the ctor;
  - **derived class**: `this` stays uninitialised until `SUPER_CALL`. `SUPER_CALL` constructs via the parent chain with the same `newTarget`, so the instance's prototype is `newTarget.prototype`, then runs this class's `fieldInit`.
  - Constructors cannot return a value (D27), so the result is always the new instance. `instance.klass = newTarget`.
  - **built-in class** (`Error` family): the native constructor initialises the instance; script subclasses go through `SUPER_CALL` as usual.
  - **host class**: `Reflect.construct(target, toHost(args))`, result through `toScript`. A script class extending a host class constructs the host object in `SUPER_CALL` and wraps it as a `HostObject` whose `klass` is the script subclass (so script methods and fields live on the wrapper, host members on the target).
- `NEW` on anything that is not a `Class` (or a host class) → `TypeError: X is not a class` (D25). Calling a class without `new` → `TypeError`.

#### 5.6.4 Re-entrancy

`vm.callFunction(fn, thisValue, args): Value` pushes a frame and runs the dispatch loop until that frame returns. It is used by array callbacks, `sort` comparators and the host API. Exceptions propagate through nested loops correctly: a script `throw` inside a `map` callback can be caught by a `try` around the `map` call.

#### 5.6.5 Exceptions and `finally`

- `TRY` pushes a handler `{ catchIp, finallyIp, stackHeight, envDepth }` onto the current frame.
- `THROW`, or any runtime error raised by `runtime.*` (a host `PScriptError` thrown inside the VM loop, caught and converted to a script Error object):
  1. unwinds frames and handlers until it finds a handler;
  2. restores the stack height and env;
  3. pushes the exception and jumps to `catchIp`, or to `finallyIp` with a "throw" completion.
- `finally` uses completion records: `{ type: 'normal' | 'return' | 'throw' | 'jump', value | target }`, stored in a frame-local stack. `ENTER_FINALLY`/`END_FINALLY` resume the pending completion.
- No handler anywhere → `PScriptRuntimeError` to the host, with the script stack trace.
- Unexpected host exceptions from **stdlib** natives (bugs) are wrapped as `InternalError` and are **not** catchable by scripts. Exceptions from user-provided host functions are catchable (§5.8.2).

#### 5.6.6 Access control at runtime

- `GET_PROP`/`SET_PROP`/`GET_INDEX`/`SET_INDEX`/`IN` pass `frame.homeClass` to `runtime.properties`, which implements §4.5.3. Receivers that are not class instances (object literals, arrays, primitives) skip straight to step 3, so the common fast path is unaffected.
- `GET_PROP_PRIV`/`SET_PROP_PRIV`:
  1. find the class `E` by walking `homeClass.outerClass` `depth` times;
  2. if the receiver is an instance of `E` (or is `E`, for statics), use `E.privateIndex.get(name)`: a field is read from the receiver's `privates` map under `E`'s private key, a method is returned, an accessor's getter/setter is called;
  3. otherwise fall back to the generic `GET_PROP`/`SET_PROP` path.
- Computed access (`o[k]`) runs the full §4.5.3 algorithm, including step 1 over the home class and its enclosing classes.

#### 5.6.7 Class definition and method tables (D28, D29)

When `CLASS` runs:

1. Check the superclass: it must be a class (D25) and not `final` (D28). Check each `implements` value: it must be an interface (D31).
2. Run the override and access checks of §4.5.2/§4.5.6 for every **public and protected** entry of `template.methods` and `template.fields` against the superclass's **member index** (below).
3. Build the class's indexes:
   - **member index** (public and protected): `Map<string, MemberEntry>` for instance members and another for static members, where `MemberEntry = { kind: 'method' | 'accessor' | 'field', owner: Class, final: boolean, access: 'public' | 'protected', fn?: Closure, get?: Closure, set?: Closure, getAccess?, setAccess? }`. Start from a copy of the superclass's index (for host superclasses, build entries lazily from the host prototype), then apply this class's members. Accessor halves are merged (§4.5.6).
   - **private index**: this class's own private members only (instance and static maps). Private fields are stored on instances in `privates`, keyed by a per-class `PrivateKey`, so a subclass's same-named member never collides.
4. **Member references** (§4.5.9): every `template.memberRefs` entry must exist in the new indexes (instance or static); otherwise a violation `Class 'X' has no member 'y'`.
4b. **Implicit names** (§4.5.8): for each entry of `template.implicitNames`, look the name up in the new indexes (own + inherited; private only from this class; static or instance per context). Build the class's resolution table (`member` or `outer`). If a member matches and `outer` is `lexical`, or the name exists as a global right now → ambiguity violation. (Own-member vs. lexical/stdlib conflicts were already rejected at compile time.)
5. **Interface conformance** (§4.5.7): compute `interfaces` = the superclass's set ∪ every listed interface and all their ancestors. For each required member, check the member index (public entries only). Collect all violations from steps 2, 4, 4b and 5 and throw one `TypeError` listing them (first location in the message).
6. Freeze everything. Method lookup is then one map lookup (`index.get(name)`), not a prototype walk.

This is the "flattened method table" from the D28 discussion: a VMT keyed by name. `super.m` uses the superclass's index. The access checks read `access` and `owner` straight from the entry, and `instanceof` with an interface is `klass.interfaces.has(I)`.

#### 5.6.8 Modules

- Frames carry `module: ModuleRecord | null`. Closures capture the module of the frame that created them, so functions exported from a module keep reading their own module's imports when called from elsewhere.
- `LOAD_IMPORT i` reads `frame.module.importCells[i]`, i.e. `cell.env.slots[cell.slot]`, with the TDZ check. Host-module imports are *host cells*: reading one performs `toScript(exports[name])` on every access (live, D9).
- Namespace imports compile to `LOAD_IMPORT` of a cell holding the record's namespace object, created lazily once per record.
- Evaluating a module = running its `main` proto in a frame whose top env is the record's pre-created `env` (created at link time, so cells can point into it before evaluation, and hoisted functions are initialised then).

#### 5.6.9 Coroutines (D42, §1.7)

- A generator's frame is an ordinary heap `Frame` with a `coroutine`. Its prologue (`GENERATOR`) runs in the caller's loop after the arguments are bound, then takes the frame off the frame stack — saving the operand-stack values above `frame.base` in the coroutine — and returns the generator object as a `RETURN` would.
- `resumeCoroutine(co, mode, value)` pushes the frame back (operand values restored, `frame.base` and every handler's `stackHeight` shifted by the same delta) and runs a **nested dispatch loop** whose entry frame is the coroutine's frame. So `YIELD` always suspends the entry frame: it saves the stack slice, pops the frame and returns the yielded value from the loop. A `RETURN` of the frame ends the loop as usual; the coroutine is then completed.
- Resumption modes: `next` pushes the sent value (nothing when the body starts); `throw` unwinds from the paused `yield` with the exception; `return` unwinds with a `GeneratorReturn` signal, a `ScriptThrow` that `catch` handlers skip (`finally` handlers run, and their `END_FINALLY` rethrows it). The signal leaving the frame completes the generator with its value.
- `yield*` keeps the delegate iterator on the stack. `YIELD_DELEGATE` steps it with the mode of the last resumption (`co.mode`, valid only while `co.delegating`); while the delegate is not done it suspends with `ip` pointing at itself.
- Iterators on the operand stack belong to `for…of` loops. Unwinding (`enterHandler`, popping a frame) closes the ones it drops, ignoring errors from the cleanup; `break` uses `ITER_CLOSE` instead of `POP`; `return` emits `CLOSE_ITERS` when the function has stack items.
- The step budget (D14) covers resumptions; a resumption from the host (empty frame stack) starts a new budget. Resumptions count toward `maxCallDepth`.

#### 5.6.10 Async functions and jobs (D43)

- An async function's frame is a coroutine too (§5.6.9). Its `ASYNC` prologue suspends the frame, creates the function's promise and resumes the coroutine at once in a nested loop; `AWAIT` suspends like `YIELD`. The VM's `stepAsync` drives it: a suspension subscribes an internal reaction (no derived promise) to `PromiseResolve(awaited)` whose jobs resume the coroutine with `next` or `throw`; completion resolves the promise, an exception rejects it.
- `src/vm/promises.ts` implements the state machine (`PromiseObject` in `src/runtime/promises.ts`): `resolve` (self-resolution → TypeError; a PScript promise is adopted through one job; anything else fulfills), `reject`, `performThen` (a derived promise), `react` (internal callbacks), reaction jobs (script handlers through `callBack`, D38), `resolvingFunctions`, and the unhandled-rejection set. Natives reach it through `AccessContext.promises`.
- The job queue lives in the VM: `enqueueJob` appends and schedules one host microtask (`queueMicrotask`); `execute()` and the module registry call `settle()` (drain, then throw the oldest unhandled rejection as an uncaught error). A background drain reports errors through `VMOptions.reportError` (the interpreter's `stderr`). While draining, calls from jobs do not reset the step budget.
- Tasks (D44): a timer callback runs through `VM.runTask(task)` (`AccessContext.runTask`): a new step budget, the callback, then `settleJobs()`; an exception or an unhandled rejection goes to `VMOptions.reportError`. Natives reach the conversion layer through `AccessContext.interop` (used by `fetch`).
- Interop: a script promise becomes a host `Promise` that follows it (rejections as `PScriptRuntimeError`); a host thenable becomes a script promise whose callbacks (host microtasks) resolve it, and a round trip gives back the original host promise.

### 5.7 Runtime value model (WP-D, contract in P0)

Naming (D8): the script-side classes have **no prefix**. They are exported from `src/runtime/values.ts` as `Object`, `Array`, `Function`, `Closure`, `NativeFunction`, `Class`, and they deliberately shadow the JS built-ins in files that import them. Rules that keep this safe:

- Files that need the host built-ins as well use `globalThis.Object`, `globalThis.Array` etc. explicitly (for example `globalThis.Object.freeze`, `globalThis.Array.isArray`).
- Files that do not need the script classes do not import them.
- ESLint cannot tell an imported `Object` from the global one, so this convention is enforced by review (Phase 2) and by unit tests that exercise every host-built-in call path.

```ts
export type Value = undefined | null | boolean | number | string | Object   // every non-primitive extends Object
export const UNINITIALIZED: unique symbol                                     // TDZ marker, never escapes to scripts

export class Object {
  proto: Object | null
  props: Map<string, Value | Accessor>  // insertion-ordered own properties; accessors may be own (object literals) or on prototypes (classes)
  privates?: Map<PrivateKey, Value>     // private fields, keyed per declaring class (§5.6.7)
  klass?: Class                         // set for class instances (brand, access checks, interfaces)
  extensible: boolean
}
export class Array extends Object { items: Value[] }        // proto = realm.ArrayPrototype
export class Function extends Object { name: string, length: number }
export class Closure extends Function {
  fnProto: FunctionProto            // named fnProto to avoid a clash with `proto`
  env: Environment
  module: ModuleRecord | null       // module the closure was created in (§5.6.8)
  thisValue?: Value                 // arrows only
  homeClass: Class | null
  homeObject: Object | null         // for super lookups
}
export class NativeFunction extends Function { impl: NativeImpl }          // never constructable (D25)
export class Class extends Function {
  template: ClassTemplate
  superClass: Class | null
  prototype: Object                 // internal only (D29)
  outerClass: Class | null          // lexically enclosing class (private access from nested classes, §4.5.2)
  memberIndex: Map<string, MemberEntry>          // public + protected instance members, flattened (§5.6.7)
  staticMemberIndex: Map<string, MemberEntry>
  privateIndex: Map<string, PrivateEntry>        // own private instance members
  staticPrivateIndex: Map<string, PrivateEntry>
  interfaces: Set<Interface>        // transitive: own `implements`, their ancestors, and the superclass's set
  final: boolean
  ctor: Closure | null
  fieldInit: Closure | null
  native?: NativeClassImpl          // built-in classes (Error family): native construct + prototype
  host?: (new (...args: any[]) => any) // host classes (§5.8.1)
}
export class Accessor { get: Closure | null; set: Closure | null }   // never exposed to scripts as a value
export class PrivateKey { constructor(readonly owner: Class, readonly name: string) {} }   // identity = (class, name)
export interface PrivateEntry {
  kind: 'field' | 'method' | 'accessor'
  key?: PrivateKey                  // fields
  fn?: Closure                      // methods
  get?: Closure; set?: Closure      // accessors
}
export class Interface extends Object {          // §4.5.7; frozen, not callable
  name: string
  parents: Interface[]
  members: Map<string, InterfaceTemplate['members'][number]>   // merged with all ancestors
  ancestors: Set<Interface>                                     // including itself
}
export class ModuleNamespace extends Object { record: ModuleRecord }  // §4.7.2, exotic: reads go through cells
export class HostObject extends Object { target: object }             // §5.8.1, exotic: all operations delegate to target
export class HostFunction extends Function { target: (...args: any[]) => any }   // host functions that are NOT classes; host classes become `Class` with `host` set
export class Environment { slots: Value[]; parent: Environment | null }
export interface Realm {
  ObjectPrototype, FunctionPrototype, ArrayPrototype, StringPrototype, NumberPrototype,
  BooleanPrototype, ErrorPrototype, globals: Map<string, { value: Value, readonly: boolean }>
}
```

- Strings, numbers and booleans stay JS primitives. Property access on them goes through the realm's `StringPrototype` etc. They are never boxed into objects.
- `getProperty(ctx, recv, key)` is the single entry point for reads. It handles primitives, arrays (`length`, indices, then prototype), the member-resolution algorithm of §4.5.3 (private, protected and public members), **accessors** (calls the getter through `ctx.callFunction` with the original receiver), and the exotic objects (`ModuleNamespace`, `HostObject`, `HostFunction`). `setProperty` likewise finds a setter along the chain before creating an own data property (§4.5.4).
- `AccessContext` therefore also carries `callFunction(fn, thisValue, args): Value`, provided by the VM.

### 5.8 Public API (`src/index.ts`)

```ts
export interface InterpreterOptions {
  globals?: Record<string, unknown>         // each value goes through toScript (live proxies, §5.8.1)
  stdout?: (text: string) => void           // default: console.log of the host
  stderr?: (text: string) => void
  maxSteps?: number                         // default: Infinity (D14)
  maxCallDepth?: number                     // default: 10_000; Infinity allowed (D14)
  random?: () => number                     // Math.random override
  fetch?: (input, init?) => Promise<unknown> // what scripts' fetch() calls; default: globalThis.fetch (D44)
  moduleLoader?: ModuleLoader               // §4.7.3; takes precedence over `modules`
  modules?: Record<string, string | Record<string, unknown>>   // in-memory modules: source text or host exports
}

export function parse(source: string, options?: { fileName?: string, goal?: 'script' | 'module' }): Program
export function compile(source: string | Program, options?: { fileName?: string }): CompiledScript
export function compileModule(source: string | Program, id: string): CompiledModule
export function disassemble(script: CompiledScript | CompiledModule | FunctionProto): string

export class Interpreter {
  constructor(options?: InterpreterOptions)
  run(source: string, options?: { fileName?: string }): unknown   // completion value (§4.4.10), via toHost
  execute(script: CompiledScript): unknown                          // same, for precompiled scripts
  get(name: string): unknown                                         // script binding or global, via toHost
  set(name: string, value: unknown): void                            // defines/overwrites a global, via toScript
  call(fnOrName: string | ((...args: any[]) => any), ...args: unknown[]): unknown

  // modules (D20)
  runModule(source: string, options?: { id?: string }): Record<string, unknown>  // entry module from source; returns its live namespace proxy
  importModule(specifier: string): Record<string, unknown>   // load via the loader (cached); returns the live namespace proxy
  defineModule(id: string, exports: Record<string, unknown>): void   // register a host module (live values)
}

export function run(source: string, options?: InterpreterOptions): unknown   // convenience one-shot

export function markAsClass<T extends (...args: any[]) => any>(fn: T): T   // §5.8.1: treat a host function as a class
export type { ModuleLoader, CompiledScript, CompiledModule }
export { PScriptError, PScriptSyntaxError, PScriptRuntimeError }
export type * from './parser/ast'
```

#### 5.8.1 Host interop: live proxies (D9, R21)

Values cross the host/script boundary **by reference**. Nothing is deep-copied. Two functions in `src/runtime/interop.ts` do every conversion: `toScript(hostValue)` and `toHost(scriptValue)`.

**Common rules**

- Primitives (`undefined`, `null`, booleans, numbers, strings) pass through unchanged. `bigint` and `symbol` values → `TypeError` at the boundary.
- **Identity is preserved.** Each direction keeps a `WeakMap` cache, so the same object always maps to the same wrapper (`==` works on both sides).
- **Round trips unwrap.** `toScript(toHost(x)) === x` and `toHost(toScript(y)) === y`. A script object handed to the host and back is the original object, not a wrapper of a wrapper.

**Host → script (`toScript`)**

| Host value | Script value | Behaviour |
|---|---|---|
| function that is a **host class** (see below) | `Class` with `host` set | `new` uses `Reflect.construct`; can be extended by script classes; works with `instanceof` (§4.5.5). Calling without `new` → `TypeError` |
| any other function | `HostFunction` | calling converts arguments with `toHost` and `this` with `toHost`, calls the target, and converts the result with `toScript`. **Not constructable** (D25). `typeof` is `'function'` |
| array | `HostObject` with array behaviour | index reads/writes and `length` hit the live host array; `Array.isArray` is `true`; array methods are the **host's** methods (called with the host array as `this`, callbacks converted with `toHost`); `for…of` uses the host iterator |
| any other object (plain objects, class instances, Map, Date, …) | `HostObject` | `o.k` → `toScript(Reflect.get(target, k))`; `o.k = v` → `Reflect.set(target, k, toHost(v))`; `k in o` → `k in target`; `Object.keys` → own enumerable string keys; methods are called with `this` = the target; iterable targets work with `for…of` |
| `Error` instance thrown by a host function | script `Error` object (`name`, `message`, `stack`) with `cause` = `HostObject` of the original | so `catch (e) { e instanceof Error }` and `e.message` behave naturally |

- **Which host functions are classes (D25).** A host function becomes a host class iff either:
  - it is declared with ES `class` syntax (`Function.prototype.toString` output starts with `class`), or
  - the host marked it explicitly with the exported helper `markAsClass(fn)`. This is how built-in host constructors are exposed: `globals: { Date: markAsClass(Date), Map: markAsClass(Map) }`.
  Old-style constructor functions are plain functions unless marked. The classification happens once, in `toScript`, and is cached with the wrapper.
- **Blocked keys** (sandbox hardening): `__proto__`, `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`. Reads return `undefined`; writes → `TypeError`. This blocks the classic `obj.constructor.constructor('…')()` escape to the host `Function` constructor. Interop is **not** a full security sandbox; the docs must say so.
- Symbol-keyed properties of host objects are invisible to scripts (scripts have no symbols).
- A host function returning `undefined` gives `null` to the script (D37); missing properties of host objects read as `undefined` (host objects are bags).

**Script → host (`toHost`)**

| Script value | Host value | Behaviour |
|---|---|---|
| `Closure`, `NativeFunction`, `HostFunction` | `Proxy` over an **arrow-function** target | `apply` → `vm.callFunction`, with arguments converted by `toScript`; the arrow target has no `[[Construct]]`, so host-side `new` throws `TypeError` natively (D25); `typeof` is `'function'` |
| `Class` | `Proxy` over a **class** target | `construct` → script `new` semantics; `apply` → `TypeError` (class called without `new`); host-side `instanceof` works through a `Symbol.hasInstance` on the target that applies the §4.5.5 brand rule |
| `Array` | `Proxy` over an array target | index/`length` reads and writes go to the live `items`; `Array.isArray(proxy)` is `true`; `[...proxy]`, `for…of`, `JSON.stringify` work because `Symbol.iterator` and the array traps are implemented |
| `Object` (plain objects, class instances), `ModuleNamespace` | `Proxy` over an extensible object target (class instances: reading an undeclared member gives `undefined`, writing one throws `TypeError`, D36) | `get` → `runtime.getProperty` (getters run in the VM), `set` → `setProperty`, `has` → `hasProperty`, `ownKeys`/`getOwnPropertyDescriptor` → public own keys (reported as configurable, to satisfy proxy invariants), `deleteProperty` → removes an own data property (`false` for namespaces and class-declared members) |

- The host acts with **no home class**: protected and private members are inaccessible from the host, exactly like from top-level script code (§4.5.2). Reading one through a proxy throws the same `AccessError`.
- Host calls into script functions may pass extra arguments (they are dropped); missing required arguments → `TypeError` (D38).
- Calls from the host into the VM are **re-entrant**: allowed both when the VM is idle and while it is running a native that called into the host. Step and depth limits apply. A script exception escaping into the host is thrown as `PScriptRuntimeError` whose `value` is `toHost(thrownValue)`.
- Proxies stay valid for as long as the `Interpreter` lives. They hold a reference to it.

#### 5.8.2 Host functions vs stdlib natives

- **User-provided host functions** (from `globals`, `defineModule`, `set`) are `HostFunction`s. A host exception thrown from them is converted with `toScript` (Errors per the table above) and is **catchable** by scripts.
- **Stdlib natives** are `NativeFunction`s written against the runtime API. An unexpected host exception from them (a bug) becomes a non-catchable `InternalError` (§5.6.5).

### 5.9 Errors (`src/errors.ts`, contract)

```ts
export class PScriptError extends Error { fileName?: string; line?: number; column?: number }
export class PScriptSyntaxError extends PScriptError { /* message, line, column, excerpt (source line + caret) */ }
export class PScriptRuntimeError extends PScriptError {
  scriptName: 'TypeError' | 'ReferenceError' | 'RangeError' | 'AccessError' | 'Error' | string
  value: unknown                  // the thrown script value (converted toHost)
  scriptStack: { functionName: string, line: number, column: number }[]
}
```

- Message format: `<fileName>:<line>:<column> <ScriptName>: <message>`, followed by a code excerpt.
- Jison `parseError` is overridden via `yy.parseError`. It turns "Expecting …" into a readable list, maps tokens to their display text (`OBJ_LBRACE` → `{`), and reports the location of the offending token.

---

## 6. Testing strategy

All tests use Vitest (`npm test`). Coverage target: **≥ 90% lines/branches on `src/**`**. The generated parser is excluded.

### 6.1 Unit tests per layer

| Layer | Approach |
|---|---|
| Lexer | `source → [type, text]` tables for each token class, including every number/string edge case in §4.1 and errors with locations |
| Token filter | `source → token stream` assertions for every row of the §4.2.1 table, brace classification cases, arrow detection, and keyword-as-property |
| Parser | AST snapshot tests (loc stripped) per grammar production; error tests (message + location) |
| Grammar health | a test that builds the grammar and asserts **0 conflicts** (the plugin also enforces this) |
| Compiler | `disassemble()` snapshots for representative constructs; static-error tests |
| VM | hand-assembled protos via `vm/assembler.ts`, testing each opcode in isolation, plus handler/unwinding and re-entrancy tests |
| Runtime | operators (coercion table, strict `==`), properties (incl. protected matrix, accessors), format |
| Interop | `toScript`/`toHost` per row of the §5.8.1 tables, identity and round-trip unwrapping, blocked keys, proxy invariants (`Object.keys`, `JSON.stringify`, `Array.isArray`, spread on host side), re-entrant calls, exceptions in both directions |
| Stdlib | one test file per module |

### 6.2 Parser oracle: acorn

For every `.pscript` program in the corpus that is valid JS (most of them), parse it with `acorn` (`ecmaVersion: 'latest'`) and with PScript. Compare the ASTs after normalisation:

- strip `start`, `end`, `loc`, `range` and `access`;
- map acorn's `Identifier{name:'undefined'}` 1:1.

Exclude files tagged `// @pscript-only` (D2, D15). For the parser oracle, `==`/`!=` parse identically in acorn.

### 6.3 Behaviour oracle: differential testing against Node

- **Equality (D1)**: before running a program in Node, the harness rewrites `==` → `===` and `!=` → `!==` (a token-aware rewrite that skips strings and templates), so equality behaves identically and stays differential.
- `tests/programs/**/*.pscript`: each program writes output using `print(...)` with **primitives or `JSON.stringify(...)` only**, so the formatting differences in D18 do not matter.
- `differential.test.ts` runs each program in (a) PScript and (b) Node's `node:vm` in a fresh context, with `print` = a collector, and asserts identical stdout.
- Expected-output files (`*.out`) are checked in as well, so failures are readable and non-JS programs work. A script `npm run test:update-expected` regenerates them from Node for JS-compatible programs.
- Error programs: `*.err` contains the expected error name, message substring and line.
- **Module programs** are directories: `tests/programs/modules/<case>/` with `main.pscript` as the entry and sibling modules. Specifiers are written without extension (`'./math'`). PScript runs them through the default in-memory loader. For the Node side, the harness copies the files into a temp directory as `.mjs` and rewrites `from './x'` to `from './x.mjs'` (a regex over import/export specifiers is acceptable in test code), then runs `node main.mjs` as a child process with `print` provided by a small preloaded `globalThis.print` shim.
- The acorn oracle uses `sourceType: 'module'` for module programs.

### 6.4 Corpus coverage (minimum; WP-E owns it)

One directory per feature. Each needs ≥ 5 programs, including edge cases:

- **Literals and lexing**: `literals/` (numbers incl. e-notation, strings and escapes, booleans).
- **Statements and functions**: `asi/`, `operators/`, `scoping/` (TDZ, shadowing, per-iteration closures), `functions/` (defaults, recursion, hoisting, closures, counters).
- **Data structures and loops**: `lambdas/` (lexical `this`, expression vs block body, object-returning arrows), `objects/` (method shorthand, `this`, shorthand props, keywords as keys), `arrays/` (all stdlib methods), `loops/` (for, while, for-of, break/continue, nested).
- **Classes and errors**:
  - `classes/` (fields, statics, inheritance, super, default ctor, instanceof);
  - `arity/` (D38, `@pscript-only`): too few/too many arguments at compile time (declarations, const arrows, `this.m`, statics, `new`, `super`), class-definition time, link time (imports) and runtime (dynamic callees); defaults only on omission; parameter-order errors; override signature mismatch; interface signatures; stdlib callbacks receiving only declared arguments; host calls with extra arguments;
  - `closed-classes/` (D36, D37, `@pscript-only`): undeclared member reads/writes/calls at compile time (own chain), class-definition time (imported/host/expression superclass) and runtime (other receivers, computed keys, nested functions); `in`/reflection not throwing; host-side proxy behaviour; every row of the §4.4.12 table;
  - `tostring/` (D35, `@pscript-only`): default class `toString()` with every value kind, nested instances, arrays, plain objects, escapes, cycles, hidden private/protected fields, subclass names, anonymous classes, overrides and `super.toString()`, errors, and `print`/templates/`+`/`String()` all agreeing;
  - `templates/` (D34): plain, multiline (incl. `\r\n` normalisation), interpolation of every value kind, objects with `toString()`, nested templates, braces/strings/objects/arrows inside `${}`, escapes and invalid escapes, ASI around templates, tagged-template SyntaxError;
  - `overriding/` (D28, D29): `override` required / forbidden, kind mismatches, accessor halves, `final` members at depth > 1, `final` classes, static vs instance chains, overriding `toString` and `Error` members, host superclasses, sealed classes (`C.prototype`, adding statics, assigning to methods on instances), and the Node harness stripping of modifiers;
  - `construction/` (`@pscript-only`, D25–D27): every row of the §4.5.5 table, `new` on each non-class kind, `extends` of a function or `null`, `instanceof` with non-class right-hand sides, built-in error classes and subclasses, host classes via `markAsClass` and ES `class` detection, script classes extending host classes, constructor `return expr` SyntaxError;
  - `access/` (D30, D4), mostly `@pscript-only`: the private matrix (same class, other instance of the same class, subclass, nested class, lambda inside method, outside, host), the protected matrix (same class, subclass, superclass template method, sibling, outside, lambda inside method, static protected), each for fields, methods and both accessor halves with differing access; the §4.5.3 resolution cases (base private vs derived public with the same name, computed access, `in`, reflection showing public members only); access-changing overrides;
  - `implicit-members/` (D33, `@pscript-only`): reads, writes, compound updates and calls of fields, accessors and methods (instance and static, all access levels, own and inherited); virtual dispatch through implicit calls; every ambiguity source (outer `let`/`const`, function, class, interface, import, namespace import, script-level binding, stdlib global, host global) against own members (compile-time SyntaxError) and inherited members (definition-time TypeError); locals/params shadowing members; static-context errors; closures and nested `function`s; before-`super()`; nested classes; late host globals; `globalThis` disambiguation;
  - `interfaces/` (D31, D32, `@pscript-only`): every row of the §4.5.7 conformance table, missing-member error listing, interface `extends` with merging and conflicts, inherited `implements` through superclasses, `instanceof` with interfaces (class, subclass, sub-interface, object literal, host object), interfaces exported/imported across modules, interface-related SyntaxErrors;
  - `exceptions/` (throw any value, nested try, finally on return/break, runtime errors caught as Error);
  - `accessors/` (get/set pairs, getter-only assignment TypeError, setter-only read, static, inherited and overridden accessors, `super.x` accessors, compound assignment calling get+set once each, private and protected accessors, accessors hidden from `Object.keys`/`JSON.stringify`, methods named `get`/`set`).
- **Modules**: `modules/` (named exports of let/const/function/class, export lists with renaming, import renaming, live bindings, re-exports, side-effect imports and evaluation order, singletons, cycles with hoisted functions, TDZ in cycles, missing export link error, assignment to import SyntaxError, errored module rethrow, host modules via `defineModule`, rejected `export default`/`import * as` syntax).
- **Completion value**: `completion/`, every row of the §4.4.10 table plus loops with `break`/`continue`, nested `try`/`finally`, and REPL-style multi-`run` sessions. These run differentially against Node's `vm.runInContext`, which returns the same completion value.
- **Host and integration**: `stdlib/`, `interop/` (live mutation visible on both sides, host arrays/Maps in `for…of`, host callbacks receiving script closures, `interpreter.call`, limits incl. `Infinity`), and `programs/` (larger realistic programs: a tokenizer, a bank-account class hierarchy, fizzbuzz, a JSON pretty-printer, a quicksort, an event emitter).

### 6.5 Definition of done (whole project, v1)

- `npm run check` passes (lint + typecheck + tests).
- `npm run build` produces `dist/index.js` (ES only, D16) and `dist/index.d.ts`.
- All MUST and SHOULD features have corpus programs, and they pass.
- The differential suite passes.
- Coverage is ≥ 90%.
- `README.md` has usage plus a link to `docs/LANGUAGE.md`.
- A benchmark script (`npm run bench`: fib(27), loop of 1e6, 1e5 object allocations, array map/filter) runs and prints timings. No hard target in v1; record a baseline.

---

## 7. Multi-agent work breakdown

### 7.1 Overview and critical path

```
Phase 0  Foundation & contracts ................ 1 agent (coordinator)        [blocking]
           │
Phase 1  ┌─ WP-A Front-end (lexer, filter, grammar, builders, parse) ─┐
(parallel)├─ WP-B Compiler (+ disassembler)                            │
          ├─ WP-C VM (+ assembler test helper)                         ├─► Phase 2  Integration  ──► Phase 3 (parallel)
          ├─ WP-D Runtime & stdlib (+ format, accessors)               │   (1 agent, then fan-out     H1 errors/DX
          ├─ WP-E Test corpus & oracles (acorn, differential)          │    of fixes per area)        H2 docs/LANGUAGE.md
          ├─ WP-F Module system (loader, linker, namespaces, API)      │
          └─ WP-G Host interop (live proxies, §5.8.1)                 ─┘
                                                                                                      H3 perf
                                                                                                      H4 COULD features
                                                                                                      H5 CLI/REPL (COULD)
```

- The critical path is **P0 → WP-A → Integration**. WP-A is the largest work package.
- WP-B, WP-C and WP-D do not need the parser:
  - WP-B builds ASTs by hand (helper `t.*` factories in its own tests);
  - WP-C uses the assembler;
  - WP-D unit-tests the runtime functions directly.
- WP-E needs no implementation at all. It writes programs and expected outputs, and Node generates the expectations for JS-compatible programs.

### 7.2 Operating rules for every agent

1. Read `docs/PLAN.md` fully before starting. The spec wins; ask the coordinator about contradictions rather than guessing.
2. **Edit only the files your WP owns** (§5.2). Contract files are read-only. To change one, write a proposal in `docs/contract-changes.md` and notify the coordinator.
3. Code style comes from `@padcom/eslint-config-typescript`: no semicolons, single quotes, 2-space indent, trailing commas. Run `npx eslint <your files>` and `npm run typecheck` before finishing.
4. No runtime dependencies. Dev dependencies are added only by the coordinator.
5. Work in your own git worktree/branch (`wp/a-frontend`, …). Commit in small logical steps. The coordinator merges.
6. Finish with a short report:
   - what is done;
   - what deviates from the plan and why;
   - open issues, with test names that fail on purpose (`it.todo` / `it.fails`).

### 7.3 Phase 0: Foundation & contracts (coordinator, sequential)

**Deliverables**

1. `git init`, `.gitignore`, `.nvmrc`. Update `package.json` per §3.2 and install dev dependencies.
2. `vite.config.ts`, `eslint.config.js`, `tsconfig.json`, `vitest.setup.js`.
3. `build/vite-plugin-jison.ts` with a test: a tiny calculator `.jison` fixture compiles and fails on an intentionally conflicting fixture.
4. Contract files, fully typed, with stub implementations that throw `new Error('not implemented')`:
   - `src/parser/ast.ts`: §5.3 verbatim;
   - `src/parser/tokens.ts`: token names, ENDERS, CONTINUERS, keyword list;
   - `src/compiler/opcodes.ts`: the `Op` const enum, an `OPERAND_COUNT` table and a `STACK_EFFECT` doc comment per op;
   - `src/compiler/function-proto.ts`;
   - `src/runtime/values.ts`, `src/runtime/realm.ts` (interface);
   - `src/errors.ts`;
   - signatures for `runtime/operators.ts` and `runtime/properties.ts`. These signatures are the WP-C ↔ WP-D boundary:

     ```ts
     getProperty(ctx: AccessContext, recv: Value, key: string): Value
     setProperty(ctx: AccessContext, recv: Value, key: string, v: Value): void
     hasProperty(ctx, obj, key): boolean
     ownKeys(ctx, obj): string[]
     ```

     with `AccessContext = { realm: Realm, homeClass: Class | null, callFunction(fn, thisValue, args): Value }`, and `add/sub/…(a: Value, b: Value): Value`, `truthy`, `toNumber`, `toString`, `typeOf`, `strictEquals`, `instanceOf`;
   - `src/modules/module-record.ts` (§5.4), and the VM ↔ linker boundary: `vm.evaluateModule(record: ModuleRecord): void` and `vm.createModuleEnv(compiled: CompiledModule): Environment` (creates the env and initialises hoisted functions).
5. `src/index.ts` exporting the §5.8 API (stubs).
6. `tests/helpers/`:
   - `runProgram(src, opts) → { stdout, value, error }`;
   - `runInNode(src) → { stdout, error }`;
   - `stripLoc(ast)`.
7. The `src/grammar/pscript.jison` skeleton: a `%lex` with all tokens from §4.1, and a placeholder grammar `program: EOF`. It must compile through the plugin.
8. `npm run check` and `npm run build` are green, which proves the toolchain end to end. **Verify** `vite-plugin-eslint` against ESLint 10 (see risk K3).

**Done when** the repo builds, lints and tests green with stubs, and every contract file exists. Commit as the baseline, then create the WP branches.

### 7.4 WP-A: Front-end

- **Owns**: `src/grammar/pscript.jison`, `src/parser/token-filter.ts`, `src/parser/ast-builders.ts`, `src/parser/parse.ts`, `tests/unit/{lexer,filter,parser}/**`.
- **Spec**: §4.1–4.3, §5.3, §5.9 (syntax errors).
- **Tasks**:
  1. complete the lexer rules, including NEWLINE and string-escape decoding;
  2. the token filter (§4.2), built and unit-tested first, before the grammar;
  3. the grammar with precedence, conflict-free;
  4. builders (static checks that belong to syntax: assignment targets, const init, `access` from the member-name prefix);
  5. `parse()` with a fresh parser per call and friendly errors;
  6. the acorn oracle test over `tests/programs/**` once WP-E has files. Until then, inline samples.
- **Also**: access-modifier keywords, `interface` declarations and `implements` clauses (§4.3, D30, D31), `override`/`final` modifiers and `final class` (§4.2.4, §4.3), `get`/`set` (classes and object literals) and import/export contextual tokens (§4.2.5), accessor and module productions (including `import * as ns`), `parse(source, { goal: 'script' | 'module' })` setting `Program.sourceType`, and the syntax-level module errors (default exports, namespace imports, import/export not at top level).
- **Also**: template literals (§4.1.8, §4.2.6): the `TEMPLATE` lexer state with its brace-counter stack, cooked/raw values, `TemplateLiteral` productions.
- **Suggested internal order**: lexer → filter → statements → expressions → functions/arrows → objects → classes (incl. accessors) → try/catch → import/export → errors.
- **Acceptance**:
  - 0 grammar conflicts;
  - every row of the §4.2.1 table is a passing test;
  - the acorn oracle passes on all JS-compatible samples;
  - syntax errors report the correct line and column.

### 7.5 WP-B: Compiler

- **Owns**: `src/compiler/{scope,compiler,disassembler}.ts`, `tests/unit/compiler/**`.
- **Spec**: §4.4–4.5 (static semantics), §5.4, §5.5.
- **Tasks**:
  - scope analysis (hoisting, TDZ slots, const);
  - codegen for every AST node;
  - control stack for break/continue/return through try/finally and envs;
  - the class template;
  - private-member resolution against the lexically enclosing classes (emit `GET_PROP_PRIV`/`SET_PROP_PRIV`, §5.4);
  - `InterfaceTemplate`s and the `INTERFACE` instruction; `implements` lists for `CLASS`;
  - implicit member access (§4.5.8): name resolution with the class step, `implicitNames` in the template, `LOAD/STORE/CALL_IMPLICIT`, capturing the method's `this` for nested functions, compile-time ambiguity errors for own members vs. lexical bindings and stdlib globals;
  - completion value;
  - template literals via `TO_STRING`/`CONCAT` (§4.1.8);
  - strict-arity checks (D38): parameter-order errors, compile-time call checks for known callees, `memberRefs` with argument counts, constant function-declaration bindings, link-time checks of imported functions;
  - undeclared-member checks for `this`/class receivers: compile-time errors when the chain is visible, `memberRefs` in the template otherwise (D36); `null` defaults for fields, `let`, parameters and returns (D37);
  - accessors in the class template and in object literals (`DEFINE_GETTER` / `DEFINE_SETTER`, §5.4);
  - the completion register with the exact §4.4.10 rules;
  - strict `EQ`/`NE` for `==`/`!=` (D1);
  - module goal: `compileModule` producing `CompiledModule` (imports, local/indirect exports, hoisted functions, `LOAD_IMPORT`);
  - static errors, including the module, accessor, constructor-`return` (D27) and modifier ones in §4.3;
  - `override`/`final` flags into `ClassTemplate` (D28);
  - the disassembler.
- **Tests**: disassembly snapshots built from hand-written ASTs (a `t` factory helper in tests), plus static-error tests.
- **Coordinate with WP-C** through `docs/contract-changes.md` on any opcode change.
- **Acceptance**: every node type compiles; snapshots are reviewed; all static errors listed in §4.3 are tested.

### 7.6 WP-C: Virtual machine

- **Owns**: `src/vm/**`, `tests/unit/vm/**`.
- **Spec**: §4.4 (dynamic semantics), §4.5 (class construction, private brand), §5.4, §5.6.
- **Tasks**:
  - the dispatch loop for every opcode;
  - frames, environments and TDZ;
  - calls (closures, natives, classes, `new`, `super`);
  - re-entrant `callFunction`;
  - exceptions and finally completions;
  - iterators;
  - step and depth limits;
  - script stack traces;
  - installing accessors in `CLASS` and private accessors in `GET_PRIVATE`/`SET_PRIVATE`;
  - class-only `NEW` and `extends` checks, `klass` branding, built-in and host superclasses in `SUPER_CALL` (§4.5.5, §5.6.3);
  - `memberRefs` verification (D36), override/final/access checks, member and private indexes, implicit-name resolution tables and ambiguity checks, and interface conformance in `CLASS`; `INTERFACE`; `LOAD/STORE/CALL_IMPLICIT` (§5.6.7);
  - module frames, `LOAD_IMPORT`, `evaluateModule` and `createModuleEnv` (§5.6.8);
  - the assembler test helper (`assemble('CONST 0\nHALT', { constants: [1] })`).
- **Depends on** WP-D for operators and properties. Until they land, use the P0 stubs plus a minimal local fallback in tests only.
- **Acceptance**: every opcode has a unit test; unwinding works across native boundaries; limits are enforced.

### 7.7 WP-D: Runtime & standard library

- **Owns**: `src/runtime/{operators,properties,classes,format,realm}.ts` (implementation), `src/stdlib/**`, `tests/unit/{runtime,stdlib}/**`.
- **Spec**: §4.4.1–4.4.3, §4.4.6–4.4.7, §4.5.2–4.5.4 (runtime checks, accessors), §4.6, §5.7.
- **Tasks**:
  - coercions and operators (D1, D5), including brand-based `instanceof` for classes and interfaces (D26, D32);
  - the built-in `Error` classes as native `Class`es (D25);
  - `ToString` for objects and the default class-instance `toString()` (§4.4.3, §4.4.11);
  - property access, including arrays, primitives, **accessor properties** (§4.5.4), the member-resolution algorithm (§4.5.3) over class member and private indexes (§5.6.7), the sealed-class write rules (D29) and the **private and protected access matrices**;
  - class helpers (brand, private storage via `PrivateKey`, interface sets);
  - realm intrinsics;
  - all stdlib natives (callback methods use `ctx.callFunction`, provided by the VM through `NativeContext`);
  - `print` formatting;
  - the exotic-object hooks in `getProperty`/`setProperty`/`hasProperty`/`ownKeys` that delegate to `ModuleNamespace` (WP-F) and `HostObject`/`HostFunction` (WP-G) through small interfaces defined in P0.
- **Acceptance**:
  - the operator coercion tables match Node for primitive operands (generate the table in tests by evaluating in Node);
  - the private and protected matrices are fully tested;
  - every stdlib function has tests.

### 7.8 WP-E: Test corpus & oracles

- **Owns**: `tests/programs/**`, `tests/differential.test.ts`, `tests/programs.test.ts`, `scripts/update-expected.ts`.
- **Spec**: all of §4, §6.
- **Tasks**:
  - write the corpus (§6.4);
  - generate `.out` files from Node for JS-compatible programs;
  - hand-write `.out`/`.err` for `@pscript-only` programs;
  - the program runner and the differential runner.
  - Tests may be marked `it.todo` until integration. The corpus must be **complete before Phase 2 starts**.
- **Acceptance**:
  - ≥ 5 programs per directory in §6.4;
  - every MUST feature appears in ≥ 3 programs;
  - every protected/private access-matrix cell and every interface-conformance rule has a program;
  - the Node run of every JS-compatible program is green, which validates the corpus itself.

### 7.8a WP-F: Module system

- **Owns**: `src/modules/loader.ts`, `src/modules/linker.ts`, the module methods of `Interpreter` (in a separate `src/modules/api.ts` that `index.ts` delegates to), `tests/unit/modules/**`.
- **Spec**: §4.7, §5.4 (module contract), §5.6.8, §5.8.
- **Tasks**:
  - default in-memory loader with relative-path normalisation and the `.pscript` → `.psc` fallback (D10); host modules with live values and `defineModule`;
  - module namespace objects (§4.7.2): sorted keys, live reads, frozen;
  - graph loading: call the loader for each request, parse with goal `module`, `compileModule`, cache records by resolved id;
  - linking: resolve every import and indirect export to a `BindingCell` (following re-export chains, detecting missing exports and circular re-exports), create module envs via `vm.createModuleEnv` before any evaluation;
  - evaluation: DFS post-order with the status machine (`linking` / `evaluating` / `evaluated` / `errored`), cycle handling, error caching;
  - `runModule`, `importModule` (returning the namespace through `toHost`, i.e. a live proxy);
  - keep every loader call inside `fetchModule` (§1.7).
- **Depends on** the `CompiledModule`/`ModuleRecord` contracts only. Until WP-A/B/C land, unit-test the linker with hand-built `CompiledModule` fixtures and a fake VM that records evaluation order.
- **Acceptance**: loader path-resolution table tested; link errors (missing export, circular re-export, loader failure) tested with messages; evaluation order and cycle behaviour match the §4.7.2 rules on fixture graphs.

### 7.8b WP-G: Host interop

- **Owns**: `src/runtime/interop.ts`, `src/runtime/host-object.ts` (behaviour of `HostObject` / `HostFunction`), `tests/unit/interop/**`.
- **Spec**: §5.8.1, §5.8.2, §4.4.8 (host iterables), §4.6.2 (formatting of host values).
- **Tasks**: both conversion directions with identity caches and unwrapping; host-class detection and `markAsClass` (D25), host-side `new`/`instanceof` behaviour of class proxies; the JS `Proxy` handlers for script objects, arrays, functions and namespaces; `HostObject`/`HostFunction` semantics including blocked keys, `this` binding, host iterators, and host `Error` conversion; exception translation in both directions.
- **Depends on** the `values.ts` contract and the `AccessContext`/`vm.callFunction` signatures. Until WP-C/D land, test against a fake runtime that implements `getProperty`/`setProperty` over plain Maps.
- **Acceptance**: every row of the §5.8.1 tables has tests; `toScript(toHost(x)) === x` and the reverse hold; `JSON.stringify`, `Object.keys`, `Array.isArray` and spread work on proxies from the host side; the `constructor.constructor` escape is blocked.

### 7.9 Phase 2: Integration (coordinator, then fan-out)

1. Merge WP branches into `main` in the order P0 → D → G → C → B → A → F → E. Resolve contract-change requests.
2. Wire the pipeline: `parse → compile → Interpreter.execute`.
3. Run the full suite. Bucket failures by layer (front-end / compiler / VM / runtime / test bug).
4. Spawn one fix agent per bucket, with the same ownership rules as Phase 1. Iterate until §6.5 is met, except for docs and bench.

### 7.10 Phase 3: Hardening (parallel)

- **H1 Errors & DX**: excerpts with carets, "did you mean" suggestions for undeclared names, consistent messages.
- **H2 Docs**: `docs/LANGUAGE.md` (user reference, derived from §4) and `README.md`.
- **H3 Performance**: bench script; fast paths (number-number `ADD`, monomorphic `GET_PROP` caching on `Object` if needed, avoiding env allocation for blocks without captures).
- **H4 COULD features**, each as a vertical slice through all layers, owned by one agent, in priority order:
  1. spread/rest;
  2. optional chaining;
  3. computed keys;
  4. `do…while`;
  5. `switch`;
  6. bitwise operators;

- **H5 CLI/REPL**: `bin/pscript` (Node-only entry, outside `src/` so the library stays browser-safe).

### 7.11 Coordinator kick-off prompt (paste into a new session)

> Read `docs/PLAN.md` completely. You are the coordinator.
> 1. Execute **Phase 0** yourself exactly as specified in §7.3 and commit it.
> 2. Spawn seven agents in parallel (worktree isolation), one per work package WP-A … WP-G. Give each the text of its §7.x section plus §7.2, and tell it to read the whole PLAN.md first.
> 3. While they run, review `docs/contract-changes.md` requests as they arrive.
> 4. When all have reported, execute **Phase 2** (§7.9). Spawn fix agents per failure bucket until the definition of done (§6.5) holds.
> 5. Then run Phase 3 work packages H1–H3 in parallel; ask me before starting H4/H5.
> Report progress after each phase with test counts and any deviations from the plan.

### 7.12 Sequential path: one milestone per session

An alternative to the multi-agent plan, for implementing PScript **one small piece at a time**, each in a fresh session that will not run out of context. Each milestone is a **vertical slice**: it touches lexer, grammar, compiler, VM and runtime only as far as its feature needs, and ends with something runnable and tested.

**Rules for every milestone session**

1. **Don't read the whole plan** (it is ~45k tokens). Read `docs/PROGRESS.md`, §2 (decisions), the milestone's row below, and only the sections it lists. Find them with `grep -n '^#' docs/PLAN.md` and read by line range.
2. Follow the contracts in §5 (AST, bytecode, value model, API) even when only part of them is needed yet: add to files in their final shape, never invent a different structure.
3. Add tests for everything in the milestone: unit tests plus programs under `tests/programs/<dir>/` (lift the matching examples from §10).
4. Finish with `npm run check` green, a commit, and an update to `docs/PROGRESS.md`: milestone done, deviations from the plan, known gaps, and what the next session should know.
5. If a milestone turns out bigger than one session, split it at a natural boundary and record the split in `docs/PROGRESS.md`.

**Session prompt template**

> Implement milestone **M<n>** from `docs/PLAN.md` §7.12. First read `docs/PROGRESS.md` and §2. Then read only the sections listed for M<n>. Follow the rules in §7.12. Stop when the milestone's "done when" holds.

**Milestones**

| # | Milestone | Read | Done when |
|---|---|---|---|
| M0 | **Scaffolding**: `git init`, package.json, Vite/ESLint/TS/Vitest config, Jison plugin with a fixture grammar, `PROGRESS.md` | §3 | `npm run check` and `npm run build` green; plugin rejects a conflicting grammar |
| M1 | **Contracts**: `ast.ts`, `opcodes.ts`, `function-proto.ts`, `values.ts`, `errors.ts`, `tokens.ts` as types/enums only | §5.3, §5.4, §5.7, §5.9, §4.1.2 | files compile; no logic yet |
| M2 | **Calculator end to end**: numbers, strings, booleans, `null`/`undefined`, `+ - * / % **`, unary ops, parentheses; compiler; VM loop; `Interpreter.run` returning the value; `print` | §4.1.3–4.1.6, §4.4.3 (arithmetic), §5.5, §5.6.1–5.6.2, §5.8 | `run('1 + 2 * 3') === 7`; `print('a', 1)` writes `a 1` |
| M3 | **Statements and ASI**: comments, NEWLINE tokens, token filter with ASI, expression statements, statement lists | §4.1.1, §4.2.1 | every row of the §4.2.1 table passes (rows needing later features marked `it.todo`) |
| M4 | **Variables**: `let`/`const`, blocks, environments, TDZ, assignment and compound assignment, script-level bindings persisting across `run()`, globals; differential test harness | §4.4.4, §6.3 | scoping programs pass, also against Node |
| M5 | **Operators**: comparisons, strict `==`/`!=` (no `===`), logical, `??`, ternary, `typeof`, `++`/`--`, D5 TypeErrors | §4.4.2–4.4.3 | operator tables tested, Node-compared for primitives |
| M6 | **Control flow**: `if`/`else`, `while`, `for` with per-iteration `let`, `break`/`continue`, completion-value rules | §4.4.8, §4.4.10 | FizzBuzz and every §4.4.10 row pass |
| M7 | **Functions**: declarations with hoisting (constant bindings), expressions, calls with strict arity (D38), `return` (`null` default, D37), defaults, closures, `maxCallDepth`, stack traces | §4.4.5, §4.4.13, §5.6.3 | closure/counter/recursion programs pass |
| M8 | **Arrow functions**: arrow detection in the filter, lexical `this` | §4.2.3, §4.4.5 | arrow programs pass |
| M9 | **Objects**: brace classification, object literals, property access, method shorthand with `this`, shorthand properties, keywords as keys, `CALL_METHOD`; acorn oracle | §4.2.2, §4.2.4, §4.4.6 (no accessors), §6.2 | object programs pass, parser matches acorn |
| M10 | **Arrays and `for…of`**: literals, indexing, `length`, non-callback array methods, `GET_ITER`/`ITER_NEXT` | §4.4.7, §4.4.8, §4.6.4 (partial) | array/loop programs pass |
| M11 | **Exceptions**: `throw`, `try`/`catch`/`finally`, the `Error` built-in classes, runtime errors as catchable objects | §4.4.9, §5.6.5, §4.6.1 (errors) | exception programs, incl. `finally` on `return`/`break` |
| M12 | **Callbacks and re-entrancy**: `vm.callFunction`, array callback methods, `sort` | §5.6.4, §4.6.4 | `map`/`filter`/`reduce`/`sort` with throwing callbacks pass |
| M13 | **Standard library**: strings, `Math`, `Object`, `JSON.stringify`, conversions, `globalThis`, `print` formatting | §4.6 | stdlib tests pass |
| M14 | **Template literals**: `TEMPLATE` lexer state with brace stack, cooked/raw values, filter rules, `TemplateLiteral` grammar, `TO_STRING`/`CONCAT`, object `ToString` | §4.1.8, §4.2.6, §4.4.3 (ToString) | `templates/` programs pass, also against Node |
| M15 | **Classes**: declarations/expressions, fields (`null` default), constructor, methods, statics, closed instances with early errors (D36), default `toString()` (D35), `extends`/`super`, class-only `new`, brand-based `instanceof`, D27, sealed classes, flattened member index | §4.5.1, §4.5.5, §4.5.6 (sealed part), §4.5.9, §4.4.11, §5.6.3, §5.6.7 | class and construction programs pass |
| M16 | **Accessors**: class and object-literal getters/setters, accessor halves | §4.5.4, §4.4.6 | accessor programs pass |
| M17 | **Access modifiers**: `public`/`protected`/`private`, member resolution, `GET_PROP_PRIV`, `AccessError`, reflection shows public only | §4.5.2, §4.5.3, §5.6.6 | full access matrices pass |
| M18 | **Overriding**: `override`, `final` members and classes, access-preserving overrides | §4.5.6 | override programs pass |
| M19 | **Interfaces**: declarations, `extends`, `implements`, conformance check, `instanceof` with interfaces | §4.5.7 | interface programs pass |
| M20 | **Implicit member access**: resolution step, `LOAD/STORE/CALL_IMPLICIT`, strict ambiguity rule (compile time and class-definition time) | §4.5.8 | implicit-members programs pass |
| M21 | **Modules I**: grammar, `compileModule`, loader with `.pscript`/`.psc`, linker, named imports/exports with renaming, live bindings, singletons, `runModule`/`importModule` | §4.7.1–4.7.3, §5.4 (module contract), §5.6.8 | module programs pass, also against Node |
| M22 | **Modules II**: re-exports, namespace imports, cycles, errored modules, host modules, `defineModule` | §4.7.2–4.7.3 | cycle and namespace programs pass |
| M23 | **Host interop**: live proxies in both directions, `HostObject`/`HostFunction`, `markAsClass`, host classes, blocked keys, exception translation | §5.8.1–5.8.2 | interop tests pass |
| M24 | **Limits and polish**: `maxSteps`, error excerpts, public API review, ES-only build check, coverage ≥ 90% | §5.8, §5.9, §6.5 | §6.5 definition of done, except docs |
| M25 | **Docs and benchmark**: `docs/LANGUAGE.md` (incl. "Differences from JavaScript"), README, `npm run bench` | §7.10 (H2, H3) | v1 complete |

The multi-agent plan (§7.1–7.11) and this sequential path produce the same result. The sequential path can switch to parallel agents at any milestone boundary, because both follow the same contracts.

---

## 8. Risks & mitigations

| ID | Risk | Mitigation |
|---|---|---|
| K1 | `jison@0.4.18` is old (2017) and CommonJS-only; its generated code is not ESM | Used only at build time inside the Vite plugin. Output is wrapped with `export default`. `jison-gho` is the fallback if blocking bugs appear |
| K2 | LALR conflicts (arrows, object vs block, `new`, dangling else, ASI) | Context-sensitive decisions move into the token filter (§4.2). Dangling else is resolved by precedence. Conflicts fail the build |
| K3 | `vite-plugin-eslint` (pulled in by `@padcom/vite-config-default`) is old and may not work with ESLint 10 flat config | Verify in Phase 0. If it breaks, disable the plugin through overrides (or fix upstream in `@padcom/vite-config-default`) and rely on `npm run lint` |
| K4 | TypeScript must stay `<6` because of a `@padcom/vite-config-default` peer | Pin `typescript ~5.9` |
| K5 | Contract churn between parallel agents | Contracts frozen in P0; a change-request file; the coordinator arbitrates |
| K6 | `finally` + break/continue/return complexity | A dedicated corpus directory; the completion-record design is fixed in §5.6.5 |
| K7 | Access semantics (protected on the same inheritance line, per-class private) surprise users | Rules fixed in §4.5.2–4.5.3 (D4, D30). Full access matrix in tests. Documented in LANGUAGE.md |
| K8 | Output-format differences break the differential tests | Differential programs print only primitives or `JSON.stringify` (§6.3) |
| K12 | Live proxies expose more host surface to scripts than copies would | Blocked-key list, symbol keys invisible, interop documented as "not a security sandbox"; tests for known escape patterns |
| K13 | Naming runtime classes `Object`/`Array`/`Function` shadows JS built-ins inside the implementation | `globalThis.*` convention (§5.7), review checklist item in Phase 2 |
| K14 | D25 breaks common JS idioms (old-style constructor functions, `new Date()` without setup) and confuses JS developers | Clear error messages that say to use a class; `markAsClass` for host constructors; a "Differences from JavaScript" chapter in `docs/LANGUAGE.md` (H2) that lists every `@pscript-only` deviation from §2 |
| K15 | Mandatory `override` makes overriding `toString`/`Error` members noisier, and harness stripping of modifiers could mangle programs | Clear error messages that suggest adding `override`; the stripping regex only touches modifier positions and has its own unit tests |
| K18 | Implicit member access makes code depend on the superclass's member list (fragile base class) | Strict ambiguity rule (D33): conflicts fail when the class is defined, never silently; explicit `this.`/`globalThis.` always available |
| K16 | Keyword-based private access needs runtime resolution (`this.x` may be private or public) | Compiler emits `GET_PROP_PRIV` only for names that an enclosing class declares private, so ordinary property access keeps the fast path; resolution cases have dedicated tests |
| K17 | Interfaces and access modifiers make many class programs non-JS, shrinking differential coverage | The harness strips access modifiers, `override`, `final` and `implements` clauses; only programs that test violations or use interfaces at runtime are `@pscript-only` |
| K10 | Module cycles and live bindings are subtle (TDZ across modules, hoisted functions, re-export chains) | Envs created at link time before evaluation; fixture-graph unit tests in WP-F; differential module tests against Node |
| K11 | Contextual `get`/`set`/`as`/`from` collide with ordinary identifiers | Decided only in the token filter with explicit lookahead rules (§4.2.5); tests for methods/variables named `get`, `set`, `from`, `as` |
| K9 | Performance of an environment-based closure model | Acceptable for v1. H3 folds block environments that no closure can observe into the enclosing one (§5.5) |

---

## 9. Reference program (exercises every MUST feature)

```js
// numbers, strings, booleans
const big = 6.022e23, small = 1.5E-3, n = 42, half = .5
let greeting = 'Hello' + ", " + "world\n"
let ok = true && !false

// functions, defaults, return
function sum(items, start = 0) {
  let total = start
  for (let i = 0; i < items.length; i++) total += items[i]
  return total
}

// lambdas
const square = x => x * x
const add = (a, b) => { return a + b }
const pair = () => ({ a: 1, b: 2 })

// object literal with method shorthand
const counter = {
  count: 0,
  inc() { this.count++; return this },
  get() { return this.count },
  get doubled() { return this.count * 2 }    // object-literal getter (R18)
}
counter.inc().inc()

// arrays, for-of, while
let squares = []
for (let x of [1, 2, 3, 4]) squares.push(square(x))
let i = 0
while (i < squares.length) { i++ }

// interfaces, classes with private and protected members
interface Describable {
  describe()
  get balance()
}

class Account {
  private amount = 0
  protected owner
  static count = 0
  constructor(owner) { this.owner = owner; Account.count++ }
  deposit(v) { this.check(v); this.amount += v; return this }
  get balance() { return this.amount }        // getter (R17)
  set nickname(v) { this.owner = v }          // setter
  private check(v) { if (v <= 0) throw new Error('invalid amount') }
  protected label() { return this.owner }
}

final class Savings extends Account implements Describable {
  rate = 0.02
  override protected label() { return 'Savings of ' + super.label() }   // explicit override (D28)
  describe() { return this.label() + ' (savings)' }                     // protected access from subclass: OK
}

const s = new Savings('Ann').deposit(100)
print(s.describe(), s.balance, Account.count, sum(squares), counter.get(), counter.doubled)
print(1 == '1', 1 == 1)   // false true (strict equality, D1)
print(s instanceof Account, s instanceof Describable, counter instanceof Account)   // true true false (D26, D32)
// new sum([1])           // TypeError: sum is not a class (D25)

try {
  s.label()             // AccessError: protected member accessed outside the hierarchy
} catch (e) {
  print(e.name, e.message)
}
```

---

## 10. Feature examples

One short example per feature, to judge the language design at a glance. `// →` shows the printed output. Lines commented out with `//` show errors. Every example follows the spec above, and the test corpus (§6.4) should start from them.

### 10.1 Literals

```js
print(42, 3.14, .5, 5., 1e3, 1.5E-3)      // → 42 3.14 0.5 5 1000 0.0015
print('single', "double", 'A\x42')   // → single double AB
print("say \"hi\"", 'it\'s')              // → say "hi" it's
print(true, false, null, undefined)       // → true false null undefined
```

### 10.2 Template literals and multiline strings (D34)

```js
const user = { name: 'Ann', tasks: ['write', 'test'] }
print(`Hello, ${user.name}!`)                     // → Hello, Ann!
print(`${user.tasks.length} tasks: ${user.tasks.join(', ')}`)   // → 2 tasks: write, test
print(`2 + 2 = ${2 + 2}, cost: $5, ${ {a: 1}.a }`)   // → 2 + 2 = 4, cost: $5, 1

const list = `<ul>
${user.tasks.map(t => `  <li>${t}</li>`).join('\n')}
</ul>`                                              // multiline with nested templates
print(list)
// → <ul>
//     <li>write</li>
//     <li>test</li>
//   </ul>

class Money {
  amount
  constructor(amount) { this.amount = amount }
  override toString() { return `$${amount.toFixed(2)}` }   // `$` before `${` is literal text
}
print(`Total: ${new Money(5)}`)                   // → Total: $5.00   (interpolation calls toString)
print(`escaped: \${not interpolated} \` backtick`)   // → escaped: ${not interpolated} ` backtick
// print`x`                                       // SyntaxError: tagged templates are not supported
```

### 10.3 Comments and optional semicolons

```js
// line comment
/* block
   comment */
let a = 1
let b = a
  + 2                  // a line starting with an operator continues: b = a + 2
let c = [1, 2]
  .map(x => x * 10)    // a line starting with `.` continues the chain
print(b, c)            // → 3 [10, 20]

function f() {
  return
  42                   // `return` ends at the newline, as in JS
}
print(f())             // → null   (D37)

let g = a
(b)                    // D2: a line starting with `(` is a new statement, not a call a(b)
```

### 10.4 Variables and scope

```js
const LIMIT = 3
let x = 1
{
  let x = 2
  print(x)             // → 2
}
print(x)               // → 1
// LIMIT = 4           // SyntaxError: Assignment to constant variable 'LIMIT'
// print(y); let y = 1 // ReferenceError: Cannot access 'y' before initialization

let fns = []
for (let i = 0; i < LIMIT; i++) fns.push(() => i)
print(fns.map(fn => fn()))   // → [0, 1, 2]   (a fresh `i` per iteration)
```

### 10.5 Operators and equality (D1, D5, D15)

```js
print(1 + 2 * 3, 2 ** 3 ** 2, -2 ** 2)       // → 7 512 -4
print('a' + 1, '3' * 2, 7 % 3)               // → a1 6 1
print(1 == 1, 1 == '1', null == undefined)   // → true false false   (strict: no coercion)
print('a' != 'b')                            // → true
// 1 === 1                                   // SyntaxError: '===' is not supported; use '=='
print(null ?? 'default', 0 || 'x', 0 ?? 'x') // → default x 0
print(typeof 1, typeof 'a', typeof null, typeof notDeclared)   // → number string null undefined   (D39)
let n = 5
n += 2
n **= 2
print(n++, n)                                // → 49 50
// [] + {}                                   // TypeError: Cannot apply '+' to array and object (D5)
// [1] < 2                                   // TypeError (D5)
```

### 10.6 Control flow

```js
for (let i = 1; i <= 15; i++) {
  if (i % 15 == 0) print('FizzBuzz')
  else if (i % 3 == 0) print('Fizz')
  else if (i % 5 == 0) print('Buzz')
  else print(i)
}

let i = 0
while (true) {
  i++
  if (i == 2) continue
  if (i > 4) break
  print(i)                          // → 1, then 3, then 4
}

for (const ch of 'hey') print(ch)   // → h, e, y
for (let item of [10, 20]) print(item)   // → 10, 20
```

### 10.7 Functions

```js
print(square(4))                    // → 16   (declarations are hoisted)
function square(x) { return x * x }

function greet(name, greeting = 'Hello') { return greeting + ', ' + name }
print(greet('Ann'), '/', greet('Bob', 'Hi'))   // → Hello, Ann / Hi, Bob
print(square.name, greet.length)    // → square 1

function counter() {
  let n = 0
  return () => ++n
}
const next = counter()
next()
next()
print(next())                       // → 3
// new square(2)                    // TypeError: square is not a class (D25)
// greet()                          // SyntaxError: greet(name, greeting?) expects 1-2 arguments, got 0 (D38)
// square(1, 2)                     // SyntaxError: square(x) expects 1 argument, got 2 (D38)
// square = null                    // SyntaxError: function declarations are constant (D38)
```

### 10.8 Lambdas

```js
const double = x => x * 2
const add = (a, b) => a + b
const make = () => ({ ok: true })            // an object result needs parentheses
const block = n => { const m = n + 1; return m * 2 }
print(double(4), add(1, 2), make().ok, block(2))   // → 8 3 true 6
print([3, 1, 2].sort((a, b) => a - b))       // → [1, 2, 3]
```

### 10.9 Objects (R4, R18)

```js
const name = 'Ann'
const user = {
  name,                                       // shorthand property
  'full name': 'Ann Smith',
  class: 'admin',                             // keywords are allowed as keys
  greet() { return 'Hi, ' + this.name },      // method shorthand
  get initials() { return 'AS' },             // getter
  set nick(v) { this.name = v },              // setter
}
print(user.greet(), '/', user['full name'], '/', user.class, user.initials)
                                              // → Hi, Ann / Ann Smith / admin AS
user.nick = 'Annie'
print(user.name)                              // → Annie
print(Object.keys(user))     // → ["name", "full name", "class", "greet", "initials", "nick"]
print(user)                  // → {name: "Annie", "full name": "Ann Smith", class: "admin", greet: [Function: greet], initials: [Getter], nick: [Setter]}
print(JSON.stringify({ a: 1, b: [true, null] }))   // → {"a":1,"b":[true,null]}
```

### 10.10 Arrays

```js
const xs = [5, 3, 8]
xs.push(1)
print(xs.length, xs[0], xs.at(10))               // → 4 5 null
// xs[10]                                        // RangeError: Index 10 out of range for length 4 (D37)
print(xs.filter(x => x > 3).map(x => x * 2))     // → [10, 16]
print(xs.reduce((a, b) => a + b, 0))             // → 17
print(xs.includes(8), xs.indexOf(3), xs.join('-'))   // → true 1 5-3-8-1
print(Array.isArray(xs))                         // → true
// xs['foo'] = 1                                 // TypeError: arrays only accept integer keys
// [] instanceof Array                           // TypeError: Array is not a class (use Array.isArray)
```

### 10.11 Standard library

```js
print(Math.max(1, 5, 3), Math.floor(2.7), parseInt('42px'), Number('3.5'))   // → 5 2 42 3.5
print(String(7).padStart(3, '0'), 'a,b,c'.split(','), '  hi '.trim().toUpperCase())
                                                 // → 007 ["a", "b", "c"] HI
print(globalThis.print == print)                 // → true
```

### 10.12 Exceptions

```js
function parse(n) {
  if (typeof n != 'number') throw new TypeError('not a number: ' + n)
  return n
}
try {
  parse('x')
} catch (e) {
  print(e.name, e.message, e instanceof TypeError)   // → TypeError not a number: x true
} finally {
  print('done')                                      // → done
}

try { null.x } catch (e) { print(e.name) }           // → TypeError

class ValidationError extends Error {
  override name = 'ValidationError'                  // `name` is inherited from Error, so `override`
}
try { throw new ValidationError('bad input') } catch (e) { print(e.name, e.message) }
                                                     // → ValidationError bad input
```

### 10.13 Completion value (D12), seen from the host

```ts
import { Interpreter } from '@padcom/pscript'

const vm = new Interpreter()
vm.run('1 + 2')                                    // 3
vm.run('let x = 5')                                // undefined
vm.run('x * 2')                                    // 10   (bindings persist between runs)
vm.run('if (x > 1) { "big" } else { "small" }')    // 'big'
vm.run('try { 1 } finally { 2 }')                  // 1
```

### 10.14 Classes

```js
class Point {
  x = 0
  y = 0
  constructor(x, y) { this.x = x; this.y = y }
  plus(other) { return new Point(this.x + other.x, this.y + other.y) }
  override toString() { return '(' + this.x + ', ' + this.y + ')' }   // overrides Object's toString
  static of(x, y) { return new Point(x, y) }
}
const p = Point.of(1, 2).plus(new Point(3, 4))
print(p.toString(), p instanceof Point, typeof Point)   // → (4, 6) true function
print(p)                                                // → (4, 6)   (print uses the overridden toString)

class Pair { left = 'a'; right = 2 }
print(new Pair(), `${new Pair()}`)                      // → Pair(left = "a", right = 2) Pair(left = "a", right = 2)   (default toString, D35)
// Point(1, 2)          // TypeError: Class constructor Point cannot be invoked without 'new'
// Point.prototype      // SyntaxError: Class 'Point' has no member 'prototype' (D29, D36)
// Point.extra = 1      // TypeError: classes are not extensible (D29)
```

### 10.15 Inheritance, construction and `instanceof` (D25–D27)

```js
class Animal {
  name
  constructor(name) { this.name = name }
  speak() { return this.name + ' makes a sound' }
}
class Dog extends Animal {
  tricks = []
  constructor(name) {
    super(name)                         // required before using `this`
    this.tricks.push('sit')
  }
  override speak() { return super.speak() + ': woof' }
}
const d = new Dog('Rex')
print(d.speak())                        // → Rex makes a sound: woof
print(d instanceof Dog, d instanceof Animal, ({}) instanceof Animal)   // → true true false
// new (function () {})()               // TypeError: anonymous function is not a class (D25)
// class Bad { constructor() { return {} } }   // SyntaxError: Constructors cannot return a value (D27)
```

### 10.16 Access modifiers (D30, D4)

```js
class Account {
  private balance = 0
  protected owner
  constructor(owner) { this.owner = owner }
  deposit(amount) { this.check(amount); this.balance += amount; return this }
  get total() { return this.balance }
  sameBalance(other) { return this.balance == other.balance }   // private is per class, not per instance
  private check(amount) { if (amount <= 0) throw new RangeError('amount must be positive') }
}

class Savings extends Account {
  describe() { return this.owner + ' has ' + this.total }        // protected + public: OK
  // peek() { return this.balance }     // AccessError at call time: 'balance' is private to Account
}

const s = new Savings('Ann').deposit(50)
print(s.describe())                     // → Ann has 50
print(Object.keys(s), JSON.stringify(s))   // → [] {}   (reflection shows public members only)
try { s.owner } catch (e) { print(e.name, e.message) }
// → AccessError Cannot access protected member 'owner' of class 'Account' from outside its class hierarchy

// Protected works along the whole inheritance line, so a base class can call a subclass hook:
class Report {
  final render() { return '<' + this.body() + '>' }
}
class Html extends Report {
  protected body() { return 'html' }
}
print(new Html().render())              // → <html>

// A private member and a public member with the same name never clash:
class Base {
  private tag = 'base'
  showTag() { return this.tag }         // always Base's private `tag`
}
class Derived extends Base {
  tag = 'derived'                       // a new public member; no `override`, Base.tag is private
}
print(new Derived().showTag(), new Derived().tag)   // → base derived
```

### 10.17 Getters and setters in classes (R17)

```js
class Temperature {
  private celsius = 0
  get fahrenheit() { return this.celsius * 9 / 5 + 32 }
  set fahrenheit(f) { this.celsius = (f - 32) * 5 / 9 }
  get kelvin() { return this.celsius + 273.15 }
  protected set kelvin(k) { this.celsius = k - 273.15 }   // the two halves may differ in access
}
const t = new Temperature()
t.fahrenheit = 212
print(t.fahrenheit, t.kelvin)           // → 212 373.15
// t.kelvin = 0                         // AccessError: the setter is protected

class Rounded extends Temperature {
  override get fahrenheit() { return Math.round(super.fahrenheit) }   // the inherited setter still applies
}
const r = new Rounded()
r.fahrenheit = 100
print(r.fahrenheit)                     // → 100
```

### 10.18 Overriding, `final` and sealed classes (D28, D29)

```js
class Shape {
  area() { return 0 }
  final describe() { return 'area ' + this.area() }
}
class Circle extends Shape {
  r
  constructor(r) { super(); this.r = r }
  override area() { return 3 * this.r ** 2 }
}
final class Unit extends Shape {
  override area() { return 1 }
}
print(new Circle(2).describe(), '/', new Unit().describe())   // → area 12 / area 1

// class A extends Shape { area() {} }               // TypeError: 'area' overrides 'Shape.area' and must be marked 'override'
// class B extends Shape { override perimeter() {} } // TypeError: 'perimeter' does not override anything in 'Shape'
// class C extends Shape { override describe() {} } // TypeError: Cannot override final method 'describe' of class 'Shape'
// class D extends Unit {}                           // TypeError: Cannot extend final class 'Unit'

const c = new Circle(1)
// c.area = () => 5                     // TypeError: Cannot assign to method 'area' of class 'Circle' (D29)
// c.color = 'red'                      // TypeError: Circle has no member 'color' (D36)
```

### 10.19 Interfaces (D31, D32)

```js
interface Named {
  get name()
}
interface Comparable {
  compareTo(other)
}
interface Shape extends Named, Comparable {
  area()
}

class Square implements Shape {
  side
  constructor(side) { this.side = side }
  get name() { return 'square' }
  area() { return this.side ** 2 }
  compareTo(other) { return this.area() - other.area() }
}

const a = new Square(2)
const b = new Square(3)
print(a.name, a.compareTo(b))           // → square -5
print(a instanceof Shape, a instanceof Named, ({ area() {} }) instanceof Shape)   // → true true false
print(Shape)                            // → [interface Shape]

// class Bad implements Shape { area() { return 0 } }
//                                      // TypeError: Class 'Bad' does not implement Shape: name (getter), compareTo(other)
// new Shape()                          // TypeError: Shape is an interface
```

### 10.20 Implicit member access (D33)

```js
const TAX = 0.2

class Cart {
  private items = []
  get count() { return items.length }             // this.items
  add(name, price) {
    items.push({ name, price })                   // `name` and `price` are parameters (locals win)
    return count                                  // this.count (getter)
  }
  total() { return round(sum() * (1 + TAX)) }     // round and sum are methods; TAX is an outer constant
  private sum() { return items.reduce((s, item) => s + item.price, 0) }
  private round(v) { return Math.round(v * 100) / 100 }
}
const cart = new Cart()
cart.add('book', 10)
cart.add('pen', 2.5)
print(cart.count, cart.total())         // → 2 15

// The strict rule: a bare name may not mean both a member and an outside definition.
function format(v) { return '$' + v }
class Price {
  value = 1
  format() { return 'member' }
  // show() { return format(value) }   // SyntaxError: Ambiguous name 'format' in class 'Price': it is both a member
  //                                   // and an outer function. Write 'this.format' for the member, or rename the function.
  show() { return this.format() + ' ' + value }   // explicit: OK
}

class Logger {
  print(msg) { globalThis.print('[log] ' + msg) }   // name the global explicitly
  info(msg) { this.print(msg) }                     // a bare print(msg) here would be ambiguous
}
new Logger().info('ready')              // → [log] ready
```

### 10.21 Modules (R16, R19)

```js
// geometry.pscript
export const PI = 3.14159
export function circleArea(r) { return PI * r * r }
export interface Shape { area() }
export class Circle implements Shape {
  r
  constructor(r) { this.r = r }
  area() { return circleArea(r) }      // circleArea: a function of this module; r: implicit member (D33)
}
let created = 0
export function track() { return ++created }
export { created, created as count }

// shapes/index.psc   (both .pscript and .psc are found, D10)
export { Circle, circleArea as area } from '../geometry'

// main.pscript
import { Circle, track, created } from './geometry'
import { area } from './shapes/index'
import * as geo from './geometry'

track()
track()
print(created, geo.count)               // → 2 2   (live bindings)
print(area(1), new Circle(1).area())    // → 3.14159 3.14159
print(Object.keys(geo))  // → ["Circle", "PI", "Shape", "circleArea", "count", "created", "track"]
// created = 5                          // SyntaxError: Cannot assign to import 'created'
// import x from './geometry'           // SyntaxError: default imports are not supported; use import { x } from …
```

### 10.22 Host interop and limits (D9, D14)

```ts
import { Interpreter, markAsClass } from '@padcom/pscript'

const settings = { theme: 'dark', tags: ['a'] }
const vm = new Interpreter({
  globals: { settings, log: (...args: unknown[]) => console.log(...args), Date: markAsClass(Date) },
  modules: { 'host:math': { square: (x: number) => x * x } },
  maxSteps: 1_000_000,
})

vm.run(`
  settings.theme = 'light'           // writes through to the host object (live proxy)
  settings.tags.push('b')
  log(new Date(0).getTime())         // host class marked with markAsClass → 0
`)
console.log(settings)                // { theme: 'light', tags: [ 'a', 'b' ] }

const point = vm.run(`
  class Point { x = 1; y = 2; private secret = 3; sum() { return x + y } }
  new Point()
`) as any
console.log(point.x, point.sum(), JSON.stringify(point))   // 1 3 {"x":1,"y":2}
point.x = 10
console.log(point.sum())             // 12   (the proxy is live)
// point.secret                      // throws AccessError: the host has no access to private members

const ns = vm.runModule(`import { square } from 'host:math'; export const nine = square(3)`)
console.log(ns.nine)                 // 9

try { vm.run('while (true) {}') } catch (e: any) { console.log(e.scriptName) }   // RangeError (step limit)
```

### 10.23 Printing (D18)

```js
print('text', 42, [1, 'a', [true]], { a: 1, b: 'x' })   // → text 42 [1, "a", [true]] {a: 1, b: "x"}
class P { x = 1 }
print(new P(), P, print, () => 1)    // → P(x = 1) [class P] [Function: print] [Function (anonymous)]
```

---

## 11. `psc`: the PScript-to-JavaScript transpiler

> Status: done (2026-10-27): T1–T5 below, tracked in `docs/PROGRESS.md`.

### 11.1 Goal and non-goals

`psc` compiles PScript source to plain, readable JavaScript (ES modules) that runs in Node and browsers without
PScript. It uses PScript as a **stricter source language**: the value is in the **compile-time checks** (arity,
constant bindings, closed classes, access modifiers, `override`/`final`, interfaces, implicit members, module
exports), not in reproducing the VM's runtime behaviour.

- **The interpreter is unchanged.** The VM, runtime and stdlib stay the core of the project; `psc` is an additional
  backend that reuses the front end (parser, token filter, AST) and the compiler's checks. It must not change
  `compile()`'s behaviour or the bytecode contract.
- **Non-goal: runtime equality with the VM.** The emitted code has JavaScript runtime semantics wherever a PScript
  guarantee would need a runtime helper on a hot path (operators, property reads, array indexing). Those
  differences are documented, not bugs (§11.4).
- **No runtime dependency by default.** Output needs no PScript package. The few helpers it needs are emitted
  inline, only when used.

### 11.2 Decisions

| ID | Topic | Decision |
|---|---|---|
| P1 | Diagnostics | `transpile()` first runs the existing `compile()` / `compileModule()` on the AST and discards the bytecode, so `psc` reports exactly the interpreter's compile-time errors (`PScriptSyntaxError`). The first error stops compilation (as in `compile()`). |
| P2 | Emitter | A separate AST → JS printer (`src/transpiler/`). It needs its own light name resolution only for implicit members (T2); everything else is syntax-directed. |
| P3 | Output style | ES2022, 2-space indent, semicolons (generated code must not depend on ASI), one statement per line, original literal spelling (`raw`). Comments are not kept (the parser drops them). |
| P4 | Cheap semantics kept | `==`/`!=` → `===`/`!==` (D1); `typeof` yields `'null'` for `null` (helper); `-x ** 2` → `-(x ** 2)`; `let x` and fields without initialiser start as `null` (D37); bare `return` returns `null`; `this` outside functions and classes is `null`. |
| P5 | Semantics left to JS | Operators converting objects (D5), array reads out of range (§4.4.7), functions falling off the end return `undefined`, strict arity of dynamic calls (D38: only callees known at compile time are checked), integer-like keys listed first, completion values (D12). |
| P6 | Globals | Stdlib globals map to the JS ones of the same name. `print` maps to `console.log` (an inline `const print = …` when used); its PScript formatting (D18) is not reproduced. Unknown globals are left as free names (host globals). |
| P7 | Classes (T2) | Implicit members become `this.x` (`$this.x`, an alias saved by the member, inside nested plain functions). `private` members become JS private names (`#x`; `#x$2` when an enclosing class has a private `x` too). `o.x` follows §4.5.3: `this.x` and `C.x` are resolved statically; another plain-name receiver gets brand checks with the public member last (`#x in o ? o.#x : o.x`); globals never reach private names. `protected`, `override`, `final`, `final class`, `implements` are erased after the checks. Fields without initialiser are `= null`. A class that redefines one accessor half gets a forwarding other half (§4.5.4). **Checks**: the program's classes and interfaces (top-level ones, and nested ones whose superclass and interfaces are top-level) are defined in a throwaway interpreter with everything else stripped, so the VM's class-definition checks (overriding, `final`, signatures, access, `implements`, inherited-name ambiguity) become compile-time errors with the VM's messages. |
| P8 | Interfaces (T2) | Every interface is a value: `const I = $interface('I', [parents])`, with a `Symbol.hasInstance` that checks the interfaces implementing classes record in a `static {}` block. Kept even when only used in `implements`, because modules export them (T3). |
| P9 | Modules (T3) | Native ESM: `import { a } from './m'` → `'./m.js'` (the `.pscript`/`.psc` extension is replaced by `.js`, an extensionless relative specifier gets `.js`). Bare and `host:` specifiers are left as they are. ESM gives live bindings, TDZ and cycle order for free. |
| P10 | Whole-program checks (T4) | `psc` compiles a set of files together, so checks the VM can only do when a class is defined or a module is linked (inherited members, `override`/`final` of imported superclasses, `implements` of imported interfaces, arity of imported functions, missing exports) are reported at compile time. |
| P11 | Source maps (T5) | Version 3 source maps from AST `loc`s, written with a small VLQ encoder (no dependency). |

### 11.3 Architecture

```
source ─► parse() ─► Program ─┬─► compile()/compileModule()  (checks only, bytecode discarded)
                              └─► Emitter ─► JS text (+ source map, T5)
```

| Path | Contents |
|---|---|
| `src/transpiler/transpile.ts` | public `transpile(source, options)` → `{ code }`; runs the checks, then the emitter |
| `src/transpiler/emitter.ts` | statements, expressions, functions, objects (T1); classes, interfaces (T2); modules (T3) |
| `src/transpiler/precedence.ts` | operator precedence, parenthesisation rules |
| `src/transpiler/helpers.ts` | inline helpers (`$typeof`, `print`, `$interface` …), emitted once at the top when used |
| `bin/psc.js` (T3) | CLI: `psc file.pscript…` / `psc -o outDir src/`, writes `.js` next to or under the output dir |

`transpile` is exported from `src/index.ts`. It adds no runtime dependency and is tree-shaken away by embedders that
only use the interpreter.

### 11.4 Differences of the emitted code from the VM

Programs that rely on these behave differently when compiled with `psc` (P5):

- `[] + 1`, `{} < 1` and other operators on objects convert instead of throwing;
- `protected` members, and private members read from outside their class, are plain property accesses at runtime
  (`undefined` or a JS `TypeError` instead of an `AccessError`); `'x' in o` is true for protected members;
- closed instances and sealed classes (D36, D29) are not enforced: writing an undeclared member creates it;
- implicit access to an instance member from a static context, and assigning to a method, are not errors;
- classes and interfaces whose superclass or interfaces `psc` cannot evaluate (calls, host classes, names declared
  in functions) are checked when the program runs (by JavaScript, i.e. not at all);
- implicit members in plain functions nested in field initialisers or derived constructors are not supported;
- `arr[10]` and `arr[-1]` give `undefined`; writing past the end leaves holes;
- reading an undeclared member of a class instance through an unknown receiver gives `undefined`;
- a function without `return` returns `undefined`; a dynamic call with the wrong argument count is not an error;
- `protected` members are reachable through receivers the compiler cannot see (they are plain properties);
- `print` output follows `console.log`; there are no `maxSteps`/`maxCallDepth` limits;
- named parameters (D40) are checked only at compile time (object literals passed to known functions, also
  imported ones); at runtime a destructured parameter ignores unknown keys, and a parameter pattern's default also
  applies when `undefined` is passed;
- runtime errors are native JS errors (`AccessError` does not exist; access violations on `#x` are `TypeError`s);
- promises (D43) are native: any object with a `then` method is adopted, `Promise` can be extended, unhandled
  rejections follow the host's rules; `resolve()` / `async` functions without `return` give `undefined`;
- generators (D42): JS gives `undefined` where PScript gives `null` (`next()` without an argument, finished steps,
  falling off the end); a bare `yield` is printed as `yield null`;
- `delete` (D41) goes through a helper that allows plain objects only (by prototype: `Object.prototype` or `null`), so
  host objects such as a `Map` instance cannot lose properties in emitted code.

### 11.5 Testing

- Unit tests per construct: PScript in, expected JS text out (`tests/unit/transpiler/`).
- `@pscript-only` programs with a `.out` must print it after transpiling, or fail `transpile()` with a message the
  `.out` contains (a class-definition error the VM reports at runtime); the rest are listed with the §11.4 reason.
- **Differential test**: every `tests/programs` program without `@pscript-only` that `psc` supports is transpiled,
  run in a fresh Node context, and must print the same lines and fail with the same error kind as the original in
  Node (`tests/transpiler.test.ts`). Programs using constructs of a later milestone are skipped until it lands.
- `@pscript-only` programs whose `.err` is a compile-time error must fail `transpile()` with the same message.
- Modules (T3): the `tests/modules` fixtures are transpiled to a temporary directory and imported by Node.

### 11.6 Milestones

| # | Milestone | Read | Done when |
|---|---|---|---|
| T1 | **Emitter core**: `transpile()` with P1 checks, statements, expressions with correct parenthesisation, functions, arrows, objects, arrays, templates, P4 semantics, P6 globals; scripts only (classes, interfaces and modules rejected with "not supported by psc yet") | §11, §5.3 | every supported Node-compatible program passes the differential test |
| T2 | **Classes and interfaces**: P7, P8; implicit-member resolution reusing `class-info.ts` / `implicit-names.ts`; accessors, statics, `super` | §11, §4.5 | class, accessor, access, overriding, interface and implicit-member programs pass |
| T3 | **Modules and CLI**: P9, `compileModule()` checks, `bin/psc.js` (files and directories, `-o`), package `bin` entry | §11, §4.7, H5 in PROGRESS | `tests/modules` fixtures run under Node after transpiling |
| T4 | **Whole-program checks**: P10 across the files of one `psc` run | §11, §4.5.6, §4.5.7, §4.4.13 | cross-module `override`/`final`/`implements`/arity/missing-export errors at compile time |
| T5 | **Source maps**: P11, `--source-map` / inline maps | §11 | Node stack traces of transpiled programs point at `.pscript` lines |

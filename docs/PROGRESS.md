# PScript — Progress

Tracks the sequential milestone path (`docs/PLAN.md` §7.12). Each session reads this file first.

## Status

| # | Milestone | Status |
|---|---|---|
| M0 | Scaffolding | done (2026-10-26) |
| M1 | Contracts | done (2026-10-26) |
| M2 | Calculator end to end | done (2026-10-26) |
| M3 | Statements and ASI | done (2026-10-26) |
| M4 | Variables | done (2026-10-26) |
| M5 | Operators | done (2026-10-26) |
| M6 | Control flow | done (2026-10-26) |
| M7 | Functions | done (2026-10-26) |
| M8 | Arrow functions | done (2026-10-26) |
| M9 | Objects | done (2026-10-26) |
| M10 | Arrays and for…of | done (2026-10-27) |
| M11 | Exceptions | done (2026-10-27) |
| M12 | Callbacks and re-entrancy | done (2026-10-27) |
| M13 | Standard library | done (2026-10-27) |
| M14 | Template literals | done (2026-10-27) |
| M15 | Classes | done (2026-10-27) |
| M16 | Accessors | done (2026-10-27) |
| M17 | Access modifiers | done (2026-10-27) |
| M18 | Overriding | done (2026-10-27) |
| M19 | Interfaces | done (2026-10-27) |
| M20 | Implicit member access | done (2026-10-27) |
| M21 | Modules I | done (2026-10-27) |
| M22 | Modules II | done (2026-10-27) |
| M23 | Host interop | done (2026-10-27) |
| M24 | Limits and polish | done (2026-10-27) |
| M25 | Docs and benchmark | done (2026-10-27) — v1 complete |
| H3 | Performance | second pass (2026-10-27) |
| H5 | CLI/REPL | done (2026-10-27) |
| T1 | psc: emitter core | done (2026-10-27) |
| T2 | psc: classes and interfaces | done (2026-10-27) |
| T3 | psc: modules and CLI | done (2026-10-27) |
| T4 | psc: whole-program checks | done (2026-10-27) |
| T5 | psc: source maps | done (2026-10-27) — psc complete |

## T5 — psc: source maps

`transpile()` / `transpileModules()` take `sourceMap: true | 'inline'` (`docs/PLAN.md` §11, P11); the result gets
`map` (a version 3 `SourceMap`, exported type: `file` and `sources` are base names, i.e. relative to a `.js` written
next to its source; `sourcesContent` holds the source), and `'inline'` also appends
`//# sourceMappingURL=data:application/json;charset=utf-8;base64,…`.

- `src/transpiler/source-map.ts`: Base64 VLQ encoder, `resolveMarks()`, `inlineSourceMapComment()` (UTF-8 Base64
  without `Buffer`, so the library stays browser-safe).
- The emitter's strings carry no positions, so `Emitter.emitMapped()` turns on **markers**: `mark(node, text)`
  prefixes the text of statements, module declarations, class members and call / `new` / member expressions with
  `U+FDD0 index U+FDD1` (Unicode noncharacters; `index` into the list of marked `loc`s). `resolveMarks()` strips them
  in one pass, tracking the generated line/column, and encodes one segment per marker (nested nodes starting at the
  same place keep the outer one). The emitter's few text inspections (`startsWith('(')`, the `/^[+-]/` unary check,
  shorthand properties, the `$this` alias insertion) were checked to be unaffected by a leading marker. A source
  that itself contains U+FDD0 gets an empty mapping. Columns are 0-based UTF-16 units; PScript `loc`s are 1-based.
- `bin/psc.js`: `--source-map` writes `x.js.map` (with `file`/`sources` relocated relative to the written file) and
  appends `//# sourceMappingURL=x.js.map`; `--inline-source-map` embeds the relocated map. `npm run build` checks
  that a map is written.

Tests: `tests/unit/transpiler/source-map.test.ts` (VLQ values; mappings decoded with Node's `module.SourceMap`;
inline maps; every program of the corpus emits identical code with and without markers and only maps into the
source); `tests/transpiler-source-maps.test.ts` runs transpiled scripts and modules (nested directories, classes)
with `node --enable-source-maps` and checks the stack frames are `file.pscript:line:column` of the throw and calls.

## T4 — psc: whole-program checks

`transpileModules(sources)` (exported) compiles the files of a program together (`docs/PLAN.md` §11, P10); `psc`
uses it for all files of a run, and `transpile()` routes a single module through the same path (the program is that
one module, its imports are outside it).

- `src/transpiler/module-graph.ts`: `ModuleGraph` over `ProgramUnit`s (id, source, checked program). Relative
  specifiers resolve like the in-memory loader (`resolveSpecifier`, exact id, then `.pscript`/`.psc`; both present →
  "ambiguous module" error at the specifier); anything else is outside the program. Per module: imports, exports
  (own binding or re-export) and the compile-time signatures of top-level functions (declarations and `const` bound
  to a function, as the compiler's `constSignature`). `importBinding`/`exportBinding` follow re-exports and
  re-exported imports to `{ module, local }` or `{ namespace }`; `order()` is a dependency (post-)order.
- `src/transpiler/program-checks.ts`: the T2 skeletons, in module mode (`Skeleton` options: imports and exports
  kept; imported names that another skeleton defines as classes/interfaces are evaluable). Built to a fixpoint (a
  class can extend a class that extends an import …), compiled with `compileModule()` (a skeleton that does not
  compile drops its module, which becomes a stand-in, and the others are rebuilt), then linked and run in a
  throwaway `Interpreter` whose loader returns the precompiled skeletons. Modules outside the program are host
  stand-ins exporting (as `null`) exactly the names the program imports from them. Link errors (missing export,
  circular re-export) and class-definition errors become `PScriptSyntaxError`s at the same place with the original
  excerpt; `ReferenceError`s (TDZ in cycles: nested-class checks run earlier than the program would) are ignored.
- **Interpreter addition:** a `ModuleLoader` may return `{ id, compiled }` (a `compileModule()` result); the
  registry uses it instead of compiling source (§4.7.3 updated). No other interpreter change.
- `src/transpiler/program.ts`: scripts are checked and printed alone; modules are printed in dependency order by a
  `ProgramPrinter` that gives each `Emitter` a `ProgramContext`: what an imported name is (`ClassInfo` of a printed
  class, signature) and the shared `classNodes` map. The emitter declares imports with their `ClassInfo` (so
  implicit members and the strict rule see inherited members of imported classes, and accessor halves are forwarded
  across modules) and checks `f(…)` / `ns.f(…)` against imported signatures when the name is not shadowed.
- Files without `import`/`export` are scripts (as before), with no exports: importing a name from one is a missing
  export, as in the interpreter.

Tests: new `tests/modules` graphs (also run by the interpreter): `class-final`, `class-override`,
`class-implements` (through a renaming re-export), `import-arity`, `namespace-arity`, `inherited-implicit` (output),
`inherited-ambiguity`. `tests/transpiler-modules.test.ts` now uses `transpileModules()` and lists the graphs whose
error psc must report at compile time (`COMPILE_TIME`, including `missing-export` and `circular-reexport`).
`tests/unit/transpiler/program.test.ts`: stand-ins, non-class imports, ambiguous ids, scripts, cycles, shadowing,
cross-module accessor halves.

Not covered: classes extending a member of a namespace import (`extends ns.Base`) are not checked (the skeleton only
evaluates plain names); `new C(…)` of an imported class is not arity-checked (neither is a local one).

## T3 — psc: modules and CLI

`transpile(source, { fileName, goal })` compiles modules (`docs/PLAN.md` §11, P9):

- `goal` defaults to `'module'` when the source parses as a module with `import`/`export` declarations, else
  `'script'` (as `bin/pscript.js` decides). Modules run `compileModule(source, fileName ?? 'main')` for the checks
  (`checkedProgram()` in `transpile.ts`), so assigning an import, duplicate and undefined exports are psc errors.
- `src/transpiler/modules.ts`: `outputSpecifier()` (relative: `.pscript`/`.psc` → `.js`, no extension → `+ .js`,
  another extension is kept; bare and `host:` unchanged), import clauses and export lists. The emitter prints
  `import …;`, `export <declaration>`, `export { … } [from …];`; imports declare their local names in the top
  `Names` scope. The inline helpers follow the leading imports.
- `this` outside functions and classes is `null` (PScript's value; JS has `undefined` in modules).
- The class-check skeleton keeps exported declarations and treats imported names as declared, not evaluable: a
  class extending an imported class is left out (T4).

`bin/psc.js` (bin `psc`): files and directories (searched recursively for `.pscript`/`.psc`, `node_modules`
skipped); every relative import or re-export of an existing PScript file is compiled too (a missing one is an error,
another file type is left to Node). Output is `.js` next to each source, or with `-o dir` mirrored below the common
directory of all files. Module ids (error messages) are paths relative to the working directory, or to the common
directory when a file is outside it. The first error stops the run and nothing is written. `bin/files.js` holds the
file lookup shared with `bin/pscript.js`; `npm run build` checks that psc compiles a two-module graph Node runs.

Tests: `tests/unit/transpiler/modules.test.ts`; `tests/transpiler-modules.test.ts` transpiles every `tests/modules`
graph and runs it in Node (`runFilesInNode` in `tests/helpers/node-modules.ts`, whose prelude makes `console.log`
print like `print`); output and error kind must match the interpreter. `assign-import` fails at compile time with its
`.err` message; `namespace-print` is a known difference (print formatting). `tests/helpers/module-graphs.ts` is shared
with `tests/modules.test.ts`.

Notes for T4:

- Link errors (`missing-export`, `circular-reexport`) are Node `SyntaxError`s at load time today; T4 makes them psc
  errors with the interpreter's messages.
- Imported superclasses are invisible to the emitter (implicit members) and the skeleton (class checks).

## T2 — psc: classes and interfaces

`transpile()` now accepts classes and interfaces (`docs/PLAN.md` §11, P7, P8):

- `src/transpiler/emitter.ts`: class declarations/expressions, fields (`= null`), accessors, statics, constructors
  (a bare `return` stays `return;`), `super`. A `ClassRecord` stack (like the compiler's `enclosingClasses`) and a
  `Frame` stack (function kinds) drive implicit members: `memberCandidate()` from `src/compiler/implicit-names.ts`
  decides member vs. outer name (its parameter type was widened to `MemberContext`, no behaviour change). Inside a
  nested plain function the member's `this` is saved as `const $this = this` (name made unique like the helpers).
- Private members: `#x`, renamed `#x$2` when an enclosing class's private `x` would be shadowed. `o.x` /
  `o['x']` / `'x' in o` follow §4.5.3: `this` → the innermost class; a class name → its static privates; a global
  → public; any other plain name → brand checks innermost first, then the public member (`withMember` renders the
  read/write/update/call into each branch, so `o.x++` and `o.m()` work). Other receivers use the innermost class.
- `src/transpiler/classes.ts`: private-name helpers and forwarding accessor halves (a class overriding only the
  getter gets `set x(value) { super.x = value; }` when the visible superclass has the setter).
- `src/transpiler/class-checks.ts`: the VM's class-definition checks at compile time. A skeleton program keeps the
  top-level functions, variables (initialised to null), classes (static field values dropped) and interfaces, plus
  nested classes whose `extends`/`implements` are unshadowed top-level definitions (method bodies emptied, as
  `const $n = class …`). It is compiled and executed in a fresh `Interpreter`; a `PScriptRuntimeError` becomes a
  `PScriptSyntaxError` at the same location. A skeleton that fails to compile is ignored (the real program did).
- Inherited member + outer name (the strict rule's class-definition-time case) is reported by the emitter when the
  chain is visible, with `ambiguityMessage()`.
- Interfaces: `const I = $interface('I', [parents])` (helper with a `WeakMap` of implemented interfaces and
  `Symbol.hasInstance`), classes register with `static { $interface.implement(this, [I]); }`.
- `globalThis.print` → the `print` helper.

Tests: `tests/unit/transpiler/classes.test.ts`; `tests/transpiler.test.ts` now also runs every `@pscript-only`
program with a `.out` (129 pass, 19 listed in `PSCRIPT_ONLY_DIFFERENCES` with their §11.4 reason; programs whose
class errors psc reports at compile time must fail with a message the `.out` contains). All Node-compatible class
programs pass.

Notes for T3:

- `transpile()` rejects `import`/`export` in `Emitter.emit()`; the skeleton already drops them.
- Interfaces are always emitted, so exporting them works unchanged.
- Classes extending imported classes are "not visible" today (unknown superclass): bare names without an outer
  definition are taken as inherited members, and the skeleton leaves such classes out. T4 should feed imported
  `ClassInfo`s and skeleton definitions across files.

## T1 — psc: emitter core

`transpile(source, { fileName })` (exported from `src/index.ts`) compiles a script to JavaScript (`docs/PLAN.md` §11):

- `src/transpiler/transpile.ts`: runs `compile()` on the source text first (P1; the bytecode is discarded), then the
  emitter on a fresh parse. Parsing twice keeps the code excerpts in `compile()`'s errors without changing its API.
- `src/transpiler/emitter.ts`: table-driven printer (like the compiler's `EXPRESSIONS`/`STATEMENTS`). Every printer
  returns a string; the first line of a statement is not indented and its other lines carry absolute indentation, so
  multi-line template literals are never re-indented. Branch and loop bodies always get braces. A light `Names`
  scope chain tells locals from globals (for `print` and `typeof`); it is where T2's implicit-member resolution
  plugs in.
- `src/transpiler/precedence.ts`: JS precedence levels, `leftmost()` / `startsAmbiguously()` (statements and arrow
  bodies starting with `{`, `function`, `class` are parenthesised). Special cases: left operand of `**` (D15),
  `??` mixed with `&&`/`||`, `- -x` → `-(-x)`, `new (f())()`, `(1).x`, `in` inside a `for` initialiser.
- `src/transpiler/helpers.ts`: `$typeof` (D39) and `print` (P6), emitted once at the top when used; helper names
  avoid every identifier of the program (`$typeof2` …). `typeof` of an undeclared global stays non-throwing.
- `let x` → `let x = null`, bare `return` → `return null` (D37). `arguments`/`eval` as declared names are rejected.
- Classes, interfaces, `super` and modules throw "… are not supported by psc yet" (T2, T3).

Tests: `tests/unit/transpiler/emitter.test.ts` (JS text per construct) and `tests/transpiler.test.ts`: 78 Node-
compatible programs transpile and behave like the original in Node; 4 are skipped until T2 (they use classes);
`stdlib/basics` is a known difference (`globalThis.print`, listed in `KNOWN_DIFFERENCES`). Every program whose
`.err` is a compile-time error fails `transpile()` with the same message.

Notes for T2:

- Class members need the `Names` chain extended with a class record; reuse `classInfoOf`/`memberCandidate` from
  `src/compiler/` (the compiler has already rejected ambiguous names, so the emitter only has to decide
  member vs. outer name).
- `ClassExpression` and `Super` currently reach `unsupported()` from `expression()`, `call()` and `member()`.
- A constructor's bare `return` must stay `return;` (a derived constructor returning `null` is a TypeError in JS).

## H5 — CLI/REPL

`bin/pscript.js` (plain ES module, Node-only, imports `dist/index.js`), published as the `pscript` bin of
`@padcom/pscript`, so `npx @padcom/pscript` starts it:

- no arguments: a REPL on `node:repl` (one `Interpreter` per session, so bindings persist; input that ends with
  `Unexpected end of input` or an unterminated template continues on the next line; completion values are shown as
  `print` formats them, strings quoted); with stdin not a terminal, runs stdin as a script;
- `pscript file`: runs the file as a module when it has `import`/`export` declarations, else as a script; a
  file-system loader (§4.7.3, D10 extensions; ids are paths relative to the working directory) resolves imports;
- `-e`/`--eval`, `-h`/`--help`, `-v`/`--version`; errors print their message (location and excerpt) to stderr, exit 1.

`npm run build` also checks that the CLI runs a script. Releasing: `.npmrc` sets the tag prefix `pscript-` and the
commit message `Release @padcom/pscript@%s`; `preversion` runs `npm run check`, `prepack` builds, and
`publishConfig.access` is `public`.

The library build is no longer minified: Vite 8 minifies with rolldown, which ignores the shared config's
`esbuild.minifyIdentifiers: false`, so classes lost their names (`Interpreter.name === 'vl'`, `error.name === 'a'`).
The error classes now spell out their `name`, and the build check fails when names are lost.

Not done: standalone binaries (N1), tab completion of script names in the REPL.

## H3 — Performance (second pass)

Semantics unchanged: `npm run check` green (963 tests; coverage 97.8% statements, 92.5% branches), plus the
differential edge-case checks against the M25 build (now also block scopes, TDZ in loops, error locations of `x++`).

```
case                          pscript ms     js ms   ratio  result
fib(27)                            42.53      1.09     39x  196418
loop of 1e6                        39.87      0.95     42x  2999997
1e5 object allocations             19.30      0.50     39x  99999
array map/filter                   21.86      1.28     17x  50000
classes and methods                18.22      0.72     25x  90000
string building                     2.73      0.08     35x  20000
```

Typical code outside the benchmark set (1e6 iterations in a function, ms): loop with a `const` in its body 69 → 44,
nested `if` block 61 → 43, flat loop body 54 → 43; 3e5 method calls 42 → 36; `for…of` over 3e5 items 54 → 42.

What changed:

- **Folded block environments (K9, §5.5)**: a block, `catch`, for-let head or for-of binding without closures, whose
  bindings are not used before their declaration, takes slots of the enclosing environment instead of its own
  (`Scope.fold()`, `canFold()` in `src/compiler/closures.ts`). `PUSH_ENV` sizes are filled in when the proto is built
  (`ProtoBuilder.defer`), since folded blocks grow the environment after its `PUSH_ENV` is emitted.
- **Superinstructions** (new opcodes after `HALT`, numbering of the others unchanged): `STORE_POP`,
  `STORE_GLOBAL_POP` and `SET_PROP_POP` (`ProtoBuilder.emitPop` rewrites the store in place, so no offset moves; not
  when a jump targets the `POP`), and `INCREMENT depth slot ±1` for an unused postfix `x++` / `x--` of a lexical
  binding (postfix only: it starts where its binding does, so TDZ and type errors keep their locations).
- **Class members**: public fields and methods of instances are read and written without a `MemberAccess` when no
  enclosing class declares a private member of the same name (else the full §4.5.3 lookup runs).
- Index-like keys are recognised by their first character before the regular expression (`xs.push`).

Tried without a measurable effect (reverted): skipping empty `props` maps in prototype lookups, filling `popItems`
by popping instead of `slice`.

Left for later: inline caches per `GET_PROP` site, running array callbacks and field initialisers without a nested
dispatch loop, more superinstructions (`DUP GET_PROP CALL_METHOD`, `THIS GET_PROP`).

## H3 — Performance (first pass)

Semantics unchanged: `npm run check` green (940 tests), plus a differential check of edge cases (index keys, TDZ
and const globals, per-iteration closures, constructor arity order, error stacks, `maxCallDepth`) against the M25
build. Step counts (`maxSteps`) shrink where fewer instructions are emitted.

```
case                          pscript ms     js ms   ratio  result
fib(27)                            42.00      1.12     37x  196418
loop of 1e6                        56.95      0.99     57x  2999997
1e5 object allocations             21.60      0.56     39x  99999
array map/filter                   24.00      1.33     18x  50000
classes and methods                18.85      0.72     26x  90000
string building                     3.21      0.08     41x  20000
```

What changed, roughly by effect:

- **Opcode literals in the dispatch switch**: `build/vite-plugin-inline-enum.ts` replaces `Op.X` in `src/vm/vm.ts`
  with its number (length-preserving, so source maps stay valid). With literal `case`s V8 dispatches through a jump
  table instead of a chain of property loads and compares.
- **No `stack.length = n`** on calls and returns (V8 handles it in a runtime call that may also trim the backing
  store): items are popped instead (`truncate`, `popItems`).
- **In-place stack top** for unary and binary operators and `GET_PROP`/`GET_INDEX`; number fast paths for
  `+ - * / %` and the comparisons, boolean fast paths for jumps and `truthy`, a number fast path in `toNumber`.
- **Calls**: closure arguments are bound straight from the operand stack (no `splice`); the arity check builds its
  signature only on a mismatch; slot arrays are packed; `handlers` is allocated by the first `TRY`.
- **Script bindings cached per closure** (`Closure.globalCache`, by constant index): they are never removed and
  shadow realm globals, so a cached one stays valid; realm globals are still looked up each time.
- **`new` of a base script class** runs the constructor in the current dispatch loop (field initialisers still run
  nested, so the order of field initialisation and the arity check is unchanged).
- **Compiler**: `for (let …)` emits `COPY_ENV` only when the loop may create a closure
  (`src/compiler/closures.ts`); an unused `x++` is compiled as `++x`.
- **Property access**: no closure or tuple allocation in prototype-chain reads, `getExotic` without a table search,
  private-member check without an array of enclosing classes, integer-key fast paths for arrays.

Not done yet (candidates for a second pass): block environments without captures folded into the function's
environment (K9), superinstructions (`STORE`+`POP`, `LOAD 0 n`), member-access inline caches for class instances,
running field initialisers and array callbacks without a nested dispatch loop.

## M25 — Docs and benchmark

Done: `README.md` (usage, embedding API, interop notes incl. "not a security sandbox", layout, link to the language
reference), `docs/LANGUAGE.md` (user reference derived from §4, with "Differences from JavaScript"), `npm run bench`
(`bench/run.js`: builds, then runs the §6.5 cases — fib(27), a loop of 1e6, 1e5 object allocations, array
map/filter — plus classes and string building, in PScript and as plain JavaScript). The examples and claims in both
documents were checked against the implementation.

Baseline (median of 3 rounds, Node 26, this machine):

```
case                          pscript ms     js ms   ratio  result
fib(27)                            95.29      1.11     86x  196418
loop of 1e6                       130.93      0.94    139x  2999997
1e5 object allocations             30.70      0.44     69x  99999
array map/filter                   39.14      1.30     30x  50000
classes and methods                43.39      0.73     59x  90000
string building                     5.02      0.08     61x  20000
```

Notes:

- The docs describe the implementation, including where it differs from earlier drafts of the plan: primitives
  convert in arithmetic as in JavaScript (only objects are rejected, D5), mixing `??` with `&&`/`||` is accepted,
  numeric separators and destructuring (in `catch` and `for…of`) are not supported, and the stdlib lacks
  `Object.fromEntries`, `Object.isFrozen` and `Array.prototype.findLastIndex`.
- No performance work (H3 fast paths) was done; the baseline is for future comparison.

## M24 — Limits and polish

Done: `npm run check` green (935 tests; coverage 97.7% statements, 92.0% branches, 98.4% functions, 98.5% lines),
`npm run build` green including the new build check.

What exists:

- `maxSteps` (D14): the step budget restarts on every entry from the host (`run`/`execute`, module evaluation, host
  calls into script functions when the VM is idle); exceeding it inside a `try` cannot be swallowed (every following
  instruction exceeds it again). Tests in `tests/unit/vm/limits.test.ts`.
- Unexpected host exceptions from the runtime or stdlib natives (bugs, or a failing `stdout`) leave the VM as an
  uncatchable `PScriptRuntimeError` named `InternalError` with the original as `cause` and the script stack (§5.6.5).
- `scripts/check-build.js` runs after `vite build`: `dist/index.js` and `dist/index.d.ts` exist, the bundle has no
  CommonJS, Node built-in imports or `process` access, and it runs a script (ES-only, browser-safe, D16).
- Public API review against §5.8: `parse`, `compile`, `compileModule`, `disassemble`, `Interpreter` (`run`, `execute`,
  `get`, `set`, `call`, `runModule`, `importModule`, `defineModule`), `run`, `markAsClass`, the error classes and the
  AST/module/loader types are exported. Error excerpts with carets exist for syntax errors, runtime errors in scripts
  and in modules, and link errors.

Gaps:

- `Interpreter.run()` called from a host function while a script runs (re-entrant `run`, not `call`) is not supported.
- H1 "did you mean" suggestions are not implemented.

## M23 — Host interop

Done: interop tests pass (`tests/unit/interop/interop.test.ts`: every §5.8.1 row, identity, round trips, blocked
keys, host classes and subclasses, exceptions both ways, `Interpreter.call`). `npm run check` and `npm run build`
green; 932 tests.

What exists:

- `src/runtime/interop.ts`: `Interop` (one per VM): `toScript` (primitives pass, bigint/symbol → TypeError, proxies
  unwrap to their script value, other host values get a cached wrapper: `HostFunction`, host `Class` for ES classes
  and `markAsClass` functions, `HostObject` otherwise) and `toHost` (wrappers unwrap, other script objects get a cached
  proxy). It implements `HostAccess` (`get`/`set`/`has`/`keys`/`iterate`, blocked keys) used by the runtime for
  `HostObject`s and host parts; `invoke` calls host functions (`this` of script subclass instances is their host part;
  `undefined` results → `null`). `markAsClass`, `BLOCKED_KEYS` exported (`markAsClass` from the package).
- `src/runtime/host-proxies.ts`: proxies for the host side — functions (arrow target: not constructable; extra
  arguments dropped), classes (`construct` → script `new`, `apply` → TypeError, `Symbol.hasInstance` → brand rule),
  arrays (live `items`, `Array.isArray`, spread, JSON), objects/namespaces (reads via `getProperty` with a no-home-class
  context, undeclared class members read `undefined`, writes via `setProperty`, `ownKeys` = public keys, deleting own
  data properties of plain objects).
- Host classes: `Class` with `host`, `hostAccess` and a native constructor (`Reflect.construct`). Script subclasses
  get instances whose `hostTarget` holds the host part; undeclared reads/writes (instances and statics) fall back to
  the host part (`MemberAccess.hostPart`); unproven `this.x` references are not checked for classes extending a host
  class; override checks see members of the host prototype.
- VM: `interop`, `hostContext` (no home class), public `construct`, `toHostError` (script exceptions →
  `PScriptRuntimeError` with `value = toHost(thrown)`), `fromHost` (a `PScriptRuntimeError` gives back its script value,
  host `Error`s become script errors of the same kind with `cause`, other values are thrown as they are);
  `HostFunction` calls in `callFunction`.
- Runtime: `HostObject` in `getProperty`/`setProperty`/`in`/`publicProps` (Object.keys/values/entries, JSON, print),
  `for…of` over host iterables, `Array.isArray` and printing of host arrays, `instanceof` of host instances.
- `Interpreter.call(fnOrName, ...args)`; `globals`/`set`/`defineModule` accept host objects and functions;
  `runModule`/`importModule` now return the namespace through `toHost` (a live proxy; writes throw).

Deviations / gaps:

- Script errors reach the host as proxies of the script error object (`error.value.message` works).
- Host functions' own properties (other than `name`/`length`) are not visible to scripts; statics of host classes are.
- `JSON.stringify` of a host array from a script gives an object (`{"0":…}`), not an array.

## M22 — Modules II

Done: namespace, re-export, cycle and error programs pass in `tests/modules/` (all but `namespace-print` also against Node); host-module unit tests (`tests/unit/modules/host-modules.test.ts`). `npm run check` and `npm run build` green; 909 tests.

What exists:

- Namespace objects (`ModuleNamespace(record, names, read)`, one per record via `registry.namespace`): null prototype, frozen; reads go through the export cells (resolved on first read, TDZ `ReferenceError`), unknown keys are `undefined`; writes and new keys → `TypeError: Cannot assign to 'x' of a module namespace`; `in` checks the export names; `Object.keys/values/entries`, `JSON.stringify` list the exports in sorted order (`publicProps`); `print` shows `[Module] {a: 1, b: [Function: b]}`. Namespace imports (and exports of them, `import * as u …; export { u }`) use a cell that returns the namespace.
- Re-exports (`export { a as b } from`, exporting an import) resolve through `followReexport`; `circular re-export of 'x'` is a link-time SyntaxError.
- Cycles: hoisted functions are callable before their module runs; reading an uninitialised `let`/`const` of a module that is still evaluating is the TDZ `ReferenceError`.
- Errored modules: the error propagates to the importers (which are errored too) and is rethrown by later imports.
- Host modules: `Interpreter.defineModule(id, exports)` or a loader result `{ id, exports }`. Export names are the own enumerable keys at definition time; each read is `toScript(exports[name])` (live, `HostCell`). Bindings are read-only; defining an id twice → `PScriptRuntimeError`. Defined modules (and every loaded record) are found by their resolved specifier before the loader is asked.
- Contract changes: `BindingCell = SlotCell | HostCell`, `HostExports { names, object }` replaces `hostExports: Map`, `ModuleRecord.namespace`; `readCell` in `src/modules/cells.ts`.

Deviations / gaps:

- Host modules can only export primitives until M23 (`toScript` rejects host objects and functions).
- `String(ns)` gives `[object Object]` (JS: `[object Module]`).

## M21 — Modules I

Done: module graphs under `tests/modules/<case>/` (entry `main.pscript`, `main.out` / `main.err`) pass in PScript and, unless `@pscript-only`, in Node (`tests/modules.test.ts`; `tests/helpers/node-modules.ts` writes the graph as `.mjs` files with rewritten equality and specifiers and runs it in a child process). Unit tests in `tests/unit/modules/`. `npm run check` and `npm run build` green; 891 tests.

What exists:

- Token filter (§4.2.5): `{` after `import`/`export` → `SPEC_LBRACE` (`{specifiers}`, no ASI); inside an import clause or `export { … }` clause, `as` → `AS` and `from` → `FROM` (not inside the braces); `export` counts as a statement start (so `export function`/`class`/`final class` are declarations). Unsupported forms fail with a hint: default imports (incl. `import x, {…}`), `export default`, `export *`, `import()`, `import.meta`; string export names fail in the grammar. Future reserved words now come from the lexer as `RESERVED` and are rejected by the filter (so `export default` can get its own message).
- Grammar: `import 'm'`, `import { a, b as c } from 'm'`, `import * as ns from 'm'`, `export <let/const/function/class/final class/interface>`, `export { a, b as c }`, `export { a as b } from 'm'` (trailing commas allowed). `src/parser/module-declarations.ts` builds the nodes and rejects them in scripts and below the top level.
- `compileModule(source, id)` (exported): module goal with a function-like top scope (no `DECLARE_GLOBAL`, no completion value), `import` bindings (`BindingKind 'import'`, read with `LOAD_IMPORT i`, assignment → `Cannot assign to import 'x'`, also usable as implicit-member fallbacks), `ModuleTables` (`src/compiler/module-tables.ts`) for requests (deduplicated), imports, local/indirect exports (exporting an import is an indirect export) and duplicate/undefined export checks. Top-level function declarations (also exported ones) are `hoistedFunctions` `{ slot, proto }` initialised at link time, not by the body.
- Contract changes (`src/modules/module-record.ts`): `ModuleImportEntry.loc`, `ModuleIndirectExport.loc` (link errors point at the specifier), `HoistedFunction { slot, proto }` instead of `number[]`, `CompiledModule.source`; `ScriptStackFrame.fileName` (module id).
- Loader (`src/modules/loader.ts`): `ModuleLoader`, `memoryLoader(modules)` (exact id, then `.pscript`, then `.psc`; both → ambiguity error), `resolveSpecifier` (POSIX-style relative resolution against the referrer's id).
- Registry (`src/modules/registry.ts`): load graph (records registered before their requests, so cycles terminate), link (environment created first, then requests, import cells, re-export resolution with `circular re-export` detection, hoisted functions), evaluate (depth-first post-order, once; `evaluating` modules are not re-entered; errors mark the record `errored` and are rethrown on later imports). Link errors are `PScriptSyntaxError`s of the importing module (`Module './math' does not provide an export named 'x'`); loader failures become `PScriptRuntimeError: Cannot find module './x' imported from 'main': …`.
- VM: frames and closures carry their module (class methods too, via `DefinitionSite.module`); `LOAD_IMPORT` reads the cell with the TDZ check; `evaluateModule(record)` runs the body with `this` null; runtime errors in modules name the module id and show its source excerpt.
- API: `InterpreterOptions.moduleLoader` / `modules`, `Interpreter.runModule(source, { id })` (default id `main`) and `importModule(specifier)` return a frozen, null-prototype object with live getters for the export names (sorted).

Deviations / gaps (for M22):

- Namespace imports parse and compile (`importName '*'`) but linking them fails (no module namespace objects yet); host modules (`{ exports }` from the loader) are rejected; `defineModule` is missing.
- Re-exports and cycles already work through the registry but have no dedicated programs yet.
- `import { as }` / `import { from }` (keywords as imported names) are not supported.
- The host-side namespace view returns script values as they are (`toHost` is still the identity until M23).

## M20 — Implicit member access

Done: implicit-member programs pass (`tests/programs/implicit-members/`: §10.20, rule matrix incl. §4.5.8's Invoice, compile-time and class-definition-time ambiguities). `npm run check` and `npm run build` green; 843 tests.

What exists:

- Compiler (`src/compiler/implicit-names.ts` + `implicitName`/`implicit` in compiler.ts): the stack of enclosing classes is now `ClassRecord`s (info, the scope around the body, current static context, `implicitNames`). A bare name in a class body that is not a binding declared inside the body is classified: own member (instance members in instance code; static or instance members in static code), member of a visible superclass (privates excluded), provably none (normal load), or unknown (superclass not visible). Own member + outer lexical/script binding or stdlib global → compile-time `SyntaxError` with the §4.5.8 message (`stdlibGlobalNames()` in `src/stdlib/index.ts` lists the stdlib globals from a scratch realm). Otherwise reads/writes/calls emit `LOAD_IMPLICIT i a b`, `STORE_IMPLICIT i a b`, `CALL_IMPLICIT i argc a b` with the fallback `depth slot` (lexical) or `k 0` (script binding / global). `typeof x` follows the same path. Compile-time arity checks are skipped for implicit calls.
- Class definition (`src/vm/implicit.ts`): `resolveImplicitNames` builds `Class.implicitTable` (`{ instance, static }` → `member` | `outer` | `instance-only`) from the finished member indexes (+ own privates) and reports ambiguities with inherited members or current script bindings/globals (`ClassHost.outerGlobal`), joined with the other class-definition violations.
- VM: closures remember the frame of the enclosing method (`Closure.implicitFrame`, `Frame.implicitFrame`), so nested `function`s and arrows use the method's `this` (read lazily, so `super()` in derived constructors is respected → `ReferenceError` before it). Static vs instance code is decided by whether that `this` is a class. Member accesses go through `getProperty`/`setProperty` (virtual dispatch, access rules, accessors, `Cannot assign to method`); `instance-only` → `TypeError: Cannot access instance member 'x' from a static context`.
- `print` of anonymous classes: `[class (anonymous)]` (was `[class ]`).

Deviations / gaps:

- In instance code only instance members are candidates (static members need `ClassName.x`), the spec leaves this open.
- Inherited members of a *visible* superclass vs. outer bindings are reported at class-definition time (TypeError), like hidden superclasses, rather than at compile time.
- Built-in prototype members (`toString`, Error's `message`) are not implicit-member candidates.
- `typeof x` for an implicit name whose fallback is an undeclared global throws ReferenceError instead of giving `'undefined'`.
- Script-level bindings declared after the class (but before it runs) count as outside definitions at class-definition time, as they exist in the TDZ.
- The VM "unimplemented opcode" unit test now uses `DEFINE_PROP_INDEX`.

## M19 — Interfaces

Done: interface programs pass (`tests/programs/interfaces/`: §10.19, the §4.5.7 satisfaction table, declaration semantics), parser unit tests (`tests/unit/parser/interfaces.test.ts`). `npm run check` and `npm run build` green; 835 tests.

What exists:

- Grammar: `interface Name (extends LHS, …)? { members }` as a statement; `class … (extends LHS)? (implements LHS, …)? { … }` for declarations and expressions. Interface members: `m(a, ...r)`, `get x()`, `set x(v)`, `x`; bodies, initialisers, modifiers, defaults are parsed only to be rejected with clear SyntaxErrors (`src/parser/interface-members.ts`), duplicate names too (a `get`/`set` pair is allowed).
- Token filter: `INTERFACE` sets up the body brace like a class declaration's (`{class-statement}` → `CLASS_LBRACE`), so class-body ASI and `get`/`set` detection apply.
- Compiler: interfaces are `let` bindings (TDZ, not hoisted); `<parents…> INTERFACE k n` then INIT. `src/compiler/interfaces.ts` builds `InterfaceTemplate`s; `InterfaceMemberTemplate.description` (new field) is how a missing member is listed. CLASS gets the `implements` values above the superclass (`template.interfaceCount`).
- VM (`src/vm/interfaces.ts`): `defineInterface` checks parents (`Interface extends value X is not an interface`), merges requirements parents-first then own (`get` + `set` → property; methods must agree on arity; otherwise `Interface 'D' has conflicting requirements for 'm'`), records ancestors, freezes. `defineClass` takes `{ superClass, interfaces }`; `checkInterfaces` (`Class implements value X is not an interface`); `implementInterfaces` fills `cls.interfaces` (superclass's ∪ listed with ancestors) and lists missing members per interface: `Class 'Bad' does not implement Shape: name (getter), compareTo(other)` — collected with override/member-ref violations into one TypeError.
- Satisfaction (public members only, own or inherited): methods need exactly the required parameters (no optional ones, rest iff declared); built-in prototype methods (`toString`) count; getters/setters per half access; properties need a public field or public get+set.
- `new I()` → `TypeError: I is an interface`; `print(I)` → `[interface I]`; `typeof I` is `'object'`; `instanceof I` uses `klass.interfaces` (already in operators).

Deviations / gaps:

- Missing members are listed parents first, then own members (§4.5.7's prose example lists them in a different order; §10.19 agrees with this order).
- `export interface` waits for modules. No interface expressions (as specified).
- The VM "unimplemented opcode" unit test now uses `LOAD_IMPLICIT` (M20 will need another one).

## M18 — Overriding

Done: override programs pass (`tests/programs/overriding/`: §10.18, a rule matrix, final class error). `npm run check` and `npm run build` green; 819 tests.

What exists:

- `src/vm/overrides.ts`: `overrideViolations(template, { realm, superClass, constants })`, run by `defineClass` before the members are installed. For every public/protected member (instance against instance, static against static): inherited = superclass member index entry, else a built-in (`Error`-family prototype data/methods, `Object.prototype`, `Function.prototype` for statics). Checks in order: `final` (no redefinition of any kind), `override` required / forbidden, kinds match (method/accessor/field), access matches (per accessor half), signature matches (required, optional, rest; script methods only, natives are not checked).
- Messages as §4.5.6, each followed by ` (line:column)` of the member; all violations of one class (overrides + unproven `this.x` refs) are joined with `; ` in a single `TypeError` (§5.6.7).
- Accessor halves: a half that redefines an inherited half needs `override`; adding a half the superclass does not have does not (but `override` is allowed there).
- `final class`: `Class.final`; `extends` of it → `TypeError: Cannot extend final class 'X'` (in `checkSuperClass`).

Deviations / gaps:

- Member locations start at the member name, not at its first modifier.
- The COULD compile-time version of these checks is not implemented (all are class-definition time).
- Host superclasses do not exist yet; `inheritedMember` will need a host-prototype lookup then (§5.6.7 "build entries lazily").

Notes for next session (M19):

- Interface conformance goes into `defineClass` next to `overrideViolations` (same violation list). `Class.interfaces` and `Interface` (values.ts) exist; `INTERFACE k n` opcode is declared but not implemented (the "unimplemented opcode" VM unit test uses it — switch to another).

## M17 — Access modifiers

Done: access programs pass (`tests/programs/access/`: §10.16 example, private/protected matrices, nested classes, accessor halves with different access, hidden-private error). `npm run check` and `npm run build` green; 816 tests.

What exists:

- `src/runtime/members.ts`: §4.5.3 member resolution for class instances and classes (`MemberAccess`): (1) private members of the home class and its enclosing classes, when the receiver has them (fields in `object.privates` under the class's `PrivateKey`); (2) the member index with protected checks per accessor half (`getAccess`/`setAccess`); built-in data on prototypes; (4) a hidden private in the receiver's chain → `AccessError`; (5) D36 "no member". `src/runtime/lookup.ts` holds the shared prototype-chain lookup helpers used by `properties.ts`.
- `AccessError` is a subclass of `TypeError` (`src/stdlib/errors.ts`), messages exactly as §4.5.2.
- `vm/classes.ts`: private methods/accessors/fields go into `privateIndex`/`staticPrivateIndex` (not inherited); public/protected into the member indexes. Accessor halves keep their own access.
- Compiler: `ClassInfo.privates`; a lexical stack of enclosing classes; `o.x` / `o.x = v` / `o.m()` emit `GET_PROP_PRIV depth k` / `SET_PROP_PRIV depth k` when an enclosing class declares `x` private (K16), else `GET_PROP`/`SET_PROP`. Private field initialisers use `SET_PROP_PRIV 0 k`. The VM tries that class's private member first, else falls back to the generic path (which runs the whole algorithm, also for computed `o[k]`).
- `IN` uses the access rules (`hasPropertyIn`): class members count only when accessible. Reflection (`Object.keys/values/entries`, `JSON.stringify`, D35 `ClassName(...)`) lists public fields only (`publicProps`).
- **Fix:** every closure (not only arrows) inherits the creating frame's home class, so nested `function` expressions inside methods can use private/protected members (§4.5.2). `homeObject` (for `super`) stays arrow-only.

Deviations / gaps:

- §10.16's `Report.render()` calls `this.body()`, which Report does not declare; with D36 that is a compile-time SyntaxError (whole chain visible). The program calls the subclass hook through another receiver (`const page = this; page.body()`), which exercises the "superclass may use a subclass's protected member" rule at runtime. PLAN §10.16 should be adjusted.
- `this.x` where `x` is private to a superclass compiles (the compile-time member check counts all access levels) and fails at runtime with `AccessError` (§4.5.3 step 4), as the spec allows.
- An accessor whose halves are split between `private` and a non-private access ends up as two separate members (private half in the private index); untested corner.
- `super.x` does not check access yet (`superMember` reads the superclass member index, which only holds public/protected; private superclass members are therefore "no member").
- `tests/unit/vm/vm.test.ts` "unimplemented opcode" now uses `INTERFACE` (change again in M19).

Notes for next session (M18):

- Override/final checks belong in `defineClass` (`vm/classes.ts`) before `members()` replaces entries: compare against the inherited `MemberEntry` (`owner`, `access`, `final`, `kind`); private members are skipped (they are not in the member index). `Class.isFinal`/`template.isFinal` for `Cannot extend final class`.
- `§10.16`/`§10.17` programs already use `override` (not yet checked); keep them valid.

## M16 — Accessors

Done: accessor programs pass (`tests/programs/accessors/`). `npm run check` and `npm run build` green; 805 tests.

What exists:

- Token filter (§4.2.5): `get`/`set` followed by a member name on the same line, in class-member or object-key position, become `GET`/`SET` (`get() {}`, `get = 1`, `{ get: 1 }`, `{ get }`, `get\n x() {}` stay names). **Fix:** a token on a new line after something that ends a member is in member position even though the `;` the filter will insert has not been emitted yet (`x = 0\n get y() {}`, `x = 1\n static z = 2`).
- Grammar: class `GET name() {}` / `SET name(param) {}` (exactly one parameter), object-literal `get k() {}` / `set k(v) {}` (`Property.kind` `get`/`set`, `method: false`). An accessor named `constructor` → SyntaxError.
- Compiler: accessor members → protos of kind `getter`/`setter`, `ClassMethodTemplate.kind` `get`/`set`; object-literal accessors → `DEFINE_GETTER`/`DEFINE_SETTER`.
- Classes (`vm/classes.ts`): a get/set pair combines into one `accessor` member entry; a subclass redefining one half keeps the inherited other half (§4.5.6). `super.x` on an accessor calls the superclass getter with the current `this`.
- `src/runtime/properties.ts` rewritten with the access context and the original receiver threaded through: getters/setters run via `ctx.callFunction` with the receiver; class accessor without setter → `TypeError: Cannot set property x of A which has only a getter`, without getter → `TypeError: 'x' has only a setter` (§4.4.12); object literals store own `Accessor`s (`defineAccessor`; a later data property replaces them), a setter-only one reads `undefined`, a getter-only one rejects writes. Compound assignment / update call the getter once and the setter once.
- Object-literal accessors: `print` shows `[Getter]` / `[Setter]` / `[Getter/Setter]`; `JSON.stringify`, `Object.values`/`entries`/`assign` call the getter (`stringify(ctx, value, [replacer, indent])` now takes the context). Class accessors are not own properties (not in `Object.keys`, D35, JSON) but `in` sees them.

## M15 — Classes

Done: class and construction programs pass (`tests/programs/classes/`; JS-compatible ones also against Node and acorn). `npm run check` and `npm run build` green; 783 tests, no todos.

What exists:

- Grammar: class declarations (`CLASS_DECLARATION`) and expressions, `final class`, `extends LeftHandSideExpression`, class bodies (`CLASS_LBRACE`) with fields (`name`, `name = expr`), methods and a constructor; **all member modifiers are already parsed** in the fixed order `(public|protected|private)? static? final? override?` and stored on the AST (`access`, `static`, `final`, `override`) — only `static` has semantics so far (access: M17, override/final: M18). `super(...)`, `super.x`, `super[k]`. `src/parser/class-members.ts` checks modifier order/duplicates, private + final/override, constructor modifiers, a field named `constructor`; one constructor per class.
- Token filter: `class` at statement start (or after a statement-starting `final`) → `CLASS_DECLARATION`; the class body brace (tracked by depth, like function-declaration bodies) → `CLASS_LBRACE` with a `{class}` / `{class-statement}` bracket (ASI applies inside; a declaration's `}` ends the statement); in member position, `final`/`override` before a modifier or name → `FINAL`/`OVERRIDE`, `final` before `class` → `FINAL`; keywords followed by `(`, `=`, `;`, `}` or a newline are member names (`static() {}`, `if = 1`). Special emit handling lives in the `EMIT_HOOKS` table.
- Compiler: `src/compiler/class-info.ts` keeps member names per class declaration (keyed by binding) so that `this.x` (methods, constructor, initialisers and arrows in them; not nested `function`s) and `C.x` are **SyntaxErrors at compile time** when the whole chain is visible (superclass named directly and declared in the same compilation); otherwise `this.x` references go to `template.memberRefs`, checked by `CLASS` (TypeError). Class declarations are **constant** bindings (TDZ until evaluated). A `ClassTemplate` holds: constructor proto (kind `constructor` / `derivedConstructor`; ends with `THIS RETURN`; `return expr` → `SyntaxError: Constructors cannot return a value`, D27), `instanceFieldInit` / `staticInit` protos (`THIS <value or NULL> DEFINE_PROP k POP` per field), methods (kind `method`), field names, `memberRefs`, `isFinal`, and `bindsName`. Code: `[PUSH_ENV 1] <superclass>? CLASS k [POP_ENV]` — a named class gets a one-slot environment for its name.
- **Contract addition:** `ClassTemplate.bindsName` — `CLASS` stores the class in slot 0 of the current environment before static initialisers run (so `static x = C.y` works). The "no superclass" case is handled by `template.hasSuper` (CLASS pops a superclass only then) — no `PUSH_EMPTY` needed.
- `src/vm/classes.ts`: `defineClass` (superclass must be a class: `TypeError: Class extends value f is not a class`; prototype chained to the superclass's / `Object.prototype`; flattened `memberIndex` / `staticMemberIndex` copied from the superclass then extended with this class's methods and fields; method closures get `homeClass` and `homeObject` = prototype or class; `memberRefs` check; name slot; `extensible = false`; static initialiser runs with `this` = class), `superMember` (`GET_SUPER`), `hasInstanceMember` / `hasStaticMember`.
- VM: `CLASS`, `SUPER_CALL`, `GET_SUPER`, `GET_SUPER_INDEX`; `THIS` in a derived constructor before `super()` → `ReferenceError: Must call super constructor before accessing 'this'`. Construction: a base class creates the instance (`klass` = newTarget, prototype = newTarget.prototype), runs its field initialiser, then its constructor; a derived constructor runs with `this` uninitialised and `SUPER_CALL` constructs the superclass part with the same newTarget (built-in classes construct natively, so `class E extends Error` works), then runs this class's field initialiser; an implied derived constructor passes the arguments through; a base class without constructor takes no arguments (D38). Constructors run in a nested dispatch loop (`runNested`, like callbacks). Frames take `homeClass`/`homeObject` from the closure; arrows capture them lexically.
- Properties (D29, D36): class instances read own fields, then the class's methods (member index), then built-in prototype data/methods, else `TypeError: Point has no member 'z'`; writes allowed only to declared fields and inherited built-in data (`Cannot assign to method 'm' of class 'A'`, `… has no member …`). Classes read their statics (own and inherited), `name`, `length`, `Function.prototype` members, else `TypeError: Class 'C' has no member …`; new statics → `Cannot add property 'x' to class 'C': classes are not extensible`. `in` sees class members and never throws.
- D35: `Object.prototype.toString` gives `ClassName(field = value, …)` for class instances (own data properties; nested values formatted like `print`, nested instances through their own `toString()`, cycles `[Circular]`); `super.toString()` gives it back from an override. `print`/`formatValue` take the access context so instances print through their (possibly overridden) `toString()`.
- `Error.prototype` declares `message`, `stack`, `cause` (so they are known members of error subclasses).
- Acorn oracle ignores `override`, `final`, `implements` (PScript class extensions).

Notes / gaps:

- Programs using `override` are `@pscript-only` (not JS syntax); M18 will make `override` mandatory where a member redefines an inherited one, so write it now.
- Arrows created in a derived constructor before `super()` capture the uninitialised `this`.
- `Object.keys`/`JSON.stringify`/D35 list all own fields until access modifiers (M17) hide non-public ones.

## M14 — Template literals

Done: `templates/` programs pass, also against Node and acorn where JS-compatible. `npm run check` and `npm run build` green; 734 tests + 1 todo.

What exists:

- Lexer: instead of an exclusive start condition, two regex rules match a whole template chunk — `` `text` `` / `` `text${ `` and `` }text${ `` / `` }text` `` (`TEMPLATE_TEXT` macro: `[^`\\$]`, escapes, `$` not followed by `{`). `src/parser/templates.ts` `TemplateBraces` (per parse, behind `yy.openBrace`/`closeBrace`/`templateStart`/`templateContinue`) keeps one open-brace counter per interpolation: a `}`-chunk only continues the template when the `}` closes the current interpolation (counter 0); otherwise the action calls Jison's `less(1)` to give the text back and returns a plain `}`. Unterminated template → `SyntaxError: Unterminated template literal`; unterminated interpolation → a parse error at the end.
- Tokens `TEMPLATE_FULL`, `TEMPLATE_HEAD`, `TEMPLATE_MIDDLE`, `TEMPLATE_TAIL`; `templateElement` builds `TemplateElement { raw, cooked }` (`\r\n`/`\r` → `\n` in both; cooked via `cookString`, so escape errors and octal rules match strings, plus `` \` `` `\$` `\{`).
- Grammar: `TemplateLiteral` as a primary expression (`TEMPLATE_FULL` | `TEMPLATE_HEAD Expression TemplateRest`).
- Token filter (§4.2.6): `TEMPLATE_HEAD` opens a `{template}` bracket closed by `TEMPLATE_TAIL` (no ASI inside, `{` right after is an object literal); a template at the start of a line begins a statement (not a CONTINUER). **Tagged templates** (a template directly after an expression on the same line) → `SyntaxError: tagged templates are not supported; call a function with a template instead: tag(`x`)` — `return`/`break`/`continue` before a template are not tags.
- Compiler: text parts → `CONST` (empty ones skipped), substitutions → `<expr> TO_STRING`, then `CONCAT n` (nothing to concatenate → `CONST ''`). VM: `TO_STRING` (= `toStringIn`: calls `toString()`, never a D5 error) and `CONCAT n`.

Notes:

- `templates/asi.pscript` is `@pscript-only`: in JS a template on the line after an expression is a tagged template.
- The `Money` example of §10.2 (a class with `override toString()`) waits for M15.

## M13 — Standard library

Done: stdlib programs pass (`tests/programs/stdlib/`, also against Node where JS-compatible). `npm run check` and `npm run build` green; 693 tests + 1 todo.

What exists (`src/stdlib/`, all globals read-only):

- `src/runtime/conversions.ts`: **`toStringIn(ctx, v)`** — `ToString` that looks up `toString` with normal member resolution and calls it (result must be primitive; no usable `toString` → `TypeError: Cannot convert object to string`) — and `addIn` (`+`). The VM's `ADD`, `join`, default `sort`, `String()`, `parseInt`/`parseFloat` and string-method arguments use it. Built-in `toString`s are natives on the prototypes (`Object.prototype` → `[object Object]` / errors `Name: message`; arrays → `join(',')`; functions/classes → `[Function: f]` / `[class C]`; numbers with radix; booleans; strings). The context-free `operators.toString` stays for built-in forms only.
- `object.ts`: `Object.prototype.toString`, `hasOwnProperty`; `Object.keys/values/entries` (insertion order, arrays and strings by index), `assign`, `freeze` (new `Object.frozen` flag: existing properties become read-only — contract addition).
- `function.ts`: `Function.prototype.toString`, `bind` (bound functions pass the target only the arguments it declares, like native callbacks, so `[x].map(obj.m.bind(obj))` works under D38), `call`, `apply`.
- `string.ts`: every §4.6.3 method; `split(sep, limit?)`; `replace`/`replaceAll` take string patterns and **literal** replacements (no `$&` patterns — a deviation, PScript-only test); `at` out of range → `null` (D37); `String(v)` conversion function.
- `number.ts`: `Number(v)` (objects → D5 TypeError) with `MAX_SAFE_INTEGER MIN_SAFE_INTEGER EPSILON MAX_VALUE MIN_VALUE isInteger`; `toFixed`, `toString(radix)`; `Boolean(v)`; `parseInt`, `parseFloat`, `isNaN`, `isFinite`; `NaN`, `Infinity`.
- `math.ts`: `Math` with `PI E` and every §4.6.1 function; `random` comes from `InterpreterOptions.random` (new option).
- `json.ts`: `JSON.stringify(value, null?, indent?)` with its own serializer (insertion-order keys; `undefined`/functions skipped in objects, `null` in arrays; non-finite numbers → `null`; cycles → TypeError; replacer functions → TypeError). `JSON.parse` (COULD) not implemented.
- `global.ts`: `print`, `console.log` / `console.error` (`stderr` option now used), `globalThis` (`src/runtime/global-object.ts`: reads the realm's globals live; writes → `TypeError: Cannot assign to 'x' through globalThis`).
- `installStdlib(realm, { stdout, stderr?, random? })`.
- Node harness: the vm context also gets `console.log` = print.

Gaps:

- Natives do not declare/check arity (§5.6.3).
- `Object.keys` of error objects lists `message`/`stack` (JS: non-enumerable).
- Class instances: `Object.prototype.toString` will produce `ClassName(field = value, …)` (D35) in M15; `Object.keys` will need to list only public fields (M17).

## M12 — Callbacks and re-entrancy

Done: `map`/`filter`/`reduce`/`sort` with throwing callbacks pass (`tests/programs/callbacks/`, also against Node). `npm run check` and `npm run build` green; 663 tests + 1 todo.

What exists:

- `src/stdlib/callbacks.ts`: `requireCallback` (`Array.prototype.map: number is not a function`), `callBack` (D38: a script closure receives as many of the offered arguments as it declares — all of them with a rest parameter; natives get all; a callback requiring more → the usual arity TypeError), `compareResult` (NaN → 0).
- `src/stdlib/array-callbacks.ts`: `forEach map filter flatMap some every find findLast findIndex reduce reduceRight sort`. They delegate to the JS algorithms on the live `items` array (so mutation during iteration behaves as in JS); `find`/`findLast` not found → `null`, `forEach` → `null` (D37); `reduce` of an empty array without an initial value → TypeError; `sort` is stable, defaults to `ToString` order, and sorts a copy so a throwing comparator leaves the array unchanged; the optional `thisArg` is supported.
- `Array.from(iterable | { length }, mapFn?)` (missing elements of an array-like are `undefined`, as JS).
- VM: `callFunction` runs script functions in a nested dispatch loop (`runNested`); a host `RangeError` from stack exhaustion during deep native ⇄ script re-entrancy becomes the script `RangeError: Maximum call stack size exceeded` (catchable), even with `maxCallDepth: Infinity`.
- `tsconfig.json` `lib` is now `ES2023` (`findLast`).

## M11 — Exceptions

Done: exception programs pass (`tests/programs/exceptions/`, incl. `finally` on `return`/`break`/`continue`, also against Node where JS-compatible); every §4.4.10 row passes against Node. `npm run check` and `npm run build` green; 645 tests + 1 todo.

What exists:

- Grammar: `throw expr`, `try` with `catch (e)`, `catch` without binding, `finally`, and both. `CATCH` is a header keyword and a statement-brace preceder in the filter.
- Errors (§4.6.1): `src/stdlib/errors.ts` installs `Error`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `AccessError` as built-in **classes** (`Class` with `native.construct`), read-only globals; `name` lives on each prototype, `message` and `stack` are own properties; `Error.prototype.toString` → `Name: message`. `createError(ctx, cls, message)`; the stack string is `Name: message` + `    at fn (line:col)` lines from `ctx.captureStack()`. Calling a class without `new` → `TypeError: Class constructor Error cannot be invoked without 'new'`. `NEW` on a built-in class constructs natively (script classes still throw "not implemented" until M15).
- `ToString` / `print` of error objects → `TypeError: msg` (class instances print through `toString()`, D35); `isErrorObject`, `errorToString`, `inheritedProperty` in `operators.ts`.
- VM (§5.6.5):
  - `run(entryDepth)` wraps `dispatch(entryDepth)` (the old loop) in `try`/`catch`; `unwind` turns the exception into a `ScriptThrow` (a `ScriptError` from the runtime becomes an instance of the matching error class, with the stack captured where it happened), pops handlers/frames of this dispatch loop, and either enters a handler (restoring stack height and environment; `catch` gets the value, `finally` a `FinallyRecord`) or rethrows to the caller — through natives into outer dispatch loops, or out of `execute`.
  - Opcodes: `TRY catch finally` (pushes a handler with stack height and env), `END_TRY`, `THROW`, `ENTER_FINALLY` (pushes a normal record), `END_FINALLY` (rethrows a pending exception).
  - Uncaught: `PScriptRuntimeError` with the thrown error's name/message (non-errors: `Error: Uncaught <value>`), the stack captured at the throw, and `value` = the script value (host conversion: M23).
  - `AccessContext.captureStack()` (optional, contract addition) — the VM implements it.
- Compiler:
  - `try/catch`: `TRY catch -1; block; END_TRY; JUMP end; catch: bind; body; end`. `try/finally`: `TRY -1 finally; block (or the try/catch); END_TRY; ENTER_FINALLY; finally: body; END_FINALLY` — so a `catch` block runs inside the outer finally handler.
  - **`break`/`continue`/`return` crossing a `try`** pop its handler (`END_TRY`) and **inline a copy of its `finally` block** (compiled in the try statement's scope, with only the outer regions active), innermost first; `return` computes its value first. This gives JS semantics (finally runs once, a `return`/`break` inside `finally` overrides) with no runtime completion records for jumps.
  - `FunctionContext.regions` (active handler regions) and `stackItems` (values kept on the stack across statements: for-of iterators, finally records, saved completion values); loops record both, and `break`/`continue` drop the extra stack values first.
  - Completion value: `try` resets it on entry; a `finally` block saves and restores it (`LOAD`/`STORE` around the block).

Decisions / gaps:

- `throw` followed by a newline is not rejected (JS: SyntaxError); `throw` is not an ENDER, so the expression on the next line is thrown.
- Unexpected host exceptions from natives are not wrapped as `InternalError` yet (§5.6.5); they propagate unchanged and are not catchable.
- Error `name` is a prototype property; M15 (`class ValidationError extends Error { override name = … }`) may need it as a declared field.

## M10 — Arrays and for…of

Done: array and loop programs pass (`tests/programs/arrays/`, also against Node and acorn where JS-compatible). `npm run check` and `npm run build` green; 626 tests + 2 todo.

What exists:

- Grammar: array literals (no holes, trailing comma), `for (let x of e)`, `for (const x of e)`, `for (x of e)`. `yy.forOfDeclaration` builds the one-declarator `VariableDeclaration` acorn produces.
- Arrays (§4.4.7, D37): integer keys only — reads out of range (including negative indexes) → `RangeError: Index -1 out of range for length 1`; writes past the end fill with `null`; writing a non-integer key → `TypeError: Arrays only accept integer keys (got 'foo')`; `length` is writable (truncates/extends with `null`; invalid → `RangeError: Invalid array length`). Reads of other keys go to `Array.prototype`. Strings reject negative indexes the same way.
- `src/runtime/iterators.ts`: `ScriptIterator` (never visible to scripts; lives on the VM stack), `getIterator` (arrays: live, by index while `i < length`; strings: by code unit; else `TypeError: x is not iterable`), `DONE` sentinel.
- Compiler: `ARRAY n`; for-of as `GET_ITER; top: ITER_NEXT done; [PUSH_ENV 1; INIT] body; next: [POP_ENV] JUMP top; break: [POP_ENV] POP; done:` — `break` jumps to the label that pops the iteration environment and the iterator, `continue` to the one that pops only the environment. A bare identifier is assigned with `STORE`/`STORE_GLOBAL`.
- VM opcodes added: `ARRAY GET_ITER ITER_NEXT`.
- `src/stdlib/native.ts` (`defineMethods`, `integerArgument`, `orNull`), `src/stdlib/array.ts`: `push pop shift unshift slice splice concat join reverse indexOf lastIndexOf includes at fill flat` (non-array receiver → TypeError; "nothing / not found" → `null`, D37; `includes` uses SameValueZero, `indexOf` strict equality); the global `Array` is a read-only namespace object (not a class) with `isArray` and `of`.

Gaps:

- Callback methods (`map`, `filter`, `sort`, …) and `Array.from` → M12/M13.
- `[] instanceof Array` gives the generic `Right-hand side of 'instanceof' is not a class` (§10.10 suggests mentioning `Array.isArray`).
- Script arrays returned to the host are the internal objects until interop (M23).

## M9 — Objects

Done: object programs pass (also against Node where JS-compatible); the acorn oracle (`tests/parser-oracle.test.ts`) matches every JS-valid, non-`@pscript-only` program. `npm run check` and `npm run build` green; 597 tests + 2 todo.

What exists:

- Token filter:
  - **Brace classification (§4.2.2)**: `{` becomes `BLOCK_LBRACE` or `OBJ_LBRACE`. Brackets are now `{statement}` (block statements, function-declaration bodies), `{block}` (bodies of function expressions, arrows, methods — after `)` / `=>`) and `{object}`. A statement start (none, `;`, `BLOCK_LBRACE`, `}`, `else`, `try`, `finally`, a header `)`) or a pending function-declaration body (tracked by bracket depth, `declarationDepth`) gives `{statement}`; `)`/`=>` give `{block}`; anything else `{object}`.
  - **The `}` of a `{statement}` is not an ENDER** (`closesStatement`), so no `;` (EmptyStatement) is inserted after block statements and function declarations — required for the acorn oracle. Expression bodies keep the §4.2.1 behaviour (`let f = () => {\n}\nf()` is two statements).
  - **Keywords as property names (§4.2.4)**: after `.`, and in object-key position (`{object}` top, prev `OBJ_LBRACE`/`,`, next `:` `(` `,` `}`) → `IDENT` (text kept). Class-member positions come with M15.
  - `CATCH` added to the header keywords (its `)` does not end a statement), ready for M11.
- Grammar: JS-style `LeftHandSideExpression` = `MemberExpression | CallExpression`; `MemberExpression` includes `new X(...)` (so `new a.B(1).c()` works); object literals: `key: value`, shorthand `{ a }`, methods `m() {}`, string/number keys, trailing comma. Identifier keys have their own rules (reducing `IDENT` to a `PropertyName` first was an LALR conflict in Jison). Assignment/update targets may be member expressions. Parse errors show `BLOCK_LBRACE`/`OBJ_LBRACE` as `'{'` etc.
- `src/runtime/properties.ts`: `getProperty`, `setProperty`, `defineProperty`, `propertyKey`. Missing property → `undefined`; `null`/`undefined` receivers → `TypeError: Cannot read properties of null (reading 'k')` / `Cannot set properties of …`; primitives → their realm prototypes; strings: `length` and index (out of range → `RangeError: Index 5 out of range for length 3`, D37); arrays: `length` (assignable, truncates) and indices (out of range read → RangeError, write past the end fills with `null`); functions: `name` / `length` (read-only); non-extensible objects reject new properties.
- Compiler: `Reference` abstraction for assignment targets (name / `o.k` / `o[k]`, `baseSize` 0/1/2) used by `=`, compound and logical assignment (logical drops the base with `SWAP POP` / `ROT3 POP POP` when it does not assign) and `++`/`--` (postfix keeps the old value with `DUP` + `ROT3`/`ROT4`). `o.m(x)` → `<o> DUP GET_PROP m <x> CALL_METHOD 1`; object literals → `OBJECT` + `DEFINE_PROP k` per property; methods are protos of kind `'method'`; property values that are anonymous functions/arrows are named after the key. Assigning an anonymous function to a variable names it too.
- VM opcodes added: `DUP2 SWAP ROT3 ROT4 GET_PROP SET_PROP GET_INDEX SET_INDEX OBJECT DEFINE_PROP CALL_METHOD` (`this` = receiver). `DEFINE_PROP` sets the home object of methods.
- `print` formats objects and arrays (§4.6.2: `{a: 1, "full name": "Ann"}`, `[1, "a"]`, `[Circular]`, `[Object]`/`[Array]` beyond depth 2). `ToString`: plain objects `[object Object]`, arrays `join(',')`.
- `tests/parser-oracle.test.ts`: acorn (`ecmaVersion: 'latest'`, script) vs PScript, ignoring `start end loc range access generator async directive` and `expression` on non-arrow functions; programs acorn rejects are skipped.

Decisions / gaps:

- `ToString` of an object does not call a script-defined `toString()` yet (M13/M14).
- Computed keys (`{ [k]: v }`, COULD) and accessors (M16) are not supported yet.
- `functions/duplicate-parameter.pscript` is now `@pscript-only` (acorn's sloppy mode allows duplicate parameters).
- The dispatch loop's lint exemption now also covers `@stylistic/padding-line-between-statements` (`CALL_METHOD` falls through to `CALL`).
- `x is not a function` messages name the value's type, not the expression (`o.m is not a function` in JS).

## M8 — Arrow functions

Done: arrow programs pass (`tests/programs/arrows/`, also against Node). `npm run check` and `npm run build` green; 489 tests + 4 todo.

What exists:

- Token filter (§4.2.3): a lookahead buffer (`lookahead`, `peek(i)`, `readRaw()`); `read()` classifies each token through the `ARROW_STARTS` table: `IDENT` followed by `=>` → `ARROW_IDENT`; `(` whose matching `)` (depth counting over the lookahead) is followed by `=>` → `ARROW_LPAREN` (pushes a `(` bracket). A newline before `=>` → `SyntaxError: Line terminator not permitted before '=>'` via the new `TokenState.fail` hook. Worst case O(n²) over nested parentheses, no memoisation yet.
- Grammar: `ArrowFunction` at the lowest level of `AssignmentExpression` (`ARROW_IDENT '=>' ArrowBody | ARROW_LPAREN FormalParameters ')' '=>' ArrowBody`); `ArrowBody` is a block or an `AssignmentExpression`. Parameters are checked like function parameters.
- Compiler: arrows compile through `functionProto` with kind `'arrow'`; an expression body is `<expr> RETURN`. `FunctionContext` gained `parent`, `isArrow`, `usesThis`; `this` marks the current arrow and every enclosing arrow up to the nearest non-arrow function (`markArrowsUsingThis`), so `FunctionProto.usesThis` is true exactly for arrows that need the lexical `this`. `const f = () => …` gets a compile-time signature and the name `f`.
- VM: `CLOSURE` of a proto with `usesThis` stores the frame's `this` in `closure.thisValue`; calling an arrow uses `closure.thisValue ?? null` instead of the call's `this`.

Notes:

- Lexical `this` is tested through a native that calls a function with an explicit `this` (`tests/unit/vm/arrows.test.ts`); real method calls come with M9.
- Arrows will also capture the home class lexically (§4.4.5) — M15.

## M7 — Functions

Done: closure, counter and recursion programs pass (`tests/programs/functions/`, also against Node where JS-compatible). `npm run check` and `npm run build` green; 460 tests + 5 todo.

What exists:

- Grammar: `FunctionDeclaration` (token `FUNCTION_DECLARATION`, see below), `FunctionExpression` (anonymous or named) as a primary expression, parameters `a`, `a = expr`, `...rest` (trailing comma allowed), `return [expr]`, `this`, and a minimal `NEW PrimaryExpression Arguments` (member callees arrive with M9). `yy.functionNode(type, { id, params }, body, loc)`.
- Parser checks: required after optional, rest not last, duplicate parameters → SyntaxError; a function declaration as the sole body of `if`/`while`/`for` → SyntaxError.
- Token filter: `function` at the start of a statement (start of input, after `;`, `{`, `}`, `else`, or a control-flow header's `)`) becomes `FUNCTION_DECLARATION`, so the LALR grammar can tell declarations from expression statements.
- `src/compiler/signature.ts`: `signatureOf(name, params)` → `{ text: 'greet(name, greeting?)', required, optional, hasRest }`, `arityError(signature, argc)` → `'… expects 1-2 arguments, got 0'` | `null`. Shared by compiler and VM.
- Compiler: per-function `FunctionContext` (`out`, `scope`, `loops`, `tracksCompletion`); `Scope` kind `'function'` (always has an environment); binding kind `'function'` (constant, D38: `Cannot assign to function 'f': function declarations are constant`) with an optional `signature`. Function declarations are hoisted (pre-scan declares them; `CLOSURE` + `INIT`/`INIT_GLOBAL` at scope entry: script, block, function body). Function env layout: parameters (rest last), then the body's top-level declarations. Defaults: prologue `JUMP_IF_ARG slot skip; <default>; INIT 0 slot`. Every function ends with `NULL RETURN` (D37). A named function expression gets a one-slot environment holding itself (`PUSH_ENV 1; CLOSURE; DUP; INIT; POP_ENV`). `let f = function () {}` names the function `f`. Compile-time arity check for callees that are function declarations or `const`s bound directly to a function expression. `return` outside a function → `SyntaxError: Illegal return statement`.
- VM: call frames without JS recursion (`CALL` pushes a frame, `RETURN` pops it and restores the caller's hot locals); `run(entryDepth)` returns when the entry frame returns, so `callFunction` (native → script, §5.6.4) runs a nested dispatch loop. Runtime arity check (`TypeError`, same message), rest parameter → `Array` with `realm.ArrayPrototype`, omitted parameters stay `UNINITIALIZED` for `JUMP_IF_ARG`. `maxCallDepth` counts calls (the script frame is not a call) → `RangeError: Maximum call stack size exceeded`. `NEW` on a non-class → `TypeError: square is not a class` (D25); classes are not implemented yet. Stack traces list frames innermost first, `<script>` and `<anonymous>` for unnamed code.

Contract additions:

- **Opcode `JUMP_IF_ARG slot target`** (jump when parameter `slot` was passed): an omitted argument must be told apart from an explicit `undefined` (D38), which no existing opcode could do.
- `FunctionProto.signature?: string` — display form of the parameter list for runtime arity messages.

Decisions / known gaps:

- `this` at script top level is `null` (§4.4.12 says so for plain calls and modules; scripts follow).
- Default values see the function body's top-level `let`/`const` (in TDZ) rather than only outer bindings, because parameters and body declarations share one environment. JS uses a separate parameter scope; observable only in contrived code.
- Function declarations at script level are constant script bindings, so redeclaring a function in a later `run()` on the same `Interpreter` is a `SyntaxError` (JS would allow it for `function`).
- `fn.name` / `fn.length` are stored on the function objects, but member access arrives with M9.
- Natives don't declare arity yet (§5.6.3 says they should; `print` is variadic anyway).

## M6 — Control flow

Done: FizzBuzz and every §4.4.10 row except `try` (M11) and `function` (M7) pass, compared with Node's `vm` (`tests/unit/vm/completion.test.ts`). `npm run check` and `npm run build` green; 394 tests + 7 todo.

What exists:

- Grammar: `if`/`else` (dangling else via `%nonassoc IF_WITHOUT_ELSE` / `ELSE` precedence), `while`, `for (init; test; update)` (each clause optional; init is a `let`/`const` declaration or an expression), `break`, `continue`. A lexical declaration as the sole body → `SyntaxError: Lexical declaration cannot appear in a single-statement context`. `yy.forStatement` takes the header as `{ init, test, update }` (lint caps parameters at 4).
- Compiler: loop stack (`breaks`/`continues` jump lists + environment depth); `break`/`continue` emit one `POP_ENV` per block environment they leave; outside a loop → `SyntaxError: Illegal break statement` / `Illegal continue statement`. `for (let …)` → head scope with `PUSH_ENV`, `COPY_ENV` before the update (fresh binding per iteration), `POP_ENV` after the loop. `if`/loops reset the completion value to `undefined` on entry; `tracksCompletion` flag (always true until M7 adds function bodies). `ProtoBuilder.patch(operand, target)` can now patch backward targets.
- VM: `COPY_ENV`; `maxSteps` enforced (`RangeError: Execution step limit exceeded`), counted per `execute()` only when finite (`VM.steps`).
- `src/runtime/script-error.ts`: `rangeError`.
- Programs: `tests/programs/control-flow/` (FizzBuzz, while/break/continue, for variants, if/else incl. dangling else, nested break through block environments, error cases).

ASI changes (token filter):

- A `)` that closes the parentheses after `if`/`while`/`for` is not an ENDER (`closesHeader`), so `if (c)\n  stmt` keeps `stmt` as the body. §4.2.1 does not mention this, but without it a `;` would be inserted after the `)`.
- **Deviation:** §4.2.1 lists `else` as a CONTINUER, which leaves `if (a) f()\nelse g()` without the `;` the then-branch needs. The filter now inserts `;` before an `else` that starts a line when the previous token may end a statement and is not a `}` that closed a block (`closesBlock`). `if (a) b else c` on one line stays a syntax error, as in JS.
- Special insertion rules live in the `SPECIAL_TOKENS` table (`EOF`, `}`, `ELSE`).

## M5 — Operators

Done: operator tables tested; every binary operator over 15 primitive values (3375 expressions) and every unary operator match Node exactly (`tests/unit/runtime/operator-matrix.test.ts`). `npm run check` and `npm run build` green; 340 tests + 6 todo.

What exists:

- Grammar levels (§4.4.3): `ConditionalExpression` → `NullishExpression` (`??`) → `OrExpression` → `AndExpression` → `EqualityExpression` → `RelationalExpression` (`< <= > >= instanceof in`) → additive …; prefix `++`/`--` in `UnaryExpression`; `PostfixExpression` (`CallExpression '++' | '--'`) below `**`. `??` mixes freely with `&&`/`||` (lower precedence than `||`). Targets of `++`/`--` are checked like assignment targets (`Invalid '++' target`).
- Compiler: `&&`/`||`/`??` → `AND_JUMP`/`OR_JUMP`/`NULLISH_JUMP`; ternary → `JUMP_IF_FALSE`/`JUMP`; `++x` → `LOAD POS INC STORE`, `x++` → `LOAD POS DUP INC STORE POP`; comparisons → `EQ NE LT LE GT GE INSTANCEOF IN`.
- `src/runtime/operators.ts`: `strictEquals` (D1), `compare` (strings by code unit, else ToNumber; objects → D5 TypeError), `instanceOf` (classes by `klass`/`superClass` chain, interfaces by `klass.interfaces`; anything else on the right → `TypeError: Right-hand side of 'instanceof' is not a class`), `hasProperty` (`in`: prototype chain; arrays: indices and `length`; non-object → TypeError).
- VM opcodes added: `EQ NE LT LE GT GE INSTANCEOF IN INC DEC`.
- Programs: `tests/programs/operators/` (equality, comparison, logical, ternary, update, mixed-nullish, error cases).

Decisions:

- `in` does not apply access rules yet (§4.5.2, M17) and treats `props` keys only; `instanceof` works on the runtime structures, but nothing creates class instances until M15.
- `INC`/`DEC` assume a number (the compiler always emits `POS` first).

## M4 — Variables

Done: scoping programs pass in PScript and against Node (`tests/differential.test.ts`). `npm run check` and `npm run build` green; 284 tests + 6 todo.

What exists:

- Grammar: `let`/`const` with several declarators, `{ … }` blocks, `AssignmentExpression` (`CallExpression AssignmentOperator AssignmentExpression`, all ten operators). `yy.assignment` rejects targets other than identifiers (`Invalid assignment target`; members come in M9) and `undefined =`; `yy.variableDeclaration` rejects `const` without initialiser.
- `src/compiler/scope.ts`: `Scope` (`script` | `block`), `declare`, `resolve(name)` → `{ where: 'lexical', depth, slot }` | `{ where: 'script' }` | `{ where: 'global' }`, `hasEnv` (blocks with declarations only), `envDepth`.
- Compiler: pre-scan per statement list (duplicates → SyntaxError); script top-level declarations → `DECLARE_GLOBAL k flags` up front, `INIT_GLOBAL`; blocks → `PUSH_ENV n` / `POP_ENV` only when they declare something; reads/writes → `LOAD`/`STORE depth slot` or `LOAD_GLOBAL`/`STORE_GLOBAL`; `typeof` of a non-lexical name → `TYPEOF_GLOBAL`; `let x` → `null` (D37); const assignment known at compile time → `SyntaxError: Assignment to constant variable 'x'`; compound assignment; logical assignment via `AND_JUMP`/`OR_JUMP`/`NULLISH_JUMP` (assigns only when needed). Completion store uses `STORE envDepth 0`.
- `ProtoBuilder.emitJump` / `patch` (forward jumps) and `nameNext` (debug names).
- `src/vm/globals.ts`: `Globals` = script bindings (persist across `run()`, shadow globals, TDZ, const) + realm globals (read-only check). VM opcodes added: `STORE_GLOBAL DECLARE_GLOBAL INIT_GLOBAL PUSH_ENV POP_ENV JUMP JUMP_IF_FALSE JUMP_IF_TRUE AND_JUMP OR_JUMP NULLISH_JUMP`. TDZ errors name the binding: `Cannot access 'x' before initialization`.
- `print` (and every stdlib global from now on) is read-only. `Interpreter.get()` sees script bindings first.
- Differential harness: `tests/helpers/node-reference.ts` (`rewriteEquality` — token-aware `==`→`===`, `!=`→`!==` skipping strings and comments; `runInNode` — `node:vm` new context, `'use strict'`, `print` collector) and `tests/differential.test.ts` (same output lines and same error name; programs containing `@pscript-only` are skipped). `tests/programs/variables/` has 12 programs.

Deviations and decisions:

- **Contract addition:** `FunctionProto.names?: Record<number, string>` — debug table from instruction offset to binding name, used for TDZ messages (§5.4 says "name via debug table" without defining it).
- Redeclaring a script-level name in a later `run()` → runtime `SyntaxError` from `DECLARE_GLOBAL` (as JS); declarations before the failing one in that script stay declared (JS checks all first).
- Assigning a `const` script binding from an earlier run → runtime `TypeError: Assignment to constant variable 'x'` (it can't be known at compile time). Read-only global → `TypeError: Cannot assign to read-only global 'x'`.
- A binding whose initialiser never ran (error earlier in the script) stays in the TDZ forever, as in JS.
- `Interpreter.set()` still defines a realm global; a script binding of the same name shadows it.
- `npm run test:update-expected` (§6.3) is not implemented; `.out` files are written by hand.
- `operators/arithmetic.pscript` was split: the PScript-only parts (D15, D39, function ToString) moved to `operators/pscript-specific.pscript`.

Notes for the next sessions:

- **ASI after `}`:** following §4.2.1, a `;` is inserted after every block `}` followed by a newline or EOF (`}` is an ENDER), which yields `EmptyStatement`s that acorn would not produce. M9's acorn comparison will need either to ignore `EmptyStatement`s or a filter rule (e.g. treat a `}` that closed a statement block as not an ENDER — but function-expression bodies need the `;`, see the `() => {\n}\nf()` row, so this depends on §4.2.2 brace classification).
- Error programs in `tests/programs` are also checked differentially by error *name*; write messages and line numbers in `.err` as PScript produces them.

## M3 — Statements and ASI

Done: every §4.2.1 table row that the current grammar can express passes (`tests/unit/filter/asi-table.test.ts`); the others are `it.todo` naming their milestone (M4, M6, M7, M8, M9, M15). `npm run check` and `npm run build` green; 207 tests + 8 todo.

What changed:

- Lexer (§4.1.1): whitespace is space, tab, `\v`, `\f`, U+00A0, U+FEFF; `\r\n`, `\n`, `\r` → `NEWLINE`; U+2028/U+2029 → `NEWLINE` via `yy.lineSeparator`, which also fixes Jison's line counter (it only counts `\r`/`\n`); `//` and `/* */` comments (a block comment containing a line terminator yields `NEWLINE`, `yy.blockComment`); unterminated block comment → SyntaxError.
- `src/parser/tokens.ts`: `ENDERS` and `CONTINUERS` exactly as §4.2.1 (token names: keywords upper-case, punctuators by text). `TokenName` now also lists `NUMBER`, `STRING`, `NEWLINE`, `EOF`.
- `src/parser/token-filter.ts`: `TokenFilter` consumes `NEWLINE`s and inserts `;` per §4.2.1 (newline + statement level + `prev ∈ ENDERS` + `T ∉ CONTINUERS`; before a `{block}`'s `}`; at EOF). Bracket stack of `(`, `[`, `{block}`; every `{` counts as a block until M9 adds `{object}` (§4.2.2). Inserted `;` is zero-width at the end of the previous token.
- **The generated lexer returns grammar symbol ids (numbers) for quoted tokens such as `'+'` and for EOF**; the filter maps them back to names with the parser's `terminals_` table, and the parser accepts names. Keep this in mind when adding filter rules: compare against names, never ids.
- Grammar: `Program: StatementList EOF`; expression statements always end with `;` (real or inserted).
- `parse.ts` exports `tokenize(source)` (lexer + filter → token names; internal, not in the public API) used by the filter tests.

Deviations:

- **No `;` is inserted at EOF inside open `(` / `[`**: §4.2.1 says "at EOF when prev ∈ ENDERS" without the bracket condition. A `;` there can never parse, and without it the error is "Unexpected end of input" at the end of the source.
- Jison only offers an expected-token list when it is short; with ASI the parser is often in a state with many possibilities, so `f(1` now reports just "Unexpected end of input".

Known gaps:

- U+2028/U+2029 inside a block comment or after a backslash in a string do not advance Jison's line counter, so later positions are one line off in those rare cases.

## M2 — Calculator end to end

Done: `run('1 + 2 * 3') === 7`, `print('a', 1)` writes `a 1` (unit tests and the built `dist/index.js`). `npm run check` and `npm run build` green; 160 tests.

What exists (pipeline: `parse` → `compile` → `VM.execute`):

- `src/grammar/pscript.jison`: full §4.1.6 punctuator set in the lexer; numbers, strings, keywords, identifiers. The grammar covers only what M2 needs: `Program` = expression statements separated by `;` (the last `;` optional), `+ - * / % **`, prefix `! - + typeof`, calls, parentheses, literals, identifiers. Layered rules (no precedence declarations); D15 via `UnaryExpression → ExponentiationExpression` and `CallExpression '**' UnaryExpression`.
- The lexer delegates to `yy` helpers in `src/parser/parse.ts`: `identToken` (keyword → upper-case token, future reserved word → error), `numberToken` (leading zeros, identifier right after a number; checked in TS because a regex rule backtracks), `lexError`. `#`, `===`, `!==`, unterminated strings and stray characters are lexer errors.
- `src/parser/literals.ts`: string escape decoding (`cookString`, table-driven) and number checks. Octal escapes (`\1`, `\01`) are a SyntaxError; unknown escapes yield the character.
- `src/parser/ast-builders.ts`: node builders; Jison locations → 1-based line/column, end exclusive (`end.column` = 1-based column just past the token). `Program.loc` spans the whole source.
- `src/parser/token-filter.ts`: `TokenFilter` wraps the generated lexer (Jison uses `Object.create(parser.lexer)`, so per-parse state is reset in `setInput`). For now it only records the current token's location: Jison's error hash reports the last *shifted* token, so syntax errors use the filter's location instead. **M3 builds the ASI filter on this class.**
- `src/parser/parse.ts`: fresh `Parser` + `yy` + filter per call; readable parse errors (`Unexpected number 2`, `Unexpected end of input; expected ')', ','` — expected list shown when ≤ 6 entries).
- `src/compiler/proto-builder.ts` (`emit`, `constant` with number/string sharing and -0 kept apart, `mark(loc)` for the location table, `build`), `compiler.ts` (handler tables per node type; unsupported nodes → `SyntaxError: X is not supported yet`), `disassembler.ts`.
- Completion value: slot 0 of the script's top environment (`UNDEFINED; INIT 0 0` … `STORE 0 0; POP` per expression statement … `LOAD 0 0; HALT`).
- `src/vm/frame.ts`, `src/vm/vm.ts`: `switch` dispatch over a shared operand stack; implemented opcodes: `CONST UNDEFINED NULL TRUE FALSE POP DUP LOAD STORE INIT LOAD_GLOBAL TYPEOF_GLOBAL ADD SUB MUL DIV MOD POW NEG POS NOT TYPEOF CALL HALT`; anything else throws `Opcode X is not implemented`. `CALL` supports native functions only.
- `src/runtime/operators.ts` (`typeOf`, `kindOf`, `truthy`, `toNumber`, `toString`, `add`, `arithmetic`), `format.ts` (§4.6.2 primitives and functions/classes), `realm.ts` (`createRealm`, `defineGlobal`), `script-error.ts` (`ScriptError`, `typeError`, `referenceError`), `interop.ts` (primitives only).
- `src/stdlib/{index,global}.ts`: `print` (returns `null`, D37).
- `src/interpreter.ts`: `Interpreter` (`run`, `execute`, `get`, `set`), `run()`; re-exported from `src/index.ts` with `parse`, `compile`, `disassemble`, the errors and the AST types.
- Tests: `tests/programs.test.ts` runs `tests/programs/**/*.pscript` against a sibling `.out` (exact output) or `.err` (substring of the error message); `tests/helpers/run-program.ts`; unit tests under `tests/unit/{lexer,parser,compiler,runtime,vm}` and `tests/unit/api.test.ts`.

Deviations and decisions:

- **Error messages are formatted in the error classes** (`errors.ts`): `message` = `<file>:<line>:<col> <Name>: <reason>` + `\n` + excerpt; `<script>` when no file name; `reason` holds the bare text. The constructors changed to `PScriptSyntaxError(reason, { fileName, line, column, excerpt })` and `PScriptRuntimeError(scriptName, reason, value, { scriptStack, …location, excerpt })`. `formatExcerpt(source, line, column)` is exported.
- Uncaught runtime errors: `PScriptRuntimeError.value` is `{ name, message }` until script `Error` objects exist (M11). Location = start of the failing node (e.g. the whole binary expression).
- `typeof` of a declared global uses `TYPEOF_GLOBAL` (no ReferenceError either way).
- `InterpreterOptions` only has `globals`, `stdout`, `stderr`, `maxSteps`, `maxCallDepth` so far; `random` (M13) and `moduleLoader`/`modules` (M21) come later. Limits are stored but not enforced yet (M7/M24). `stderr` is unused.
- `Interpreter.get()` returns `undefined` for a missing global (§5.8 doesn't say). `call`, `runModule`, `importModule`, `defineModule`, `markAsClass`, `compileModule` are not exported yet.
- `toScript` throws for host objects/functions; `toHost` returns script objects unchanged (M23).
- `ToString(object)` only knows functions and classes; other objects throw `Cannot convert object to string` (full member lookup comes with M13/M14). `print` shows other objects as `[Object]` for now.
- Script classes are imported under aliases (`Object as ScriptObject`, `Array as ScriptArray`, `Function as ScriptFunction`) rather than shadowing.
- Coverage excludes `*.jison` (generated parser code). The build now also emits `dist/index.js.map`.

Notes for the next session (M3):

- **Lint vs. the dispatch loop:** `VM.run` is wrapped in `/* eslint-disable complexity, max-lines-per-function, max-statements */` (§5.6.2 requires one `switch`). Everywhere else complexity ≤ 4 and max-depth 2 apply: use handler tables (see `compiler.ts`, `literals.ts`).
- Tooling gotcha: writing `\u2028` into files through the editor tools produced raw U+2028 characters (which are line terminators in JS). Check with `grep -c $'\xe2\x80\xa8'`.
- `vite-plugin-eslint` lints every file Vitest loads, so a throwaway test file must satisfy the lint rules (or start with `/* eslint-disable */`).

## M1 — Contracts

Done: all contract files compile, lint and are covered by small unit tests (`tests/unit/`); `npm run check` and `npm run build` green.

Files:

- `src/parser/ast.ts`: §5.3 verbatim (one member per line, JSDoc on each, as the lint rules demand).
- `src/parser/tokens.ts`: §4.1.2 only: `KEYWORDS`, `CONTEXTUAL_KEYWORDS`, `FUTURE_RESERVED_WORDS`, `TokenName` (`IDENT`, upper-cased keywords), `IDENT_PATTERN`.
- `src/compiler/opcodes.ts`: `enum Op` (contiguous from 0, in §5.4 table order), `OPCODES: Record<Op, OpcodeInfo>` (`operands` names, `jumps` = indexes of jump-target operands, `stack` effect), `enum GlobalFlags` for `DECLARE_GLOBAL`.
- `src/compiler/function-proto.ts`: `FunctionProto`, `ClassTemplate`, `InterfaceTemplate`, `CompiledScript`.
- `src/runtime/values.ts`: the value model of §5.7 including `Realm`, `AccessContext`.
- `src/modules/module-record.ts`: `CompiledModule`, `BindingCell`, `ModuleStatus`, `ModuleRecord`.
- `src/errors.ts`: `PScriptError`, `PScriptSyntaxError`, `PScriptRuntimeError`.

Deviations and decisions where the plan was silent:

- **Additions:** `Node` union in `ast.ts`; `FunctionKind` type (includes `'module' | 'getter' | 'setter'` as §5.4 says); named sub-interfaces for inline object types (`ClassMethodTemplate`, `ClassMemberRef`, `ClassFieldTemplate`, `ImplicitName`, `InterfaceMemberTemplate`, `ModuleImportEntry`, `ModuleLocalExport`, `ModuleIndirectExport`, `GlobalBinding`, `ErrorLocation`, `RuntimeErrorLocation`, `ScriptStackFrame`, `ScriptErrorName`).
- **`Environment.slots` is `Slot[]`** where `Slot = Value | typeof UNINITIALIZED` (§5.7 says `Value[]`, which can't hold the TDZ marker).
- **`LOAD_IMPLICIT i a b`, `STORE_IMPLICIT i a b`, `CALL_IMPLICIT i argc a b`:** §5.4 says "fallback operands follow i" without fixing the count. They are always two: `depth slot` for a lexical fallback, `k(name) 0` for a global one, so every opcode has a fixed width.
- **Shapes §5.7 names but doesn't define:** `AccessContext { realm, homeClass, callFunction }`; `NativeImpl = (ctx, thisValue, args) => Value`; `NativeClassImpl { construct(ctx, cls, args) }`; `MemberEntry { kind, access, owner, final, fn?, get?, set? }`.
- **Constructors:** the value classes have minimal constructors (no logic). `Class.outerClass`, `Interface.members` and `Interface.ancestors` are initialised fields, not constructor parameters (lint caps constructors at 4 params). `Interface.ancestors` starts as `{ itself }`.
- `PScriptRuntimeError(scriptName, message, value, { scriptStack, fileName, line, column })`. `error.name` is the JS class name; message formatting (`file:line:col Name: msg` + excerpt) is not implemented yet (M2/M24).
- **Not created yet:** `src/runtime/realm.ts` (the `Realm` interface lives in `values.ts` as §5.7 shows it), `ModuleLoader` type (§4.7.3, M21), token-filter `ENDERS`/`CONTINUERS` and punctuator/literal token names (M2/M3). How `CLASS` receives "no superclass" (`EMPTY`) is still open; §5.4 suggests proposing `PUSH_EMPTY` via `docs/contract-changes.md`.

Notes for the next session:

- Shadowing hazard (§5.7) is real: ESLint rules such as `@typescript-eslint/no-array-constructor` fire on `new Array(...)` when `Array` is the imported script class. Import with an alias (`Array as ScriptArray`) or use `globalThis.Array` for the host one.
- Lint limits worth knowing: `max-params` 4, `max-lines-per-function` 32 (also applies to `describe` callbacks — split them), `max-len` 130, one element per line in multiline arrays.

## M0 — Scaffolding

Done: `npm run check` (lint + typecheck + tests) and `npm run build` are green; the Jison plugin rejects a conflicting grammar (`tests/build/vite-plugin-jison.test.ts`).

What exists:

- `vite.config.ts`: `defineLibConfig` + `jison()` plugin, ES-only build (D16). `vite build` emits exactly `dist/index.js` and `dist/index.d.ts`, so `module`/`types`/`exports` in `package.json` are correct as written in §3.2.
- `build/vite-plugin-jison.ts`: `compileGrammar(source, id)` (exported for tests) and the `jison()` plugin. Conflicts throw an `Error` that includes Jison's conflict report (captured by swapping `Jison.print`).
- `build/jison.d.ts`, `build/vite-config-lib.d.ts`: ambient types for the untyped `jison` and `@padcom/vite-config-lib` packages.
- `src/grammar/jison.d.ts` (`declare module '*.jison'`) and `src/grammar/jison-types.ts` (`JisonParserModule`, `JisonParser`, `JisonLexer`, …). The interfaces live in a separate `.ts` file so the `.d.ts` stays a global script, which wildcard module declarations require.
- `src/index.ts`: empty (`export {}`); the public API arrives in later milestones.
- `tests/fixtures/jison/calc.jison` (working calculator) and `conflict.jison` (unresolved shift/reduce); `tests/grammar/jison-import.test.ts` imports the `.jison` file through the plugin.
- `eslint.config.js`: `flat/browser` for everything, plus the node globals entry from `flat/node` for `build/**`, `tests/**`, config files.

Deviations from the plan:

- **Extra dev dependencies**: `@padcom/eslint-config-javascript` (`@padcom/eslint-config-typescript@0.20.2` imports it but does not declare it; upstream bug) and `@microsoft/api-extractor` (needed by `vite-plugin-dts` with `bundleTypes`/`rollupTypes`).
- `vite.config.ts` passes `dts: { include: ['src'] }`, otherwise declarations for `build/`, `tests/` and the config are emitted into `dist/`.
- `vite.config.ts` restricts coverage to `src/**` and `build/**` (otherwise the generated fixture parser is measured).
- `vite.config.ts` imports `./build/vite-plugin-jison.ts` with its extension (silences Vite's native-config-loader warning), so `tsconfig.json` enables `allowImportingTsExtensions`.
- `tsconfig.json` also sets `skipLibCheck`, `isolatedModules`, `verbatimModuleSyntax`, `lib: ["ES2022"]`, `types: ["node"]`, and includes `src`, `tests`, `build`, `vite.config.ts`. Vitest globals are not enabled; tests import from `vitest`.
- The repository was already a git repo (§3.3 said it was not).

Known gaps / notes for the next session:

- Vite prints "Both esbuild and oxc options were set …" because `@padcom/vite-config-lib` sets `esbuild.minifyIdentifiers`. Harmless; upstream fix.
- `npm install` reports 4 high-severity advisories in transitive dev dependencies (Jison's old deps). Build-time only; nothing ships at runtime.
- House style (ESLint) is strict: no semicolons, single quotes, `prefer-destructuring`, `prefer-template`, blank line before statements after declarations, and **JSDoc on every exported function and on every member of exported interfaces** (`jsdoc/require-jsdoc` with `TSPropertySignature`/`TSMethodSignature` contexts). Expect M1 (`ast.ts`, `values.ts`, …) to need a one-line doc comment per interface member. `npx eslint --fix` fixes most formatting issues.
- The grammar plugin generates with `moduleName: 'pscriptParser'`; per §3.4, `parse()` must create `new parser.Parser()` per call.

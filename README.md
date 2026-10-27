# PScript

PScript is a small, strict, JavaScript-like scripting language for embedding in JavaScript applications. It runs in
the browser and in Node, has no dependencies at runtime, and compiles scripts to bytecode for its own VM.

```js
import { Interpreter } from '@padcom/pscript'

const pscript = new Interpreter({ globals: { greet: name => `Hello, ${name}!` } })

pscript.run(`
  class Counter {
    private count = 0
    increment() { count++; return this }
    get value() { return count }
  }
  const counter = new Counter().increment().increment()
  print(greet('PScript'), counter.value)
`)
// → Hello, PScript! 2
```

It looks like JavaScript and most simple JavaScript programs run unchanged, but it removes the parts that make
JavaScript hard to reason about:

- `==` is strict (there is no `===`) and `typeof null` is `'null'`;
- functions have strict arity: missing or extra arguments are errors; operators never convert objects;
- destructuring works as in JavaScript, and object patterns in parameters are strict named parameters
  (`function f({ x = 1, y = 2 } = {})` rejects `f({ z: 3 })`);
- reading past the end of an array is an error, class instances are closed (no undeclared members);
- classes have real access modifiers (`private`, `protected`), `override` and `final`, and interfaces;
- inside a class body, members can be used without `this.` (with a strict rule against ambiguous names);
- modules with named imports and exports, live bindings and an in-memory or custom loader;
- `delete` works on plain objects only (class instances and arrays keep their shape);
- generators work as in JavaScript (missing values are `null` there too);
- `async`/`await` (also at the top level of modules and scripts) and promises with the same callback order as
  JavaScript; asynchronous module loaders; `setTimeout`, `setInterval`,
  `queueMicrotask` and `fetch` use the host's event loop and network;
- spread works in calls and in array and object literals, and optional chaining (`a?.b`, `f?.()`) as in JavaScript;
- no `var` or `with`.

The full language reference, including a list of differences from JavaScript, is in
[`docs/LANGUAGE.md`](docs/LANGUAGE.md).

## Command line

```sh
npx @padcom/pscript                    # interactive REPL (multi-line input, .help, .exit)
npx @padcom/pscript main.pscript       # run a file; a file with imports or exports runs as a module
npx @padcom/pscript -e 'print(1 + 2)'  # run an inline script
echo 'print("hi")' | npx @padcom/pscript
```

Modules are loaded from the file system: `./` and `../` resolve against the importing file, trying the exact path,
then `.pscript`, then `.psc`. Errors go to stderr and set the exit code to 1.

`psc` compiles PScript to JavaScript ES modules (see [Transpiling to JavaScript](#transpiling-to-javascript-experimental)):

```sh
npx -p @padcom/pscript psc main.pscript       # writes main.js, and a .js for every PScript file main imports
npx -p @padcom/pscript psc -o dist src/       # every .pscript/.psc file under src/, laid out the same under dist/
npx -p @padcom/pscript psc --source-map src/  # also write main.js.map …; --inline-source-map embeds them
```

All files of a run are checked together as one program. Nothing is written when there is an error. With source maps,
`node --enable-source-maps main.js` reports errors at the `.pscript` lines.

## Installing and building

```sh
npm install
npm run build      # dist/index.js (ES module)
npm run check      # lint, typecheck and the test suite
npm run bench      # micro benchmarks
```

Releases: `npm version patch|minor|major` runs `npm run check`, then commits `Release @padcom/pscript@x.y.z` and tags
it `pscript-x.y.z`; `npm publish` builds `dist/` before packing.

## Embedding

```js
import { Interpreter, markAsClass, run } from '@padcom/pscript'

run('print(1 + 2)')                                   // one-shot

const interpreter = new Interpreter({
  globals: { config: { limit: 3 }, Date: markAsClass(Date) },
  stdout: text => console.log(text),                  // where print() goes
  maxSteps: 1_000_000,                                // stop runaway scripts
  maxCallDepth: 1_000,
  fetch: (url, init) => fetch(url, init),             // what scripts' fetch() calls (default: the host's)
  modules: { 'math.pscript': 'export const PI = 3.14159' },  // ids; './math' resolves to math.pscript
})

interpreter.run('let total = config.limit * 2')
interpreter.run('total + 1')                          // → 7: the completion value
interpreter.get('total')                              // → 6 (script-level bindings persist)
interpreter.set('debug', true)                        // define or replace a global
interpreter.run('function double(x) { return 2 * x }')
interpreter.call('double', 21)                        // → 42

const math = interpreter.runModule("import { PI } from './math'\nexport const tau = 2 * PI")
math.tau                                              // → 6.28318 (live view of the exports)

interpreter.defineModule('host:clock', { now: () => Date.now() })
```

- `run(source)` returns the completion value of the script (like `eval`).
- `compile(source)` and `Interpreter.execute(compiled)` separate compilation from execution;
  `disassemble(compiled)` shows the bytecode.
- Errors are `PScriptSyntaxError` (at compile time) or `PScriptRuntimeError` (uncaught script exceptions, with the
  thrown value, the script stack and a source excerpt).

### Transpiling to JavaScript (experimental)

`transpile(source)` compiles a script or module to plain JavaScript with the interpreter's compile-time checks
(arity, constant bindings, implicit members, module exports) plus the class checks the interpreter makes when a class
is defined (`override`, `final`, access, `implements`). Classes become JavaScript classes (`private` members are
`#private`), interfaces work with `instanceof`, modules become ES modules (`import { a } from './m'` →
`'./m.js'`). A source with `import`/`export` declarations is a module (or pass `{ goal: 'module' }`).
`transpileModules({ 'main.pscript': …, 'lib/util.psc': … })` compiles the files of a program together (as `psc`
does), so imports of missing exports, the arity of imported functions, and `override`/`final`/`implements` across
modules are compile-time errors too. Both take `{ sourceMap: true }` (the result's `map`) or `{ sourceMap: 'inline' }`
(also appended to the code). The output has JavaScript runtime semantics; see `docs/PLAN.md` §11 for the design and
the list of differences.

```js
import { transpile } from '@padcom/pscript'

transpile('let x\nprint(x == null)').code
// → const print = (...args) => console.log(...args);
//   let x = null;
//   print(x === null);
```

### Host values

Values cross the boundary by reference: host objects and functions are live proxies inside scripts, and script
objects, arrays, functions and classes are live proxies for the host. Identity is preserved in both directions.
Host functions declared with `class` (or marked with `markAsClass`) are classes for scripts, which can construct and
extend them. Host exceptions become catchable script errors.

Interop blocks the obvious escape routes (`constructor`, `__proto__`, `prototype` and the legacy accessor methods
are not reachable through host objects), but it is **not a security sandbox**: a script can do whatever the host
values you give it can do. Only pass in what scripts are meant to use.

## Project layout

| Path | Contents |
|---|---|
| `src/grammar/pscript.jison` | LALR grammar (Jison), compiled by a Vite plugin |
| `src/parser/` | lexer token filter (ASI, contextual keywords), AST builders, syntax checks |
| `src/compiler/` | bytecode compiler, opcodes, disassembler |
| `src/vm/` | the VM: dispatch loop, classes, interfaces, implicit members, overrides |
| `src/runtime/` | value model, property access, operators, interop, formatting |
| `src/stdlib/` | the standard library (`print`, `Object`, `Array`, `String`, `Math`, `JSON`, errors …) |
| `src/modules/` | module loader and registry |
| `src/transpiler/` | `psc`: the PScript-to-JavaScript transpiler |
| `bin/pscript.js` | the command line and REPL (Node-only, outside the browser-safe library) |
| `bin/psc.js` | the transpiler's command line |
| `tests/` | unit tests, program corpus (`tests/programs`, `tests/modules`), Node and acorn oracles |
| `docs/PLAN.md` | the design: decisions, grammar, contracts, milestones |
| `docs/PROGRESS.md` | implementation log per milestone |

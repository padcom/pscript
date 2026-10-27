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
- reading past the end of an array is an error, class instances are closed (no undeclared members);
- classes have real access modifiers (`private`, `protected`), `override` and `final`, and interfaces;
- inside a class body, members can be used without `this.` (with a strict rule against ambiguous names);
- modules with named imports and exports, live bindings and an in-memory or custom loader;
- no `var`, `switch`, `delete`, destructuring, generators, `async` or `with`.

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
| `bin/pscript.js` | the command line and REPL (Node-only, outside the browser-safe library) |
| `tests/` | unit tests, program corpus (`tests/programs`, `tests/modules`), Node and acorn oracles |
| `docs/PLAN.md` | the design: decisions, grammar, contracts, milestones |
| `docs/PROGRESS.md` | implementation log per milestone |

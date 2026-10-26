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
| M16 | Accessors | next |

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

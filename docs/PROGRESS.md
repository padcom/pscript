# PScript — Progress

Tracks the sequential milestone path (`docs/PLAN.md` §7.12). Each session reads this file first.

## Status

| # | Milestone | Status |
|---|---|---|
| M0 | Scaffolding | done (2026-10-26) |
| M1 | Contracts | done (2026-10-26) |
| M2 | Calculator end to end | next |

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

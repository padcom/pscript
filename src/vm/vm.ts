// The bytecode interpreter (§5.6).
import type { ClassTemplate, CompiledScript, FunctionProto, InterfaceTemplate } from '@/compiler/function-proto'
import { readCell } from '@/modules/cells'
import type { CompiledModule, ModuleRecord } from '@/modules/module-record'
import { GlobalFlags, Op, SPREAD_ARGC } from '@/compiler/opcodes'
import { PScriptError, PScriptRuntimeError, formatExcerpt, type ScriptStackFrame } from '@/errors'
import { addIn, toStringIn } from '@/runtime/conversions'
import {
  arithmetic,
  compare,
  instanceOf,
  inheritedProperty,
  isErrorObject,
  kindOf,
  strictEquals,
  toNumber,
  truthy,
  typeOf,
  type ArithmeticOperator,
} from '@/runtime/operators'
import { formatNested } from '@/runtime/format'
import { DONE, GeneratorIterator, ScriptIterator, getIterator } from '@/runtime/iterators'
import { GeneratorObject, type IteratorStep, type ResumeMode } from '@/runtime/generators'
import {
  defineAccessor,
  defineProperty,
  deleteProperty,
  getArrayIndex,
  getProperty,
  hasPropertyIn,
  propertyKey,
  setArrayIndex,
  setProperty,
} from '@/runtime/properties'
import { getPrivateMember, setPrivateMember } from '@/runtime/members'
import { Interop } from '@/runtime/interop'
import { ScriptError, ScriptThrow, rangeError, referenceError, typeError } from '@/runtime/script-error'
import { arityError } from '@/compiler/signature'
import {
  Accessor,
  Array as ScriptArray,
  Class as ClassValue,
  Closure,
  Environment,
  Function as ScriptFunction,
  HostFunction,
  Interface,
  NativeFunction,
  Object as ScriptObject,
  UNINITIALIZED,
  type AccessContext,
  type ImplicitReceiver,
  type Realm,
  type Slot,
  type Value,
} from '@/runtime/values'
import { defineClass, superMember } from './classes'
import { Coroutine, GeneratorReturn, type CoroutineHost } from './coroutines'
import { Promises, type PromiseHost } from './promises'
import type { PromiseObject } from '@/runtime/promises'
import { defineInterface } from './interfaces'
import { arraySpread, checkPattern, iteratorRest, objectRest, objectSpread } from './patterns'
import type { Frame, Handler } from './frame'
import { Globals, type ScriptBinding } from './globals'

/**
 * Limits enforced by the VM (D14).
 */
export interface VMOptions {
  /** maximum number of executed instructions per `execute()` */
  maxSteps: number
  /** maximum depth of nested calls */
  maxCallDepth: number
  /** receives errors of jobs run outside `execute()` (unhandled rejections); default: rethrown to the host */
  reportError?: (error: unknown) => void
}

function location(proto: FunctionProto, offset: number): [number, number] {
  const { locations } = proto
  let found: [number, number] = [0, 0]

  for (let i = 0; i < locations.length && locations[i] <= offset; i += 3) found = [locations[i + 1], locations[i + 2]]

  return found
}

function lookupEnv(env: Environment, depth: number): Environment {
  let target = env

  for (let i = 0; i < depth; i++) target = target.parent as Environment

  return target
}

function bindingName(frame: Frame): string {
  return frame.proto.names?.[frame.opStart] ?? '<binding>'
}

function initialized(slot: Slot, frame: Frame): Value {
  if (slot === UNINITIALIZED) throw referenceError(`Cannot access '${bindingName(frame)}' before initialization`)

  return slot
}

// A packed array of `size` slots in the TDZ (faster to index than `new Array(size).fill(...)`).
function uninitializedSlots(size: number): Slot[] {
  const slots: Slot[] = []

  for (let i = 0; i < size; i++) slots.push(UNINITIALIZED)

  return slots
}

// The arity check's fast path (D38): the full check with its message runs only for a mismatch.
function acceptsArgc({ length, paramCount, hasRest }: FunctionProto, argc: number): boolean {
  return argc >= length && (hasRest || argc <= paramCount)
}

function functionName({ kind, name }: FunctionProto): string {
  return kind === 'script' ? '<script>' : name || '<anonymous>'
}

/**
 * The pending completion of a `finally` block on the stack: normal, or an exception to rethrow (§5.6.5).
 */
class FinallyRecord {
  constructor(readonly thrown: ScriptThrow | null) {}
}

// What the host sees of an uncaught value: error objects by name and message, anything else as "Uncaught <value>".
function describeThrown(value: Value): [string, string] {
  if (!(value instanceof ScriptObject && isErrorObject(value))) return ['Error', `Uncaught ${formatNested(value)}`]

  return [String(inheritedProperty(value, 'name')), String(inheritedProperty(value, 'message') ?? '')]
}

// Deep native ⇄ script re-entrancy can exhaust the host stack even with maxCallDepth = Infinity (§4.4.5).
function hostStackOverflow(e: unknown): boolean {
  // (no regular expression here: compiling one needs stack, which is exactly what ran out)
  return e instanceof globalThis.RangeError && e.message.includes('call stack')
}

/** `this` of a derived constructor before `super(...)` */
const NO_THIS = UNINITIALIZED as unknown as Value

// In a derived constructor `this` is uninitialised until `super(...)` returns (§4.5.1).
function initializedThis(frame: ImplicitReceiver): Value {
  if (frame.thisValue === NO_THIS) throw referenceError("Must call super constructor before accessing 'this'")

  return frame.thisValue
}

/**
 * Operands of LOAD/STORE/CALL_IMPLICIT: the implicit name and its fallback (`depth slot` or `k 0`).
 */
interface ImplicitOperands {
  /** index in the home class's `implicitNames` */
  index: number
  /** depth, or the name's constant */
  a: number
  /** slot, or 0 */
  b: number
}

// Static code runs with the class as `this`.
function contextOf({ thisValue }: ImplicitReceiver): 'static' | 'instance' {
  return thisValue instanceof ClassValue ? 'static' : 'instance'
}

// An import is a live view of the exporter's binding, with the TDZ check (§4.7.2).
function readImport(frame: Frame, index: number): Value {
  const record = frame.module as ModuleRecord
  const value = readCell(record.importCells[index])

  if (value !== UNINITIALIZED) return value

  throw referenceError(`Cannot access '${record.compiled?.imports[index].localName}' before initialization`)
}

// Unexpected host exceptions (bugs), as opposed to PScript's own errors.
function isInternalError(error: unknown): error is Error {
  return error instanceof Error && !(error instanceof PScriptError)
}

// A PScriptRuntimeError carrying a script value (a script exception that went through host code).
function isScriptValueError(error: unknown): error is PScriptRuntimeError {
  return error instanceof PScriptRuntimeError && error.value !== undefined
}

/** Host errors with these names become script errors of the same class (§5.8.1). */
const HOST_ERROR_NAMES = new Set(['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError'])

// The kind and message a host error shows to scripts: an interpreter's own error by its script name and reason (a
// module that could not be loaded or linked, D52).
function hostErrorParts(error: Error): [string, string] {
  if (error instanceof PScriptRuntimeError) return [error.scriptName, error.reason]
  if (error instanceof PScriptError) return ['SyntaxError', error.reason]

  return [HOST_ERROR_NAMES.has(error.name) ? error.name : 'Error', error.message]
}

/** A built-in class with its native constructor. */
type NativeClass = ClassValue & Required<Pick<ClassValue, 'native'>>

// A number key whose string form is an integer index (`xs[1]`, not `xs[1.5]` or `xs[1e21]`).
function isIndex(key: Value): key is number {
  return typeof key === 'number' && globalThis.Number.isSafeInteger(key)
}

function isScriptRoot({ native, host, superClass }: ClassValue): boolean {
  return !native && !host && !superClass
}

// `new C(...)` of a script class without a superclass, with a constructor (NEW's fast path).
function isBaseScriptClass(value: Value): value is ClassValue & { ctor: Closure } {
  return value instanceof ClassValue && value.ctor !== null && isScriptRoot(value)
}

// Drops operand stack items down to `height`; popping is cheaper than setting `length` for the few items of a call.
function truncate(stack: Value[], height: number) {
  while (stack.length > height) stack.pop()
}

// Pops the top `count` items, bottom first.
// The argc operand of a call: with a spread argument (D46), the arguments are one array, replaced by its items.
function spreadArgc(stack: Value[], argc: number): number {
  if (argc !== SPREAD_ARGC) return argc

  const { items } = stack.pop() as ScriptArray

  for (const item of items) stack.push(item)

  return items.length
}

/** The operator of each bitwise instruction (D50). */
const BITWISE: Record<number, ArithmeticOperator> = {
  [Op.BIT_AND]: '&',
  [Op.BIT_OR]: '|',
  [Op.BIT_XOR]: '^',
  [Op.SHL]: '<<',
  [Op.SHR]: '>>',
  [Op.USHR]: '>>>',
}

/** The accessor half DEFINE_GETTER_INDEX / DEFINE_SETTER_INDEX define (D48). */
const INDEX_ACCESSORS: Record<number, 'get' | 'set'> = { [Op.DEFINE_GETTER_INDEX]: 'get', [Op.DEFINE_SETTER_INDEX]: 'set' }

// A function defined under a computed key takes its name (D48).
function named<T extends ScriptFunction>(fn: T, name: string): T {
  fn.name = name

  return fn
}

// The module `import()` resolves relative specifiers against: the code's own module, none in scripts (D52).
function referrerOf({ module }: Frame): string | null {
  return module ? module.id : null
}

// ARRAY_PUSH: arr v → arr.
function arrayPush(stack: Value[]) {
  const value = stack.pop() as Value
  const array = stack[stack.length - 1] as ScriptArray

  array.items.push(value)
}

/** A body with top-level `await` that has not finished (D51). */
export const PENDING: unique symbol = Symbol('PENDING')

function popItems(stack: Value[], count: number): Value[] {
  const items = stack.slice(stack.length - count)

  truncate(stack, stack.length - count)

  return items
}

// Moves the top item `depth` items down: a b c → c a b (3), a b c d → d a b c (4).
function rotate(stack: Value[], depth: number) {
  const top = stack.length - 1
  const moved = stack[top]

  for (let i = top; i > top - depth + 1; i--) stack[i] = stack[i - 1]
  stack[top - depth + 1] = moved
}

// A running generator cannot be resumed; one that never started completes on return() / throw().
function isFinished(coroutine: Coroutine, mode: ResumeMode): boolean {
  if (coroutine.state === 'running') throw typeError('Generator is already running')
  if (coroutine.state === 'suspended-start' && mode !== 'next') coroutine.state = 'completed'

  return coroutine.completed
}

// An exception left the generator: it is done. Its own return() signal ends it with the returned value.
function coroutineFailed(coroutine: Coroutine, e: unknown): IteratorStep {
  coroutine.state = 'completed'

  if (e instanceof GeneratorReturn && e.coroutine === coroutine) return { value: e.value, done: true }

  throw hostStackOverflow(e) ? rangeError('Maximum call stack size exceeded') : e
}

// A ScriptIterator result as a step; the "return value" of a non-generator iterator is undefined (as in JS).
function iteratorStep(next: Value | typeof DONE): IteratorStep {
  return next === DONE ? { value: undefined, done: true } : { value: next, done: false }
}

function popFinallyHandler(handlers: Handler[]): Handler | undefined {
  let handler = handlers.pop()

  while (handler && handler.finallyTarget < 0) handler = handlers.pop()

  return handler
}

function nullish(value: Value): boolean {
  return value === null || value === undefined
}

// Closes the iterators of `for…of` loops being left (D42): generators run their finally blocks.
function closeIterators(items: Value[]) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as unknown

    if (item instanceof ScriptIterator) item.close()
  }
}

// When an exception leaves loops, a failing close() must not replace it (as in JS).
function closeIteratorsQuietly(items: Value[]) {
  for (let i = items.length - 1; i >= 0; i--) {
    try {
      closeIterators([items[i]])
    } catch {
      // the exception being thrown wins
    }
  }
}

// A finished generator: `next()` gives `{ value: null, done: true }` (D37), `return(v)` gives v, `throw(e)` throws.
function finishedStep(mode: ResumeMode, value: Value, stack: () => ScriptStackFrame[]): IteratorStep {
  if (mode === 'throw') throw new ScriptThrow(value, stack())

  return { value: mode === 'return' ? value : null, done: true }
}

export class VM implements AccessContext, CoroutineHost, PromiseHost {
  readonly stack: Value[] = []
  readonly frames: Frame[] = []
  readonly globals: Globals
  /** instructions executed by the current `execute()` (counted only when maxSteps is finite) */
  steps = 0
  private script: CompiledScript | null = null
  /** source text of the modules evaluated so far, by id (error excerpts) */
  private moduleSources = new Map<string, string>()

  /** host ⇄ script value conversion (§5.8.1) */
  readonly interop: Interop
  /** the context host code acts in: no home class (§5.8.1) */
  readonly hostContext: AccessContext
  /** promises and their jobs (D43) */
  readonly promises: Promises
  /** what `import(specifier)` calls (D52): set by the interpreter, which owns the module registry */
  moduleImporter: ((specifier: string, referrer: string | null) => PromiseObject) | null = null
  /** the job (microtask) queue: promise reactions and `await` continuations */
  private jobs: (() => void)[] = []
  /** running jobs: calls from them share one step budget */
  private draining = false
  /** a host microtask will drain the queue */
  private drainScheduled = false

  constructor(readonly realm: Realm, readonly options: VMOptions) {
    this.globals = new Globals(realm)
    this.interop = new Interop(this)
    this.promises = new Promises(this)
    this.hostContext = {
      realm,
      homeClass: null,
      callFunction: (fn, thisValue, args) => this.callFunction(fn, thisValue, args),
      captureStack: () => this.captureStack(),
      promises: this.promises,
    }
  }

  get homeClass(): ClassValue | null {
    return this.frames.at(-1)?.homeClass ?? null
  }

  /**
   * Turns a script exception that reaches host code into a `PScriptRuntimeError` (other errors pass unchanged).
   *
   * @param error the exception
   * @returns what the host sees
   */
  toHostError(error: unknown): unknown {
    return this.uncaught(error)
  }

  /**
   * Turns an exception thrown by host code into a script exception (§5.8.2): a `PScriptRuntimeError` gives back the
   * script value it carries, a host `Error` becomes a script error with the original as `cause`.
   *
   * @param error the host exception
   * @returns the script exception to throw
   */
  fromHost(error: unknown): ScriptThrow {
    if (error instanceof ScriptThrow) return error

    return this.throwValue(isScriptValueError(error) ? this.interop.toScript(error.value) : this.hostErrorValue(error))
  }

  // A host Error becomes a script error of the same kind; other thrown values are converted.
  private hostErrorValue(error: unknown): Value {
    if (!(error instanceof Error)) return this.interop.toScript(error)

    const object = this.errorObject(...hostErrorParts(error)) as ScriptObject

    object.props.set('cause', this.interop.toScript(error))

    return object
  }

  private throwValue(value: Value): ScriptThrow {
    return new ScriptThrow(value, this.captureStack())
  }

  /**
   * Calls a function from native code (§5.6.4): script functions run in a nested dispatch loop.
   *
   * @param fn the function
   * @param thisValue `this`
   * @param args arguments
   * @returns the result
   */
  callFunction(fn: Value, thisValue: Value, args: Value[]): Value {
    if (fn instanceof NativeFunction) return fn.impl(this, thisValue, args)
    if (fn instanceof HostFunction) return this.interop.invoke(fn, thisValue, args)
    if (!(fn instanceof Closure)) this.notCallable(fn)

    return this.callClosure(fn, thisValue, args)
  }

  private callClosure(fn: Closure, thisValue: Value, args: Value[]): Value {
    this.startStepBudget()
    this.enterClosure(fn, args, thisValue)

    return this.runNested()
  }

  // A call or resumption from the host starts a new step budget (D14); jobs share the budget of their drain.
  private startStepBudget() {
    if (this.frames.length === 0 && !this.draining) this.steps = 0
  }

  private runNested(): Value {
    try {
      return this.run(this.frames.length)
    } catch (e) {
      throw hostStackOverflow(e) ? rangeError('Maximum call stack size exceeded') : e
    }
  }

  // Pushes the frame of a script function call (§5.6.3) after the arity (D38) and depth (D14) checks.
  private enterClosure(closure: Closure, args: Value[], thisValue: Value): Frame {
    this.checkCall(closure.fnProto, args.length)

    return this.pushClosureFrame(closure, this.bindArguments(closure.fnProto, args, 0, args.length), thisValue)
  }

  // CALL / CALL_METHOD of a closure: the arguments are bound straight from the operand stack (no array of them).
  private enterClosureFromStack(closure: Closure, argc: number, thisValue: Value, height: number): Frame {
    const { stack } = this

    this.checkCall(closure.fnProto, argc)

    const slots = this.bindArguments(closure.fnProto, stack, stack.length - argc, argc)

    truncate(stack, height)

    return this.pushClosureFrame(closure, slots, thisValue)
  }

  private checkCall(proto: FunctionProto, argc: number) {
    this.checkArity(proto, argc)

    // frames[0] is the script, so frames.length is the depth of the call being made
    if (this.frames.length > this.options.maxCallDepth) throw rangeError('Maximum call stack size exceeded')
  }

  private pushClosureFrame(closure: Closure, slots: Slot[], thisValue: Value): Frame {
    const { fnProto: proto } = closure
    const env = new Environment(slots, closure.env)
    const frame = this.newFrame(proto, env, proto.kind === 'arrow' ? closure.thisValue ?? null : thisValue)

    frame.closure = closure
    frame.homeClass = closure.homeClass
    frame.homeObject = closure.homeObject
    frame.implicitFrame = closure.implicitFrame
    frame.module = closure.module
    frame.globalCache = closure.globalCache ??= []
    this.frames.push(frame)

    return frame
  }

  private checkArity(proto: FunctionProto, argc: number) {
    if (!acceptsArgc(proto, argc)) this.arityMismatch(proto, argc)
  }

  private arityMismatch(proto: FunctionProto, argc: number) {
    const problem = arityError({
      text: proto.signature ?? `${proto.name}()`,
      required: proto.length,
      optional: proto.paramCount - proto.length,
      hasRest: proto.hasRest,
    }, argc)
    if (problem) throw typeError(problem)
  }

  // Parameters take the first slots; omitted ones stay UNINITIALIZED for JUMP_IF_ARG (defaults). The `argc`
  // arguments are `source[start]`, `source[start + 1]`, ...
  private bindArguments({ scopeSize, paramCount, hasRest }: FunctionProto, source: Value[], start: number, argc: number): Slot[] {
    const slots: Slot[] = []
    const bound = Math.min(argc, paramCount)
    let i = 0

    for (; i < bound; i++) slots.push(source[start + i])

    for (; i < scopeSize; i++) slots.push(UNINITIALIZED)

    if (hasRest) slots[paramCount] = new ScriptArray(this.realm.ArrayPrototype, source.slice(start + paramCount, start + argc))

    return slots
  }

  private newFrame(proto: FunctionProto, env: Environment, thisValue: Value): Frame {
    return {
      closure: null,
      proto,
      ip: 0,
      opStart: 0,
      base: this.stack.length,
      env,
      thisValue,
      homeClass: null,
      homeObject: null,
      implicitFrame: null,
      module: null,
      handlers: null,
      isConstruct: false,
      newTarget: null,
      globalCache: [],
      coroutine: null,
    }
  }

  /**
   * Evaluates a linked module: runs its body in the module's top environment, with `this` null (§5.6.8).
   *
   * @param record the module (its `env` and imports are set up by the linker)
   * @returns the promise of a module body with top-level `await` (D51), which runs until its first `await`; null when
   * the body has run to completion
   */
  evaluateModule(record: ModuleRecord): PromiseObject | null {
    const { main, source, async } = record.compiled as CompiledModule
    const frame = this.newFrame(main, record.env as Environment, null)

    if (source !== undefined) this.moduleSources.set(record.id, source)
    frame.module = record
    this.steps = 0
    this.frames.push(frame)

    try {
      const value = this.run(1)

      return async ? value as PromiseObject : null
    } catch (e) {
      throw this.uncaught(e)
    } finally {
      this.frames.length = 0
      this.stack.length = 0
    }
  }

  /**
   * Creates a function of a module that is initialised when the module is linked (hoisted, §4.7.2).
   *
   * @param record the module
   * @param proto the function's proto
   * @returns the closure
   */
  moduleFunction(record: ModuleRecord, proto: FunctionProto): Closure {
    return new Closure(this.realm.FunctionPrototype, proto, record.env as Environment, record)
  }

  /**
   * Runs a compiled script to completion.
   *
   * @param script the script
   * @returns its completion value (§4.4.10)
   */
  execute(script: CompiledScript): Value {
    const { main } = script
    const env = new Environment(uninitializedSlots(main.scopeSize), null)

    this.script = script
    this.steps = 0
    this.frames.push(this.newFrame(main, env, null))

    try {
      const value = this.run(1)

      this.frames.length = 0
      this.stack.length = 0
      this.settleJobs()

      return value
    } catch (e) {
      throw this.uncaught(e)
    } finally {
      this.frames.length = 0
      this.stack.length = 0
    }
  }

  // `import(specifier)` (D52): relative specifiers resolve against the module of the code (null in scripts). Errors
  // (a specifier whose toString() throws) reject the promise, as in JS.
  private importDynamic(frame: Frame, specifier: Value): PromiseObject {
    const importer = this.moduleImporter
    if (!importer) throw typeError('import() is not available here')

    try {
      return importer(toStringIn(this, specifier), referrerOf(frame))
    } catch (e) {
      return this.rejected(e)
    }
  }

  private rejected(error: unknown): PromiseObject {
    const { value, frames } = this.asThrow(error)
    const promise = this.promises.create()

    this.promises.reject(promise, value, frames)

    return promise
  }

  /**
   * The outcome of a script or module body with top-level `await` (D51) once the job queue has drained: its value
   * when it completed, its exception (as a host error) when it failed.
   *
   * @param promise the body's promise
   * @returns the value, or `PENDING` when the body still waits (for a host promise or a timer)
   */
  outcome(promise: PromiseObject): Value | typeof PENDING {
    if (promise.state === 'rejected') throw this.uncaught(new ScriptThrow(promise.result, promise.frames))

    return promise.state === 'fulfilled' ? promise.result : PENDING
  }

  // ---------------------------------------------------------------------------
  // Jobs (D43, §5.6.10): run when the script stack is empty — at the end of `execute()` and of a module graph's
  // evaluation, or in a host microtask when a job is queued from outside (a host promise settled, a host call).

  /**
   * Queues a job.
   *
   * @param job the job
   */
  enqueueJob(job: () => void) {
    this.jobs.push(job)

    if (this.drainScheduled) return
    this.drainScheduled = true
    globalThis.queueMicrotask(() => this.drainInBackground())
  }

  /**
   * Runs the queued jobs (and those they queue) to completion; an unhandled rejection left after that is thrown as an
   * uncaught error (§5.9). Used after a module graph has been evaluated.
   */
  settle() {
    try {
      this.settleJobs()
    } catch (e) {
      throw this.uncaught(e)
    } finally {
      this.frames.length = 0
      this.stack.length = 0
    }
  }

  private settleJobs() {
    this.drainJobs()

    const [unhandled] = this.promises.takeUnhandled()
    if (unhandled) throw this.unhandledRejection(unhandled)
  }

  private unhandledRejection({ result, frames }: PromiseObject): ScriptThrow {
    return new ScriptThrow(result, frames)
  }

  private drainJobs() {
    const limited = this.options.maxSteps !== Infinity

    this.draining = true

    try {
      for (let i = 0; i < this.jobs.length; i++) this.runJob(i, limited)
    } finally {
      this.jobs = []
      this.draining = false
    }
  }

  private runJob(index: number, limited: boolean) {
    if (limited && this.steps > this.options.maxSteps) throw rangeError('Execution step limit exceeded')
    this.jobs[index]()
  }

  // Jobs queued while no script runs: drained in a host microtask, with a new step budget.
  private drainInBackground() {
    this.drainScheduled = false

    if (this.frames.length > 0 || this.jobs.length === 0) return

    this.steps = 0

    try {
      this.settle()
    } catch (e) {
      this.reportError(e)
    }
  }

  /**
   * Runs a task of the host's event loop (a timer callback, D44): with a new step budget, followed by
   * the jobs it queued, as JS runs microtasks after each task. An exception or an unhandled rejection is reported to
   * the host (`VMOptions.reportError`), since there is no caller to receive it.
   *
   * @param task calls the function
   */
  runTask(task: () => void) {
    this.steps = 0

    try {
      this.runTaskAndJobs(task)
    } catch (e) {
      this.reportError(e)
    }
  }

  private runTaskAndJobs(task: () => void) {
    try {
      task()
      this.settleJobs()
    } catch (e) {
      throw this.uncaught(e)
    } finally {
      this.frames.length = 0
      this.stack.length = 0
    }
  }

  private reportError(error: unknown) {
    if (!this.options.reportError) throw error
    this.options.reportError(error)
  }

  /**
   * The script exception an exception caught by native code stands for: a thrown value, or the error object of a
   * runtime error. Internal errors are rethrown.
   *
   * @param error the exception
   * @returns the script exception
   */
  toThrow(error: unknown): ScriptThrow {
    return this.asThrow(error)
  }

  // An exception that left the script: report it to the host (§5.9).
  private uncaught(e: unknown): unknown {
    if (e instanceof ScriptError) return this.uncaughtThrow(this.asThrow(e))
    if (e instanceof ScriptThrow) return this.uncaughtThrow(e)

    return isInternalError(e) ? this.internalError(e) : e
  }

  // A host exception from inside the runtime or a stdlib native is a bug, never catchable by scripts (§5.6.5).
  private internalError(error: Error): PScriptRuntimeError {
    const frames = this.captureStack()
    const { line, column } = frames[0] ?? { line: 0, column: 0 }
    const internal = new PScriptRuntimeError('InternalError', error.message, undefined, { scriptStack: frames, line, column })

    internal.cause = error

    return internal
  }

  private uncaughtThrow({ value, frames }: ScriptThrow): PScriptRuntimeError {
    const [name, reason] = describeThrown(value)
    const { line, column, fileName = this.script?.fileName } = frames[0] ?? { line: 0, column: 0 }

    return new PScriptRuntimeError(name, reason, this.interop.toHost(value), {
      scriptStack: frames,
      fileName,
      line,
      column,
      excerpt: this.excerpt(frames[0], line, column),
    })
  }

  /**
   * The current script stack, innermost first.
   *
   * @returns one entry per frame
   */
  captureStack(): ScriptStackFrame[] {
    return this.frames.map(frame => {
      const [line, column] = location(frame.proto, frame.opStart)
      const where = { functionName: functionName(frame.proto), line, column }

      return frame.module ? { ...where, fileName: frame.module.id } : where
    }).reverse()
  }

  // A runtime error (ScriptError) becomes an instance of the matching built-in error class (§4.4.9).
  private asThrow(e: unknown): ScriptThrow {
    if (e instanceof ScriptThrow) return e
    if (!(e instanceof ScriptError)) throw e

    return new ScriptThrow(this.errorObject(e.scriptName, e.message), this.captureStack())
  }

  private errorObject(name: string, message: string): Value {
    const cls = (this.realm.globals.get(name) ?? this.realm.globals.get('Error'))?.value as NativeClass

    return cls.native.construct(this, cls, [message])
  }

  // Finds the innermost handler in the frames of this dispatch loop (§5.6.5) or rethrows to the caller.
  private unwind(e: unknown, entryDepth: number) {
    const thrown = this.asThrow(e)

    while (this.frames.length >= entryDepth) {
      const frame = this.frames[this.frames.length - 1]
      const handler = this.nextHandler(frame, thrown)

      if (handler) {
        this.enterHandler(frame, handler, thrown)

        return
      }
      this.frames.pop()
      this.dropStack(frame.base)
    }
    throw thrown
  }

  // `generator.return()` runs finally blocks only: catch handlers are skipped.
  private nextHandler(frame: Frame, thrown: ScriptThrow): Handler | undefined {
    const handlers = frame.handlers ?? []

    return thrown instanceof GeneratorReturn ? popFinallyHandler(handlers) : handlers.pop()
  }

  // Unwinding drops operand-stack values; iterators among them belong to loops being left.
  private dropStack(height: number) {
    if (this.stack.length > height) closeIteratorsQuietly(this.stack.slice(height))
    this.stack.length = height
  }

  // Restores the stack and environment of the `try`, then continues in `catch` (with the value) or `finally`.
  private enterHandler(frame: Frame, handler: Handler, thrown: ScriptThrow) {
    this.dropStack(handler.stackHeight)
    frame.env = handler.env

    if (handler.catchTarget >= 0) {
      this.stack.push(thrown.value)
      frame.ip = handler.catchTarget
    } else {
      this.stack.push(new FinallyRecord(thrown) as unknown as Value)
      frame.ip = handler.finallyTarget
    }
  }

  private sourceOf(moduleId: string | undefined): string | undefined {
    return moduleId === undefined ? this.script?.source : this.moduleSources.get(moduleId)
  }

  private excerpt(frame: ScriptStackFrame | undefined, line: number, column: number): string | undefined {
    const source = this.sourceOf(frame?.fileName)

    return source === undefined ? undefined : formatExcerpt(source, line, column)
  }

  // Arrows capture `this` (when they read it, §4.4.5) and the home object (for `super`) lexically; every nested
  // function inherits the home class, which decides private and protected access (§4.5.2).
  private closure(proto: FunctionProto, frame: Frame): Closure {
    const closure = new Closure(this.realm.FunctionPrototype, proto, frame.env, frame.module)

    closure.homeClass = frame.homeClass
    closure.implicitFrame = frame.implicitFrame ?? frame

    if (proto.usesThis) closure.thisValue = frame.thisValue
    if (proto.kind === 'arrow') closure.homeObject = frame.homeObject

    return closure
  }

  // Object-literal property; a method remembers the object as its home object (for `super`, §5.4).
  private defineProperty(value: Value, object: ScriptObject, key: string) {
    if (value instanceof Closure && value.fnProto.kind === 'method') value.homeObject = object
    defineProperty(object, key, value)
  }

  // Script bindings are never removed and shadow realm globals, so a frame remembers the ones it has found by
  // constant index; realm globals are looked up every time.
  private scriptBinding(frame: Frame, index: number): ScriptBinding | undefined {
    const cache = frame.globalCache
    let binding: ScriptBinding | undefined = cache[index]

    if (binding === undefined) {
      binding = this.globals.scriptBindings.get(frame.proto.constants[index] as string)

      if (binding) cache[index] = binding
    }

    return binding
  }

  private loadGlobal(frame: Frame, index: number): Value {
    const binding = this.scriptBinding(frame, index)

    if (binding && binding.value !== UNINITIALIZED) return binding.value

    return this.globals.load(frame.proto.constants[index] as string)
  }

  private storeGlobal(frame: Frame, index: number, value: Value) {
    const binding = this.scriptBinding(frame, index)

    if (binding && binding.value !== UNINITIALIZED && !binding.isConst) binding.value = value
    else this.globals.store(frame.proto.constants[index] as string, value)
  }

  private notCallable(fn: Value): never {
    if (fn instanceof ClassValue) throw typeError(`Class constructor ${fn.name} cannot be invoked without 'new'`)

    throw typeError(`${typeOf(fn)} is not a function`)
  }

  // `new C(...)` (§5.6.3): built-in classes construct natively; script classes arrive with M15.
  /**
   * `new callee(...args)` (also used by host-side `new` on class proxies).
   *
   * @param callee the class
   * @param args arguments
   * @returns the instance
   */
  construct(callee: Value, args: Value[]): Value {
    if (!(callee instanceof ClassValue)) this.notAClass(callee)

    return this.constructAs(callee, args, callee)
  }

  // Construction (§5.6.3): `newTarget` is the class `new` was applied to; `cls` the class whose part runs now.
  private constructAs(cls: ClassValue, args: Value[], newTarget: ClassValue): ScriptObject {
    if (cls.native) return cls.native.construct(this, newTarget, args)
    if (!cls.superClass) return this.constructBase(cls, args, newTarget)
    if (cls.ctor) return this.runConstructor(cls.ctor, NO_THIS, args, newTarget)

    // implied `constructor(...args) { super(...args) }`
    return this.initializeFields(cls, this.constructAs(cls.superClass, args, newTarget))
  }

  // A base class creates the instance (brand = newTarget), runs its field initialisers, then its constructor.
  private constructBase(cls: ClassValue, args: Value[], newTarget: ClassValue): ScriptObject {
    const instance = this.initializeFields(cls, this.newInstance(newTarget))

    if (cls.ctor) return this.runConstructor(cls.ctor, instance, args, newTarget)
    if (args.length > 0) throw typeError(`${cls.name || 'anonymous'}() expects 0 arguments, got ${args.length}`) // D38

    return instance
  }

  private newInstance(newTarget: ClassValue): ScriptObject {
    const instance = new ScriptObject(newTarget.prototype)

    instance.klass = newTarget

    return instance
  }

  private initializeFields(cls: ClassValue, instance: ScriptObject): ScriptObject {
    if (cls.fieldInit) this.callFunction(cls.fieldInit, instance, [])

    return instance
  }

  // Constructors end with `THIS RETURN`, so the nested run yields the instance.
  private runConstructor(ctor: Closure, thisValue: Value, args: Value[], newTarget: ClassValue): ScriptObject {
    const frame = this.enterClosure(ctor, args, thisValue)

    frame.isConstruct = true
    frame.newTarget = newTarget

    return this.runNested() as ScriptObject
  }

  // `super(...)` in a derived constructor: construct the superclass part with the same newTarget, then this class's fields.
  private superCall(frame: Frame, args: Value[]): ScriptObject {
    const cls = frame.homeClass as ClassValue
    if (frame.thisValue !== NO_THIS) throw referenceError('Super constructor may only be called once')

    const instance = this.constructAs(cls.superClass as ClassValue, args, frame.newTarget as ClassValue)

    frame.thisValue = instance

    return this.initializeFields(cls, instance)
  }

  // `super.x`: the superclass's member (instance or static, by context), with the current `this` unaffected.
  private superProperty(frame: Frame, key: string): Value {
    const home = frame.homeClass
    if (!home) throw typeError("'super' keyword unexpected here")

    const isStatic = frame.homeObject === home
    const found = superMember(this.realm, home, key, isStatic)

    // an accessor runs with the current `this` (§4.5.4)
    return found instanceof Accessor ? (found.get ? this.callFunction(found.get, frame.thisValue, []) : undefined) : found
  }

  // The receiver and name of an implicit member access, or null when the bare name is an outside definition (§4.5.8).
  private implicitMember(frame: Frame, index: number): [Value, string] | null {
    const cls = frame.homeClass as ClassValue
    const { name } = cls.template.implicitNames[index]
    const owner = frame.implicitFrame ?? frame
    const kind = cls.implicitTable[index][contextOf(owner)]

    if (kind === 'instance-only') throw typeError(`Cannot access instance member '${name}' from a static context`)

    return kind === 'member' ? [initializedThis(owner), name] : null
  }

  // The recorded fallback of an implicit name: an enclosing binding (depth, slot) or a script binding / global.
  private loadOuter(frame: Frame, { index, a, b }: ImplicitOperands): Value {
    const { name, outer } = (frame.homeClass as ClassValue).template.implicitNames[index]

    if (outer === 'import') return readImport(frame, a)

    return outer === 'lexical' ? initialized(lookupEnv(frame.env, a).slots[b], frame) : this.globals.load(name)
  }

  private storeOuter(frame: Frame, { index, a, b }: ImplicitOperands, value: Value) {
    const { name, outer } = (frame.homeClass as ClassValue).template.implicitNames[index]
    if (outer === 'global') {
      this.globals.store(name, value)

      return
    }
    const env = lookupEnv(frame.env, a)

    initialized(env.slots[b], frame)
    env.slots[b] = value
  }

  private loadImplicit(frame: Frame, operands: ImplicitOperands): Value {
    const member = this.implicitMember(frame, operands.index)

    return member ? getProperty(this, ...member) : this.loadOuter(frame, operands)
  }

  private storeImplicit(frame: Frame, operands: ImplicitOperands, value: Value) {
    const member = this.implicitMember(frame, operands.index)

    if (member) setProperty(this, ...member, value)
    else this.storeOuter(frame, operands, value)
  }

  // CALL_IMPLICIT: a member is called as a method of the implicit receiver, an outside definition plainly.
  private implicitCallee(frame: Frame, operands: ImplicitOperands): [Value, Value] {
    const member = this.implicitMember(frame, operands.index)

    return member ? [getProperty(this, ...member), member[0]] : [this.loadOuter(frame, operands), null]
  }

  /**
   * How a script binding or global is described in implicit-name ambiguities (§4.5.8).
   *
   * @param name the name
   * @returns `an outer binding`, `a global`, or null when the name is neither
   */
  outerGlobal(name: string): string | null {
    if (this.globals.scriptBindings.has(name)) return 'an outer binding'

    return this.realm.globals.has(name) ? 'a global' : null
  }

  // ---------------------------------------------------------------------------
  // Generators (D42, §5.6.9)

  // GENERATOR: the parameters are bound; the frame leaves the frame stack and waits for the first next().
  private startGenerator(frame: Frame): GeneratorObject {
    const coroutine = new Coroutine(this, frame)

    frame.coroutine = coroutine
    this.suspend(frame)
    coroutine.state = 'suspended-start'

    return new GeneratorObject(this.realm.GeneratorPrototype, coroutine)
  }

  // ---------------------------------------------------------------------------
  // Async functions (D43, §5.6.10)

  // ASYNC: the body runs now, until its first `await`; the call returns the function's promise.
  private startAsync(frame: Frame): PromiseObject {
    const coroutine = new Coroutine(this, frame)
    const promise = this.promises.create()

    frame.coroutine = coroutine
    this.suspend(frame)
    coroutine.state = 'suspended-start'
    this.stepAsync(coroutine, promise, 'next', null)

    return promise
  }

  // Runs the body until it awaits (it continues in a job once the awaited promise settles) or ends (the promise is
  // resolved with the result, or rejected with the exception).
  private stepAsync(coroutine: Coroutine, promise: PromiseObject, mode: ResumeMode, value: Value) {
    let step: IteratorStep

    try {
      step = this.resumeCoroutine(coroutine, mode, value)
    } catch (e) {
      const { value: reason, frames } = this.asThrow(e)

      this.promises.reject(promise, reason, frames)

      return
    }

    if (step.done) this.promises.resolve(promise, step.value)
    else this.awaitValue(coroutine, promise, step.value)
  }

  // `await v`: PerformPromiseThen on PromiseResolve(v) — one job when v is a settled promise, as in JS.
  private awaitValue(coroutine: Coroutine, promise: PromiseObject, awaited: Value) {
    this.promises.react(
      this.promises.promiseResolve(awaited),
      result => this.stepAsync(coroutine, promise, 'next', result),
      reason => this.stepAsync(coroutine, promise, 'throw', reason),
    )
  }

  // Saves the frame's operand-stack values and takes the frame off the frame stack.
  private suspend(frame: Frame) {
    const coroutine = frame.coroutine as Coroutine

    coroutine.saved = this.stack.slice(frame.base)
    truncate(this.stack, frame.base)
    this.frames.pop()
    coroutine.state = 'suspended-yield'
  }

  /**
   * Runs a generator until it yields or completes (`next`, `return`, `throw`, `for…of`).
   *
   * @param coroutine the generator's coroutine
   * @param mode how to resume
   * @param value the value sent, thrown or returned
   * @returns the step
   */
  resumeCoroutine(coroutine: Coroutine, mode: ResumeMode, value: Value): IteratorStep {
    if (isFinished(coroutine, mode)) return finishedStep(mode, value, () => this.captureStack())

    this.startStepBudget()
    const depth = this.enterCoroutine(coroutine)

    try {
      const result = this.continueCoroutine(coroutine, mode, value, depth)

      coroutine.finishIfReturned()

      return { value: result, done: coroutine.completed }
    } catch (e) {
      return coroutineFailed(coroutine, e)
    }
  }

  // Puts the frame back on top of the frame stack, with its operand-stack values (handlers keep relative heights).
  private enterCoroutine(coroutine: Coroutine): number {
    const { frame, saved } = coroutine
    const delta = this.stack.length - frame.base

    if (this.frames.length > this.options.maxCallDepth) throw rangeError('Maximum call stack size exceeded')
    frame.base = this.stack.length
    frame.handlers?.forEach(handler => { handler.stackHeight += delta })

    for (const item of saved) this.stack.push(item)
    coroutine.saved = []
    this.frames.push(frame)

    return this.frames.length
  }

  // next(v): `yield` gives v; throw(e): the exception is thrown at the `yield`; return(v): finally blocks run, then
  // the generator returns v. Inside `yield*`, YIELD_DELEGATE forwards all three to the delegate.
  private continueCoroutine(coroutine: Coroutine, mode: ResumeMode, value: Value, depth: number): Value {
    const starting = coroutine.state === 'suspended-start'

    coroutine.state = 'running'

    if (coroutine.delegating || mode === 'next') this.send(coroutine, mode, starting ? [] : [value])
    else this.unwind(this.abruptResumption(coroutine, mode, value), depth)

    return this.run(depth)
  }

  // The value `yield` gives (none when the body starts); inside `yield*` the mode goes to YIELD_DELEGATE.
  private send(coroutine: Coroutine, mode: ResumeMode, values: Value[]) {
    coroutine.mode = mode
    coroutine.delegating = false
    this.stack.push(...values)
  }

  private abruptResumption(coroutine: Coroutine, mode: ResumeMode, value: Value): ScriptThrow {
    return mode === 'throw' ? new ScriptThrow(value, this.captureStack()) : new GeneratorReturn(coroutine, value)
  }

  // One step of `yield*`: generators get next/throw/return forwarded; other iterators only next (throw closes them
  // and fails, return closes them and returns).
  private delegateStep(coroutine: Coroutine, sent: Value, delegate: Value): IteratorStep {
    const { mode } = coroutine
    const iterator = delegate as unknown as ScriptIterator

    coroutine.mode = 'next'

    if (iterator instanceof GeneratorIterator) return this.generatorDelegateStep(coroutine, iterator, mode, sent)
    if (mode === 'next') return iteratorStep(iterator.next())

    iterator.close()

    if (mode === 'return') throw new GeneratorReturn(coroutine, sent)
    throw typeError('The iterator does not provide a throw method')
  }

  private generatorDelegateStep(coroutine: Coroutine, iterator: GeneratorIterator, mode: ResumeMode, sent: Value): IteratorStep {
    const step = iterator.generator.driver.resume(mode, sent)

    if (mode === 'return' && step.done) throw new GeneratorReturn(coroutine, step.value)

    return step
  }

  private notAClass(callee: Value): never {
    if (callee instanceof Interface) throw typeError(`${callee.name} is an interface`)
    throw typeError(`${callee instanceof ScriptFunction ? callee.name || 'anonymous function' : kindOf(callee)} is not a class`)
  }

  // §5.6.2: one switch dispatch loop, with hot locals; exempt from the size and nesting rules.
  /* eslint-disable complexity, max-lines-per-function, max-depth, prefer-destructuring,
    @stylistic/max-statements-per-line, @stylistic/padding-line-between-statements */
  // Runs until the frame at depth `entryDepth` returns (or the script halts), handling exceptions.
  private run(entryDepth: number): Value {
    for (;;) {
      try {
        return this.dispatch(entryDepth)
      } catch (e) {
        this.unwind(e, entryDepth)
      }
    }
  }

  private dispatch(entryDepth: number): Value {
    const { stack, globals } = this
    let frame = this.frames[this.frames.length - 1]
    let { code, constants } = frame.proto
    let { ip } = frame
    const { maxSteps } = this.options
    const limited = maxSteps !== Infinity
    let a: Value
    let b: Value

    for (;;) {
      frame.opStart = ip

      if (limited && ++this.steps > maxSteps) throw rangeError('Execution step limit exceeded')

      switch (code[ip++] as Op) {
        case Op.CONST: stack.push(constants[code[ip++]] as Value); break
        case Op.UNDEFINED: stack.push(undefined); break
        case Op.NULL: stack.push(null); break
        case Op.TRUE: stack.push(true); break
        case Op.FALSE: stack.push(false); break
        case Op.POP: stack.pop(); break
        case Op.DUP: stack.push(stack[stack.length - 1]); break
        case Op.LOAD:
          stack.push(initialized(lookupEnv(frame.env, code[ip++]).slots[code[ip++]], frame))
          break

        case Op.STORE: {
          const env = lookupEnv(frame.env, code[ip++])
          const slot = code[ip++]

          initialized(env.slots[slot], frame)
          env.slots[slot] = stack[stack.length - 1]
          break
        }
        case Op.INIT:
          lookupEnv(frame.env, code[ip++]).slots[code[ip++]] = stack.pop()
          break
        case Op.LOAD_GLOBAL: stack.push(this.loadGlobal(frame, code[ip++])); break
        case Op.STORE_GLOBAL: this.storeGlobal(frame, code[ip++], stack[stack.length - 1]); break
        case Op.DECLARE_GLOBAL:
          globals.declare(constants[code[ip++]] as string, (code[ip++] & GlobalFlags.Const) !== 0)
          break
        case Op.INIT_GLOBAL: globals.initialize(constants[code[ip++]] as string, stack.pop()); break
        case Op.TYPEOF_GLOBAL: stack.push(globals.typeOf(constants[code[ip++]] as string)); break
        case Op.PUSH_ENV:
          frame.env = new Environment(uninitializedSlots(code[ip++]), frame.env)
          break
        case Op.POP_ENV: frame.env = frame.env.parent as Environment; break
        case Op.COPY_ENV: frame.env = new Environment(frame.env.slots.slice(), frame.env.parent); break
        case Op.JUMP: ip = code[ip]; break
        case Op.JUMP_IF_FALSE:
          a = stack.pop()
          ip = a === true || (a !== false && truthy(a)) ? ip + 1 : code[ip]
          break
        case Op.JUMP_IF_TRUE:
          a = stack.pop()
          ip = a === true || (a !== false && truthy(a)) ? code[ip] : ip + 1
          break
        case Op.AND_JUMP:
          if (truthy(stack[stack.length - 1])) { stack.pop(); ip++ } else ip = code[ip]
          break
        case Op.OR_JUMP:
          if (truthy(stack[stack.length - 1])) ip = code[ip]; else { stack.pop(); ip++ }
          break
        case Op.NULLISH_JUMP:
          if (nullish(stack[stack.length - 1])) { stack.pop(); ip++ } else ip = code[ip]
          break
        case Op.ADD:
          b = stack.pop()
          a = stack[stack.length - 1]
          stack[stack.length - 1] = typeof a === 'number' && typeof b === 'number' ? a + b : addIn(this, a, b)
          break
        case Op.SUB:
          b = stack.pop()
          a = stack[stack.length - 1]
          stack[stack.length - 1] = typeof a === 'number' && typeof b === 'number' ? a - b : arithmetic('-', a, b)
          break
        case Op.MUL:
          b = stack.pop()
          a = stack[stack.length - 1]
          stack[stack.length - 1] = typeof a === 'number' && typeof b === 'number' ? a * b : arithmetic('*', a, b)
          break
        case Op.DIV:
          b = stack.pop()
          a = stack[stack.length - 1]
          stack[stack.length - 1] = typeof a === 'number' && typeof b === 'number' ? a / b : arithmetic('/', a, b)
          break
        case Op.MOD:
          b = stack.pop()
          a = stack[stack.length - 1]
          stack[stack.length - 1] = typeof a === 'number' && typeof b === 'number' ? a % b : arithmetic('%', a, b)
          break
        case Op.POW:
          b = stack.pop()
          stack.push(arithmetic('**', stack.pop(), b))
          break
        case Op.EQ:
          b = stack.pop()
          stack[stack.length - 1] = strictEquals(stack[stack.length - 1], b)
          break
        case Op.NE:
          b = stack.pop()
          stack[stack.length - 1] = !strictEquals(stack[stack.length - 1], b)
          break
        case Op.LT:
          b = stack.pop()
          a = stack[stack.length - 1]
          stack[stack.length - 1] = typeof a === 'number' && typeof b === 'number' ? a < b : compare('<', a, b)
          break
        case Op.LE:
          b = stack.pop()
          a = stack[stack.length - 1]
          stack[stack.length - 1] = typeof a === 'number' && typeof b === 'number' ? a <= b : compare('<=', a, b)
          break
        case Op.GT:
          b = stack.pop()
          a = stack[stack.length - 1]
          stack[stack.length - 1] = typeof a === 'number' && typeof b === 'number' ? a > b : compare('>', a, b)
          break
        case Op.GE:
          b = stack.pop()
          a = stack[stack.length - 1]
          stack[stack.length - 1] = typeof a === 'number' && typeof b === 'number' ? a >= b : compare('>=', a, b)
          break
        case Op.INSTANCEOF:
          b = stack.pop()
          stack.push(instanceOf(stack.pop(), b))
          break
        case Op.IN:
          b = stack.pop()
          stack.push(hasPropertyIn(this, stack.pop(), b))
          break
        // INC / DEC follow POS, so the top is a number
        case Op.INC: stack[stack.length - 1] = (stack[stack.length - 1] as number) + 1; break
        case Op.DEC: stack[stack.length - 1] = (stack[stack.length - 1] as number) - 1; break
        case Op.NEG: stack[stack.length - 1] = -toNumber(stack[stack.length - 1], '-'); break
        case Op.BIT_NOT: stack[stack.length - 1] = ~toNumber(stack[stack.length - 1], '~'); break
        case Op.BIT_AND:
        case Op.BIT_OR:
        case Op.BIT_XOR:
        case Op.SHL:
        case Op.SHR:
        case Op.USHR:
          b = stack.pop()
          stack[stack.length - 1] = arithmetic(BITWISE[code[ip - 1]], stack[stack.length - 1], b)
          break
        case Op.POS:
          a = stack[stack.length - 1]
          if (typeof a !== 'number') stack[stack.length - 1] = toNumber(a, '+')
          break
        case Op.NOT: stack[stack.length - 1] = !truthy(stack[stack.length - 1]); break
        case Op.TYPEOF: stack[stack.length - 1] = typeOf(stack[stack.length - 1]); break

        case Op.DUP2: stack.push(stack[stack.length - 2], stack[stack.length - 1]); break
        case Op.SWAP:
          b = stack[stack.length - 1]
          stack[stack.length - 1] = stack[stack.length - 2]
          stack[stack.length - 2] = b
          break
        case Op.ROT3: rotate(stack, 3); break
        case Op.ROT4: rotate(stack, 4); break
        case Op.GET_PROP:
          stack[stack.length - 1] = getProperty(this, stack[stack.length - 1], constants[code[ip++]] as string)
          break

        case Op.GET_PROP_PRIV: {
          const receiver = stack.pop()
          const depth = code[ip++]
          const key = constants[code[ip++]] as string

          stack.push((getPrivateMember(this, receiver, { depth, key }) ?? [getProperty(this, receiver, key)])[0])
          break
        }
        case Op.SET_PROP_PRIV: {
          const value = stack.pop()
          const receiver = stack.pop()
          const depth = code[ip++]
          const key = constants[code[ip++]] as string

          if (!setPrivateMember(this, receiver, { depth, key }, value)) setProperty(this, receiver, key, value)
          stack.push(value)
          break
        }
        case Op.SET_PROP: {
          const value = stack.pop()

          setProperty(this, stack.pop(), constants[code[ip++]] as string, value)
          stack.push(value)
          break
        }
        case Op.GET_INDEX:
          b = stack.pop()
          a = stack[stack.length - 1]
          stack[stack.length - 1] = a instanceof ScriptArray && isIndex(b)
            ? getArrayIndex(a, b)
            : getProperty(this, a, propertyKey(b))
          break

        case Op.SET_INDEX: {
          const value = stack.pop()

          b = stack.pop()
          a = stack.pop()
          if (a instanceof ScriptArray && isIndex(b)) setArrayIndex(a, b, value)
          else setProperty(this, a, propertyKey(b), value)
          stack.push(value)
          break
        }
        case Op.OBJECT: stack.push(new ScriptObject(this.realm.ObjectPrototype)); break
        case Op.TO_STRING: stack.push(toStringIn(this, stack.pop())); break
        case Op.CONCAT: {
          const argc = code[ip++]

          stack.push(popItems(stack, argc).join(''))
          break
        }
        case Op.ARRAY: {
          const argc = code[ip++]

          stack.push(new ScriptArray(this.realm.ArrayPrototype, popItems(stack, argc)))
          break
        }
        case Op.GET_ITER: stack.push(getIterator(stack.pop()) as unknown as Value); break
        case Op.ITER_NEXT: {
          const next = (stack[stack.length - 1] as unknown as ScriptIterator).next()

          if (next === DONE) {
            stack.pop()
            ip = code[ip]
          } else {
            stack.push(next)
            ip++
          }
          break
        }
        case Op.ITER_VALUE: {
          const next = (stack[stack.length - 1] as unknown as ScriptIterator).next()

          stack.push(next === DONE ? undefined : next)
          break
        }
        case Op.ITER_REST: stack.push(iteratorRest(stack.pop() as unknown as ScriptIterator, this.realm)); break
        case Op.CHECK_PATTERN: {
          const k = code[ip++]

          checkPattern(stack[stack.length - 1], k < 0 ? null : constants[k] as string, frame.proto.signature ?? frame.proto.name)
          break
        }
        case Op.OPTIONAL_JUMP:
          if (stack[stack.length - 1] === null || stack[stack.length - 1] === undefined) {
            truncate(stack, stack.length - code[ip + 1])
            stack.push(undefined)
            ip = code[ip]
          } else ip += 2
          break
        case Op.OBJECT_REST: stack.push(objectRest(this, stack.pop(), constants[code[ip++]] as string)); break
        case Op.ARRAY_PUSH: arrayPush(stack); break
        case Op.ARRAY_SPREAD:
          b = stack.pop()
          arraySpread(stack[stack.length - 1] as ScriptArray, b)
          break
        case Op.OBJECT_SPREAD:
          b = stack.pop()
          objectSpread(this, stack[stack.length - 1] as ScriptObject, b)
          break
        case Op.DELETE_PROP:
          stack[stack.length - 1] = deleteProperty(stack[stack.length - 1], constants[code[ip++]] as string)
          break
        case Op.DELETE_INDEX:
          b = stack.pop()
          stack[stack.length - 1] = deleteProperty(stack[stack.length - 1], propertyKey(b))
          break
        case Op.DEFINE_GETTER:
          b = stack.pop()
          defineAccessor(stack[stack.length - 1] as ScriptObject, constants[code[ip++]] as string, 'get', b as ScriptFunction)
          break
        case Op.DEFINE_SETTER:
          b = stack.pop()
          defineAccessor(stack[stack.length - 1] as ScriptObject, constants[code[ip++]] as string, 'set', b as ScriptFunction)
          break
        case Op.DEFINE_PROP:
          this.defineProperty(stack.pop(), stack[stack.length - 1] as ScriptObject, constants[code[ip++]] as string)
          break
        case Op.DEFINE_PROP_INDEX:
          b = stack.pop()
          a = propertyKey(stack.pop())
          this.defineProperty(code[ip++] ? named(b as ScriptFunction, a) : b, stack[stack.length - 1] as ScriptObject, a)
          break
        case Op.DEFINE_GETTER_INDEX:
        case Op.DEFINE_SETTER_INDEX:
          b = stack.pop()
          a = propertyKey(stack.pop())
          defineAccessor(stack[stack.length - 1] as ScriptObject, a, INDEX_ACCESSORS[code[ip - 1]], named(b as Closure, a))
          break
        case Op.LOAD_IMPORT: stack.push(readImport(frame, code[ip++])); break
        case Op.IMPORT_DYNAMIC: stack[stack.length - 1] = this.importDynamic(frame, stack[stack.length - 1]); break
        case Op.LOAD_IMPLICIT: {
          const operands = { index: code[ip++], a: code[ip++], b: code[ip++] }

          frame.ip = ip
          stack.push(this.loadImplicit(frame, operands))
          break
        }
        case Op.STORE_IMPLICIT: {
          const operands = { index: code[ip++], a: code[ip++], b: code[ip++] }

          frame.ip = ip
          this.storeImplicit(frame, operands, stack[stack.length - 1])
          break
        }
        case Op.CALL_IMPLICIT: {
          const index = code[ip++]
          const argc = spreadArgc(stack, code[ip++])
          const operands = { index, a: code[ip++], b: code[ip++] }
          const args = popItems(stack, argc)

          frame.ip = ip
          const [callee, thisValue] = this.implicitCallee(frame, operands)

          if (callee instanceof Closure) {
            frame = this.enterClosure(callee, args, thisValue)
            code = frame.proto.code
            constants = frame.proto.constants
            ip = 0
          } else stack.push(this.callFunction(callee, thisValue, args))
          break
        }
        case Op.CALL_METHOD: // CALL with the receiver below the function
        case Op.CALL: {
          const isMethod = code[ip - 1] === Op.CALL_METHOD
          const argc = spreadArgc(stack, code[ip++])
          const calleeAt = stack.length - argc - 1
          const callee = stack[calleeAt]
          const thisValue = isMethod ? stack[calleeAt - 1] : null // plain call: this = null (D37)

          if (callee instanceof Closure) {
            frame.ip = ip
            frame = this.enterClosureFromStack(callee, argc, thisValue, isMethod ? calleeAt - 1 : calleeAt)
            code = frame.proto.code
            constants = frame.proto.constants
            ip = 0
          } else {
            const args = popItems(stack, argc)

            truncate(stack, isMethod ? calleeAt - 1 : calleeAt)
            stack.push(this.callFunction(callee, thisValue, args))
          }
          break
        }

        case Op.RETURN: {
          const value = stack.pop()

          this.frames.pop()
          truncate(stack, frame.base)

          if (this.frames.length < entryDepth) return value
          frame = this.frames[this.frames.length - 1];
          ({ code, constants } = frame.proto)
          ip = frame.ip
          stack.push(value)
          break
        }
        case Op.CLOSURE: stack.push(this.closure(constants[code[ip++]] as FunctionProto, frame)); break
        case Op.THIS:
          stack.push(initializedThis(frame))
          break
        case Op.CLASS: {
          const template = constants[code[ip++]] as ClassTemplate
          const interfaces = popItems(stack, template.interfaceCount)
          const superClass = template.hasSuper ? stack.pop() : undefined
          const site = { env: frame.env, homeClass: frame.homeClass, constants, module: frame.module }

          frame.ip = ip
          stack.push(defineClass(this, template, { superClass, interfaces }, site))
          break
        }
        case Op.INTERFACE: {
          const template = constants[code[ip++]] as InterfaceTemplate
          const count = code[ip++]

          stack.push(defineInterface(this.realm, template, popItems(stack, count)))
          break
        }
        case Op.SUPER_CALL: {
          const argc = spreadArgc(stack, code[ip++])

          frame.ip = ip
          stack.push(this.superCall(frame, popItems(stack, argc)))
          break
        }
        case Op.GET_SUPER: stack.push(this.superProperty(frame, constants[code[ip++]] as string)); break
        case Op.GET_SUPER_INDEX: stack.push(this.superProperty(frame, propertyKey(stack.pop()))); break

        case Op.NEW: {
          const argc = spreadArgc(stack, code[ip++])
          const calleeAt = stack.length - argc - 1
          const callee = stack[calleeAt]

          if (isBaseScriptClass(callee)) {
            // as constructBase, with the constructor running in this loop (it ends with THIS RETURN)
            frame.ip = ip
            const instance = this.initializeFields(callee, this.newInstance(callee))

            frame = this.enterClosureFromStack(callee.ctor, argc, instance, calleeAt)
            frame.isConstruct = true
            frame.newTarget = callee
            code = frame.proto.code
            constants = frame.proto.constants
            ip = 0
          } else {
            const args = popItems(stack, argc)

            stack.push(this.construct(stack.pop(), args))
          }
          break
        }
        case Op.TRY:
          frame.handlers ??= []
          frame.handlers.push({ catchTarget: code[ip++], finallyTarget: code[ip++], stackHeight: stack.length, env: frame.env })
          break
        case Op.END_TRY: frame.handlers?.pop(); break
        case Op.GENERATOR: {
          frame.ip = ip
          const generator = this.startGenerator(frame)

          if (this.frames.length < entryDepth) return generator
          frame = this.frames[this.frames.length - 1];
          ({ code, constants } = frame.proto)
          ip = frame.ip
          stack.push(generator)
          break
        }
        case Op.ASYNC: {
          frame.ip = ip
          const promise = this.startAsync(frame)

          if (this.frames.length < entryDepth) return promise
          frame = this.frames[this.frames.length - 1];
          ({ code, constants } = frame.proto)
          ip = frame.ip
          stack.push(promise)
          break
        }
        // a coroutine's frame always runs as the entry frame of its own loop (resumeCoroutine), so suspending it
        // ends this loop
        case Op.AWAIT:
        case Op.YIELD:
          a = stack.pop()
          frame.ip = ip
          this.suspend(frame)

          return a
        case Op.YIELD_DELEGATE: {
          const coroutine = frame.coroutine as Coroutine

          frame.ip = ip
          const step = this.delegateStep(coroutine, stack.pop(), stack[stack.length - 1])

          if (step.done) {
            stack[stack.length - 1] = step.value
            break
          }
          frame.ip = frame.opStart // resuming runs the next step
          coroutine.delegating = true
          this.suspend(frame)

          return step.value
        }
        case Op.ITER_CLOSE:
          frame.ip = ip
          closeIterators([stack.pop()])
          break
        case Op.CLOSE_ITERS:
          frame.ip = ip
          closeIterators(stack.slice(frame.base, stack.length - 1))
          break
        case Op.THROW: throw new ScriptThrow(stack.pop(), this.captureStack())
        case Op.ENTER_FINALLY: stack.push(new FinallyRecord(null) as unknown as Value); break
        case Op.END_FINALLY: {
          const record = stack.pop() as unknown as FinallyRecord

          if (record.thrown) throw record.thrown
          break
        }
        case Op.JUMP_IF_ARG:
          if (frame.env.slots[code[ip++]] === UNINITIALIZED) ip++
          else ip = code[ip]
          break
        case Op.HALT: return stack.pop()
        case Op.STORE_POP: {
          const env = lookupEnv(frame.env, code[ip++])
          const slot = code[ip++]

          initialized(env.slots[slot], frame)
          env.slots[slot] = stack.pop()
          break
        }
        case Op.STORE_GLOBAL_POP: this.storeGlobal(frame, code[ip++], stack.pop()); break
        case Op.SET_PROP_POP:
          b = stack.pop()
          setProperty(this, stack.pop(), constants[code[ip++]] as string, b)
          break
        case Op.INCREMENT: {
          const env = lookupEnv(frame.env, code[ip++])
          const slot = code[ip++]

          a = initialized(env.slots[slot], frame)
          env.slots[slot] = (typeof a === 'number' ? a : toNumber(a, '+')) + code[ip++]
          break
        }
        default:
          throw new Error(`Opcode ${Op[code[frame.opStart]]} is not implemented`)
      }
    }
  }
  /* eslint-enable complexity, max-lines-per-function, max-depth, prefer-destructuring,
    @stylistic/max-statements-per-line, @stylistic/padding-line-between-statements */
}

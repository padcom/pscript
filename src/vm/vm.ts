// The bytecode interpreter (§5.6).
import type { ClassTemplate, CompiledScript, FunctionProto } from '@/compiler/function-proto'
import { GlobalFlags, Op } from '@/compiler/opcodes'
import { PScriptRuntimeError, formatExcerpt, type ScriptStackFrame } from '@/errors'
import { addIn, toStringIn } from '@/runtime/conversions'
import {
  arithmetic,
  compare,
  hasProperty,
  instanceOf,
  inheritedProperty,
  isErrorObject,
  kindOf,
  strictEquals,
  toNumber,
  truthy,
  typeOf,
} from '@/runtime/operators'
import { formatNested } from '@/runtime/format'
import { DONE, getIterator, type ScriptIterator } from '@/runtime/iterators'
import { defineAccessor, defineProperty, getProperty, propertyKey, setProperty } from '@/runtime/properties'
import { toHost } from '@/runtime/interop'
import { ScriptError, ScriptThrow, rangeError, referenceError, typeError } from '@/runtime/script-error'
import { arityError } from '@/compiler/signature'
import {
  Accessor,
  Array as ScriptArray,
  Class as ClassValue,
  Closure,
  Environment,
  Function as ScriptFunction,
  NativeFunction,
  Object as ScriptObject,
  UNINITIALIZED,
  type AccessContext,
  type NativeClassImpl,
  type Realm,
  type Slot,
  type Value,
} from '@/runtime/values'
import { defineClass, superMember } from './classes'
import type { Frame, Handler } from './frame'
import { Globals } from './globals'

/**
 * Limits enforced by the VM (D14).
 */
export interface VMOptions {
  /** maximum number of executed instructions per `execute()` */
  maxSteps: number
  /** maximum depth of nested calls */
  maxCallDepth: number
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
function initializedThis(frame: Frame): Value {
  if (frame.thisValue === NO_THIS) throw referenceError("Must call super constructor before accessing 'this'")

  return frame.thisValue
}

function nullish(value: Value): boolean {
  return value === null || value === undefined
}

export class VM implements AccessContext {
  readonly stack: Value[] = []
  readonly frames: Frame[] = []
  readonly globals: Globals
  /** instructions executed by the current `execute()` (counted only when maxSteps is finite) */
  steps = 0
  private script: CompiledScript | null = null

  constructor(readonly realm: Realm, readonly options: VMOptions) {
    this.globals = new Globals(realm)
  }

  get homeClass(): ClassValue | null {
    return this.frames.at(-1)?.homeClass ?? null
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
    if (!(fn instanceof Closure)) this.notCallable(fn)

    this.enterClosure(fn, args, thisValue)

    return this.runNested()
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
    const { fnProto: proto } = closure

    this.checkArity(proto, args.length)

    // frames[0] is the script, so frames.length is the depth of the call being made
    if (this.frames.length > this.options.maxCallDepth) throw rangeError('Maximum call stack size exceeded')

    const env = new Environment(this.bindArguments(proto, args), closure.env)
    const frame = this.newFrame(proto, env, proto.kind === 'arrow' ? closure.thisValue ?? null : thisValue)

    frame.closure = closure
    frame.homeClass = closure.homeClass
    frame.homeObject = closure.homeObject
    this.frames.push(frame)

    return frame
  }

  private checkArity(proto: FunctionProto, argc: number) {
    const problem = arityError({
      text: proto.signature ?? `${proto.name}()`,
      required: proto.length,
      optional: proto.paramCount - proto.length,
      hasRest: proto.hasRest,
    }, argc)
    if (problem) throw typeError(problem)
  }

  // Parameters take the first slots; omitted ones stay UNINITIALIZED for JUMP_IF_ARG (defaults).
  private bindArguments({ scopeSize, paramCount, hasRest }: FunctionProto, args: Value[]): Slot[] {
    const slots = new globalThis.Array<Slot>(scopeSize).fill(UNINITIALIZED)

    for (let i = 0; i < Math.min(args.length, paramCount); i++) slots[i] = args[i]

    if (hasRest) slots[paramCount] = new ScriptArray(this.realm.ArrayPrototype, args.slice(paramCount))

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
      handlers: [],
      isConstruct: false,
      newTarget: null,
    }
  }

  /**
   * Runs a compiled script to completion.
   *
   * @param script the script
   * @returns its completion value (§4.4.10)
   */
  execute(script: CompiledScript): Value {
    const { main } = script
    const env = new Environment(new globalThis.Array<Slot>(main.scopeSize).fill(UNINITIALIZED), null)

    this.script = script
    this.steps = 0
    this.frames.push(this.newFrame(main, env, null))

    try {
      return this.run(1)
    } catch (e) {
      throw this.uncaught(e)
    } finally {
      this.frames.length = 0
      this.stack.length = 0
    }
  }

  // An exception that left the script: report it to the host (§5.9).
  private uncaught(e: unknown): unknown {
    if (e instanceof ScriptError) return this.uncaughtThrow(this.asThrow(e))

    return e instanceof ScriptThrow ? this.uncaughtThrow(e) : e
  }

  private uncaughtThrow({ value, frames }: ScriptThrow): PScriptRuntimeError {
    const [name, reason] = describeThrown(value)
    const { line, column } = frames[0] ?? { line: 0, column: 0 }

    return new PScriptRuntimeError(name, reason, toHost(value), {
      scriptStack: frames,
      fileName: this.script?.fileName,
      line,
      column,
      excerpt: this.excerpt(line, column),
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

      return { functionName: functionName(frame.proto), line, column }
    }).reverse()
  }

  // A runtime error (ScriptError) becomes an instance of the matching built-in error class (§4.4.9).
  private asThrow(e: unknown): ScriptThrow {
    if (e instanceof ScriptThrow) return e
    if (!(e instanceof ScriptError)) throw e

    return new ScriptThrow(this.errorObject(e.scriptName, e.message), this.captureStack())
  }

  private errorObject(name: string, message: string): Value {
    const cls = (this.realm.globals.get(name) ?? this.realm.globals.get('Error'))?.value as ClassValue & { /**
                                                                                                            *
                                                                                                            */
      native: NativeClassImpl
    }

    return cls.native.construct(this, cls, [message])
  }

  // Finds the innermost handler in the frames of this dispatch loop (§5.6.5) or rethrows to the caller.
  private unwind(e: unknown, entryDepth: number) {
    const thrown = this.asThrow(e)

    while (this.frames.length >= entryDepth) {
      const frame = this.frames[this.frames.length - 1]
      const handler = frame.handlers.pop()

      if (handler) {
        this.enterHandler(frame, handler, thrown)

        return
      }
      this.frames.pop()
      this.stack.length = frame.base
    }
    throw thrown
  }

  // Restores the stack and environment of the `try`, then continues in `catch` (with the value) or `finally`.
  private enterHandler(frame: Frame, handler: Handler, thrown: ScriptThrow) {
    this.stack.length = handler.stackHeight
    frame.env = handler.env

    if (handler.catchTarget >= 0) {
      this.stack.push(thrown.value)
      frame.ip = handler.catchTarget
    } else {
      this.stack.push(new FinallyRecord(thrown) as unknown as Value)
      frame.ip = handler.finallyTarget
    }
  }

  private excerpt(line: number, column: number): string | undefined {
    const source = this.script?.source

    return source === undefined ? undefined : formatExcerpt(source, line, column)
  }

  // Arrows that read `this` capture it from the creating frame (§4.4.5).
  // Arrows capture `this` (when they read it) and the home class/object (for `super`, private access) lexically.
  private closure(proto: FunctionProto, frame: Frame): Closure {
    const closure = new Closure(this.realm.FunctionPrototype, proto, frame.env, null)

    if (proto.usesThis) closure.thisValue = frame.thisValue
    if (proto.kind === 'arrow') {
      closure.homeClass = frame.homeClass
      closure.homeObject = frame.homeObject
    }

    return closure
  }

  // Object-literal property; a method remembers the object as its home object (for `super`, §5.4).
  private defineProperty(value: Value, object: ScriptObject, key: string) {
    if (value instanceof Closure && value.fnProto.kind === 'method') value.homeObject = object
    defineProperty(object, key, value)
  }

  private notCallable(fn: Value): never {
    if (fn instanceof ClassValue) throw typeError(`Class constructor ${fn.name} cannot be invoked without 'new'`)

    throw typeError(`${typeOf(fn)} is not a function`)
  }

  // `new C(...)` (§5.6.3): built-in classes construct natively; script classes arrive with M15.
  private construct(callee: Value, args: Value[]): Value {
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
    const instance = new ScriptObject(newTarget.prototype)

    instance.klass = newTarget
    this.initializeFields(cls, instance)

    if (cls.ctor) return this.runConstructor(cls.ctor, instance, args, newTarget)
    if (args.length > 0) throw typeError(`${cls.name || 'anonymous'}() expects 0 arguments, got ${args.length}`) // D38

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

  private notAClass(callee: Value): never {
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
        case Op.LOAD_GLOBAL: stack.push(globals.load(constants[code[ip++]] as string)); break
        case Op.STORE_GLOBAL: globals.store(constants[code[ip++]] as string, stack[stack.length - 1]); break
        case Op.DECLARE_GLOBAL:
          globals.declare(constants[code[ip++]] as string, (code[ip++] & GlobalFlags.Const) !== 0)
          break
        case Op.INIT_GLOBAL: globals.initialize(constants[code[ip++]] as string, stack.pop()); break
        case Op.TYPEOF_GLOBAL: stack.push(globals.typeOf(constants[code[ip++]] as string)); break
        case Op.PUSH_ENV:
          frame.env = new Environment(new globalThis.Array<Slot>(code[ip++]).fill(UNINITIALIZED), frame.env)
          break
        case Op.POP_ENV: frame.env = frame.env.parent as Environment; break
        case Op.COPY_ENV: frame.env = new Environment([...frame.env.slots], frame.env.parent); break
        case Op.JUMP: ip = code[ip]; break
        case Op.JUMP_IF_FALSE: ip = truthy(stack.pop()) ? ip + 1 : code[ip]; break
        case Op.JUMP_IF_TRUE: ip = truthy(stack.pop()) ? code[ip] : ip + 1; break
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
          stack.push(addIn(this, stack.pop(), b))
          break
        case Op.SUB:
          b = stack.pop()
          stack.push(arithmetic('-', stack.pop(), b))
          break
        case Op.MUL:
          b = stack.pop()
          stack.push(arithmetic('*', stack.pop(), b))
          break
        case Op.DIV:
          b = stack.pop()
          stack.push(arithmetic('/', stack.pop(), b))
          break
        case Op.MOD:
          b = stack.pop()
          stack.push(arithmetic('%', stack.pop(), b))
          break
        case Op.POW:
          b = stack.pop()
          stack.push(arithmetic('**', stack.pop(), b))
          break
        case Op.EQ:
          b = stack.pop()
          stack.push(strictEquals(stack.pop(), b))
          break
        case Op.NE:
          b = stack.pop()
          stack.push(!strictEquals(stack.pop(), b))
          break
        case Op.LT:
          b = stack.pop()
          stack.push(compare('<', stack.pop(), b))
          break
        case Op.LE:
          b = stack.pop()
          stack.push(compare('<=', stack.pop(), b))
          break
        case Op.GT:
          b = stack.pop()
          stack.push(compare('>', stack.pop(), b))
          break
        case Op.GE:
          b = stack.pop()
          stack.push(compare('>=', stack.pop(), b))
          break
        case Op.INSTANCEOF:
          b = stack.pop()
          stack.push(instanceOf(stack.pop(), b))
          break
        case Op.IN:
          b = stack.pop()
          stack.push(hasProperty(stack.pop(), b))
          break
        case Op.INC: stack.push((stack.pop() as number) + 1); break
        case Op.DEC: stack.push((stack.pop() as number) - 1); break
        case Op.NEG: stack.push(-toNumber(stack.pop(), '-')); break
        case Op.POS: stack.push(toNumber(stack.pop(), '+')); break
        case Op.NOT: stack.push(!truthy(stack.pop())); break
        case Op.TYPEOF: stack.push(typeOf(stack.pop())); break

        case Op.DUP2: stack.push(stack[stack.length - 2], stack[stack.length - 1]); break
        case Op.SWAP:
          b = stack[stack.length - 1]
          stack[stack.length - 1] = stack[stack.length - 2]
          stack[stack.length - 2] = b
          break
        // the index is computed before the pop: a b c → c a b, a b c d → d a b c
        case Op.ROT3: stack.splice(stack.length - 3, 0, stack.pop()); break
        case Op.ROT4: stack.splice(stack.length - 4, 0, stack.pop()); break
        case Op.GET_PROP:
          stack.push(getProperty(this, stack.pop(), constants[code[ip++]] as string))
          break

        case Op.SET_PROP: {
          const value = stack.pop()

          setProperty(this, stack.pop(), constants[code[ip++]] as string, value)
          stack.push(value)
          break
        }
        case Op.GET_INDEX:
          b = stack.pop()
          stack.push(getProperty(this, stack.pop(), propertyKey(b)))
          break

        case Op.SET_INDEX: {
          const value = stack.pop()
          const key = propertyKey(stack.pop())

          setProperty(this, stack.pop(), key, value)
          stack.push(value)
          break
        }
        case Op.OBJECT: stack.push(new ScriptObject(this.realm.ObjectPrototype)); break
        case Op.TO_STRING: stack.push(toStringIn(this, stack.pop())); break
        case Op.CONCAT: {
          const argc = code[ip++]

          stack.push(stack.splice(stack.length - argc, argc).join(''))
          break
        }
        case Op.ARRAY: {
          const argc = code[ip++]

          stack.push(new ScriptArray(this.realm.ArrayPrototype, stack.splice(stack.length - argc, argc)))
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
        case Op.CALL_METHOD: // CALL with the receiver below the function
        case Op.CALL: {
          const isMethod = code[ip - 1] === Op.CALL_METHOD
          const argc = code[ip++]
          const args = stack.splice(stack.length - argc, argc)
          const callee = stack.pop()
          const thisValue = isMethod ? stack.pop() : null // plain call: this = null (D37)

          if (callee instanceof Closure) {
            frame.ip = ip
            frame = this.enterClosure(callee, args, thisValue)
            code = frame.proto.code
            constants = frame.proto.constants
            ip = 0
          } else stack.push(this.callFunction(callee, thisValue, args))
          break
        }

        case Op.RETURN: {
          const value = stack.pop()

          this.frames.pop()
          stack.length = frame.base

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
          const superClass = template.hasSuper ? stack.pop() : undefined

          frame.ip = ip
          stack.push(defineClass(this, template, superClass, { env: frame.env, homeClass: frame.homeClass, constants }))
          break
        }
        case Op.SUPER_CALL: {
          const argc = code[ip++]

          frame.ip = ip
          stack.push(this.superCall(frame, stack.splice(stack.length - argc, argc)))
          break
        }
        case Op.GET_SUPER: stack.push(this.superProperty(frame, constants[code[ip++]] as string)); break
        case Op.GET_SUPER_INDEX: stack.push(this.superProperty(frame, propertyKey(stack.pop()))); break

        case Op.NEW: {
          const argc = code[ip++]
          const args = stack.splice(stack.length - argc, argc)

          stack.push(this.construct(stack.pop(), args))
          break
        }
        case Op.TRY:
          frame.handlers.push({ catchTarget: code[ip++], finallyTarget: code[ip++], stackHeight: stack.length, env: frame.env })
          break
        case Op.END_TRY: frame.handlers.pop(); break
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
        default:
          throw new Error(`Opcode ${Op[code[frame.opStart]]} is not implemented`)
      }
    }
  }
  /* eslint-enable complexity, max-lines-per-function, max-depth, prefer-destructuring,
    @stylistic/max-statements-per-line, @stylistic/padding-line-between-statements */
}

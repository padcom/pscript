// The bytecode interpreter (§5.6).
import type { CompiledScript, FunctionProto } from '@/compiler/function-proto'
import { GlobalFlags, Op } from '@/compiler/opcodes'
import { PScriptRuntimeError, formatExcerpt, type ScriptStackFrame } from '@/errors'
import {
  add,
  arithmetic,
  compare,
  hasProperty,
  instanceOf,
  kindOf,
  strictEquals,
  toNumber,
  truthy,
  typeOf,
} from '@/runtime/operators'
import { DONE, getIterator, type ScriptIterator } from '@/runtime/iterators'
import { defineProperty, getProperty, propertyKey, setProperty } from '@/runtime/properties'
import { ScriptError, rangeError, referenceError, typeError } from '@/runtime/script-error'
import { arityError } from '@/compiler/signature'
import {
  Array as ScriptArray,
  Class as ClassValue,
  Closure,
  Environment,
  Function as ScriptFunction,
  NativeFunction,
  Object as ScriptObject,
  UNINITIALIZED,
  type AccessContext,
  type Realm,
  type Slot,
  type Value,
} from '@/runtime/values'
import type { Frame } from './frame'
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
    if (!(fn instanceof Closure)) throw typeError(`${typeOf(fn)} is not a function`)

    this.enterClosure(fn, args, thisValue)

    return this.run(this.frames.length)
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

  private uncaught(e: unknown): unknown {
    if (!(e instanceof ScriptError)) return e

    const scriptStack: ScriptStackFrame[] = this.frames.map(frame => {
      const [line, column] = location(frame.proto, frame.opStart)

      return { functionName: functionName(frame.proto), line, column }
    }).reverse()
    const [{ line, column }] = scriptStack
    const value = { name: e.scriptName, message: e.message }

    return new PScriptRuntimeError(e.scriptName, e.message, value, {
      scriptStack,
      fileName: this.script?.fileName,
      line,
      column,
      excerpt: this.excerpt(line, column),
    })
  }

  private excerpt(line: number, column: number): string | undefined {
    const source = this.script?.source

    return source === undefined ? undefined : formatExcerpt(source, line, column)
  }

  // Arrows that read `this` capture it from the creating frame (§4.4.5).
  private closure(proto: FunctionProto, frame: Frame): Closure {
    const closure = new Closure(this.realm.FunctionPrototype, proto, frame.env, null)

    if (proto.usesThis) closure.thisValue = frame.thisValue

    return closure
  }

  // Object-literal property; a method remembers the object as its home object (for `super`, §5.4).
  private defineProperty(value: Value, object: ScriptObject, key: string) {
    if (value instanceof Closure && value.fnProto.kind === 'method') value.homeObject = object
    defineProperty(object, key, value)
  }

  private notAClass(callee: Value): never {
    throw typeError(`${callee instanceof ScriptFunction ? callee.name || 'anonymous function' : kindOf(callee)} is not a class`)
  }

  // §5.6.2: one switch dispatch loop, with hot locals; exempt from the size and nesting rules.
  /* eslint-disable complexity, max-lines-per-function, max-depth, prefer-destructuring,
    @stylistic/max-statements-per-line, @stylistic/padding-line-between-statements */
  // Runs until the frame at depth `entryDepth` returns (or the script halts).
  private run(entryDepth: number): Value {
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
          stack.push(add(stack.pop(), b))
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
        case Op.THIS: stack.push(frame.thisValue); break

        case Op.NEW: {
          const callee = stack[stack.length - code[ip] - 1]

          if (!(callee instanceof ClassValue)) this.notAClass(callee)
          throw new Error('Classes are not implemented yet')
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

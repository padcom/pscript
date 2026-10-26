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
  strictEquals,
  toNumber,
  truthy,
  typeOf,
} from '@/runtime/operators'
import { ScriptError, referenceError, typeError } from '@/runtime/script-error'
import {
  Environment,
  NativeFunction,
  UNINITIALIZED,
  type AccessContext,
  type Class,
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

function nullish(value: Value): boolean {
  return value === null || value === undefined
}

export class VM implements AccessContext {
  readonly stack: Value[] = []
  readonly frames: Frame[] = []
  readonly globals: Globals
  private script: CompiledScript | null = null

  constructor(readonly realm: Realm, readonly options: VMOptions) {
    this.globals = new Globals(realm)
  }

  get homeClass(): Class | null {
    return this.frames.at(-1)?.homeClass ?? null
  }

  /**
   * Calls a function from native code (§5.6.4). Only native functions so far.
   *
   * @param fn the function
   * @param thisValue `this`
   * @param args arguments
   * @returns the result
   */
  callFunction(fn: Value, thisValue: Value, args: Value[]): Value {
    if (fn instanceof NativeFunction) return fn.impl(this, thisValue, args)

    throw typeError(`${typeOf(fn)} is not a function`)
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
    this.frames.push({
      closure: null,
      proto: main,
      ip: 0,
      opStart: 0,
      base: this.stack.length,
      env,
      thisValue: null,
      homeClass: null,
      homeObject: null,
      handlers: [],
      isConstruct: false,
      newTarget: null,
    })

    try {
      return this.run()
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

      return { functionName: frame.proto.name || '<script>', line, column }
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

  private call(argc: number): Value {
    const { stack } = this
    const args = stack.splice(stack.length - argc, argc)
    const fn = stack.pop()

    return this.callFunction(fn, null, args)
  }

  // §5.6.2: one switch dispatch loop, with hot locals; exempt from the size and nesting rules.
  /* eslint-disable complexity, max-lines-per-function, max-depth, @stylistic/max-statements-per-line */
  private run(): Value {
    const { stack, globals } = this
    const frame = this.frames[this.frames.length - 1]
    const { code, constants } = frame.proto
    let { ip } = frame
    let b: Value

    for (;;) {
      frame.opStart = ip

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
        case Op.CALL: stack.push(this.call(code[ip++])); break
        case Op.HALT: return stack.pop()
        default:
          throw new Error(`Opcode ${Op[code[frame.opStart]]} is not implemented`)
      }
    }
  }
  /* eslint-enable complexity, max-lines-per-function, max-depth, @stylistic/max-statements-per-line */
}

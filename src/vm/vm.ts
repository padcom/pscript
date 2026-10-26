// The bytecode interpreter (§5.6).
import type { CompiledScript, FunctionProto } from '@/compiler/function-proto'
import { Op } from '@/compiler/opcodes'
import { PScriptRuntimeError, formatExcerpt, type ScriptStackFrame } from '@/errors'
import { add, arithmetic, toNumber, truthy, typeOf } from '@/runtime/operators'
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

function initialized(slot: Slot): Value {
  if (slot === UNINITIALIZED) throw referenceError('Cannot access a binding before initialization')

  return slot
}

export class VM implements AccessContext {
  readonly stack: Value[] = []
  readonly frames: Frame[] = []
  private script: CompiledScript | null = null

  constructor(readonly realm: Realm, readonly options: VMOptions) {}

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

  private loadGlobal(name: string): Value {
    const binding = this.realm.globals.get(name)
    if (!binding) throw referenceError(`${name} is not defined`)

    return binding.value
  }

  private typeofGlobal(name: string): string {
    const binding = this.realm.globals.get(name)

    return binding ? typeOf(binding.value) : 'undefined'
  }

  private call(argc: number): Value {
    const { stack } = this
    const args = stack.splice(stack.length - argc, argc)
    const fn = stack.pop()

    return this.callFunction(fn, null, args)
  }

  /* eslint-disable complexity, max-lines-per-function -- §5.6.2: one switch dispatch loop */
  private run(): Value {
    const { stack } = this
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
          stack.push(initialized(lookupEnv(frame.env, code[ip++]).slots[code[ip++]]))
          break

        case Op.STORE: {
          const env = lookupEnv(frame.env, code[ip++])
          const slot = code[ip++]

          initialized(env.slots[slot])
          env.slots[slot] = stack[stack.length - 1]
          break
        }
        case Op.INIT:
          lookupEnv(frame.env, code[ip++]).slots[code[ip++]] = stack.pop()
          break
        case Op.LOAD_GLOBAL: stack.push(this.loadGlobal(constants[code[ip++]] as string)); break
        case Op.TYPEOF_GLOBAL: stack.push(this.typeofGlobal(constants[code[ip++]] as string)); break
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
  /* eslint-enable complexity, max-lines-per-function */
}

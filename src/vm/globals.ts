// Script-level bindings and globals (§4.4.4 name resolution steps 2–4).
// Script bindings are the top-level let/const/class/function declarations of scripts; they persist
// across `run()` calls on the same Interpreter and shadow globals of the same name.
import { typeOf } from '@/runtime/operators'
import { ScriptError, referenceError, typeError } from '@/runtime/script-error'
import { UNINITIALIZED, type Realm, type Slot, type Value } from '@/runtime/values'

/**
 * A top-level declaration of a script.
 */
export interface ScriptBinding {
  /** current value; UNINITIALIZED while in the TDZ */
  value: Slot
  /** declared with `const` */
  isConst: boolean
}

function tdz(name: string): ScriptError {
  return referenceError(`Cannot access '${name}' before initialization`)
}

export class Globals {
  readonly scriptBindings = new Map<string, ScriptBinding>()

  constructor(private realm: Realm) {}

  /**
   * Declares a script binding (in the TDZ until initialised).
   *
   * @param name binding name
   * @param isConst declared with `const`
   */
  declare(name: string, isConst: boolean) {
    if (this.scriptBindings.has(name)) {
      throw new ScriptError('SyntaxError', `Identifier '${name}' has already been declared`)
    }
    this.scriptBindings.set(name, { value: UNINITIALIZED, isConst })
  }

  /**
   * Initialises a script binding.
   *
   * @param name binding name
   * @param value initial value
   */
  initialize(name: string, value: Value) {
    (this.scriptBindings.get(name) as ScriptBinding).value = value
  }

  /**
   * Reads a script binding or global.
   *
   * @param name binding name
   * @returns the value
   */
  load(name: string): Value {
    const binding = this.scriptBindings.get(name)
    if (binding) return this.initialized(name, binding)

    const global = this.realm.globals.get(name)
    if (!global) throw referenceError(`${name} is not defined`)

    return global.value
  }

  /**
   * Assigns a script binding or an existing global.
   *
   * @param name binding name
   * @param value new value
   */
  store(name: string, value: Value) {
    const binding = this.scriptBindings.get(name)
    if (binding) {
      this.assign(name, binding, value)

      return
    }

    const global = this.realm.globals.get(name)
    if (!global) throw referenceError(`${name} is not defined`)
    if (global.readonly) throw typeError(`Cannot assign to read-only global '${name}'`)
    global.value = value
  }

  /**
   * `typeof name` without a ReferenceError for undeclared names.
   *
   * @param name binding name
   * @returns the type name
   */
  typeOf(name: string): string {
    const binding = this.scriptBindings.get(name)
    if (binding) return typeOf(this.initialized(name, binding))

    const global = this.realm.globals.get(name)

    return global ? typeOf(global.value) : 'undefined'
  }

  /**
   * Reads a name for the host (`Interpreter.get`): no errors.
   *
   * @param name binding name
   * @returns the value, or `undefined` when missing or uninitialised
   */
  peek(name: string): Value {
    const binding = this.scriptBindings.get(name)
    if (binding) return binding.value === UNINITIALIZED ? undefined : binding.value

    return this.realm.globals.get(name)?.value
  }

  private initialized(name: string, binding: ScriptBinding): Value {
    if (binding.value === UNINITIALIZED) throw tdz(name)

    return binding.value
  }

  private assign(name: string, binding: ScriptBinding, value: Value) {
    this.initialized(name, binding)

    if (binding.isConst) throw typeError(`Assignment to constant variable '${name}'`)
    binding.value = value
  }
}

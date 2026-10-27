// Realm construction (§5.7): intrinsic prototypes and the global bindings.
import { Object as ScriptObject, type Realm, type Value } from './values'

/**
 * Creates a realm.
 *
 * @returns a realm with empty intrinsic prototypes and no globals
 */
export function createRealm(): Realm {
  const ObjectPrototype = new ScriptObject(null)

  return {
    ObjectPrototype,
    FunctionPrototype: new ScriptObject(ObjectPrototype),
    ArrayPrototype: new ScriptObject(ObjectPrototype),
    StringPrototype: new ScriptObject(ObjectPrototype),
    NumberPrototype: new ScriptObject(ObjectPrototype),
    BooleanPrototype: new ScriptObject(ObjectPrototype),
    ErrorPrototype: new ScriptObject(ObjectPrototype),
    GeneratorPrototype: new ScriptObject(ObjectPrototype),
    AsyncGeneratorPrototype: new ScriptObject(ObjectPrototype),
    globals: new Map(),
  }
}

/**
 * Defines or overwrites a global binding.
 *
 * @param realm the realm
 * @param name binding name
 * @param value binding value
 * @param readonly whether assignment throws a TypeError
 */
export function defineGlobal(realm: Realm, name: string, value: Value, readonly = false) {
  realm.globals.set(name, { value, readonly })
}

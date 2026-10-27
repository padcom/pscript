// Map and Set objects (D49): instances of the final built-in classes `Map` and `Set`. Keys compare like JavaScript's
// SameValueZero: primitives by value (NaN equals NaN, -0 is 0), objects by identity, host proxies by the identity of
// the host object they wrap (§5.8.1). Iteration is in insertion order and live, as in JS.
import { HostObject, Array as ScriptArray, Object as ScriptObject, type Value } from './values'

/**
 * The value a key is stored under: host proxies by their host object.
 *
 * @param key a key or a set element
 * @returns what the backing JS Map compares
 */
export function collectionKey(key: Value): unknown {
  return key instanceof HostObject ? key.target : key
}

function* entryArrays(entries: Map<unknown, [Value, Value]>, arrayPrototype: ScriptObject): Generator<Value> {
  for (const [key, value] of entries.values()) yield new ScriptArray(arrayPrototype, [key, value])
}

/**
 * A `Map` or `Set` instance.
 */
export abstract class CollectionObject extends ScriptObject {
  /**
   * Iterates the entries or elements (`for…of`, spread).
   */
  abstract iterate(): Iterator<Value>
}

/**
 * A `Map` instance: entries keyed by `collectionKey`, each with the key it was first set with.
 */
export class MapObject extends CollectionObject {
  readonly entries = new Map<unknown, [Value, Value]>()

  constructor(proto: ScriptObject, private readonly arrayPrototype: ScriptObject) {
    super(proto)
  }

  /**
   * Iterates the entries as `[key, value]` arrays (`for…of`, spread, `entries()`).
   *
   * @returns the iterator
   */
  override iterate(): Iterator<Value> {
    return entryArrays(this.entries, this.arrayPrototype)
  }
}

/**
 * A `Set` instance: elements keyed by `collectionKey`.
 */
export class SetObject extends CollectionObject {
  readonly elements = new Map<unknown, Value>()

  /**
   * Iterates the elements (`for…of`, spread, `values()`).
   *
   * @returns the iterator
   */
  override iterate(): Iterator<Value> {
    return this.elements.values()
  }
}

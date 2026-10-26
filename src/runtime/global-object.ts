// `globalThis` (§4.6.1): a read-only namespace exposing every global by name, including host
// globals added later. Reads go to the realm's globals; writes are a TypeError.
import { Object as ScriptObject, type Realm } from './values'

export class GlobalObject extends ScriptObject {
  constructor(proto: ScriptObject | null, readonly realm: Realm) {
    super(proto)
    this.extensible = false
  }
}

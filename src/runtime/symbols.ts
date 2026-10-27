// Well-known symbols (D57): `Symbol.iterator` and `Symbol.asyncIterator` are the only symbols. They are values of
// type 'symbol' that name properties through internal keys (src/parser/symbol-keys.ts).
import { symbolKey } from '@/parser/symbol-keys'
import { Object as ScriptObject } from './values'

export class SymbolValue extends ScriptObject {
  /** the internal property key */
  readonly key: string

  constructor(readonly description: string) {
    super(null)
    this.key = symbolKey(description.replace(/^Symbol\./, ''))
    this.extensible = false
    this.frozen = true
  }

  /**
   * `String(symbol)`.
   *
   * @returns `Symbol(Symbol.iterator)`
   */
  text(): string {
    return `Symbol(${this.description})`
  }
}

/** `Symbol.iterator`. */
export const SYMBOL_ITERATOR = new SymbolValue('Symbol.iterator')

/** `Symbol.asyncIterator`. */
export const SYMBOL_ASYNC_ITERATOR = new SymbolValue('Symbol.asyncIterator')

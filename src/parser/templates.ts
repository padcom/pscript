// Template literal lexing support (§4.1.8): the brace stack that tells an interpolation's closing
// `}` from other braces, and cooking of template text.
import type { JisonLexer } from '@/grammar/jison-types'
import type { TemplateElement } from './ast'
import { toLoc, type JisonLoc } from './ast-builders'
import { cookString } from './literals'

/** A token from the generated lexer while its action runs (`less(n)` gives back all but n characters). */
type LexerInAction = JisonLexer & { yytext: string, less(n: number): void }

// `\r\n` and `\r` in template text are normalised to `\n`, in both the raw and the cooked value (as JS).
function normalise(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * The raw text of a template chunk without its delimiters (`` ` `` / `}` and `` ` `` / `${`).
 *
 * @param token the chunk as lexed
 * @returns the raw text
 */
export function templateRaw(token: string): string {
  return normalise(token.slice(1, token.endsWith('${') ? -2 : -1))
}

/**
 * Builds a TemplateElement; escape errors are reported through `onError` (offset relative to the token).
 *
 * @param token the chunk as lexed
 * @param loc its location
 * @param tail whether it ends the template
 * @returns the element
 */
export function templateElement(token: string, loc: JisonLoc, tail: boolean): TemplateElement {
  const raw = templateRaw(token)

  return { type: 'TemplateElement', value: { raw, cooked: cookString(`\`${raw}\``) }, tail, loc: toLoc(loc) }
}

/**
 * One counter of open `{` per interpolation being lexed; created per parse.
 */
export class TemplateBraces {
  private stack: number[] = []

  openBrace(): string {
    if (this.stack.length > 0) this.stack[this.stack.length - 1]++

    return '{'
  }

  closeBrace(): string {
    if (this.top() > 0) this.stack[this.stack.length - 1]--

    return '}'
  }

  // `` `text` `` or `` `text${ ``.
  start(token: string): string {
    if (token.endsWith('`')) return 'TEMPLATE_FULL'
    this.stack.push(0)

    return 'TEMPLATE_HEAD'
  }

  // `}text${` / `` }text` `` continues a template only when the `}` closes the current interpolation;
  // otherwise it is an ordinary `}` and the text is given back to the lexer.
  continue(lexer: LexerInAction): string {
    if (this.stack.length === 0 || this.top() > 0) {
      lexer.less(1)

      return this.closeBrace()
    }
    if (!lexer.yytext.endsWith('`')) return 'TEMPLATE_MIDDLE'
    this.stack.pop()

    return 'TEMPLATE_TAIL'
  }

  private top(): number {
    return this.stack.length === 0 ? -1 : this.stack[this.stack.length - 1]
  }
}

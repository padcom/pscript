// Lexer wrapper installed as `parser.lexer` (§3.4, §4.2). It delegates to the generated
// lexer and records the location of the current token; the ASI token filter (M3) builds on it.
import type { JisonLexer, JisonLocation } from '@/grammar/jison-types'

/**
 * State shared between the lexer wrapper and the parse error hook.
 */
export interface TokenState {
  /** location of the token the parser is currently looking at */
  current: JisonLocation | null
}

// Jison's parse() uses `Object.create(parser.lexer)`, so all per-parse state is set in setInput().
export class TokenFilter {
  yytext = ''
  yyleng = 0
  yylineno = 0
  yylloc: JisonLocation = { first_line: 1, last_line: 1, first_column: 0, last_column: 0 }
  match = ''
  yy: Record<string, any> = {}
  options: Record<string, any>
  private inner: JisonLexer & { /**
                                 *
                                 */
    match: string
  }

  constructor(private base: JisonLexer, private state: TokenState) {
    this.options = base.options
    this.inner = Object.create(base)
  }

  setInput(input: string, yy: Record<string, any> = {}) {
    this.inner = Object.create(this.base)
    this.inner.setInput(input, yy)
    this.yy = yy

    return this
  }

  lex(): number | string {
    const { inner } = this
    const token = inner.lex()

    this.yytext = inner.yytext
    this.yyleng = inner.yyleng
    this.yylineno = inner.yylineno
    this.yylloc = inner.yylloc
    this.match = inner.match
    this.state.current = inner.yylloc

    return token
  }
}

/**
 * Creates a lexer for one parse.
 *
 * @param base the generated lexer (used as a prototype, never mutated)
 * @param state receives the location of each token
 * @returns a lexer object for `parser.lexer`
 */
export function createTokenFilter(base: JisonLexer, state: TokenState): JisonLexer {
  return new TokenFilter(base, state) as unknown as JisonLexer
}

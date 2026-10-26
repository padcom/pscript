// The token filter (§4.2): sits between the generated lexer and the parser, consumes NEWLINE
// tokens and inserts the semicolons that ASI requires (§4.2.1). It is the only place where
// newline-sensitive decisions are made.
import type { JisonLexer, JisonLocation, JisonParser } from '@/grammar/jison-types'
import { CONTINUERS, ENDERS } from './tokens'

/**
 * State shared between the token filter and the parse error hook.
 */
export interface TokenState {
  /** location of the token the parser is currently looking at */
  current: JisonLocation | null
}

/**
 * A token read from the generated lexer.
 */
interface Token {
  /** token name (punctuators use their text) */
  name: string
  /** matched text */
  text: string
  /** location */
  loc: JisonLocation
  /** line counter of the lexer after the token */
  lineno: number
  /** whether a line terminator (or a multi-line comment) came before the token */
  afterNewline: boolean
  /** a `)` that closes the condition of `if` / `while` / `for`: the statement continues */
  closesHeader?: boolean
  /** a `}` that closes a block */
  closesBlock?: boolean
}

type Bracket = '(' | '(header)' | '[' | '{block}' | '{object}'

/** Keywords whose `( … )` is followed by a statement, so their `)` does not end one. */
const HEADER_KEYWORDS = new Set(['IF', 'WHILE', 'FOR'])

// Object-literal braces are told apart from blocks in M9 (§4.2.2); until then every `{` is a block.
const OPENERS: Record<string, Bracket> = { '(': '(', '[': '[', '{': '{block}' }
const CLOSERS = new Set([')', ']', '}'])

function endOf(loc: JisonLocation): JisonLocation {
  return { first_line: loc.last_line, last_line: loc.last_line, first_column: loc.last_column, last_column: loc.last_column }
}

/**
 * Tokens with their own insertion rule (when `prev` may end a statement):
 * - EOF: insert at statement level (not inside open brackets, where a `;` can never help);
 * - `}`: insert when it closes a block;
 * - `else`: see `endsBranch`.
 */
const SPECIAL_TOKENS: Record<string, (filter: TokenFilter, token: Token) => boolean> = {
  'EOF': filter => filter.atStatementLevel(),
  '}': filter => filter.top() === '{block}',
  'ELSE': (filter, token) => filter.endsBranch(token),
}

// Jison's parse() uses `Object.create(parser.lexer)`, so all per-parse state is reset in setInput().
export class TokenFilter {
  yytext = ''
  yyleng = 0
  yylineno = 0
  yylloc: JisonLocation = { first_line: 1, last_line: 1, first_column: 0, last_column: 0 }
  match = ''
  yy: Record<string, any> = {}
  options: Record<string, any>
  private inner: JisonLexer
  private prev: Token | null = null
  private pending: Token | null = null
  private brackets: Bracket[] = []

  constructor(private base: JisonLexer, private terminals: Record<number, string>, private state: TokenState) {
    this.options = base.options
    this.inner = Object.create(base)
  }

  setInput(input: string, yy: Record<string, any> = {}) {
    this.inner = Object.create(this.base)
    this.inner.setInput(input, yy)
    this.yy = yy
    this.prev = null
    this.pending = null
    this.brackets = []

    return this
  }

  lex(): string {
    const token = this.pending ?? this.read()

    this.pending = null

    if (!this.needsSemicolon(token)) return this.emit(token)

    this.pending = token

    return this.emit(this.virtualSemicolon(token))
  }

  /**
   * Reads the next significant token, skipping NEWLINEs.
   *
   * @returns the token
   */
  private read(): Token {
    let afterNewline = false

    for (;;) {
      const name = this.tokenName(this.inner.lex())
      if (name !== 'NEWLINE') return this.snapshot(name, afterNewline)
      afterNewline = true
    }
  }

  // The generated lexer returns grammar symbol ids for quoted tokens and at the end of input.
  private tokenName(token: number | string): string {
    return typeof token === 'number' ? this.terminals[token] : token
  }

  private snapshot(name: string, afterNewline: boolean): Token {
    const { yytext, yylloc, yylineno } = this.inner

    return { name, text: yytext, loc: { ...yylloc }, lineno: yylineno, afterNewline }
  }

  private needsSemicolon(token: Token): boolean {
    return this.prevEnds() && this.insertsBefore(token)
  }

  private prevEnds(): boolean {
    return this.prev !== null && ENDERS.has(this.prev.name) && !this.prev.closesHeader
  }

  // `prev` may end a statement: insert at EOF, before a block's `}`, or at a newline that
  // starts a new statement (§4.2.1). Not at EOF inside open brackets: a `;` can never fix
  // that, and "expected ')'" is the better error.
  private insertsBefore(token: Token): boolean {
    const rule = SPECIAL_TOKENS[token.name]
    if (rule) return rule(this, token)

    return token.afterNewline && this.startsStatement(token)
  }

  // `if (c) a()\nelse …`: the then-branch statement needs its `;`, unless it was a block.
  endsBranch(token: Token): boolean {
    return token.afterNewline && !this.prev?.closesBlock
  }

  private startsStatement(token: Token): boolean {
    return this.atStatementLevel() && !CONTINUERS.has(token.name)
  }

  top(): Bracket | undefined {
    return this.brackets[this.brackets.length - 1]
  }

  atStatementLevel(): boolean {
    const top = this.top()

    return top === undefined || top === '{block}'
  }

  private virtualSemicolon(before: Token): Token {
    const loc = endOf((this.prev as Token).loc)

    return { name: ';', text: '', loc, lineno: before.lineno, afterNewline: false }
  }

  private emit(token: Token): string {
    this.track(token)
    this.prev = token
    this.yytext = token.text
    this.match = token.text
    this.yyleng = token.text.length
    this.yylineno = token.lineno
    this.yylloc = token.loc
    this.state.current = token.loc

    return token.name
  }

  private track(token: Token) {
    if (token.name in OPENERS) this.brackets.push(this.opener(token.name))
    else if (CLOSERS.has(token.name)) this.close(token, this.brackets.pop())
  }

  private close(token: Token, bracket: Bracket | undefined) {
    token.closesHeader = bracket === '(header)'
    token.closesBlock = bracket === '{block}'
  }

  private opener(name: string): Bracket {
    return name === '(' && this.afterHeaderKeyword() ? '(header)' : OPENERS[name]
  }

  private afterHeaderKeyword(): boolean {
    return HEADER_KEYWORDS.has(this.prev?.name ?? '')
  }
}

/**
 * Creates the token filter for one parse.
 *
 * @param parser the generated parser module (its lexer is used as a prototype, never mutated)
 * @param state receives the location of each token
 * @returns a lexer object for `parser.lexer`
 */
export function createTokenFilter(parser: JisonParser, state: TokenState): JisonLexer {
  // eslint-disable-next-line no-underscore-dangle -- Jison's name for the symbol table
  return new TokenFilter(parser.lexer, parser.terminals_, state) as unknown as JisonLexer
}

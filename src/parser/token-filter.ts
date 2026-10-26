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
  /** reports a syntax error found by the filter */
  fail: (reason: string, loc: JisonLocation) => never
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

const PAREN_DEPTH: Record<string, number> = { '(': 1, ')': -1 }

/** Tokens that may start an arrow function (§4.2.3). */
const ARROW_STARTS: Record<string, (filter: TokenFilter, token: Token) => void> = {
  'IDENT': (filter, token) => filter.classifyIdent(token),
  '(': (filter, token) => filter.classifyParen(token),
}

/** Tokens after which a statement starts (besides a control-flow header's `)`). */
const STATEMENT_PRECEDERS = new Set([';', '{', '}', 'ELSE'])

/** Keywords whose `( … )` is followed by a statement, so their `)` does not end one. */
const HEADER_KEYWORDS = new Set(['IF', 'WHILE', 'FOR'])

// Object-literal braces are told apart from blocks in M9 (§4.2.2); until then every `{` is a block.
const OPENERS: Record<string, Bracket> = { '(': '(', 'ARROW_LPAREN': '(', '[': '[', '{': '{block}' }
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
  /** raw tokens read ahead (arrow detection), not yet seen by the parser */
  private lookahead: Token[] = []

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
    this.lookahead = []

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
   * Reads the next significant token and classifies arrow-function starts (§4.2.3).
   *
   * @returns the token
   */
  private read(): Token {
    const token = this.lookahead.shift() ?? this.readRaw()

    ARROW_STARTS[token.name]?.(this, token)

    return token
  }

  // `x =>`: an identifier immediately followed by `=>` is an arrow's only parameter.
  classifyIdent(token: Token) {
    const next = this.peek(0)

    if (next.name === '=>') this.markArrow(token, 'ARROW_IDENT', next)
  }

  // `(` whose matching `)` is immediately followed by `=>` starts an arrow's parameter list.
  classifyParen(token: Token) {
    const close = this.matchingParen()
    const arrow = close < 0 ? null : this.peek(close + 1)

    if (arrow?.name === '=>') this.markArrow(token, 'ARROW_LPAREN', arrow)
  }

  private markArrow(token: Token, name: string, arrow: Token) {
    if (arrow.afterNewline) this.state.fail("Line terminator not permitted before '=>'", arrow.loc)
    token.name = name
  }

  // Index in the lookahead of the `)` matching a `(` just read, or -1 at EOF (depth counting).
  private matchingParen(): number {
    let depth = 1

    for (let i = 0; this.peek(i).name !== 'EOF'; i++) {
      depth += PAREN_DEPTH[this.peek(i).name] ?? 0

      if (depth === 0) return i
    }

    return -1
  }

  private peek(i: number): Token {
    while (this.lookahead.length <= i) this.lookahead.push(this.readRaw())

    return this.lookahead[i]
  }

  // The next token from the generated lexer, skipping NEWLINEs (recorded as `afterNewline`).
  private readRaw(): Token {
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
    if (token.name === 'FUNCTION' && this.atStatementStart()) token.name = 'FUNCTION_DECLARATION'
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

  // A statement may start here: beginning of input, after `;`, a block brace, a control-flow header or `else`.
  private atStatementStart(): boolean {
    const { prev } = this

    return prev === null || STATEMENT_PRECEDERS.has(prev.name) || Boolean(prev.closesHeader)
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

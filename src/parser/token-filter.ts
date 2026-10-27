// The token filter (§4.2): sits between the generated lexer and the parser, consumes NEWLINE
// tokens and inserts the semicolons that ASI requires (§4.2.1). It is the only place where
// newline-sensitive decisions are made.
import type { JisonLexer, JisonLocation, JisonParser } from '@/grammar/jison-types'
import { CONTINUERS, ENDERS, KEYWORDS } from './tokens'

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
  /** a `)` that closes the condition of `if` / `while` / `for` / `switch` / `catch`: the statement continues */
  closesHeader?: boolean
  /** a `)` that closes the condition of a `do … while`: the statement ends here, even without a newline */
  closesDoWhile?: boolean
  /** the `while` of a `do … while` */
  endsDo?: boolean
  /** the `:` of a `case` / `default` clause: a statement starts after it */
  endsCase?: boolean
  /** a `*` or `async` where a class member or an object-literal key starts: a method's name follows (D42, D43) */
  startsMethod?: boolean
  /** a `}` that closes a block */
  closesBlock?: boolean
  /** a `}` that closes a block statement or a function declaration's body: no `;` needed after it */
  closesStatement?: boolean
  /** a `final` that starts a statement (`final class …` is a declaration) */
  startsStatement?: boolean
}

/** Module syntax that PScript does not support, keyed by what follows `import` / `export` (§4.7.1). */
const UNSUPPORTED_IMPORTS: Record<string, string> = {
  'IDENT': "default imports are not supported; use named imports: import { name } from '…'",
  '(': 'import() is not supported',
  '.': 'import.meta is not supported',
}
const UNSUPPORTED_EXPORTS: Record<string, string> = {
  'default': 'export default is not supported; use named exports: export { name }',
  '*': "export * is not supported; list the names: export { a, b } from '…'",
}

/**
 * Open brackets. Braces (§4.2.2) are `{statement}` (block statements and function-declaration
 * bodies), `{block}` (bodies of function expressions, arrows and methods: the expression goes on
 * after the `}`) or `{object}` (object literals).
 */
type Bracket = '(' | '(header)' | '(do-while)' | '[' | '{statement}' | '{block}' | '{object}' | '{template}' | '{class}'
  | '{class-statement}' | '{specifiers}'

/** Brackets whose contents are statements or class members: ASI applies inside them. */
const BLOCK_LIKE = new Set<Bracket | undefined>(['{statement}', '{block}', '{class}', '{class-statement}'])
const CLASS_BODIES = new Set<Bracket | undefined>(['{class}', '{class-statement}'])

const KEYWORD_TOKENS = new Set(KEYWORDS.map(keyword => keyword.toUpperCase()))

/** Modifier keywords of class members (§4.5.1); `final` and `override` are contextual. */
const MODIFIERS = new Set(['PUBLIC', 'PROTECTED', 'PRIVATE', 'STATIC', 'FINAL', 'OVERRIDE'])
const CONTEXTUAL_MODIFIERS: Record<string, string> = { final: 'FINAL', override: 'OVERRIDE' }

/** `get` / `set` before a member name on the same line (§4.2.5). */
const ACCESSOR_KEYWORDS: Record<string, string> = { get: 'GET', set: 'SET' }
const MODULE_KEYWORDS: Record<string, string> = { as: 'AS', from: 'FROM' }

/** Tokens after which a class member starts. */
const MEMBER_PRECEDERS = new Set(['CLASS_LBRACE', ';', '}', 'GET', 'SET', ...MODIFIERS])

/** After a member name: a method, a field initialiser, the end of a field. */
const MEMBER_NAME_FOLLOWERS = new Set(['(', '=', ';', '}'])

// `o.x` and `o?.x` (D47): a keyword after them is a property name (§4.2.4).
const MEMBER_DOTS = new Set(['.', '?.'])

/** Tokens that can be a member name (keywords become IDENT there). */
const NAME_TOKENS = new Set(['IDENT', 'STRING', 'NUMBER'])

function isName(name: string): boolean {
  return NAME_TOKENS.has(name) || KEYWORD_TOKENS.has(name)
}

/** Context-dependent renaming when a token is handed to the parser. */
const EMIT_HOOKS: Record<string, (filter: TokenFilter, token: Token) => void> = {
  'FUNCTION': (filter, token) => filter.functionStart(token),
  'FINAL': (filter, token) => filter.finalStart(token),
  'CLASS': (filter, token) => filter.classStart(token),
  'INTERFACE': filter => filter.interfaceStart(),
  'IMPORT': filter => filter.moduleStart('import'),
  'EXPORT': filter => filter.moduleStart('export'),
  ';': filter => filter.moduleEnd(),
  'STRING': filter => filter.moduleEnd(),
  '{': (filter, token) => filter.classifyBrace(token),
  'DO': filter => filter.doStart(),
  'CASE': filter => filter.caseStart(),
  'DEFAULT': filter => filter.caseStart(),
  '?': filter => filter.caseTernary(),
  '*': (filter, token) => filter.markMethodStart(token),
  'ASYNC': (filter, token) => filter.asyncStart(token),
  ':': (filter, token) => filter.caseColon(token),
  'WHILE': (filter, token) => filter.whileStart(token),
}

/** A `{` after one of these opens a block statement. */
const STATEMENT_BRACE_PRECEDERS = new Set([';', 'BLOCK_LBRACE', '}', 'ELSE', 'TRY', 'CATCH', 'FINALLY', 'EXPORT', 'DO'])

/** A `{` after one of these opens an import or export list (§4.2.5). */
const SPECIFIER_BRACE_PRECEDERS = new Set(['IMPORT', 'EXPORT'])

/** A `{` after one of these opens a function, arrow or method body. */
const BODY_BRACE_PRECEDERS = new Set([')', '=>'])

const BRACE_TOKENS: Partial<Record<Bracket, string>> = {
  '{object}': 'OBJ_LBRACE',
  '{class}': 'CLASS_LBRACE',
  '{class-statement}': 'CLASS_LBRACE',
  '{specifiers}': 'SPEC_LBRACE',
}

/** Brackets whose `}` completes a statement (no `;` needed after it). */
const STATEMENT_BRACKETS = new Set<Bracket | undefined>(['{statement}', '{class-statement}'])

/** In an object literal, a key follows `{` or `,` and is followed by one of these (§4.2.4). */
const KEY_PRECEDERS = new Set(['OBJ_LBRACE', ',', 'GET', 'SET'])
const KEY_FOLLOWERS = new Set([':', '(', ',', '}'])

const PAREN_DEPTH: Record<string, number> = { '(': 1, ')': -1 }

/** Tokens that may start an arrow function (§4.2.3). */
const ARROW_STARTS: Record<string, (filter: TokenFilter, token: Token) => void> = {
  'IDENT': (filter, token) => filter.classifyIdent(token),
  '(': (filter, token) => filter.classifyParen(token),
}

/** Keywords whose `( … )` is followed by a statement, so their `)` does not end one. */
const HEADER_KEYWORDS = new Set(['IF', 'WHILE', 'FOR', 'CATCH', 'SWITCH'])

/** After the body of a `do`, its `while` follows the end of a statement. */
const DO_BODY_ENDERS = new Set([';', '}'])

// Inside `${ … }` (between TEMPLATE_HEAD and TEMPLATE_TAIL) there is no ASI (§4.2.6).
const OPENERS: Record<string, Bracket> = { '(': '(', 'ARROW_LPAREN': '(', '[': '[', 'TEMPLATE_HEAD': '{template}' }
const CLOSERS = new Set([')', ']', '}', 'TEMPLATE_TAIL'])

const TEMPLATE_STARTS = new Set(['TEMPLATE_FULL', 'TEMPLATE_HEAD'])

/** ENDERS that end a statement rather than an expression, so they cannot be a template's tag. */
const STATEMENT_ENDERS = new Set(['RETURN', 'BREAK', 'CONTINUE', 'YIELD'])

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
  '}': filter => BLOCK_LIKE.has(filter.top()),
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
  /** the token being classified by read() */
  private current: Token | null = null
  /** raw tokens read ahead (arrow detection), not yet seen by the parser */
  private lookahead: Token[] = []
  /** bracket depth of a function declaration whose body brace is still to come, or -1 */
  private declarationDepth = -1
  /** bracket depth of a class whose body brace is still to come, or -1; and whether it is a declaration */
  private classDepth = -1
  private classIsStatement = false
  /** inside an `import` / `export … from` clause, where `as` and `from` are keywords (§4.2.5) */
  private moduleClause = false
  /** bracket depths of the `do` statements whose `while` is still to come, innermost last */
  private doDepths: number[] = []
  /** bracket depth of a `case` / `default` whose `:` is still to come, or -1; and the open `?` of its expression */
  private caseDepth = -1
  private caseTernaries = 0

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
    this.declarationDepth = -1
    this.classDepth = -1
    this.moduleClause = false
    this.doDepths = []
    this.caseDepth = -1

    return this
  }

  lex(): string {
    const token = this.pending ?? this.read()

    this.pending = null
    this.checkTagged(token)

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

    this.current = token

    if (token.name === 'RESERVED') this.state.fail(`Unexpected reserved word '${token.text}'`, token.loc)
    this.contextualKeyword(token)
    this.keywordAsName(token)
    ARROW_STARTS[token.name]?.(this, token)

    return token
  }

  // `` tag`x` `` (an expression directly followed by a template on the same line) is not PScript (D34).
  private checkTagged(token: Token) {
    if (TEMPLATE_STARTS.has(token.name) && !token.afterNewline && this.prevIsTag()) {
      this.state.fail('tagged templates are not supported; call a function with a template instead: tag(`x`)', token.loc)
    }
  }

  private prevIsTag(): boolean {
    return this.prevEnds() && !STATEMENT_ENDERS.has(this.prev?.name ?? '')
  }

  // `final class …`; `final` / `override` before another modifier or a member name (§4.2.5).
  private contextualKeyword(token: Token) {
    const keyword = token.name === 'IDENT' ? this.contextualName(token.text) : undefined

    if (keyword) token.name = keyword
  }

  // `final` / `override` as modifiers, `get` / `set` as accessor keywords, `as` / `from` in module clauses (§4.2.5).
  private contextualName(text: string): string | undefined {
    if (this.isModuleKeyword(text)) return MODULE_KEYWORDS[text]

    const modifier = CONTEXTUAL_MODIFIERS[text]

    return modifier ? this.asModifier(modifier) : this.asAccessorKeyword(ACCESSOR_KEYWORDS[text])
  }

  // `as` in a module clause; `from` there too, but not inside `{ … }` (`export { from }`).
  private isModuleKeyword(text: string): boolean {
    if (!this.moduleClause) return false

    return text === 'as' || (text === 'from' && this.top() !== '{specifiers}')
  }

  private asModifier(modifier: string): string | undefined {
    return this.isModifier(modifier, this.peek(0)) ? modifier : undefined
  }

  private asAccessorKeyword(keyword: string | undefined): string | undefined {
    return keyword && this.isAccessorKeyword(this.peek(0)) ? keyword : undefined
  }

  // `get x() {}` / `set x(v) {}` in a class body or an object literal (also `get [k]() {}` there, D48); `get() {}`,
  // `{ get: 1 }` stay names.
  private isAccessorKeyword(next: Token): boolean {
    return this.inAccessorPosition() && !next.afterNewline && this.isAccessorName(next)
  }

  private isAccessorName(next: Token): boolean {
    return isName(next.name) || (next.name === '[' && this.top() === '{object}')
  }

  private inAccessorPosition(): boolean {
    return this.inMemberPosition() || (this.top() === '{object}' && this.afterKeyPreceder())
  }

  private isModifier(keyword: string, next: Token): boolean {
    if (keyword === 'FINAL' && next.name === 'CLASS') return true

    return this.inMemberPosition() && this.startsMember(next)
  }

  private startsMember(next: Token): boolean {
    return !next.afterNewline && (MODIFIERS.has(next.name) || isName(next.name))
  }

  // In a class body, a member starts after `{`, `;`, `}` or a modifier — or on a new line after something that
  // ends a member (the `;` the filter is about to insert has not been emitted yet when the token is classified).
  private inMemberPosition(): boolean {
    return CLASS_BODIES.has(this.top()) && (this.afterMemberPreceder() || this.startsLine())
  }

  private afterMemberPreceder(): boolean {
    return MEMBER_PRECEDERS.has(this.prev?.name ?? '')
  }

  private startsLine(): boolean {
    return Boolean(this.current?.afterNewline) && this.prevEnds()
  }

  // A keyword in member position followed by `(`, `=`, `;`, `}` or a newline is a member name (§4.2.4).
  private memberName(): boolean {
    const next = this.peek(0)

    return this.inMemberPosition() && (next.afterNewline || MEMBER_NAME_FOLLOWERS.has(next.name))
  }

  // Keywords are property names after `.` / `?.` and as object-literal keys (§4.2.4).
  private keywordAsName(token: Token) {
    if (KEYWORD_TOKENS.has(token.name) && this.inNamePosition()) token.name = 'IDENT'
  }

  private inNamePosition(): boolean {
    return this.afterMemberDot() || this.inKeyPosition() || this.inMethodNamePosition()
  }

  private afterMemberDot(): boolean {
    return MEMBER_DOTS.has(this.prev?.name as string)
  }

  private inMethodNamePosition(): boolean {
    return this.memberName() || this.generatorMethodName()
  }

  // `*of() {}`, `async delete() {}`: a keyword after a member-start `*` / `async` and before `(` is the method's name.
  private generatorMethodName(): boolean {
    return Boolean(this.prev?.startsMethod) && this.peek(0).name === '('
  }

  markMethodStart(token: Token) {
    token.startsMethod = this.inMemberPosition() || (this.top() === '{object}' && this.afterKeyPreceder())
  }

  // `async function` at the start of a statement is a declaration; async generators are not supported (D43).
  asyncStart(token: Token) {
    const next = this.peek(0)

    if (next.afterNewline) this.state.fail("Line terminator not permitted after 'async'", next.loc)
    if (this.startsAsyncGenerator(next)) this.state.fail('async generators are not supported', token.loc)
    token.startsStatement = this.atStatementStart()
    this.markMethodStart(token)
  }

  private startsAsyncGenerator(next: Token): boolean {
    return next.name === '*' || (next.name === 'FUNCTION' && this.peek(1).name === '*')
  }

  private inKeyPosition(): boolean {
    return this.top() === '{object}' && this.afterKeyPreceder() && KEY_FOLLOWERS.has(this.peek(0).name)
  }

  private afterKeyPreceder(): boolean {
    return KEY_PRECEDERS.has(this.prev?.name ?? '')
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
    return this.prevEnds() && (this.endsDoWhile(token) || this.insertsBefore(token))
  }

  // `do … while (c) x()`: the `do` statement ends after its `)`, on the same line too (as in JS).
  private endsDoWhile(token: Token): boolean {
    return Boolean(this.prev?.closesDoWhile) && token.name !== ';'
  }

  private prevEnds(): boolean {
    const { prev } = this

    return prev !== null && ENDERS.has(prev.name) && !prev.closesHeader && !prev.closesStatement
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

    return top === undefined || BLOCK_LIKE.has(top)
  }

  private virtualSemicolon(before: Token): Token {
    const loc = endOf((this.prev as Token).loc)

    return { name: ';', text: '', loc, lineno: before.lineno, afterNewline: false }
  }

  private emit(token: Token): string {
    EMIT_HOOKS[token.name]?.(this, token)
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

  // A statement may start here: beginning of input, after `;`, a block brace, `}`, a control-flow header,
  // `else`, `try` or `finally`.
  private atStatementStart(): boolean {
    const { prev } = this

    return prev === null || STATEMENT_BRACE_PRECEDERS.has(prev.name) || Boolean(prev.closesHeader || prev.endsCase)
  }

  caseStart() {
    this.caseDepth = this.brackets.length
    this.caseTernaries = 0
  }

  // `case a ? b : c:` — the clause's `:` is the first one at its depth that does not close a `?`.
  caseTernary() {
    if (this.caseDepth === this.brackets.length) this.caseTernaries++
  }

  caseColon(token: Token) {
    if (this.caseDepth !== this.brackets.length) return
    if (this.caseTernaries > 0) {
      this.caseTernaries--

      return
    }
    token.endsCase = true
    this.caseDepth = -1
  }

  functionStart(token: Token) {
    if (this.atStatementStart() || this.afterStatementAsync()) this.declarationStart(token)
  }

  private afterStatementAsync(): boolean {
    return this.prev?.name === 'ASYNC' && Boolean(this.prev.startsStatement)
  }

  doStart() {
    this.doDepths.push(this.brackets.length)
  }

  // The `while` of a `do` comes at the `do`'s depth, after the body statement has ended (`do while (a) b(); while (c)`).
  whileStart(token: Token) {
    if (!this.endsDoBody()) return
    this.doDepths.pop()
    token.endsDo = true
  }

  private endsDoBody(): boolean {
    return this.doDepths.at(-1) === this.brackets.length && DO_BODY_ENDERS.has(this.prev?.name ?? '')
  }

  finalStart(token: Token) {
    token.startsStatement = this.atStatementStart()
  }

  // `class` (or `final class`) at the start of a statement is a declaration; its body brace comes at this depth.
  classStart(token: Token) {
    this.classIsStatement = this.atStatementStart() || Boolean(this.prev?.startsStatement)

    if (this.classIsStatement) token.name = 'CLASS_DECLARATION'
    this.classDepth = this.brackets.length
  }

  // `import …` / `export { … }`: the clause runs to its module specifier or `;`. `export <declaration>` is not a
  // clause (its names stay ordinary). Unsupported forms fail here with a hint (§4.7.1).
  moduleStart(kind: 'import' | 'export') {
    const next = this.peek(0)
    const unsupported = kind === 'import' ? UNSUPPORTED_IMPORTS[next.name] : UNSUPPORTED_EXPORTS[next.text]

    if (unsupported) this.state.fail(unsupported, next.loc)
    this.moduleClause = kind === 'import' || next.name === '{'
  }

  moduleEnd() {
    if (this.top() !== '{specifiers}') this.moduleClause = false
  }

  // An interface body is parsed like a class body (member positions, ASI); interfaces are always declarations.
  interfaceStart() {
    this.classIsStatement = true
    this.classDepth = this.brackets.length
  }

  private declarationStart(token: Token) {
    token.name = 'FUNCTION_DECLARATION'
    this.declarationDepth = this.brackets.length
  }

  // Brace classification (§4.2.2): BLOCK_LBRACE or OBJ_LBRACE, with the matching stack entry.
  classifyBrace(token: Token) {
    const kind = this.opensSpecifiers() ? '{specifiers}' : this.braceKind()

    token.name = BRACE_TOKENS[kind] ?? 'BLOCK_LBRACE'
    this.brackets.push(kind)
  }

  private opensSpecifiers(): boolean {
    return SPECIFIER_BRACE_PRECEDERS.has(this.prev?.name ?? '')
  }

  private braceKind(): Bracket {
    if (this.classDepth === this.brackets.length) return this.classBody()
    if (this.declarationDepth === this.brackets.length) {
      this.declarationDepth = -1

      return '{statement}'
    }

    return this.atStatementStart() ? '{statement}' : this.bodyOrObject()
  }

  private classBody(): Bracket {
    this.classDepth = -1

    return this.classIsStatement ? '{class-statement}' : '{class}'
  }

  private bodyOrObject(): Bracket {
    return BODY_BRACE_PRECEDERS.has(this.prev?.name ?? '') ? '{block}' : '{object}'
  }

  private track(token: Token) {
    if (token.name in OPENERS) this.brackets.push(this.opener(token.name))
    else if (CLOSERS.has(token.name)) this.close(token, this.brackets.pop())
  }

  private close(token: Token, bracket: Bracket | undefined) {
    token.closesHeader = bracket === '(header)'
    token.closesDoWhile = bracket === '(do-while)'
    token.closesBlock = BLOCK_LIKE.has(bracket)
    token.closesStatement = STATEMENT_BRACKETS.has(bracket)
  }

  private opener(name: string): Bracket {
    return name === '(' ? this.parenKind() : OPENERS[name]
  }

  private parenKind(): Bracket {
    if (this.prev?.endsDo) return '(do-while)'

    return this.afterHeaderKeyword() ? '(header)' : '('
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

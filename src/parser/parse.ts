// parse(source, options) → Program (§5.3). A fresh parser and `yy` per call (§3.4).
import pscriptParser from '@/grammar/pscript.jison'
import type { JisonParseErrorHash } from '@/grammar/jison-types'
import { PScriptSyntaxError, formatExcerpt } from '@/errors'
import type {
  AssignmentOperator,
  BlockStatement,
  Expression,
  ForOfStatement,
  Identifier,
  MemberExpression,
  Pattern,
  Program,
  SourceLocation,
  Statement,
  VariableDeclarator,
} from './ast'
import { builders, sourceLoc, type ForHeader, type FunctionHead, type FunctionType, type JisonLoc } from './ast-builders'
import { EscapeError, checkNumber } from './literals'
import { TemplateBraces, templateElement } from './templates'
import { createTokenFilter, type TokenState } from './token-filter'
import { FUTURE_RESERVED_WORDS, KEYWORDS } from './tokens'

/**
 * Options of `parse()`.
 */
export interface ParseOptions {
  /** file name used in error messages */
  fileName?: string
  /** `script` (default) or `module` (D20) */
  goal?: 'script' | 'module'
}

const KEYWORD_SET = new Set<string>(KEYWORDS)
const FUTURE_RESERVED_SET = new Set<string>(FUTURE_RESERVED_WORDS)

const TOKEN_NAMES: Record<string, string> = {
  EOF: 'end of input',
  NUMBER: 'number',
  STRING: 'string',
  IDENT: 'identifier',
  ARROW_IDENT: 'identifier',
  BLOCK_LBRACE: "'{'",
  OBJ_LBRACE: "'{'",
  ARROW_LPAREN: "'('",
  FUNCTION_DECLARATION: "'function'",
  TEMPLATE_FULL: 'template',
  TEMPLATE_HEAD: 'template',
  TEMPLATE_MIDDLE: 'template',
  TEMPLATE_TAIL: 'template',
}

function describeExpected(token: string): string {
  const name = token.replace(/^'(?<name>.*)'$/, '$<name>')

  return TOKEN_NAMES[name] ?? `'${KEYWORD_SET.has(name.toLowerCase()) ? name.toLowerCase() : name}'`
}

function describeUnexpected(hash: JisonParseErrorHash): string {
  const token = hash.token ?? 'EOF'
  if (token === 'EOF') return 'end of input'
  if (token in TOKEN_NAMES) return `${TOKEN_NAMES[token]} ${hash.text}`

  return `token '${hash.text}'`
}

function parseErrorMessage(hash: JisonParseErrorHash): string {
  const expected = (hash.expected ?? []).map(describeExpected)
  const list = expected.length > 0 && expected.length <= 6 ? `; expected ${expected.join(', ')}` : ''

  return `Unexpected ${describeUnexpected(hash)}${list}`
}

class SyntaxErrorFactory {
  constructor(private source: string, private fileName?: string) {}

  at(reason: string, { start: { line, column } }: SourceLocation): PScriptSyntaxError {
    const excerpt = formatExcerpt(this.source, line, column)

    return new PScriptSyntaxError(reason, { fileName: this.fileName, line, column, excerpt })
  }

  atToken(reason: string, loc: JisonLoc, offset = 0): PScriptSyntaxError {
    const position = { line: loc.first_line, column: loc.first_column + 1 + offset }

    return this.at(reason, { start: position, end: position })
  }
}

const LINE_HELPERS = {
  // Jison counts only \r and \n as line breaks; U+2028 / U+2029 are line terminators too (§4.1.1).
  lineSeparator(lexer: { yylineno: number, yylloc: JisonLoc }): string {
    lexer.yylineno++
    lexer.yylloc.last_line = lexer.yylineno + 1
    lexer.yylloc.last_column = 0

    return 'NEWLINE'
  },
  blockComment(text: string): string | undefined {
    return /[\n\r\u2028\u2029]/.test(text) ? 'NEWLINE' : undefined
  },
}

function lexerHelpers(errors: SyntaxErrorFactory, tokens: TokenState) {
  return {
    identToken(text: string, loc: JisonLoc): string {
      if (KEYWORD_SET.has(text)) return text.toUpperCase()
      if (FUTURE_RESERVED_SET.has(text)) throw errors.atToken(`Unexpected reserved word '${text}'`, loc)

      return 'IDENT'
    },
    numberToken(text: string, loc: JisonLoc, rest: string): string {
      const problem = checkNumber(text, rest)
      if (problem) throw errors.atToken(problem, loc)

      return 'NUMBER'
    },
    lexError(reason: string, loc: JisonLoc): never {
      throw errors.atToken(reason, loc)
    },
    parseError(_: string, hash: JisonParseErrorHash): never {
      throw errors.atToken(parseErrorMessage(hash), tokens.current ?? hash.loc)
    },
  }
}

// Assignment and update targets: identifiers and member expressions.
const TARGET_TYPES = new Set(['Identifier', 'MemberExpression'])

function checkTarget(errors: SyntaxErrorFactory, target: Expression, what: string): Identifier | MemberExpression {
  if (target.type === 'Identifier' && target.name === 'undefined') throw errors.at("Cannot assign to 'undefined'", target.loc)
  if (!TARGET_TYPES.has(target.type)) throw errors.at(`Invalid ${what} target`, target.loc)

  return target as Identifier | MemberExpression
}

// `if (x) let y = 1` is not allowed (as in JS strict mode): a declaration needs a block.
const SINGLE_STATEMENT_ERRORS: Partial<Record<Statement['type'], string>> = {
  VariableDeclaration: 'Lexical declaration cannot appear in a single-statement context',
  FunctionDeclaration: 'Functions can only be declared at top level or inside a block',
}

function checkBody(errors: SyntaxErrorFactory, body: Statement): Statement {
  const problem = SINGLE_STATEMENT_ERRORS[body.type]
  if (problem) throw errors.at(problem, body.loc)

  return body
}

// Bodies of if/while/for, checked by checkBody.
function controlFlowBuilders(errors: SyntaxErrorFactory) {
  return {
    ifStatement(test: Expression, consequent: Statement, alternate: Statement | null, loc: JisonLoc) {
      return builders.ifStatement(test, checkBody(errors, consequent), alternate && checkBody(errors, alternate), loc)
    },
    whileStatement(test: Expression, body: Statement, loc: JisonLoc) {
      return builders.whileStatement(test, checkBody(errors, body), loc)
    },
    forStatement(header: ForHeader, body: Statement, loc: JisonLoc) {
      return builders.forStatement(header, checkBody(errors, body), loc)
    },
    forOfStatement(left: ForOfStatement['left'], right: Expression, body: Statement, loc: JisonLoc) {
      return builders.forOfStatement(left, right, checkBody(errors, body), loc)
    },
  }
}

function paramName(param: Pattern): Identifier {
  if (param.type === 'Identifier') return param

  return param.type === 'AssignmentPattern' ? param.left : param.argument
}

const PARAMETER_ORDER = { Identifier: 0, AssignmentPattern: 1, RestElement: 2 }

function checkParamOrder(errors: SyntaxErrorFactory, param: Pattern, next: Pattern) {
  if (param.type === 'RestElement') throw errors.at('A rest parameter must be last', next.loc)
  if (PARAMETER_ORDER[next.type] < PARAMETER_ORDER[param.type]) {
    throw errors.at(`Required parameter '${paramName(next).name}' cannot follow an optional parameter`, next.loc)
  }
}

// Parameter lists (D38): required, then optional, then at most one rest; no duplicates.
function checkParams(errors: SyntaxErrorFactory, params: Pattern[]): Pattern[] {
  const seen = new Set<string>()

  params.forEach((param, i) => {
    const { name, loc } = paramName(param)
    if (seen.has(name)) throw errors.at(`Duplicate parameter name '${name}'`, loc)
    seen.add(name)

    if (i + 1 < params.length) checkParamOrder(errors, param, params[i + 1])
  })

  return params
}

// Object-literal parts that need checks: shorthand names must be usable as variables; methods have checked parameters.
function objectBuilders(errors: SyntaxErrorFactory) {
  return {
    shorthandProperty(id: Identifier, loc: JisonLoc) {
      if (KEYWORD_SET.has(id.name)) throw errors.at(`Unexpected keyword '${id.name}' in shorthand property`, id.loc)

      return { ...builders.property(id, id, false, loc), shorthand: true }
    },
    method({ params, body }: { params: Pattern[], body: BlockStatement }, loc: JisonLoc) {
      return builders.functionNode('FunctionExpression', { id: null, params: checkParams(errors, params) }, body, loc)
    },
  }
}

// Static checks that the grammar leaves to its actions.
function checkedBuilders(errors: SyntaxErrorFactory) {
  return {
    assignment(operator: AssignmentOperator, left: Expression, right: Expression, loc: JisonLoc) {
      return builders.assignment(operator, checkTarget(errors, left, 'assignment'), right, loc)
    },
    update(operator: '++' | '--', prefix: boolean, argument: Expression, loc: JisonLoc) {
      return builders.update(operator, prefix, checkTarget(errors, argument, `'${operator}'`), loc)
    },
    arrow(params: Pattern[], body: BlockStatement | Expression, loc: JisonLoc) {
      return builders.arrow(checkParams(errors, params), body, loc)
    },
    functionNode(type: FunctionType, { id, params }: FunctionHead, body: BlockStatement, loc: JisonLoc) {
      return builders.functionNode(type, { id, params: checkParams(errors, params) }, body, loc)
    },
    variableDeclaration(kind: 'let' | 'const', declarations: VariableDeclarator[], loc: JisonLoc) {
      const missing = kind === 'const' ? declarations.find(d => d.init === null) : undefined
      if (missing) throw errors.at(`Missing initializer in const declaration '${missing.id.name}'`, missing.loc)

      return builders.variableDeclaration(kind, declarations, loc)
    },
  }
}

// Template literals (§4.1.8): lexer hooks around a per-parse brace stack, and the AST builders.
function templateHelpers(errors: SyntaxErrorFactory) {
  const braces = new TemplateBraces()

  return {
    openBrace: () => braces.openBrace(),
    closeBrace: () => braces.closeBrace(),
    templateStart: (text: string) => braces.start(text),
    templateContinue: (lexer: Parameters<TemplateBraces['continue']>[0]) => braces.continue(lexer),
    quasi(token: string, loc: JisonLoc, tail: boolean) {
      try {
        return templateElement(token, loc, tail)
      } catch (e) {
        if (e instanceof EscapeError) throw errors.atToken(e.message, loc, e.offset)
        throw e
      }
    },
  }
}

function createYy(source: string, options: ParseOptions, tokens: TokenState) {
  const errors = new SyntaxErrorFactory(source, options.fileName)

  return {
    ...templateHelpers(errors),
    ...builders,
    ...lexerHelpers(errors, tokens),
    ...LINE_HELPERS,
    ...checkedBuilders(errors),
    ...controlFlowBuilders(errors),
    ...objectBuilders(errors),
    program(body: Statement[]): Program {
      return { type: 'Program', sourceType: options.goal ?? 'script', body, loc: sourceLoc(source) }
    },
    stringLiteral(raw: string, loc: JisonLoc) {
      try {
        return builders.stringLiteral(raw, loc)
      } catch (e) {
        if (e instanceof EscapeError) throw errors.atToken(e.message, loc, e.offset)
        throw e
      }
    },
  }
}

function createParser(source: string, options: ParseOptions) {
  const parser = new pscriptParser.Parser()
  const errors = new SyntaxErrorFactory(source, options.fileName)
  const tokens: TokenState = { current: null, fail: (reason, loc) => { throw errors.atToken(reason, loc) } }

  parser.yy = createYy(source, options, tokens)
  parser.lexer = createTokenFilter(pscriptParser, tokens)

  return parser
}

/**
 * Runs the lexer and the token filter only (for tests and debugging).
 *
 * @param source source text
 * @returns the token names the parser would see, ending with `EOF`
 */
export function tokenize(source: string): string[] {
  const { lexer, yy } = createParser(source, {})
  const names: string[] = []

  lexer.setInput(source, yy)

  for (let name = ''; name !== 'EOF';) names.push(name = String(lexer.lex()))

  return names
}

/**
 * Parses PScript source into an ESTree-compatible AST.
 *
 * @param source source text
 * @param options file name and goal
 * @returns the program
 * @throws {PScriptSyntaxError} on any lexical or syntax error
 */
export function parse(source: string, options: ParseOptions = {}): Program {
  return createParser(source, options).parse(source)
}

// parse(source, options) → Program (§5.3). A fresh parser and `yy` per call (§3.4).
import pscriptParser from '@/grammar/pscript.jison'
import type { JisonParseErrorHash } from '@/grammar/jison-types'
import { PScriptSyntaxError, formatExcerpt } from '@/errors'
import type { AssignmentOperator, Expression, Program, SourceLocation, Statement, VariableDeclarator } from './ast'
import { builders, sourceLoc, type JisonLoc } from './ast-builders'
import { EscapeError, checkNumber } from './literals'
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

// Static checks that the grammar leaves to its actions.
function checkedBuilders(errors: SyntaxErrorFactory) {
  return {
    assignment(operator: AssignmentOperator, left: Expression, right: Expression, loc: JisonLoc) {
      if (left.type === 'Identifier' && left.name === 'undefined') throw errors.at("Cannot assign to 'undefined'", left.loc)
      if (left.type !== 'Identifier') throw errors.at('Invalid assignment target', left.loc)

      return builders.assignment(operator, left, right, loc)
    },
    variableDeclaration(kind: 'let' | 'const', declarations: VariableDeclarator[], loc: JisonLoc) {
      const missing = kind === 'const' ? declarations.find(d => d.init === null) : undefined
      if (missing) throw errors.at(`Missing initializer in const declaration '${missing.id.name}'`, missing.loc)

      return builders.variableDeclaration(kind, declarations, loc)
    },
  }
}

function createYy(source: string, options: ParseOptions, tokens: TokenState) {
  const errors = new SyntaxErrorFactory(source, options.fileName)

  return {
    ...builders,
    ...lexerHelpers(errors, tokens),
    ...LINE_HELPERS,
    ...checkedBuilders(errors),
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
  const tokens: TokenState = { current: null }

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

// parse(source, options) → Program (§5.3). A fresh parser and `yy` per call (§3.4).
import pscriptParser from '@/grammar/pscript.jison'
import type { JisonParseErrorHash } from '@/grammar/jison-types'
import { PScriptSyntaxError, formatExcerpt } from '@/errors'
import type { Program, Statement } from './ast'
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

  at(reason: string, line: number, column: number): PScriptSyntaxError {
    const excerpt = formatExcerpt(this.source, line, column)

    return new PScriptSyntaxError(reason, { fileName: this.fileName, line, column, excerpt })
  }

  atToken(reason: string, loc: JisonLoc, offset = 0): PScriptSyntaxError {
    return this.at(reason, loc.first_line, loc.first_column + 1 + offset)
  }
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

function createYy(source: string, options: ParseOptions, tokens: TokenState) {
  const errors = new SyntaxErrorFactory(source, options.fileName)

  return {
    ...builders,
    ...lexerHelpers(errors, tokens),
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

/**
 * Parses PScript source into an ESTree-compatible AST.
 *
 * @param source source text
 * @param options file name and goal
 * @returns the program
 * @throws {PScriptSyntaxError} on any lexical or syntax error
 */
export function parse(source: string, options: ParseOptions = {}): Program {
  const parser = new pscriptParser.Parser()
  const tokens: TokenState = { current: null }

  parser.yy = createYy(source, options, tokens)
  parser.lexer = createTokenFilter(pscriptParser.lexer, tokens)

  return parser.parse(source)
}

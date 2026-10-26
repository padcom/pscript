// Token contract (§4.1.2). Punctuator and literal tokens (§4.1.4–4.1.6) and the
// token filter's ENDERS / CONTINUERS sets (§4.2.1) are added with the milestones that need them.

/** Reserved keywords; each lexes to the token named by its upper-case spelling. */
export const KEYWORDS = [
  'let',
  'const',
  'function',
  'return',
  'if',
  'else',
  'for',
  'of',
  'while',
  'break',
  'continue',
  'class',
  'extends',
  'new',
  'this',
  'super',
  'true',
  'false',
  'null',
  'undefined',
  'typeof',
  'instanceof',
  'in',
  'throw',
  'try',
  'catch',
  'finally',
  'static',
  'import',
  'export',
  'public',
  'protected',
  'private',
  'interface',
  'implements',
] as const

export type Keyword = typeof KEYWORDS[number]

/** Contextual keywords: ordinary identifiers, turned into keyword tokens by the token filter (§4.2.5). */
export const CONTEXTUAL_KEYWORDS = ['get', 'set', 'as', 'override', 'final', 'from'] as const

export type ContextualKeyword = typeof CONTEXTUAL_KEYWORDS[number]

/** Words reserved for the future: always a `SyntaxError` as an identifier. */
export const FUTURE_RESERVED_WORDS = [
  'var',
  'switch',
  'case',
  'default',
  'do',
  'async',
  'await',
  'yield',
  'delete',
  'void',
  'enum',
  'package',
  'abstract',
] as const

export type FutureReservedWord = typeof FUTURE_RESERVED_WORDS[number]

export type KeywordToken = Uppercase<Keyword>

export type ContextualKeywordToken = Uppercase<ContextualKeyword>

/** Token names produced by the lexer and the token filter. */
export type TokenName = 'IDENT' | KeywordToken | ContextualKeywordToken

/** Identifier syntax: `$` is an ordinary identifier character (D30). */
export const IDENT_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

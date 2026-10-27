// Token contract (§4.1.2, §4.2.1). Punctuators are named by their own text (`'+'`, `'('`, …).

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
  'do',
  'switch',
  'case',
  'default',
  'delete',
  'void',
  'yield',
] as const

export type Keyword = typeof KEYWORDS[number]

/** Contextual keywords: ordinary identifiers, turned into keyword tokens by the token filter (§4.2.5). */
export const CONTEXTUAL_KEYWORDS = ['get', 'set', 'as', 'override', 'final', 'from'] as const

export type ContextualKeyword = typeof CONTEXTUAL_KEYWORDS[number]

/** Words reserved for the future: always a `SyntaxError` as an identifier. */
export const FUTURE_RESERVED_WORDS = [
  'var',
  'async',
  'await',
  'enum',
  'package',
  'abstract',
] as const

export type FutureReservedWord = typeof FUTURE_RESERVED_WORDS[number]

export type KeywordToken = Uppercase<Keyword>

export type ContextualKeywordToken = Uppercase<ContextualKeyword>

/** Token names produced by the lexer and the token filter (punctuators use their text). */
export type TokenName = 'IDENT' | 'NUMBER' | 'STRING' | 'NEWLINE' | 'EOF' | KeywordToken | ContextualKeywordToken | (string & {})

/** Tokens that may end a statement (§4.2.1). */
export const ENDERS: ReadonlySet<TokenName> = new Set([
  'IDENT',
  'NUMBER',
  'STRING',
  'TEMPLATE_FULL',
  'TEMPLATE_TAIL',
  'TRUE',
  'FALSE',
  'NULL',
  'UNDEFINED',
  'THIS',
  'SUPER',
  ')',
  ']',
  '}',
  '++',
  '--',
  'RETURN',
  'BREAK',
  'CONTINUE',
  'YIELD',
])

/**
 * Tokens that may not start a statement, so a line starting with one continues the previous line (§4.2.1).
 * `(` and `[` are deliberately absent (D2), and so are `++`, `--` and `!`.
 */
export const CONTINUERS: ReadonlySet<TokenName> = new Set([
  '.',
  '?.',
  ',',
  '?',
  ':',
  '=>',
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '**=',
  '&&=',
  '||=',
  '??=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  '&&',
  '||',
  '??',
  'INSTANCEOF',
  'IN',
  'OF',
  'EXTENDS',
  'IMPLEMENTS',
  'ELSE',
  'CATCH',
  'FINALLY',
  ')',
  ']',
  '}',
  ';',
])

/** Identifier syntax: `$` is an ordinary identifier character (D30). */
export const IDENT_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

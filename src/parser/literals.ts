// Cooking of literal token text (§4.1.4, §4.1.5).

/**
 * Thrown for a malformed escape; `offset` is relative to the start of the token.
 */
export class EscapeError extends Error {
  constructor(message: string, public offset: number) {
    super(message)
  }
}

/** Decodes the escape whose first character (after the backslash) is at `i`; returns text and next index. */
type EscapeHandler = (raw: string, i: number) => [string, number]

const HEX = /^[0-9A-Fa-f]+$/
const DIGIT = /^[0-9]$/

function hexValue(raw: string, start: number, length: number): number {
  const digits = raw.slice(start, start + length)
  if (digits.length !== length || !HEX.test(digits)) {
    throw new EscapeError('Invalid hexadecimal escape sequence', start - 2)
  }

  return parseInt(digits, 16)
}

function codePointValue(raw: string, i: number): number {
  const end = raw.indexOf('}', i)
  const digits = end < 0 ? '' : raw.slice(i + 1, end)
  const code = HEX.test(digits) ? parseInt(digits, 16) : NaN
  if (!(code <= 0x10FFFF)) throw new EscapeError('Invalid Unicode escape sequence', i - 2)

  return code
}

const simple = (text: string): EscapeHandler => (_, i) => [text, i + 1]

const lineContinuation: EscapeHandler = (_, i) => ['', i + 1]

const ESCAPES: Record<string, EscapeHandler> = {
  'n': simple('\n'),
  'r': simple('\r'),
  't': simple('\t'),
  'b': simple('\b'),
  'f': simple('\f'),
  'v': simple('\v'),
  '\n': lineContinuation,
  '\u2028': lineContinuation,
  '\u2029': lineContinuation,
  '\r': (raw, i) => ['', raw[i + 1] === '\n' ? i + 2 : i + 1],
  'x': (raw, i) => [String.fromCharCode(hexValue(raw, i + 1, 2)), i + 3],
  'u': (raw, i) => raw[i + 1] === '{'
    ? [String.fromCodePoint(codePointValue(raw, i + 1)), raw.indexOf('}', i) + 1]
    : [String.fromCharCode(hexValue(raw, i + 1, 4)), i + 5],
  '0': (raw, i) => {
    if (DIGIT.test(raw[i + 1] ?? '')) throw new EscapeError('Octal escape sequences are not allowed', i - 1)

    return ['\0', i + 1]
  },
}

const octal: EscapeHandler = (_, i) => {
  throw new EscapeError('Octal escape sequences are not allowed', i - 1)
}

const identity: EscapeHandler = (raw, i) => [raw[i], i + 1]

function escapeHandler(c: string): EscapeHandler {
  return ESCAPES[c] ?? (DIGIT.test(c) ? octal : identity)
}

/**
 * Decodes a quoted string token (quotes included) into its value.
 * An unknown escape such as `\q` yields the character itself.
 *
 * @param raw token text, including the quotes
 * @returns the string value
 * @throws {EscapeError} on a malformed escape
 */
export function cookString(raw: string): string {
  const end = raw.length - 1
  let result = ''
  let i = 1

  for (let backslash = raw.indexOf('\\', i); backslash >= 0 && backslash < end; backslash = raw.indexOf('\\', i)) {
    const [text, next] = escapeHandler(raw[backslash + 1])(raw, backslash + 1)

    result += raw.slice(i, backslash) + text
    i = next
  }

  return result + raw.slice(i, end)
}

/**
 * Checks a number token: no leading zeros, nothing identifier-like right after it.
 *
 * @param text token text
 * @param next the input right after the token
 * @returns the error message, or `null` when the token is valid
 */
export function checkNumber(text: string, next: string): string | null {
  if (/^0[0-9]/.test(text)) return 'Leading zeros are not allowed in numbers'
  if (/^[A-Za-z_$0-9]/.test(next)) return 'Identifier starts immediately after numeric literal'

  return null
}

/* eslint-disable no-template-curly-in-string -- the strings are PScript source containing template literals */
import { describe, expect, it } from 'vitest'
import type { ExpressionStatement, TemplateLiteral } from '@/parser/ast'
import { parse, tokenize } from '@/parser/parse'

function template(source: string): TemplateLiteral {
  return (parse(source).body[0] as ExpressionStatement).expression as TemplateLiteral
}

const ARROW_IN_TEMPLATE = ['TEMPLATE_HEAD IDENT ( ARROW_LPAREN ) => BLOCK_LBRACE', 'RETURN NUMBER ; } ) TEMPLATE_TAIL ; EOF']
  .join(' ').split(' ')

describe('template tokens (§4.1.8)', () => {
  it.each([
    ['`plain`', ['TEMPLATE_FULL', ';', 'EOF']],
    ['`a${x}b`', ['TEMPLATE_HEAD', 'IDENT', 'TEMPLATE_TAIL', ';', 'EOF']],
    ['`${x}${y}`', ['TEMPLATE_HEAD', 'IDENT', 'TEMPLATE_MIDDLE', 'IDENT', 'TEMPLATE_TAIL', ';', 'EOF']],
    ['`${ {a: 1}.a }`', ['TEMPLATE_HEAD', 'OBJ_LBRACE', 'IDENT', ':', 'NUMBER', '}', '.', 'IDENT', 'TEMPLATE_TAIL', ';', 'EOF']],
    ['`${f(() => { return 1 })}`', ARROW_IN_TEMPLATE],
    ['`${`${x}`}`', ['TEMPLATE_HEAD', 'TEMPLATE_HEAD', 'IDENT', 'TEMPLATE_TAIL', 'TEMPLATE_TAIL', ';', 'EOF']],
    ['{ a } `t`', ['BLOCK_LBRACE', 'IDENT', ';', '}', 'TEMPLATE_FULL', ';', 'EOF']],
    ['`cost: $5 and $ {`', ['TEMPLATE_FULL', ';', 'EOF']],
  ])('%s', (source, tokens) => {
    expect(tokenize(source)).toEqual(tokens)
  })

  it('does not insert semicolons inside an interpolation', () => {
    expect(tokenize('`${\n a\n +\n b\n}`')).toEqual(['TEMPLATE_HEAD', 'IDENT', '+', 'IDENT', 'TEMPLATE_TAIL', ';', 'EOF'])
  })

  it('starts a new statement when a template begins a line (D34)', () => {
    expect(tokenize('a\n`t`')).toEqual(['IDENT', ';', 'TEMPLATE_FULL', ';', 'EOF'])
  })
})

describe('tagged templates are rejected (D34)', () => {
  it.each(['tag`x`', 'f()`x`', 'a[0]`x`', '`a``b`'])('%s', source => {
    expect(() => parse(source)).toThrow('tagged templates are not supported')
  })

  it('allows return and other statement keywords before a template', () => {
    expect(() => parse('function f() { return `x` }')).not.toThrow()
  })
})

describe('template values', () => {
  it('keeps raw and cooked text', () => {
    expect(template('`a\\tb${x}\\u0041`')).toMatchObject({
      quasis: [{ value: { raw: 'a\\tb', cooked: 'a\tb' }, tail: false }, { value: { raw: '\\u0041', cooked: 'A' }, tail: true }],
      expressions: [{ name: 'x' }],
    })
  })

  it('normalises CRLF and CR to LF', () => {
    expect(template('`a\r\nb\rc`').quasis[0].value).toEqual({ raw: 'a\nb\nc', cooked: 'a\nb\nc' })
  })

  it('counts lines inside templates', () => {
    expect(parse('`a\nb\nc`\nx').body[1].loc.start.line).toBe(4)
  })

  it.each([
    ['`\\x4`', 'Invalid hexadecimal escape sequence'],
    ['`\\1`', 'Octal escape sequences are not allowed'],
    ['`open', 'Unterminated template literal'],
  ])('rejects %j', (source, reason) => {
    expect(() => parse(source)).toThrow(reason)
  })
})

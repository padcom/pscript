import { describe, expect, it } from 'vitest'
import { PScriptError, PScriptRuntimeError, PScriptSyntaxError, formatExcerpt } from '@/errors'

describe('errors', () => {
  it('formats a syntax error with location and excerpt', () => {
    const details = { fileName: 'a.pscript', line: 2, column: 5, excerpt: 'let = 1\n    ^' }
    const error = new PScriptSyntaxError('Unexpected token', details)

    expect(error).toBeInstanceOf(PScriptError)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('PScriptSyntaxError')
    expect(error.message).toBe('a.pscript:2:5 SyntaxError: Unexpected token\nlet = 1\n    ^')
    expect(error).toMatchObject({ reason: 'Unexpected token', fileName: 'a.pscript', line: 2, column: 5 })
  })

  it('omits the location when unknown', () => {
    expect(new PScriptSyntaxError('Oops').message).toBe('SyntaxError: Oops')
  })

  it('uses <script> when the file name is unknown', () => {
    expect(new PScriptSyntaxError('Oops', { line: 1, column: 3 }).message).toBe('<script>:1:3 SyntaxError: Oops')
  })
})

describe('runtime errors', () => {
  it('carries the script error name, value and stack of a runtime error', () => {
    const stack = [{ functionName: 'f', line: 3, column: 1 }]
    const value = { message: 'x is not a function' }
    const error = new PScriptRuntimeError('TypeError', 'x is not a function', value, { scriptStack: stack, line: 3 })

    expect(error).toBeInstanceOf(PScriptError)
    expect(error.name).toBe('PScriptRuntimeError')
    expect(error.message).toBe('<script>:3:1 TypeError: x is not a function')
    expect(error).toMatchObject({ scriptName: 'TypeError', line: 3, scriptStack: stack })
    expect(error.value).toEqual({ message: 'x is not a function' })
  })

  it('defaults to an empty script stack', () => {
    expect(new PScriptRuntimeError('Error', 'boom', 'boom').scriptStack).toEqual([])
  })
})

describe('formatExcerpt', () => {
  it('puts a caret under the column', () => {
    expect(formatExcerpt('a\n  b + c', 2, 3)).toBe('  b + c\n  ^')
  })

  it('returns undefined for a missing line', () => {
    expect(formatExcerpt('a', 3, 1)).toBeUndefined()
  })
})

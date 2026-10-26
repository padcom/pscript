import { describe, expect, it } from 'vitest'
import { PScriptError, PScriptRuntimeError, PScriptSyntaxError } from '@/errors'

describe('errors', () => {
  it('records the location of a syntax error', () => {
    const error = new PScriptSyntaxError('Unexpected token', { fileName: 'a.pscript', line: 2, column: 5 }, 'let = 1\n    ^')

    expect(error).toBeInstanceOf(PScriptError)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('PScriptSyntaxError')
    expect(error).toMatchObject({ message: 'Unexpected token', fileName: 'a.pscript', line: 2, column: 5 })
    expect(error.excerpt).toContain('^')
  })

  it('carries the script error name, value and stack of a runtime error', () => {
    const stack = [{ functionName: 'f', line: 3, column: 1 }]
    const value = { message: 'x is not a function' }
    const error = new PScriptRuntimeError('TypeError', 'x is not a function', value, { scriptStack: stack, line: 3 })

    expect(error).toBeInstanceOf(PScriptError)
    expect(error.name).toBe('PScriptRuntimeError')
    expect(error).toMatchObject({ scriptName: 'TypeError', line: 3, scriptStack: stack })
    expect(error.value).toEqual({ message: 'x is not a function' })
  })

  it('defaults to an empty script stack', () => {
    expect(new PScriptRuntimeError('Error', 'boom', 'boom').scriptStack).toEqual([])
  })
})

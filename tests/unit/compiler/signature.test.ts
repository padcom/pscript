import { describe, expect, it } from 'vitest'
import { arityError, signatureOf } from '@/compiler/signature'
import type { FunctionDeclaration } from '@/parser/ast'
import { parse } from '@/parser/parse'

function signature(source: string) {
  const fn = parse(source).body[0] as FunctionDeclaration

  return signatureOf(fn.id.name, fn.params)
}

describe('signatures (D38)', () => {
  it('describes the parameter list', () => {
    expect(signature('function greet(name, greeting = 1) {}'))
      .toEqual({ text: 'greet(name, greeting?)', required: 1, optional: 1, hasRest: false })
    expect(signature('function log(level, ...parts) {}')).toMatchObject({ text: 'log(level, ...parts)', hasRest: true })
    expect(signatureOf('', []).text).toBe('anonymous()')
  })

  it.each([
    ['function f() {}', 0, null],
    ['function f() {}', 1, 'f() expects 0 arguments, got 1'],
    ['function f(x) {}', 1, null],
    ['function f(x) {}', 2, 'f(x) expects 1 argument, got 2'],
    ['function f(a, b) {}', 1, 'f(a, b) expects 2 arguments, got 1'],
    ['function f(a, b = 1) {}', 2, null],
    ['function f(a, b = 1) {}', 0, 'f(a, b?) expects 1-2 arguments, got 0'],
    ['function f(a, b = 1) {}', 3, 'f(a, b?) expects 1-2 arguments, got 3'],
    ['function f(a, ...r) {}', 9, null],
    ['function f(a, ...r) {}', 0, 'f(a, ...r) expects at least 1 argument, got 0'],
    ['function f(a, b, ...r) {}', 1, 'f(a, b, ...r) expects at least 2 arguments, got 1'],
  ])('%s with %i arguments', (source, argc, message) => {
    expect(arityError(signature(source), argc)).toBe(message)
  })
})

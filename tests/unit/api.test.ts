import { describe, expect, it } from 'vitest'
import { Interpreter, PScriptSyntaxError, compile, disassemble, parse, run } from '@/index'

describe('public API', () => {
  it('run() returns the completion value', () => {
    expect(run('1 + 2 * 3')).toBe(7)
    expect(run("'a' + 1;")).toBe('a1')
    expect(run('')).toBeUndefined()
  })

  it('print writes its arguments separated by spaces', () => {
    const lines: string[] = []

    run("print('a', 1)", { stdout: text => lines.push(text) })
    expect(lines).toEqual(['a 1'])
  })

  it('print returns null (D37)', () => {
    expect(run('print()', { stdout: () => {} })).toBeNull()
  })
})

describe('public API output and errors', () => {
  it('defaults stdout to console.log', () => {
    const original = console.log
    const lines: unknown[] = []

    console.log = (text: unknown) => lines.push(text)

    try {
      run("print('hi')")
    } finally {
      console.log = original
    }
    expect(lines).toEqual(['hi'])
  })

  it('reports syntax errors with the file name', () => {
    expect(() => run('1 +', { fileName: 'a.pscript' })).toThrow(PScriptSyntaxError)
    expect(() => run('1 +', { fileName: 'a.pscript' })).toThrow('a.pscript:1:4 SyntaxError')
  })

  it('exposes parse, compile and disassemble', () => {
    expect(parse('1').type).toBe('Program')
    expect(disassemble(compile('1'))).toContain('HALT')
  })
})

describe('Interpreter', () => {
  it('accepts primitive globals and reads them back', () => {
    const interpreter = new Interpreter({ globals: { answer: 42, name: 'pscript' } })

    expect(interpreter.run("name + ' ' + answer")).toBe('pscript 42')
    expect(interpreter.get('answer')).toBe(42)
    expect(interpreter.get('missing')).toBeUndefined()
  })

  it('set() defines globals, also host objects', () => {
    const interpreter = new Interpreter()

    interpreter.set('x', 2)
    interpreter.set('o', { y: 3 })
    expect(interpreter.run('x ** o.y')).toBe(8)
  })

  it('execute() runs precompiled scripts repeatedly', () => {
    const interpreter = new Interpreter({ globals: { x: 1 } })
    const script = compile('x + 1')

    expect(interpreter.execute(script)).toBe(2)
    interpreter.set('x', 10)
    expect(interpreter.execute(script)).toBe(11)
  })
})

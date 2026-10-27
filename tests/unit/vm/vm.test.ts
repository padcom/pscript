import { describe, expect, it } from 'vitest'
import { compile } from '@/compiler/compiler'
import type { FunctionProto } from '@/compiler/function-proto'
import { Op } from '@/compiler/opcodes'
import { PScriptRuntimeError } from '@/errors'
import { createRealm } from '@/runtime/realm'
import { installStdlib } from '@/stdlib'
import { VM } from '@/vm/vm'

function vm() {
  const realm = createRealm()

  installStdlib(realm, { stdout: () => {} })

  return new VM(realm, { maxSteps: Infinity, maxCallDepth: 100 })
}

function proto(code: number[], constants: unknown[] = [], scopeSize = 0): FunctionProto {
  return {
    name: '', kind: 'script', paramCount: 0, length: 0, hasRest: false, scopeSize,
    code, constants, locations: [], usesThis: false, classDepth: 0,
  }
}

describe('vm', () => {
  it('returns the completion value', () => {
    expect(vm().execute(compile("2 ** 10; 'done'"))).toBe('done')
    expect(vm().execute(compile(''))).toBeUndefined()
  })

  it('executes hand-assembled code', () => {
    const code = [Op.CONST, 0, Op.DUP, Op.ADD, Op.TRUE, Op.POP, Op.HALT]

    expect(vm().execute({ main: proto(code, [21]) })).toBe(42)
  })

  it('throws ReferenceError on reading an uninitialised slot (TDZ)', () => {
    const code = [Op.LOAD, 0, 0, Op.HALT]

    const main = { ...proto(code, [], 1), names: { 0: 'x' } }

    expect(() => vm().execute({ main })).toThrow("ReferenceError: Cannot access 'x' before initialization")
  })

  it('throws ReferenceError on storing into an uninitialised slot', () => {
    const code = [Op.NULL, Op.STORE, 0, 0, Op.HALT]

    expect(() => vm().execute({ main: proto(code, [], 1) })).toThrow("Cannot access '<binding>' before initialization")
  })

  it('reports unimplemented opcodes', () => {
    const main = proto([9999 as Op, Op.HALT])

    expect(() => vm().execute({ main })).toThrow('Opcode undefined is not implemented')
  })
})

describe('vm errors', () => {
  it('converts runtime errors into PScriptRuntimeError with location, excerpt and stack', () => {
    let error: PScriptRuntimeError | undefined

    try {
      vm().execute(compile('1;\n  2 * print', { fileName: 'x.pscript' }))
    } catch (e) {
      error = e as PScriptRuntimeError
    }

    expect(error).toBeInstanceOf(PScriptRuntimeError)
    expect((error?.value as { message: string }).message).toBe("Cannot apply '*' to number and function")
    expect(error?.message).toBe("x.pscript:2:3 TypeError: Cannot apply '*' to number and function\n  2 * print\n  ^")
    expect(error).toMatchObject({
      scriptName: 'TypeError',
      scriptStack: [{ functionName: '<script>', line: 2, column: 3 }],
    })
  })

  it('throws TypeError when calling a non-function', () => {
    expect(() => vm().execute(compile("'x'()"))).toThrow('TypeError: string is not a function')
  })

  it('recovers after an error', () => {
    const machine = vm()

    expect(() => machine.execute(compile('1 * x'))).toThrow('x is not defined')
    expect(machine.stack).toHaveLength(0)
    expect(machine.execute(compile('1 + 1'))).toBe(2)
  })
})

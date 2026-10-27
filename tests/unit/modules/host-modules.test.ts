import { describe, expect, it } from 'vitest'
import { Interpreter, PScriptRuntimeError } from '@/index'

function interpreter(output: string[] = [], modules: Record<string, string | Record<string, unknown>> = {}) {
  return new Interpreter({ modules, stdout: text => output.push(text) })
}

describe('host modules (§4.7.3)', () => {
  it('exposes defineModule exports by name, read live', () => {
    const output: string[] = []
    const host = interpreter(output)
    const config = { limit: 3, name: 'app' }

    host.defineModule('host:config', config)
    const ns = host.runModule("import { limit, name } from 'host:config'\nexport function show() { print(name, limit) }")

    config.limit = 5
    host.runModule("import { show } from './main'\nshow()", { id: 'second' })
    expect(output).toEqual(['app 5'])
    expect(Object.keys(ns)).toEqual(['show'])
  })

  it('fixes the export names when the module is defined', () => {
    const exports: Record<string, unknown> = { a: 1 }
    const host = interpreter()

    host.defineModule('host:late', exports)
    exports.b = 2
    const missing = "Module 'host:late' does not provide an export named 'b'"

    expect(() => host.runModule("import { b } from 'host:late'")).toThrow(missing)
  })
})

describe('host module imports', () => {
  it('supports namespace imports of host modules', () => {
    const output: string[] = []
    const host = interpreter(output)

    host.defineModule('host:env', { mode: 'test', level: 2 })
    host.runModule("import * as env from 'host:env'\nprint(Object.keys(env), env.mode, env.level)")
    expect(output).toEqual(['["level", "mode"] test 2'])
  })

  it('loads host modules returned by the loader', () => {
    const output: string[] = []
    const host = interpreter(output, { 'host:answer': { value: 42 } })

    host.runModule("import { value } from 'host:answer'\nprint(value)")
    expect(output).toEqual(['42'])
    expect(host.importModule('host:answer').value).toBe(42)
  })

  it('keeps host-module bindings read-only and ids unique', () => {
    const host = interpreter()

    host.defineModule('host:x', { x: 1 })
    expect(() => host.runModule("import { x } from 'host:x'\nx = 2")).toThrow("Cannot assign to import 'x'")
    expect(() => host.defineModule('host:x', {})).toThrow(PScriptRuntimeError)
  })
})

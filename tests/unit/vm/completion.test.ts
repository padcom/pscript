// Completion value (§4.4.10, D12): run() must return exactly what Node's vm returns.
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { Interpreter } from '@/index'
import { rewriteEquality } from '../../helpers/node-reference'

function both(source: string): [unknown, unknown] {
  const pscript = new Interpreter({ stdout: () => {} }).run(source)

  return [pscript, runInNewContext(rewriteEquality(source), { print: () => null })]
}

describe('§4.4.10 rows', () => {
  it.each([
    ['1 + 2', 3],
    ['let x = 5', undefined],
    ['let x = 5; x * 2', 10],
    ['1; let y = 2', 1],
    ['1; if (true) {}', undefined],
    ['1; {}', 1],
    ["if (true) { 'a' } else { 'b' }", 'a'],
    ['let i = 0; while (i < 3) { i++ }', 2],
  ])('%s → %j', (source, expected) => {
    const [pscript, node] = both(source)

    expect(pscript).toBe(expected)
    expect(node).toBe(expected)
  })

  it.todo('try { 1 } finally { 2 } → 1 (M11)')
  it.todo('function f() {} → undefined (M7)')
})

describe('more completion values, compared with Node', () => {
  it.each([
    '',
    ';',
    "'a'; ;",
    "'a'; if (false) 'b'",
    "'a'; if (false) 'b'; else 'c'",
    "'a'; while (false) 'b'",
    "'a'; for (;false;) 'b'",
    'for (let i = 0; i < 3; i++) i * 10',
    "for (let i = 0; i < 3; i++) { if (i == 1) break; 'body' + i }",
    'let n = 0; while (true) { n++; if (n > 2) break; n }',
    '1; { 2; { 3 } }',
    '1; { let a = 2 }',
    'let x = 1; x = 7',
    "let i = 0; for (; i < 2;) { i++; if (i == 2) continue; 'x' + i }",
    'if (1) { 2; if (0) 3 }',
  ])('%j', source => {
    const [pscript, node] = both(source)

    expect(pscript).toBe(node)
  })

  it('does not carry the completion value over to the next run', () => {
    const repl = new Interpreter()

    expect(repl.run('42')).toBe(42)
    expect(repl.run('let z = 1')).toBeUndefined()
  })
})

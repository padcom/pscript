import { describe, expect, it } from 'vitest'
import { compile } from '@/compiler/compiler'
import { Interpreter } from '@/index'
import { parse } from '@/parser/parse'
import { createRealm } from '@/runtime/realm'
import { installStdlib } from '@/stdlib'
import { VM } from '@/vm/vm'

function run(source: string): unknown {
  return new Interpreter({ stdout: () => {} }).run(source)
}

describe('for…of', () => {
  it('leaves the stack balanced after break, continue and normal exit', () => {
    const realm = createRealm()
    const vm = new VM(realm, { maxSteps: Infinity, maxCallDepth: 100 })

    installStdlib(realm, { stdout: () => {} })
    const source = 'for (const x of [1, 2, 3]) { let y = x\n if (y == 1) continue\n if (y == 2) break }\nfor (const z of []) {}'

    vm.execute(compile(source))
    expect(vm.stack).toHaveLength(0)
  })

  it('unwinds block environments on break', () => {
    const source = "let r = ''\nfor (const x of 'abc') { { let inner = x\n if (inner == 'b') break\n r += inner } }\nr + '!'"

    expect(run(source)).toBe('a!')
  })

  it('rejects assignment to a const loop variable', () => {
    expect(() => compile('for (const x of [1]) x = 2')).toThrow("Assignment to constant variable 'x'")
  })

  it('assigns a bare existing binding', () => {
    expect(run('let last = 0\nfor (last of [4, 5]) {}\nlast')).toBe(5)
  })

  it('reports non-iterables', () => {
    expect(() => run('for (const x of { a: 1 }) {}')).toThrow('TypeError: object is not iterable')
    expect(() => run('for (const x of null) {}')).toThrow('TypeError: null is not iterable')
  })
})

describe('for…of syntax', () => {
  it('builds ForOfStatement nodes', () => {
    expect(parse('for (const x of xs) f(x)').body[0]).toMatchObject({
      type: 'ForOfStatement',
      await: false,
      left: { type: 'VariableDeclaration', kind: 'const', declarations: [{ id: { name: 'x' }, init: null }] },
      right: { name: 'xs' },
    })
    expect(parse('for (x of xs) {}').body[0]).toMatchObject({ left: { type: 'Identifier', name: 'x' } })
  })

  it('does not insert a semicolon inside the header', () => {
    expect(parse('for (let x\n of xs) {}').body).toHaveLength(1)
  })
})

describe('array methods', () => {
  it('require an array receiver', () => {
    expect(() => run('const push = [].push\npush(1)')).toThrow('Array.prototype.push called on a non-array')
  })

  it('return null where JS returns undefined (D37)', () => {
    expect(run('[[].pop(), [].shift(), [1].at(5)].join(":")')).toBe('::')
    expect(run('[].pop() == null')).toBe(true)
  })
})

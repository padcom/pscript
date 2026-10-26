// The consequences table of §4.2.1. Rows whose features arrive later are `it.todo` with the milestone.
import { describe, expect, it } from 'vitest'
import type { CallExpression, ExpressionStatement } from '@/parser/ast'
import { parse } from '@/parser/parse'

describe('§4.2.1 ASI consequences', () => {
  it.todo('let a = 1\\nlet b = 2 → two declarations (M4)')
  it.todo('x = a\\n  .map(f) → one statement (M9)')
  it.todo('x = a\\n  + b → x = a + b (M4: assignment)')

  it('a\\n  + b → one statement (the assignment-free core of the row above)', () => {
    expect(parse('a\n  + b').body).toMatchObject([{ expression: { type: 'BinaryExpression', operator: '+' } }])
  })

  it('foo()\\n(bar)() → two statements (D2)', () => {
    const { body } = parse('foo()\n(bar)()')

    expect(body).toHaveLength(2)
    expect(body[0]).toMatchObject({ expression: { type: 'CallExpression', callee: { name: 'foo' }, arguments: [] } })
    expect(body[1]).toMatchObject({ expression: { type: 'CallExpression', callee: { type: 'Identifier', name: 'bar' } } })
  })

  it.todo('if (c) {\\n}\\nelse {\\n} → if/else (M6)')
  it.todo('return\\n42 → return; 42; (M7)')
  it.todo('let o = {\\n a: 1\\n} → object literal, no ; inside (M9)')

  it('f(\\n a,\\n b\\n) → one call', () => {
    const { body } = parse('f(\n a,\n b\n)')

    expect(body).toHaveLength(1)
    expect(((body[0] as ExpressionStatement).expression as CallExpression).arguments).toHaveLength(2)
  })

  it.todo('let f = () => {\\n}\\nf() → two statements (M8)')
  it.todo('class A {\\n x = 1\\n m() {}\\n} → field x ends with an inserted ; (M15)')
})

import { describe, expect, it } from 'vitest'
import type { ClassDeclaration, InterfaceDeclaration } from '@/parser/ast'
import { parse, tokenize } from '@/parser/parse'

function declaration(source: string): InterfaceDeclaration {
  return parse(source).body[0] as InterfaceDeclaration
}

describe('interface declarations (§4.5.7)', () => {
  it('parses members of every form, one per line or separated by semicolons', () => {
    const members = 'area()\n  color; get name()\n  set label(v)\n  log(a, ...rest)'
    const node = declaration(`interface Shape extends Named, ns.Comparable {\n  ${members}\n}`)

    expect(node.extends).toHaveLength(2)
    expect(node.body.map(member => [member.kind, member.params.length, member.hasRest])).toEqual([
      ['method', 0, false],
      ['property', 0, false],
      ['get', 0, false],
      ['set', 1, false],
      ['method', 2, true],
    ])
  })

  it('treats the body like a class body for ASI and contextual keywords', () => {
    const tokens = ['INTERFACE', 'IDENT', 'CLASS_LBRACE', 'GET', 'IDENT', '(', ')', ';', 'IDENT', ';', '}', 'EOF']

    expect(tokenize('interface I {\n get x()\n y\n}')).toEqual(tokens)
  })

  it('parses implements lists after extends', () => {
    const node = parse('class C extends B implements I, J {}').body[0] as ClassDeclaration

    expect(node.implements).toHaveLength(2)
    expect((parse('const c = class implements I {}').body[0] as any).declarations[0].init.implements).toHaveLength(1)
  })
})

describe('interface syntax errors', () => {
  it.each([
    ['interface I { public m() }', 'Interface members cannot have modifiers'],
    ['interface I { static m() }', 'Interface members cannot have modifiers'],
    ['interface I { m() {} }', 'Interface members cannot have a body'],
    ['interface I { get x() { return 1 } }', 'Interface members cannot have a body'],
    ['interface I { x = 1 }', 'Interface members cannot have an initializer'],
    ['interface I { m(a = 1) }', 'Interface methods cannot have default parameters'],
    ['interface I { m(a, a) }', "Duplicate parameter name 'a'"],
    ['interface I { m()\n m(a) }', "Duplicate interface member 'm'"],
    ['interface I { x\n get x() }', "Duplicate interface member 'x'"],
  ])('rejects %j', (source, message) => {
    expect(() => parse(source)).toThrow(message)
  })

  it('allows a getter and a setter of the same name', () => {
    expect(declaration('interface I { get x()\n set x(v) }').body).toHaveLength(2)
  })
})

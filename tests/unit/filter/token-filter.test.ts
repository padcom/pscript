import { describe, expect, it } from 'vitest'
import { tokenize } from '@/parser/parse'

describe('semicolon insertion', () => {
  it.each([
    ['a\nb', ['IDENT', ';', 'IDENT', ';', 'EOF']],
    ['1\n2', ['NUMBER', ';', 'NUMBER', ';', 'EOF']],
    ["'s'\ntrue\nfalse\nnull\nundefined", ['STRING', ';', 'TRUE', ';', 'FALSE', ';', 'NULL', ';', 'UNDEFINED', ';', 'EOF']],
    ['f()\ng()', ['IDENT', '(', ')', ';', 'IDENT', '(', ')', ';', 'EOF']],
    ['a;\nb;', ['IDENT', ';', 'IDENT', ';', 'EOF']],
    ['a\n\n\nb', ['IDENT', ';', 'IDENT', ';', 'EOF']],
    ['a', ['IDENT', ';', 'EOF']],
    ['', ['EOF']],
  ])('%j', (source, tokens) => {
    expect(tokenize(source)).toEqual(tokens)
  })
})

describe('no insertion', () => {
  it.each([
    ['a\n+ b', ['IDENT', '+', 'IDENT', ';', 'EOF']],
    ['a +\nb', ['IDENT', '+', 'IDENT', ';', 'EOF']],
    ['a\n* b\n/ c\n% d\n** e\n- f', ['IDENT', '*', 'IDENT', '/', 'IDENT', '%', 'IDENT', '**', 'IDENT', '-', 'IDENT', ';', 'EOF']],
    ['f(a\n, b\n)', ['IDENT', '(', 'IDENT', ',', 'IDENT', ')', ';', 'EOF']],
    ['(a\nb)', ['(', 'IDENT', 'IDENT', ')', ';', 'EOF']],
    ['[a\nb]', ['[', 'IDENT', 'IDENT', ']', ';', 'EOF']],
    ['a +', ['IDENT', '+', 'EOF']],
    ['f(1', ['IDENT', '(', 'NUMBER', 'EOF']],
  ])('%j', (source, tokens) => {
    expect(tokenize(source)).toEqual(tokens)
  })
})

describe('statement starters after a newline', () => {
  it.each([
    ['a\n(b)', ['IDENT', ';', '(', 'IDENT', ')', ';', 'EOF']],
    ['a\n[b]', ['IDENT', ';', '[', 'IDENT', ']', ';', 'EOF']],
    ['a\n!b', ['IDENT', ';', '!', 'IDENT', ';', 'EOF']],
    ['a\n++b', ['IDENT', ';', '++', 'IDENT', ';', 'EOF']],
    ['a\ntypeof b', ['IDENT', ';', 'TYPEOF', 'IDENT', ';', 'EOF']],
    ['a++\nb', ['IDENT', '++', ';', 'IDENT', ';', 'EOF']],
    ['a\n? b\n: c', ['IDENT', '?', 'IDENT', ':', 'IDENT', ';', 'EOF']],
    ['a\n&& b\n|| c\n?? d', ['IDENT', '&&', 'IDENT', '||', 'IDENT', '??', 'IDENT', ';', 'EOF']],
    ['a\n== b\n< c', ['IDENT', '==', 'IDENT', '<', 'IDENT', ';', 'EOF']],
  ])('%j', (source, tokens) => {
    expect(tokenize(source)).toEqual(tokens)
  })
})

describe('control-flow headers and else', () => {
  it.each([
    ['if (a)\nb', ['IF', '(', 'IDENT', ')', 'IDENT', ';', 'EOF']],
    ['while (a)\nb', ['WHILE', '(', 'IDENT', ')', 'IDENT', ';', 'EOF']],
    ['for (;;)\nb', ['FOR', '(', ';', ';', ')', 'IDENT', ';', 'EOF']],
    ['if (f(a))\nb', ['IF', '(', 'IDENT', '(', 'IDENT', ')', ')', 'IDENT', ';', 'EOF']],
    ['f(a)\nb', ['IDENT', '(', 'IDENT', ')', ';', 'IDENT', ';', 'EOF']],
    ['if (a) b\nelse c', ['IF', '(', 'IDENT', ')', 'IDENT', ';', 'ELSE', 'IDENT', ';', 'EOF']],
    ['if (a) { b }\nelse c', ['IF', '(', 'IDENT', ')', '{', 'IDENT', ';', '}', 'ELSE', 'IDENT', ';', 'EOF']],
    ['if (a) b; else c', ['IF', '(', 'IDENT', ')', 'IDENT', ';', 'ELSE', 'IDENT', ';', 'EOF']],
    ['if (a) b else c', ['IF', '(', 'IDENT', ')', 'IDENT', 'ELSE', 'IDENT', ';', 'EOF']],
  ])('%j', (source, tokens) => {
    expect(tokenize(source)).toEqual(tokens)
  })
})

describe('blocks', () => {
  it('inserts before a } that closes a block, and after it at a newline', () => {
    expect(tokenize('{ a }\nb')).toEqual(['{', 'IDENT', ';', '}', ';', 'IDENT', ';', 'EOF'])
  })

  it('inserts at newlines inside a block', () => {
    expect(tokenize('{\na\nb\n}')).toEqual(['{', 'IDENT', ';', 'IDENT', ';', '}', ';', 'EOF'])
  })

  it('does not insert before } after a non-ender', () => {
    expect(tokenize('{ a; }')).toEqual(['{', 'IDENT', ';', '}', ';', 'EOF'])
  })
})

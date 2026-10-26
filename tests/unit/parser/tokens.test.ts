import { describe, expect, it } from 'vitest'
import { CONTEXTUAL_KEYWORDS, FUTURE_RESERVED_WORDS, IDENT_PATTERN, KEYWORDS } from '@/parser/tokens'

describe('tokens', () => {
  it('keeps keyword lists disjoint', () => {
    const all = [...KEYWORDS, ...CONTEXTUAL_KEYWORDS, ...FUTURE_RESERVED_WORDS]

    expect(new Set(all).size).toBe(all.length)
  })

  it('reserves the listed keywords', () => {
    expect(KEYWORDS).toHaveLength(35)
    expect(KEYWORDS).toContain('interface')
    expect(KEYWORDS).not.toContain('get')
  })

  it.each(['x', '_a1', '$', '$el', 'camelCase'])('accepts identifier %s', name => {
    expect(IDENT_PATTERN.test(name)).toBe(true)
  })

  it.each(['1a', '#x', 'a-b', ''])('rejects identifier %j', name => {
    expect(IDENT_PATTERN.test(name)).toBe(false)
  })
})

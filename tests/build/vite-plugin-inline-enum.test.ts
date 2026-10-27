import { describe, expect, it } from 'vitest'
import { inlineEnum, inlineEnumMembers } from '../../build/vite-plugin-inline-enum'

enum Color { RED, GREEN, BLUE = 120 }

describe('inlineEnumMembers', () => {
  it('replaces member accesses with their values, keeping the length', () => {
    const code = 'switch (x) { case Color.RED: break; case Color.GREEN: break }'
    const inlined = inlineEnumMembers(code, 'Color', Color)

    expect(inlined).toBe('switch (x) { case 0        : break; case 1          : break }')
    expect(inlined).toHaveLength(code.length)
  })

  it('leaves other uses of the enum alone', () => {
    const code = 'Color[x]; Color.PINK; MyColor.RED; a.Color.RED; Color.RED_ISH'

    expect(inlineEnumMembers(code, 'Color', Color)).toBe(code)
  })

  it('keeps an access shorter than its value', () => {
    expect(inlineEnumMembers('C.B', 'C', { B: 1234 })).toBe('C.B')
  })
})

describe('inline-enum plugin', () => {
  const plugin = inlineEnum('Color', Color, /colors\.ts$/)
  const transform = plugin.transform as (code: string, id: string) => { code: string } | null

  it('ignores files that are not included', () => {
    expect(transform('Color.RED', 'other.ts')).toBeNull()
  })

  it('transforms included files', () => {
    expect(transform('Color.BLUE', 'colors.ts')?.code).toBe('120       ')
  })
})

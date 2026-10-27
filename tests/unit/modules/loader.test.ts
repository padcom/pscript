import { describe, expect, it } from 'vitest'
import { memoryLoader, resolveSpecifier } from '@/modules/loader'

describe('resolveSpecifier (§4.7.3)', () => {
  it.each([
    ['./math', null, 'math'],
    ['./math', 'main', 'math'],
    ['./util', 'lib/strings', 'lib/util'],
    ['../shared/config', 'lib/strings', 'shared/config'],
    ['../../x', 'a/b/c', 'x'],
    ['./a/./b', 'main', 'a/b'],
    ['host:fs', 'lib/strings', 'host:fs'],
  ])('%s from %s → %s', (specifier, referrer, id) => {
    expect(resolveSpecifier(specifier, referrer)).toBe(id)
  })
})

describe('memoryLoader (§4.7.3, D10)', () => {
  const loader = memoryLoader({
    'exact': 'a',
    'math.pscript': 'b',
    'short.psc': 'c',
    'both.pscript': 'd',
    'both.psc': 'e',
    'host': { x: 1 },
  })

  it('tries the exact id, then .pscript, then .psc', () => {
    expect(loader('./exact', null)).toEqual({ id: 'exact', source: 'a' })
    expect(loader('./math', null)).toEqual({ id: 'math.pscript', source: 'b' })
    expect(loader('./short', null)).toEqual({ id: 'short.psc', source: 'c' })
  })

  it('returns host exports for objects', () => {
    expect(loader('host', null)).toEqual({ id: 'host', exports: { x: 1 } })
  })

  it('rejects ambiguous and missing modules', () => {
    expect(() => loader('./both', null)).toThrow("ambiguous module 'both': both.pscript and both.psc")
    expect(() => loader('./nope', null)).toThrow("no module 'nope'")
  })
})

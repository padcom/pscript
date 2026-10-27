import type { Plugin } from 'vite'

/** A numeric TypeScript enum object (`enum E { A, B }` compiles to `{ A: 0, B: 1, 0: 'A', 1: 'B' }`). */
export type NumericEnum = Record<string, string | number>

/**
 * Replaces `name.MEMBER` with the member's number, padded with spaces to the same length so that source maps
 * stay valid. Unknown members and other uses of the enum (`name[x]`) are left alone.
 *
 * @param code module code
 * @param name the enum's identifier
 * @param values the enum
 * @returns the code with the member accesses inlined
 */
export function inlineEnumMembers(code: string, name: string, values: NumericEnum): string {
  const access = new RegExp(`(?<![\\w$.])${name}\\.([A-Za-z_$][\\w$]*)`, 'g')

  return code.replace(access, (text, member: string) => {
    const value = Object.hasOwn(values, member) ? values[member] : undefined

    return typeof value === 'number' && String(value).length <= text.length ? String(value).padEnd(text.length) : text
  })
}

/**
 * Vite plugin inlining the members of a numeric enum: `switch` cases on literals let V8 dispatch through a
 * jump table instead of a chain of property loads and comparisons (the VM's dispatch loop, §5.6.2).
 *
 * @param name the enum's identifier
 * @param values the enum
 * @param include modules to transform
 * @returns the plugin
 */
export function inlineEnum(name: string, values: NumericEnum, include: RegExp): Plugin {
  return {
    name: 'pscript:inline-enum',
    transform(code, id) {
      if (!include.test(id)) return null

      return { code: inlineEnumMembers(code, name, values), map: null }
    },
  }
}

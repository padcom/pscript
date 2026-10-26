// Runs every tests/programs/**/*.pscript. A sibling `.out` file holds the expected output;
// a `.err` file holds text the error message must contain (output before the error is not checked).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runProgram } from './helpers/run-program'

const root = join(import.meta.dirname, 'programs')
const programs = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.pscript')).sort()

function sibling(file: string, extension: string): string | null {
  const path = join(root, file.replace(/\.pscript$/, extension))

  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

describe('programs', () => {
  it.each(programs)('%s', file => {
    const source = readFileSync(join(root, file), 'utf8')
    const { output, error } = runProgram(source, { fileName: relative(root, join(root, file)) })
    const expectedError = sibling(file, '.err')

    if (expectedError === null) {
      expect(error).toBeUndefined()
      expect(output.join('\n')).toBe((sibling(file, '.out') ?? '').trimEnd())
    } else {
      expect(error?.message).toContain(expectedError.trim())
    }
  })
})

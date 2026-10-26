// Differential testing against Node (§6.3): every program without `@pscript-only` must print the
// same lines in PScript and in Node and, when it fails, fail with the same kind of error.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PScriptError, PScriptRuntimeError } from '@/index'
import { runInNode } from './helpers/node-reference'
import { runProgram } from './helpers/run-program'

const root = join(import.meta.dirname, 'programs')
const programs = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter(file => file.endsWith('.pscript'))
  .map(file => ({ file, source: readFileSync(join(root, file), 'utf8') }))
  .filter(({ source }) => !source.includes('@pscript-only'))
  .sort((a, b) => a.file.localeCompare(b.file))

function errorName(error: Error | undefined): string | undefined {
  if (error instanceof PScriptRuntimeError) return error.scriptName

  return error instanceof PScriptError ? 'SyntaxError' : error?.name
}

describe('differential (PScript vs Node)', () => {
  it.each(programs)('$file', ({ source }) => {
    const pscript = runProgram(source)
    const node = runInNode(source)

    expect(pscript.output).toEqual(node.output)
    expect(errorName(pscript.error)).toBe(node.errorName)
  })
})

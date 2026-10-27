// psc source maps (§11.5, T5): Node stack traces of transpiled programs point at the `.pscript` lines.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { transpileModules } from '@/index'

const dirs: string[] = []

afterAll(() => dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })))

// The stack frames (`file:line:column`, relative to the program's directory) of the error the program throws.
function stackOf(modules: Record<string, string>, entry: string): string[] {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'psc-source-maps-')))
  const results = transpileModules(modules, { sourceMap: 'inline' })

  dirs.push(dir)

  for (const [id, { code }] of Object.entries(results)) {
    const path = join(dir, id.replace(/\.(?:pscript|psc)$/, '.js'))

    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, code)
  }
  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n')

  const { stderr } = spawnSync(process.execPath, ['--enable-source-maps', join(dir, entry)], { encoding: 'utf8' })

  return [...stderr.matchAll(/^\s+at .*?\(?(?<location>[^\s()]+:\d+:\d+)\)?$/gm)]
    .map(({ groups }) => groups!.location)
    .filter(location => location.startsWith(dir))
    .map(location => location.slice(dir.length + 1))
}

describe('psc source maps in Node', () => {
  it('point stack traces of scripts at the PScript lines', () => {
    const modules = { 'main.pscript': '// a script\nfunction fail(o) {\n  return o.x\n}\n\nfail(null)\n' }

    expect(stackOf(modules, 'main.js')).toEqual(['main.pscript:3:10', 'main.pscript:6:1'])
  })

  it('point stack traces of modules, classes and nested directories at the PScript lines', () => {
    const modules = {
      'lib/errors.psc': 'export function boom(message) {\n  // thrown here\n  throw new Error(message)\n}\n',
      'main.pscript': [
        "import { boom } from './lib/errors'",
        '',
        'class Task {',
        '  run() {',
        "    boom('bang')",
        '  }',
        '}',
        'const tasks = [new Task()]',
        'for (const task of tasks) {',
        '  task.run()',
        '}',
        '',
      ].join('\n'),
    }

    expect(stackOf(modules, 'main.js')).toEqual(['lib/errors.psc:3:9', 'main.pscript:5:5', 'main.pscript:10:3'])
  })
})

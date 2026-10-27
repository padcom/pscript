// Checks the library build (§6.5, D16): an ES module with type declarations, browser-safe (no CommonJS, no Node
// built-ins), that loads and runs a script and keeps its names, a CLI (H5) that runs one, and psc (§11) compiling a
// module graph that Node runs. Runs after `vite build` in `npm run build`.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const FORBIDDEN = [
  [/\brequire\(/, 'CommonJS require()'],
  [/\bmodule\.exports\b/, 'CommonJS module.exports'],
  [/from ['"]node:/, 'a Node built-in import'],
  [/\bprocess\.(?:env|argv|exit)\b/, 'Node process access'],
]

function missingFiles() {
  return ['dist/index.js', 'dist/index.d.ts'].filter(file => !existsSync(file)).map(file => `${file} is missing`)
}

function forbiddenCode(code) {
  return FORBIDDEN.filter(([pattern]) => pattern.test(code)).map(([, what]) => `dist/index.js contains ${what}`)
}

async function runs() {
  const { run } = await import('../dist/index.js')

  return run('1 + 2 * 3') === 7 ? [] : ['dist/index.js does not run scripts']
}

async function keepsNames() {
  const { Interpreter, run } = await import('../dist/index.js')
  const problems = Interpreter.name === 'Interpreter' ? [] : [`Interpreter is named '${Interpreter.name}'`]

  try {
    run('let = 1')
  } catch (e) {
    if (e.name !== 'PScriptSyntaxError') problems.push(`syntax errors are named '${e.name}'`)
  }

  return problems
}

function cliRuns() {
  const output = execFileSync(process.execPath, ['bin/pscript.js', '-e', 'print(1 + 2 * 3)'], { encoding: 'utf8' })

  return output === '7\n' ? [] : ['bin/pscript.js does not run scripts']
}

// psc follows the import of `b` and writes both modules (and their source maps) next to their sources.
function pscCompiles() {
  const dir = mkdtempSync(join(tmpdir(), 'psc-check-'))

  try {
    writeFileSync(join(dir, 'a.pscript'), "import { b } from './b'\nprint(b * 2)\n")
    writeFileSync(join(dir, 'b.psc'), 'export const b = 21\n')
    writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n')
    execFileSync(process.execPath, ['bin/psc.js', '--source-map', join(dir, 'a.pscript')])
    const output = execFileSync(process.execPath, [join(dir, 'a.js')], { encoding: 'utf8' })
    const problems = output === '42\n' ? [] : ['bin/psc.js does not compile modules']

    return existsSync(join(dir, 'b.js.map')) ? problems : [...problems, 'bin/psc.js does not write source maps']
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const problems = missingFiles()

if (problems.length === 0) {
  problems.push(...forbiddenCode(readFileSync('dist/index.js', 'utf8')), ...await runs(), ...await keepsNames())
  problems.push(...cliRuns(), ...pscCompiles())
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log('build check: ES module, browser-safe, runs scripts, keeps names; the CLI runs scripts; psc compiles modules')

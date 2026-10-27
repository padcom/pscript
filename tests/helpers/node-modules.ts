// Runs a PScript module graph in Node as the behaviour oracle (§6.3): each module is written as an `.mjs` file
// (equality rewritten, relative specifiers given the extension) and the entry runs in a child process.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { rewriteEquality, type NodeResult } from './node-reference'

const RELATIVE_SPECIFIER = /(?<keyword>(?:from|import)\s*)(?<quote>['"])(?<path>\.{1,2}\/[^'"]*?)(?:\.pscript|\.psc)?\k<quote>/g

/**
 * Gives relative module specifiers the `.mjs` extension Node needs.
 *
 * @param source module source
 * @returns the rewritten source
 */
export function rewriteSpecifiers(source: string): string {
  return source.replace(RELATIVE_SPECIFIER, '$<keyword>$<quote>$<path>.mjs$<quote>')
}

const PRELUDE = [
  "globalThis.print = (...args) => console.log(args.map(String).join(' '))",
  "process.on('uncaughtException', error => { console.log('\\u0000' + error.name); process.exit(0) })",
].join('\n')

const ERROR_LINE = /^(?<name>\w*Error)\b/m

function moduleFile(name: string): string {
  return name.replace(/\.(?:pscript|psc)$/, '.mjs')
}

function write(dir: string, name: string, text: string) {
  const path = join(dir, name)

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

// Errors that stop the graph before any code runs (link errors) are only reported on stderr.
function stderrError(stderr: string): string | undefined {
  return ERROR_LINE.exec(stderr)?.groups?.name
}

function result(stdout: string, stderr: string): NodeResult {
  const lines = stdout.split('\n').filter(line => line !== '')
  const thrown = lines.find(line => line.startsWith('\u0000'))
  const output = lines.filter(line => !line.startsWith('\u0000'))

  return { output, errorName: thrown?.slice(1) ?? stderrError(stderr) }
}

/**
 * Runs a module graph in Node.
 *
 * @param files module sources by file name (relative paths), including the entry
 * @param entry file name of the entry module
 * @returns output and the thrown error's name
 */
export function runModulesInNode(files: Record<string, string>, entry: string): NodeResult {
  const dir = mkdtempSync(join(tmpdir(), 'pscript-modules-'))

  try {
    for (const [name, source] of Object.entries(files)) write(dir, moduleFile(name), rewriteSpecifiers(rewriteEquality(source)))
    write(dir, 'prelude.mjs', PRELUDE)
    write(dir, 'entry.mjs', `import './prelude.mjs'\nimport './${moduleFile(entry)}'\n`)

    const { stdout, stderr } = spawnSync(process.execPath, [join(dir, 'entry.mjs')], { encoding: 'utf8' })

    return result(stdout, stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

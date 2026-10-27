#!/usr/bin/env node
// The PScript command line (H5): runs a file, an inline script or stdin, or starts a REPL. Node-only, so it lives
// outside `src/` and the library stays browser-safe.
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import process from 'node:process'
import repl from 'node:repl'
import { Interpreter, PScriptError, PScriptSyntaxError, parse } from '../dist/index.js'
import { findFile, isPath } from './files.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const USAGE = `Usage: pscript [options] [file]

Runs a PScript file (as a module when it imports or exports), a script given with -e, or the script on stdin.
Without a file and with a terminal on stdin, starts an interactive REPL.

Options:
  -e, --eval <script>   run the script
  -h, --help            show this help
  -v, --version         show the version`

// Module ids are paths relative to the working directory, so that error messages stay short.
function fsLoader(specifier, referrer) {
  if (!isPath(specifier)) throw new Error(`cannot resolve '${specifier}': only relative and absolute paths are supported`)

  const base = referrer === null ? process.cwd() : dirname(resolve(referrer))
  const path = findFile(resolve(base, specifier), 'module')

  return { id: relative(process.cwd(), path), source: readFileSync(path, 'utf8') }
}

const MODULE_DECLARATIONS = new Set(['ImportDeclaration', 'ExportNamedDeclaration'])

function isModule(source) {
  try {
    return parse(source, { goal: 'module' }).body.some(node => MODULE_DECLARATIONS.has(node.type))
  } catch {
    return false
  }
}

function createInterpreter(stdout = text => console.log(text)) {
  return new Interpreter({ moduleLoader: fsLoader, stdout })
}

function runSource(source, fileName) {
  const interpreter = createInterpreter()

  if (isModule(source)) interpreter.runModule(source, { id: fileName })
  else interpreter.run(source, { fileName })
}

function runFile(file) {
  const path = findFile(resolve(file), 'file')

  runSource(readFileSync(path, 'utf8'), relative(process.cwd(), path))
}

function runStdin() {
  runSource(readFileSync(process.stdin.fd, 'utf8'), '<stdin>')
}

function runEval(flag, source) {
  if (source === undefined) throw new Error(`${flag} needs a script`)

  runSource(source, '<eval>')
}

function report(error) {
  console.error(error instanceof PScriptError ? error.message : `pscript: ${error.message}`)
}

function isIncomplete(error) {
  return error instanceof PScriptSyntaxError
    && ['Unexpected end of input', 'Unterminated template literal'].includes(error.reason)
}

// The REPL's interpreter: `print` output goes to the console, except while `show` formats a completion value.
function createReplSession() {
  let captured = null
  const interpreter = createInterpreter(text => captured ? captured.push(text) : console.log(text))

  // Strings are quoted, everything else is formatted as `print` does.
  function show(value) {
    if (typeof value === 'string') return JSON.stringify(value)

    captured = []

    try {
      interpreter.call('print', value)

      return captured.join('\n')
    } finally {
      captured = null
    }
  }

  return input => show(interpreter.run(input, { fileName: '<repl>' }))
}

/* eslint-disable promise/prefer-await-to-callbacks -- node:repl's eval API takes a callback */
function startRepl() {
  const evaluate = createReplSession()

  console.log(`PScript ${pkg.version}. Type .help for help, .exit or Ctrl+D to leave.`)

  repl.start({
    prompt: 'pscript> ',
    ignoreUndefined: true,
    writer: text => text,
    eval(input, context, fileName, callback) {
      try {
        callback(null, input.trim() === '' ? undefined : evaluate(input))
      } catch (e) {
        if (isIncomplete(e)) {
          callback(new repl.Recoverable(e))
        } else {
          report(e)
          callback(null)
        }
      }
    },
  })
}
/* eslint-enable promise/prefer-await-to-callbacks */

const OPTIONS = {
  '-h': () => console.log(USAGE),
  '--help': () => console.log(USAGE),
  '-v': () => console.log(pkg.version),
  '--version': () => console.log(pkg.version),
  '-e': runEval,
  '--eval': runEval,
}

function commandFor(arg) {
  if (arg === undefined) return process.stdin.isTTY ? startRepl : runStdin
  if (!arg.startsWith('-')) return runFile

  return OPTIONS[arg]
}

function main(args) {
  const command = commandFor(args[0])
  if (command === undefined) throw new Error(`unknown option '${args[0]}'\n\n${USAGE}`)

  command(...args)
}

try {
  main(process.argv.slice(2))
} catch (e) {
  report(e)
  process.exitCode = 1
}

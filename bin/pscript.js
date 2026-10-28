#!/usr/bin/env node
// The PScript command line (H5): runs a file, an inline script or stdin, starts a REPL, or runs a command (D62).
// Node-only, so it lives outside `src/` and the library stays browser-safe.
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import process from 'node:process'
import repl from 'node:repl'
import {
  Interpreter,
  PScriptError,
  PScriptSyntaxError,
  compile,
  compileModule,
  disassemble,
  parse,
} from '../dist/index.js'
import { findFile, isPScriptFile, isPath } from './files.js'
import { transpile } from './transpile.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const USAGE = `Usage: pscript [options] [file]
       pscript <command> [arguments]

Runs a PScript file (as a module when it imports or exports), a script given with -e, or the script on stdin.
Without a file and with a terminal on stdin, starts an interactive REPL. A file is an argument ending in .pscript
or .psc or containing a '/' (./tool, so that #!/usr/bin/env pscript scripts run); any other argument is a command.

Commands:
  transpile                   compile PScript files to JavaScript (the same as psc; pscript transpile --help)

Options:
  -e, --eval <script>         run the script
  -d, --disassemble [file]    print the bytecode of the file (or of stdin) instead of running it
  -h, --help                  show this help
  -v, --version               show the version`

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

// The asynchronous API waits for top-level `await` (D51).
async function runSource(source, fileName) {
  const interpreter = createInterpreter()

  if (isModule(source)) await interpreter.runModuleAsync(source, { id: fileName })
  else await interpreter.runAsync(source, { fileName })
}

function runFile(file) {
  const path = findFile(resolve(file), 'file')

  return runSource(readFileSync(path, 'utf8'), relative(process.cwd(), path))
}

function runStdin() {
  return runSource(readFileSync(process.stdin.fd, 'utf8'), '<stdin>')
}

function runEval(flag, source) {
  if (source === undefined) throw new Error(`${flag} needs a script`)

  return runSource(source, '<eval>')
}

// The bytecode listing of a file (D61), with the source position where each statement or expression starts.
function disassembleSource(source, fileName) {
  const compiled = isModule(source) ? compileModule(source, fileName) : compile(source, { fileName })

  console.log(disassemble(compiled, { locations: true }))
}

function runDisassemble(flag, file) {
  if (file === undefined) {
    disassembleSource(readFileSync(process.stdin.fd, 'utf8'), '<stdin>')

    return
  }

  const path = findFile(resolve(file), 'file')

  disassembleSource(readFileSync(path, 'utf8'), relative(process.cwd(), path))
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

  return async input => show(await interpreter.runAsync(input, { fileName: '<repl>' }))
}

function evaluateInput(evaluate, input) {
  return input.trim() === '' ? undefined : evaluate(input)
}

/* eslint-disable promise/prefer-await-to-callbacks -- node:repl's eval API takes a callback */
function startRepl() {
  const evaluate = createReplSession()

  console.log(`PScript ${pkg.version}. Type .help for help, .exit or Ctrl+D to leave.`)

  repl.start({
    prompt: 'pscript> ',
    ignoreUndefined: true,
    writer: text => text,
    async eval(input, context, fileName, callback) {
      try {
        callback(null, await evaluateInput(evaluate, input))
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

const COMMANDS = {
  transpile: (name, ...args) => transpile(args, 'pscript transpile'),
}

const OPTIONS = {
  '-h': () => console.log(USAGE),
  '--help': () => console.log(USAGE),
  '-v': () => console.log(pkg.version),
  '--version': () => console.log(pkg.version),
  '-e': runEval,
  '--eval': runEval,
  '-d': runDisassemble,
  '--disassemble': runDisassemble,
}

// Options start with '-', commands do not.
function lookup(arg) {
  const table = arg.startsWith('-') ? OPTIONS : COMMANDS

  return Object.hasOwn(table, arg) ? table[arg] : undefined
}

// An argument with a PScript extension or a '/' is a file (D62, D63: hashbang scripts), anything else a command.
function isFileArg(arg) {
  return isPScriptFile(arg) || arg.includes('/')
}

function commandFor(arg) {
  if (arg === undefined) return process.stdin.isTTY ? startRepl : runStdin
  if (isFileArg(arg)) return runFile

  return lookup(arg)
}

async function main(args) {
  const command = commandFor(args[0])
  if (command === undefined) {
    const kind = args[0].startsWith('-') ? 'option' : 'command'

    throw new Error(`unknown ${kind} '${args[0]}'\n\n${USAGE}`)
  }

  await command(...args)
}

try {
  await main(process.argv.slice(2))
} catch (e) {
  report(e)
  process.exitCode = 1
}

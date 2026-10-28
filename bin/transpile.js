// The transpiler command (§11), run as `psc` and as `pscript transpile` (D62): compiles PScript files to JavaScript
// ES modules. Directories are searched for PScript files, and the PScript files that compiled files import are
// compiled too; all of them are checked together as one program. Node-only, so it lives outside `src/`.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { parse, transpileModules } from '../dist/index.js'
import { findFile, isDirectory, isPScriptFile, isPath } from './files.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const usage = command => `Usage: ${command} [options] <file|directory>...

Compiles PScript files to JavaScript ES modules (.js). Directories are searched for .pscript and .psc files; the
PScript files that compiled files import are compiled too. The files are checked together: importing a missing
export, calling an imported function with the wrong number of arguments, or overriding a final method of an
imported class are errors. Nothing is written when there is an error.

Options:
  -o, --out-dir <dir>   write the .js files under <dir>, laid out as the sources are below their common
                        directory (default: next to each source file)
  --source-map          write a source map next to each .js file (<file>.js.map)
  --inline-source-map   embed the source map in each .js file
  -h, --help            show this help
  -v, --version         show the version`

const MODULE_DECLARATIONS = new Set(['ImportDeclaration', 'ExportNamedDeclaration'])

// Flags set an option; flags with a value take the next argument.
const FLAGS = {
  '-h': options => { options.command = 'help' },
  '--help': options => { options.command = 'help' },
  '-v': options => { options.command = 'version' },
  '--version': options => { options.command = 'version' },
  '--source-map': options => { options.sourceMap = 'file' },
  '--inline-source-map': options => { options.sourceMap = 'inline' },
}

const VALUE_FLAGS = {
  '-o': (options, value) => { options.outDir = value },
  '--out-dir': (options, value) => { options.outDir = value },
}

function valueOf(args, i) {
  if (i === args.length) throw new Error(`${args[i - 1]} needs a value`)

  return args[i]
}

// Applies one argument (and the next one, for a flag with a value); returns the index of the last one used.
function parseArg(args, i, options) {
  const arg = args[i]

  if (VALUE_FLAGS[arg]) {
    VALUE_FLAGS[arg](options, valueOf(args, i + 1))

    return i + 1
  }
  if (FLAGS[arg]) FLAGS[arg](options)
  else if (arg.startsWith('-')) throw new Error(`unknown option '${arg}'\n\n${usage(options.name)}`)
  else options.inputs.push(arg)

  return i
}

function parseArgs(args, name) {
  const options = { name, inputs: [], outDir: null, sourceMap: null, command: 'compile' }

  for (let i = 0; i < args.length; i++) i = parseArg(args, i, options)

  return options
}

function filesIn(dir) {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(file => isPScriptFile(file) && !file.split(sep).includes('node_modules'))
    .map(file => join(dir, file))
    .sort()
}

function inputFiles(input) {
  const path = resolve(input)
  if (isDirectory(path)) return filesIn(path)

  const file = findFile(path, 'file')
  if (!isPScriptFile(file)) throw new Error(`'${input}' is not a PScript file (.pscript or .psc)`)

  return [file]
}

// The PScript files a module imports or re-exports from. Other files (and bare or `host:` specifiers) are left to
// the JavaScript runtime.
function importedFiles(file, source) {
  let program

  try {
    program = parse(source, { goal: 'module' })
  } catch {
    return [] // compiling the file reports the error
  }

  return program.body
    .filter(node => MODULE_DECLARATIONS.has(node.type) && node.source && isPath(node.source.value))
    .map(node => findFile(resolve(dirname(file), node.source.value), `module imported from '${file}'`))
    .filter(isPScriptFile)
}

// The input files and everything they import, with their sources.
function collect(inputs) {
  const sources = new Map()
  const pending = inputs.flatMap(inputFiles)

  while (pending.length > 0) {
    const file = pending.shift()

    if (!sources.has(file)) {
      const source = readFileSync(file, 'utf8')

      sources.set(file, source)
      pending.push(...importedFiles(file, source))
    }
  }

  return sources
}

function commonDirectory(files) {
  const [first, ...rest] = files.map(file => dirname(file).split(sep))
  const length = first.findIndex((part, i) => rest.some(parts => parts[i] !== part))

  return first.slice(0, length === -1 ? first.length : length).join(sep) || sep
}

function isInside(file, dir) {
  const path = relative(dir, file)

  return !path.startsWith('..') && !isAbsolute(path)
}

// Module ids are POSIX paths relative to the working directory (short error messages), or to the files' common
// directory when some file is outside it, so that relative imports between ids resolve.
function moduleId(file, base) {
  return relative(base, file).split(sep).join('/')
}

function outputPath(file, root, outDir) {
  const js = file.replace(/\.(?:pscript|psc)$/, '.js')

  return outDir === null ? js : join(resolve(outDir), relative(root, js))
}

// All files are compiled together, so imports are checked against the imported modules (P10).
function compile(sources, sourceMap) {
  const files = [...sources.keys()]
  const cwd = process.cwd()
  const base = files.every(file => isInside(file, cwd)) ? cwd : commonDirectory(files)
  const modules = Object.fromEntries(files.map(file => [moduleId(file, base), sources.get(file)]))
  const results = transpileModules(modules, { sourceMap: sourceMap !== null })

  return files.map(file => ({ file, ...results[moduleId(file, base)] }))
}

const MAP_URL = '//# sourceMappingURL='

const INLINE_MAP = 'data:application/json;charset=utf-8;base64,'

// The map points from the written file to the source file (P11).
function relocatedMap(map, file, path) {
  return { ...map, file: basename(path), sources: [relative(dirname(path), file).split(sep).join('/')] }
}

// The code, with a separate or inline source map.
function withSourceMap({ file, code, map }, path, sourceMap) {
  if (sourceMap === null) return code

  const json = JSON.stringify(relocatedMap(map, file, path))
  if (sourceMap === 'inline') return `${code}${MAP_URL}${INLINE_MAP}${Buffer.from(json).toString('base64')}\n`

  writeFileSync(`${path}.map`, json)

  return `${code}${MAP_URL}${basename(path)}.map\n`
}

function write(results, root, { outDir, sourceMap }) {
  for (const result of results) {
    const path = outputPath(result.file, root, outDir)

    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, withSourceMap(result, path, sourceMap))
  }
}

function run(options) {
  if (options.inputs.length === 0) throw new Error(`no input files\n\n${usage(options.name)}`)

  const sources = collect(options.inputs)
  if (sources.size === 0) throw new Error('no PScript files found')

  write(compile(sources, options.sourceMap), commonDirectory([...sources.keys()]), options)
}

const COMMANDS = {
  help: options => console.log(usage(options.name)),
  version: () => console.log(pkg.version),
  compile: run,
}

/**
 * Runs the transpiler with command-line arguments.
 *
 * @param {string[]} args the arguments
 * @param {string} name how the command was invoked, for the usage text
 */
export function transpile(args, name) {
  const options = parseArgs(args, name)

  COMMANDS[options.command](options)
}

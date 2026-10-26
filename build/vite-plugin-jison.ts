import Jison from 'jison'
import type { Plugin } from 'vite'

const JISON_EXTENSION = /\.jison$/

/**
 * Compiles a Jison grammar (lexer and grammar in one file) into an ES module
 * whose default export is the generated parser.
 *
 * @param source grammar source
 * @param id file name used in error messages
 * @returns the generated ES module code
 * @throws {Error} when the grammar has unresolved conflicts
 */
export function compileGrammar(source: string, id = '<grammar>'): string {
  const messages: string[] = []
  const { print } = Jison

  Jison.print = (...args: unknown[]) => { messages.push(args.join(' ')) }

  try {
    const gen = new Jison.Generator(source, { moduleType: 'js', moduleName: 'pscriptParser' })
    if (gen.conflicts > 0) {
      throw new Error(`${id}: grammar has ${gen.conflicts} unresolved conflict(s)\n${messages.join('\n')}`)
    }

    return `${gen.generate()}\nexport default pscriptParser\n`
  } finally {
    Jison.print = print
  }
}

/**
 * Vite plugin turning `import parser from './file.jison'` into the generated parser.
 *
 * @returns the plugin
 */
export function jison(): Plugin {
  return {
    name: 'pscript:jison',
    transform(code, id) {
      if (!JISON_EXTENSION.test(id)) return null

      return { code: compileGrammar(code, id), map: null }
    },
  }
}

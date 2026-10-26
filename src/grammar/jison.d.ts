// `import parser from './pscript.jison'` is compiled by `build/vite-plugin-jison.ts`.
declare module '*.jison' {
  const parser: import('./jison-types').JisonParserModule

  export default parser
}

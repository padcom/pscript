// Build-time view of the `jison` package: only what the Vite plugin uses.
declare module 'jison' {
  interface Generator {
    conflicts: number
    generate(): string
  }

  const Jison: {
    Generator: new (grammar: string, options?: Record<string, unknown>) => Generator
    print: (...args: unknown[]) => void
  }

  export default Jison
}

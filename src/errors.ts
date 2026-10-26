// Error contract (§5.9). Messages read `<fileName>:<line>:<column> <ScriptName>: <message>`,
// followed by a code excerpt; the formatting is added with the parser and the VM.

/**
 * Where an error happened.
 */
export interface ErrorLocation {
  /** script or module name */
  fileName?: string
  /** 1-based line */
  line?: number
  /** 1-based column */
  column?: number
}

/**
 * A frame of a script stack trace.
 */
export interface ScriptStackFrame {
  /** function name, or a placeholder for anonymous and top-level code */
  functionName: string
  /** 1-based line */
  line: number
  /** 1-based column */
  column: number
}

export class PScriptError extends Error {
  fileName?: string
  line?: number
  column?: number

  constructor(message: string, location: ErrorLocation = {}) {
    super(message)
    this.name = new.target.name
    this.fileName = location.fileName
    this.line = location.line
    this.column = location.column
  }
}

export class PScriptSyntaxError extends PScriptError {
  /** source line plus a caret under the offending column */
  excerpt?: string

  constructor(message: string, location: ErrorLocation = {}, excerpt?: string) {
    super(message, location)
    this.excerpt = excerpt
  }
}

export type ScriptErrorName = 'TypeError' | 'ReferenceError' | 'RangeError' | 'AccessError' | 'Error' | (string & {})

/**
 * Where a runtime error happened, plus the script stack.
 */
export interface RuntimeErrorLocation extends ErrorLocation {
  /** innermost frame first */
  scriptStack?: ScriptStackFrame[]
}

export class PScriptRuntimeError extends PScriptError {
  /** innermost frame first */
  scriptStack: ScriptStackFrame[]

  constructor(
    public scriptName: ScriptErrorName,
    message: string,
    /** the thrown script value (converted toHost) */
    public value: unknown,
    { scriptStack = [], ...location }: RuntimeErrorLocation = {},
  ) {
    super(message, location)
    this.scriptStack = scriptStack
  }
}

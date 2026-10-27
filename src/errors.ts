// Error contract (§5.9). Messages read `<fileName>:<line>:<column> <ScriptName>: <message>`,
// followed by a code excerpt (the source line and a caret).

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
  /** id of the module the code belongs to (absent for scripts) */
  fileName?: string
}

/**
 * Where an error happened, plus the code excerpt to show.
 */
export interface ErrorDetails extends ErrorLocation {
  /** source line plus a caret under the offending column */
  excerpt?: string
}

/**
 * Builds the excerpt for a location: the source line and a caret under the column.
 *
 * @param source the whole source text
 * @param line 1-based line
 * @param column 1-based column
 * @returns the excerpt, or `undefined` when the line does not exist
 */
export function formatExcerpt(source: string, line: number, column: number): string | undefined {
  const text = source.split(/\r\n|[\r\n\u2028\u2029]/)[line - 1]
  if (text === undefined) return undefined

  return `${text}\n${' '.repeat(Math.max(0, column - 1))}^`
}

function formatWhere({ fileName = '<script>', line, column = 1 }: ErrorLocation) {
  return line === undefined ? '' : `${fileName}:${line}:${column} `
}

function formatMessage(name: string, reason: string, details: ErrorDetails) {
  return `${formatWhere(details)}${name}: ${reason}${details.excerpt ? `\n${details.excerpt}` : ''}`
}

export class PScriptError extends Error {
  /** the message without location and excerpt */
  reason: string
  fileName?: string
  line?: number
  column?: number
  /** source line plus a caret under the offending column */
  excerpt?: string

  constructor(name: string, reason: string, details: ErrorDetails = {}) {
    super(formatMessage(name, reason, details))
    this.name = new.target.name
    this.reason = reason
    this.fileName = details.fileName
    this.line = details.line
    this.column = details.column
    this.excerpt = details.excerpt
  }
}

export class PScriptSyntaxError extends PScriptError {
  constructor(reason: string, details: ErrorDetails = {}) {
    super('SyntaxError', reason, details)
  }
}

export type ScriptErrorName = 'TypeError' | 'ReferenceError' | 'RangeError' | 'AccessError' | 'Error' | (string & {})

/**
 * Where a runtime error happened, plus the script stack.
 */
export interface RuntimeErrorLocation extends ErrorDetails {
  /** innermost frame first */
  scriptStack?: ScriptStackFrame[]
}

export class PScriptRuntimeError extends PScriptError {
  /** innermost frame first */
  scriptStack: ScriptStackFrame[]

  constructor(
    public scriptName: ScriptErrorName,
    reason: string,
    /** the thrown script value (converted toHost) */
    public value: unknown,
    { scriptStack = [], ...details }: RuntimeErrorLocation = {},
  ) {
    super(scriptName, reason, details)
    this.scriptStack = scriptStack
  }
}

// AST node builders used by the grammar actions (`yy.*`, §5.3).
import type {
  BinaryOperator,
  CallExpression,
  EmptyStatement,
  Expression,
  ExpressionStatement,
  Identifier,
  Literal,
  Program,
  SourceLocation,
  Statement,
  UnaryExpression,
} from './ast'
import { cookString } from './literals'

/**
 * A Jison token or rule location (lines 1-based, columns 0-based, end exclusive).
 */
export interface JisonLoc {
  /** first line */
  first_line: number
  /** last line */
  last_line: number
  /** first column (0-based) */
  first_column: number
  /** column after the last character (0-based) */
  last_column: number
}

/**
 * Converts a Jison location to an AST location (1-based lines and columns).
 *
 * @param loc Jison location
 * @returns AST location
 */
export function toLoc(loc: JisonLoc): SourceLocation {
  return {
    start: { line: loc.first_line, column: loc.first_column + 1 },
    end: { line: loc.last_line, column: loc.last_column + 1 },
  }
}

/**
 * Location covering the whole source.
 *
 * @param source source text
 * @returns AST location from the first to the last character
 */
export function sourceLoc(source: string): SourceLocation {
  const lines = source.split(/\r\n|[\r\n\u2028\u2029]/)

  return {
    start: { line: 1, column: 1 },
    end: { line: lines.length, column: lines[lines.length - 1].length + 1 },
  }
}

export const builders = {
  expressionStatement(expression: Expression, loc: JisonLoc): ExpressionStatement {
    return { type: 'ExpressionStatement', expression, loc: toLoc(loc) }
  },

  emptyStatement(loc: JisonLoc): EmptyStatement {
    return { type: 'EmptyStatement', loc: toLoc(loc) }
  },

  binary(operator: BinaryOperator, left: Expression, right: Expression, loc: JisonLoc): Expression {
    return { type: 'BinaryExpression', operator, left, right, loc: toLoc(loc) }
  },

  unary(operator: UnaryExpression['operator'], argument: Expression, loc: JisonLoc): UnaryExpression {
    return { type: 'UnaryExpression', operator, prefix: true, argument, loc: toLoc(loc) }
  },

  call(callee: Expression, args: Expression[], loc: JisonLoc): CallExpression {
    return { type: 'CallExpression', callee, arguments: args, optional: false, loc: toLoc(loc) }
  },

  literal(value: Literal['value'], raw: string, loc: JisonLoc): Literal {
    return { type: 'Literal', value, raw, loc: toLoc(loc) }
  },

  numberLiteral(raw: string, loc: JisonLoc): Literal {
    return builders.literal(Number(raw), raw, loc)
  },

  stringLiteral(raw: string, loc: JisonLoc): Literal {
    return builders.literal(cookString(raw), raw, loc)
  },

  identifier(name: string, loc: JisonLoc): Identifier {
    return { type: 'Identifier', name, loc: toLoc(loc) }
  },
}

export type Builders = typeof builders

export type { Program, Statement }

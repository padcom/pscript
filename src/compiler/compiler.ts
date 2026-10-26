// Single-pass compiler from AST to bytecode (§5.5).
import { PScriptSyntaxError, formatExcerpt } from '@/errors'
import type {
  BinaryExpression,
  CallExpression,
  Expression,
  Identifier,
  Literal,
  Node,
  Program,
  Statement,
  UnaryExpression,
} from '@/parser/ast'
import { parse } from '@/parser/parse'
import type { CompiledScript } from './function-proto'
import { Op } from './opcodes'
import { ProtoBuilder } from './proto-builder'

/**
 * Options of `compile()`.
 */
export interface CompileOptions {
  /** file name used in error messages */
  fileName?: string
}

/** Slot of the completion value in the script's top environment (§4.4.10). */
const COMPLETION_SLOT = 0

const BINARY_OPS: Partial<Record<BinaryExpression['operator'], Op>> = {
  '+': Op.ADD,
  '-': Op.SUB,
  '*': Op.MUL,
  '/': Op.DIV,
  '%': Op.MOD,
  '**': Op.POW,
}

const UNARY_OPS: Record<UnaryExpression['operator'], Op> = {
  '!': Op.NOT,
  '-': Op.NEG,
  '+': Op.POS,
  'typeof': Op.TYPEOF,
}

type Handler<T> = (compiler: Compiler, node: T) => void

const EXPRESSIONS: { [K in Expression['type']]?: Handler<Extract<Expression, { type: K }>> } = {
  Literal: (c, node) => c.literal(node),
  Identifier: (c, node) => c.identifier(node),
  UnaryExpression: (c, node) => c.unary(node),
  BinaryExpression: (c, node) => c.binary(node),
  CallExpression: (c, node) => c.call(node),
}

const STATEMENTS: { [K in Statement['type']]?: Handler<Extract<Statement, { type: K }>> } = {
  ExpressionStatement: (c, node) => {
    c.expression(node.expression)
    c.out.emit(Op.STORE, 0, COMPLETION_SLOT)
    c.out.emit(Op.POP)
  },
  EmptyStatement: () => {},
}

class Compiler {
  readonly out = new ProtoBuilder({ name: '', kind: 'script' })

  constructor(private source: string | undefined, private fileName: string | undefined) {}

  script(program: Program): CompiledScript {
    const { out } = this

    out.scopeSize = 1
    out.emit(Op.UNDEFINED)
    out.emit(Op.INIT, 0, COMPLETION_SLOT)

    for (const statement of program.body) this.statement(statement as Statement)
    out.emit(Op.LOAD, 0, COMPLETION_SLOT)
    out.emit(Op.HALT)

    return { main: out.build(), source: this.source, fileName: this.fileName }
  }

  statement(node: Statement) {
    const handler = STATEMENTS[node.type] as Handler<Statement> | undefined
    if (!handler) throw this.unsupported(node)
    handler(this, node)
  }

  expression(node: Expression) {
    const handler = EXPRESSIONS[node.type] as Handler<Expression> | undefined
    if (!handler) throw this.unsupported(node)
    handler(this, node)
  }

  literal(node: Literal) {
    const { value } = node
    if (value === null) this.out.emit(Op.NULL)
    else if (typeof value === 'boolean') this.out.emit(value ? Op.TRUE : Op.FALSE)
    else this.out.emit(Op.CONST, this.out.constant(value))
  }

  identifier(node: Identifier) {
    if (node.name === 'undefined') {
      this.out.emit(Op.UNDEFINED)

      return
    }
    this.out.mark(node.loc)
    this.out.emit(Op.LOAD_GLOBAL, this.out.constant(node.name))
  }

  unary(node: UnaryExpression) {
    const { argument } = node
    if (node.operator === 'typeof' && argument.type === 'Identifier' && argument.name !== 'undefined') {
      this.out.emit(Op.TYPEOF_GLOBAL, this.out.constant(argument.name))

      return
    }
    this.expression(argument)
    this.out.mark(node.loc)
    this.out.emit(UNARY_OPS[node.operator])
  }

  binary(node: BinaryExpression) {
    const op = BINARY_OPS[node.operator]
    if (op === undefined) throw this.unsupported(node)
    this.expression(node.left)
    this.expression(node.right)
    this.out.mark(node.loc)
    this.out.emit(op)
  }

  call(node: CallExpression) {
    if (node.callee.type === 'Super') throw this.unsupported(node)
    this.expression(node.callee)

    for (const argument of node.arguments) this.expression(argument)
    this.out.mark(node.loc)
    this.out.emit(Op.CALL, node.arguments.length)
  }

  unsupported(node: Node): PScriptSyntaxError {
    const { line, column } = node.loc.start
    const excerpt = this.source === undefined ? undefined : formatExcerpt(this.source, line, column)
    const what = 'operator' in node ? `'${node.operator}'` : node.type

    return new PScriptSyntaxError(`${what} is not supported yet`, { fileName: this.fileName, line, column, excerpt })
  }
}

/**
 * Compiles a script.
 *
 * @param source source text or a parsed program
 * @param options file name
 * @returns the compiled script
 * @throws {PScriptSyntaxError} on syntax errors
 */
export function compile(source: string | Program, options: CompileOptions = {}): CompiledScript {
  const program = typeof source === 'string' ? parse(source, { fileName: options.fileName }) : source
  const text = typeof source === 'string' ? source : undefined

  return new Compiler(text, options.fileName).script(program)
}

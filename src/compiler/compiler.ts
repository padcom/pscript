// Single-pass compiler from AST to bytecode (§5.5).
import { PScriptSyntaxError, formatExcerpt } from '@/errors'
import type {
  AssignmentExpression,
  BinaryExpression,
  BlockStatement,
  CallExpression,
  Expression,
  Identifier,
  Literal,
  Node,
  Program,
  SourceLocation,
  Statement,
  UnaryExpression,
  VariableDeclaration,
} from '@/parser/ast'
import { parse } from '@/parser/parse'
import type { CompiledScript } from './function-proto'
import { GlobalFlags, Op } from './opcodes'
import { ProtoBuilder } from './proto-builder'
import { Scope } from './scope'

/**
 * Options of `compile()`.
 */
export interface CompileOptions {
  /** file name used in error messages */
  fileName?: string
}

/** Slot of the completion value in the script's top environment (§4.4.10). */
const COMPLETION_SLOT = 0

const ARITHMETIC_OPS: Partial<Record<string, Op>> = {
  '+': Op.ADD,
  '-': Op.SUB,
  '*': Op.MUL,
  '/': Op.DIV,
  '%': Op.MOD,
  '**': Op.POW,
}

const BINARY_OPS: Partial<Record<BinaryExpression['operator'], Op>> = { ...ARITHMETIC_OPS }

const UNARY_OPS: Record<UnaryExpression['operator'], Op> = {
  '!': Op.NOT,
  '-': Op.NEG,
  '+': Op.POS,
  'typeof': Op.TYPEOF,
}

/** Short-circuit jumps of `&&`, `||`, `??` and their assignment forms. */
const LOGICAL_JUMPS: Record<string, Op> = {
  '&&': Op.AND_JUMP,
  '||': Op.OR_JUMP,
  '??': Op.NULLISH_JUMP,
}

type Handler<T> = (compiler: Compiler, node: T) => void

const EXPRESSIONS: { [K in Expression['type']]?: Handler<Extract<Expression, { type: K }>> } = {
  Literal: (c, node) => c.literal(node),
  Identifier: (c, node) => c.identifier(node),
  UnaryExpression: (c, node) => c.unary(node),
  BinaryExpression: (c, node) => c.binary(node),
  CallExpression: (c, node) => c.call(node),
  AssignmentExpression: (c, node) => c.assignment(node),
}

const STATEMENTS: { [K in Statement['type']]?: Handler<Extract<Statement, { type: K }>> } = {
  ExpressionStatement: (c, node) => c.expressionStatement(node.expression),
  VariableDeclaration: (c, node) => c.variableDeclaration(node),
  BlockStatement: (c, node) => c.block(node),
  EmptyStatement: () => {},
}

class Compiler {
  readonly out = new ProtoBuilder({ name: '', kind: 'script' })
  private scope = new Scope(null, 'script')

  constructor(private source: string | undefined, private fileName: string | undefined) {}

  script(program: Program): CompiledScript {
    const { out } = this
    const body = program.body as Statement[]

    this.declare(body, this.scope)

    for (const binding of this.scope.bindings.values()) {
      out.emit(Op.DECLARE_GLOBAL, out.constant(binding.name), binding.kind === 'const' ? GlobalFlags.Const : GlobalFlags.None)
    }
    out.scopeSize = 1
    out.emit(Op.UNDEFINED)
    out.emit(Op.INIT, 0, COMPLETION_SLOT)
    this.statements(body)
    out.emit(Op.LOAD, 0, COMPLETION_SLOT)
    out.emit(Op.HALT)

    return { main: out.build(), source: this.source, fileName: this.fileName }
  }

  // ---------------------------------------------------------------------------
  // Scopes

  // Pre-scan of a statement list: collects its lexical declarations (§5.5).
  private declare(body: Statement[], scope: Scope) {
    for (const statement of body) {
      if (statement.type === 'VariableDeclaration') this.declareVariables(statement, scope)
    }
  }

  private declareVariables(node: VariableDeclaration, scope: Scope) {
    for (const { id } of node.declarations) {
      if (!scope.declare(id.name, node.kind)) throw this.error(`Identifier '${id.name}' has already been declared`, id.loc)
    }
  }

  private load(name: string, loc: SourceLocation) {
    const resolution = this.scope.resolve(name)

    this.out.mark(loc)

    if (resolution.where === 'lexical') this.lexical(Op.LOAD, name, resolution)
    else this.out.emit(Op.LOAD_GLOBAL, this.out.constant(name))
  }

  private store(name: string, loc: SourceLocation) {
    const resolution = this.scope.resolve(name)
    if (resolution.where !== 'global' && resolution.binding.kind === 'const') {
      throw this.error(`Assignment to constant variable '${name}'`, loc)
    }

    this.out.mark(loc)

    if (resolution.where === 'lexical') this.lexical(Op.STORE, name, resolution)
    else this.out.emit(Op.STORE_GLOBAL, this.out.constant(name))
  }

  // Initialises a binding declared in the current scope.
  private initialize(name: string) {
    const resolution = this.scope.resolve(name)

    if (resolution.where === 'lexical') this.lexical(Op.INIT, name, resolution)
    else this.out.emit(Op.INIT_GLOBAL, this.out.constant(name))
  }

  private lexical(op: Op, name: string, { depth, slot }: { depth: number, slot: number }) {
    this.out.nameNext(name)
    this.out.emit(op, depth, slot)
  }

  // ---------------------------------------------------------------------------
  // Statements

  statements(body: Statement[]) {
    for (const statement of body) this.statement(statement)
  }

  statement(node: Statement) {
    const handler = STATEMENTS[node.type] as Handler<Statement> | undefined
    if (!handler) throw this.unsupported(node)
    handler(this, node)
  }

  expressionStatement(expression: Expression) {
    this.expression(expression)
    this.out.emit(Op.STORE, this.scope.envDepth, COMPLETION_SLOT)
    this.out.emit(Op.POP)
  }

  variableDeclaration(node: VariableDeclaration) {
    for (const { id, init } of node.declarations) {
      if (init) this.expression(init)
      else this.out.emit(Op.NULL) // `let x` starts as null (D37)
      this.initialize(id.name)
    }
  }

  block(node: BlockStatement) {
    const outer = this.scope
    const scope = new Scope(outer, 'block')

    this.declare(node.body, scope)

    if (scope.hasEnv) this.out.emit(Op.PUSH_ENV, scope.bindings.size)
    this.scope = scope
    this.statements(node.body)
    this.scope = outer

    if (scope.hasEnv) this.out.emit(Op.POP_ENV)
  }

  // ---------------------------------------------------------------------------
  // Expressions

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
    if (node.name === 'undefined') this.out.emit(Op.UNDEFINED)
    else this.load(node.name, node.loc)
  }

  unary(node: UnaryExpression) {
    const { argument } = node
    if (node.operator === 'typeof' && this.isGlobalName(argument)) {
      this.out.emit(Op.TYPEOF_GLOBAL, this.out.constant(argument.name))

      return
    }
    this.expression(argument)
    this.out.mark(node.loc)
    this.out.emit(UNARY_OPS[node.operator])
  }

  // `typeof x` of a name that is not lexical must not throw when it is undeclared.
  private isGlobalName(node: Expression): node is Identifier {
    return node.type === 'Identifier' && node.name !== 'undefined' && this.scope.resolve(node.name).where !== 'lexical'
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

  assignment(node: AssignmentExpression) {
    const { left, right, operator } = node
    if (left.type !== 'Identifier') throw this.unsupported(left)

    const base = operator.slice(0, -1)
    if (base in LOGICAL_JUMPS) {
      this.logicalAssignment(left, right, LOGICAL_JUMPS[base])

      return
    }
    if (operator === '=') this.expression(right)
    else this.compoundValue(node, ARITHMETIC_OPS[base] as Op)
    this.store(left.name, left.loc)
  }

  private compoundValue({ left, right, loc }: AssignmentExpression, op: Op) {
    this.expression(left)
    this.expression(right)
    this.out.mark(loc)
    this.out.emit(op)
  }

  // `a ||= b` assigns only when needed (§5.5).
  private logicalAssignment(left: Identifier, right: Expression, jump: Op) {
    this.expression(left)
    const end = this.out.emitJump(jump)

    this.expression(right)
    this.store(left.name, left.loc)
    this.out.patch(end)
  }

  // ---------------------------------------------------------------------------
  // Errors

  error(reason: string, { start: { line, column } }: SourceLocation): PScriptSyntaxError {
    const excerpt = this.source === undefined ? undefined : formatExcerpt(this.source, line, column)

    return new PScriptSyntaxError(reason, { fileName: this.fileName, line, column, excerpt })
  }

  unsupported(node: Node): PScriptSyntaxError {
    return this.error(`${'operator' in node ? `'${node.operator}'` : node.type} is not supported yet`, node.loc)
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

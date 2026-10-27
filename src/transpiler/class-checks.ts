// Class-definition checks at compile time (P7): the program's classes and interfaces are defined in a throwaway
// interpreter, so overriding, `final`, `implements`, inherited-name ambiguity and the other checks the VM runs when a
// class is defined (§4.5.6–4.5.8) are reported by psc, with the interpreter's own messages. Only the definitions
// run: other statements are left out, variables start as null and static fields have no initialiser. A class whose
// superclass or interfaces are not names of such definitions (a call, a host class) is left out too.
// Classes nested in functions and blocks are checked as well when their superclass and interfaces are top-level
// definitions; their methods are left empty (their bodies refer to locals the skeleton does not have).
import { compile } from '@/compiler/compiler'
import { PScriptRuntimeError, PScriptSyntaxError, formatExcerpt } from '@/errors'
import { Interpreter } from '@/interpreter'
import type {
  ClassDeclaration,
  ClassExpression,
  Expression,
  FunctionDeclaration,
  Identifier,
  InterfaceDeclaration,
  Literal,
  MemberExpression,
  MethodDefinition,
  Node,
  Pattern,
  Program,
  PropertyDefinition,
  SourceLocation,
  Statement,
  VariableDeclaration,
} from '@/parser/ast'
import { stdlibGlobalNames } from '@/stdlib'

type ClassNode = ClassDeclaration | ClassExpression

function nullLiteral(loc: SourceLocation): Literal {
  return { type: 'Literal', value: null, raw: 'null', loc }
}

function declaration(id: Identifier, init: Expression, kind: 'let' | 'const' = 'let'): VariableDeclaration {
  return { type: 'VariableDeclaration', kind, declarations: [{ type: 'VariableDeclarator', id, init, loc: id.loc }], loc: id.loc }
}

// Static fields would run their initialisers when the class is defined.
function withoutStaticValue(member: MethodDefinition | PropertyDefinition): MethodDefinition | PropertyDefinition {
  return member.type === 'PropertyDefinition' && member.static ? { ...member, value: null } : member
}

// Nested classes keep their signatures, not their code.
function withoutCode(member: MethodDefinition | PropertyDefinition): MethodDefinition | PropertyDefinition {
  if (member.type === 'PropertyDefinition') return { ...member, value: null }

  return { ...member, value: { ...member.value, body: { ...member.value.body, body: [] } } }
}

type Member = MethodDefinition | PropertyDefinition

function withMembers<T extends ClassNode>(node: T, map: (member: Member) => Member): T {
  return { ...node, body: { ...node.body, body: node.body.body.map(map) } }
}

function paramName(param: Pattern): Identifier {
  if (param.type === 'Identifier') return param

  return param.type === 'AssignmentPattern' ? param.left : param.argument
}

function declarationIds(statement: Statement): Identifier[] {
  if (statement.type === 'VariableDeclaration') return statement.declarations.map(({ id }) => id)

  return 'id' in statement && statement.id ? [statement.id as Identifier] : []
}

type ScopeNames = (node: never) => Identifier[]

function declarationsOf(node: Node | null): Identifier[] {
  return node?.type === 'VariableDeclaration' ? declarationIds(node) : []
}

// Names a node declares in the scope it opens (every declaration anywhere in a block counts).
const SCOPE_NAMES: Partial<Record<Node['type'], ScopeNames>> = {
  BlockStatement: (node: Extract<Node, { type: 'BlockStatement' }>) => node.body.flatMap(declarationIds),
  FunctionDeclaration: (node: Extract<Node, { type: 'FunctionDeclaration' }>) => node.params.map(paramName),
  FunctionExpression: (node: Extract<Node, { type: 'FunctionExpression' }>) => node.params.map(paramName),
  ArrowFunctionExpression: (node: Extract<Node, { type: 'ArrowFunctionExpression' }>) => node.params.map(paramName),
  CatchClause: (node: Extract<Node, { type: 'CatchClause' }>) => node.param ? [node.param] : [],
  ForStatement: (node: Extract<Node, { type: 'ForStatement' }>) => declarationsOf(node.init),
  ForOfStatement: (node: Extract<Node, { type: 'ForOfStatement' }>) => declarationsOf(node.left),
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'type' in value
}

function isClass(node: Node): node is ClassNode {
  return node.type === 'ClassDeclaration' || node.type === 'ClassExpression'
}

/**
 * Finds the classes inside functions and blocks whose superclass and interfaces are top-level definitions that no
 * local name shadows.
 */
class NestedClasses {
  private readonly found: ClassNode[] = []
  private readonly shadowed: string[][] = []

  constructor(private readonly topLevel: Set<string>) {}

  find(program: Program): ClassNode[] {
    this.visit(program.body, true)

    return this.found
  }

  // Top-level classes are in the skeleton already; the code inside them is walked.
  private visit(value: unknown, topLevel: boolean) {
    if (Array.isArray(value)) value.forEach(child => this.visit(child, topLevel))
    else if (isNode(value)) this.node(value, topLevel)
  }

  private node(node: Node, topLevel: boolean) {
    const names = SCOPE_NAMES[node.type]?.(node as never)
    if (!names) {
      this.inScope(node, topLevel)

      return
    }
    this.shadowed.push(names.map(({ name }) => name))
    this.inScope(node, false)
    this.shadowed.pop()
  }

  private inScope(node: Node, topLevel: boolean) {
    if (!topLevel && isClass(node) && this.heritageVisible(node)) this.found.push(node)
    this.children(node, topLevel)
  }

  private children(node: Node, topLevel: boolean) {
    Object.entries(node).forEach(([key, child]) => {
      if (key !== 'loc') this.visit(child, topLevel)
    })
  }

  private heritageVisible({ superClass, implements: interfaces }: ClassNode): boolean {
    const names = [...superClass ? [superClass] : [], ...interfaces]

    return names.length > 0 && names.every(node => node.type === 'Identifier' && this.isTopLevel(node.name))
  }

  private isTopLevel(name: string): boolean {
    return this.topLevel.has(name) && !this.shadowed.some(scope => scope.includes(name))
  }
}

type Kept = (skeleton: Skeleton, node: never) => Statement

/** The top-level statements a skeleton keeps (in their skeleton form). */
const SKELETON_STATEMENTS: Partial<Record<Statement['type'], Kept>> = {
  FunctionDeclaration: (skeleton, node: FunctionDeclaration) => skeleton.declare(node.id, node),
  VariableDeclaration: (skeleton, node: VariableDeclaration) => skeleton.variables(node),
  ClassDeclaration: (skeleton, node: ClassDeclaration) => skeleton.definition(node),
  InterfaceDeclaration: (skeleton, node: InterfaceDeclaration) => skeleton.definition(node),
}

/**
 * Builds the definitions-only program.
 */
class Skeleton {
  /** top-level names declared so far */
  private readonly declared = new Set<string>()
  /** top-level classes and interfaces that are defined in the skeleton */
  private readonly defined = new Set<string>()
  /** the skeleton defines at least one class */
  hasClasses = false

  constructor(private readonly program: Program) {}

  build(): Program {
    const body = this.program.body.flatMap(statement => this.statement(statement as Statement))
    const nested = new NestedClasses(this.defined).find(this.program).filter(node => this.canDefine(node))

    return { ...this.program, body: [...body, ...nested.map(node => this.nestedCheck(node))] }
  }

  private statement(node: Statement): Statement[] {
    const kept = SKELETON_STATEMENTS[node.type]?.(this, node as never)

    return kept ? [kept] : []
  }

  declare<T extends Statement>(id: Identifier, node: T, defined = false): T {
    this.declared.add(id.name)

    if (defined) this.defined.add(id.name)

    return node
  }

  variables(node: VariableDeclaration): VariableDeclaration {
    const declarations = node.declarations.map(declarator => {
      const { id, init } = declarator
      const keep = init?.type === 'ClassExpression' && this.canDefine(init)

      this.declare(id, node, keep)

      return { ...declarator, init: keep ? this.defineClass(init) : nullLiteral(declarator.loc) }
    })

    return { ...node, declarations }
  }

  definition(node: ClassDeclaration | InterfaceDeclaration): Statement {
    if (node.type === 'InterfaceDeclaration') {
      return this.declare(node.id, this.interfaceDefinition(node), this.evaluable(node.extends))
    }

    const keep = this.canDefine(node)

    return this.declare(node.id, keep ? this.defineClass(node) : declaration(node.id, nullLiteral(node.loc)), keep)
  }

  private interfaceDefinition(node: InterfaceDeclaration): Statement {
    return this.evaluable(node.extends) ? node : declaration(node.id, nullLiteral(node.loc))
  }

  private defineClass<T extends ClassNode>(node: T): T {
    this.hasClasses = true

    return withMembers(node, withoutStaticValue)
  }

  // `const $1 = class Name extends Base { m(a) {} … }`: the class keeps its name for the messages.
  private nestedCheck(node: ClassNode): Statement {
    const expression: ClassExpression = { ...withMembers(node, withoutCode), type: 'ClassExpression' }
    const id: Identifier = { type: 'Identifier', name: `$${this.declared.size}`, loc: node.loc }

    this.declared.add(id.name)
    this.hasClasses = true

    return declaration(id, expression, 'const')
  }

  private canDefine(node: ClassNode): boolean {
    return this.evaluable([...node.superClass ? [node.superClass] : [], ...node.implements])
  }

  // Names of classes or interfaces defined earlier in the skeleton, or stdlib globals (`Error`).
  private evaluable(nodes: (Expression | MemberExpression)[]): boolean {
    return nodes.every(node => node.type === 'Identifier' && this.isDefinition(node.name))
  }

  private isDefinition(name: string): boolean {
    return this.defined.has(name) || (!this.declared.has(name) && stdlibGlobalNames().has(name))
  }
}

// A class-definition error of the VM, as a compile-time error at the same place.
function definitionError({ reason, line, column }: PScriptRuntimeError, source: string, fileName?: string): PScriptSyntaxError {
  const excerpt = line === undefined ? undefined : formatExcerpt(source, line, column ?? 1)

  return new PScriptSyntaxError(reason, { fileName, line, column, excerpt })
}

function run(definitions: Program, fileName?: string) {
  try {
    new Interpreter({ stdout: () => {} }).execute(compile(definitions, { fileName }))

    return null
  } catch (error) {
    // the program itself compiled: a skeleton that does not is a limit of the skeleton, not an error
    if (error instanceof PScriptRuntimeError || error instanceof PScriptSyntaxError) return error
    throw error
  }
}

/**
 * Defines the program's classes and interfaces in a throwaway interpreter.
 *
 * @param program the program (already compiled without errors)
 * @param source the source text, for code excerpts
 * @param fileName the file name used in error messages
 * @throws {PScriptSyntaxError} when a class definition fails
 */
export function checkClassDefinitions(program: Program, source: string, fileName?: string) {
  const skeleton = new Skeleton(program)
  const definitions = skeleton.build()
  const error = skeleton.hasClasses ? run(definitions, fileName) : null

  if (error instanceof PScriptRuntimeError) throw definitionError(error, source, fileName)
}

// Destructuring patterns (§4.4.14, D40). Binding patterns have their own grammar; assignment patterns are parsed as
// object and array literals and converted when they turn out to be the target of `=` or of `for (… of …)`. The
// parts of a literal that only a pattern allows (`{ a = 1 }`, `...rest`) are recorded and reported if the literal
// stays an expression.
import type {
  ArrayExpression,
  ArrayPattern,
  AssignmentPattern,
  AssignmentProperty,
  Expression,
  Identifier,
  Literal,
  ObjectExpression,
  ObjectPattern,
  PatternElement,
  PatternTarget,
  Property,
  RestElement,
  SourceLocation,
} from './ast'
import { toLoc, type JisonLoc } from './ast-builders'

/**
 * How the pattern builders report syntax errors.
 */
export interface PatternErrors {
  /** an error at a node */
  at(reason: string, loc: SourceLocation): Error
}

type CoverNode = Property | RestElement

const COVER_ERRORS: Record<CoverNode['type'], string> = {
  Property: 'Invalid shorthand property initializer',
  RestElement: "'...' is only supported in destructuring patterns",
}

function before(a: SourceLocation, b: SourceLocation): boolean {
  return a.start.line < b.start.line || (a.start.line === b.start.line && a.start.column < b.start.column)
}

function assignmentPattern(left: PatternTarget, right: Expression, loc: SourceLocation): AssignmentPattern {
  return { type: 'AssignmentPattern', left, right, loc }
}

function patternProperty(
  key: Identifier | Literal,
  value: PatternElement,
  shorthand: boolean,
  loc: SourceLocation,
): AssignmentProperty {
  return { type: 'Property', key, value, kind: 'init', method: false, shorthand, computed: false, loc }
}

/** Targets that stay as they are: names are checked, members and converted patterns are taken. */
const KEPT_TARGETS = new Set(['Identifier', 'MemberExpression', 'ObjectPattern', 'ArrayPattern'])

const DESTRUCTURING = 'destructuring assignment'

/**
 * The pattern builders and conversions of one parse.
 */
export class PatternBuilder {
  /** pattern-only parts of literals that have not become patterns (yet) */
  private readonly covers = new Set<CoverNode>()

  constructor(private readonly errors: PatternErrors, private readonly keywords: Set<string>) {}

  /**
   * The target of `=` or of `for (… of …)`: object and array literals become assignment patterns.
   *
   * @param node the parsed target
   * @param what the construct, for the error message
   * @returns the target
   */
  toTarget(node: Expression | PatternTarget, what: string): PatternTarget {
    if (node.type === 'ObjectExpression') return this.toObjectPattern(node)
    if (node.type === 'ArrayExpression') return this.toArrayPattern(node)

    return this.keptTarget(node, what)
  }

  private keptTarget(node: Expression | PatternTarget, what: string): PatternTarget {
    if (!KEPT_TARGETS.has(node.type)) throw this.errors.at(`Invalid ${what} target`, node.loc)
    if (node.type === 'Identifier' && node.name === 'undefined') throw this.errors.at("Cannot assign to 'undefined'", node.loc)

    return node as PatternTarget
  }

  /**
   * Reports the first pattern-only part of a literal that stayed an expression.
   */
  checkCovers() {
    const earlier = (found: CoverNode | null, node: CoverNode) => found && !before(node.loc, found.loc) ? found : node
    const first = [...this.covers].reduce<CoverNode | null>(earlier, null)
    if (first) throw this.errors.at(COVER_ERRORS[first.type], first.loc)
  }

  /**
   * Records a part of a literal that only a pattern allows.
   *
   * @param node the part
   * @returns the part
   */
  cover<T extends CoverNode>(node: T): T {
    this.covers.add(node)

    return node
  }

  /**
   * A name bound by a shorthand property.
   *
   * @param id the name
   * @returns the name
   */
  shorthandName(id: Identifier): Identifier {
    if (this.keywords.has(id.name)) throw this.errors.at(`Unexpected keyword '${id.name}' in shorthand property`, id.loc)

    return id
  }

  private uncover<T extends CoverNode>(node: T): T {
    this.covers.delete(node)

    return node
  }

  // `[a = 1] = …`: the element was parsed as an assignment.
  private toElement(node: Expression | RestElement): PatternElement | RestElement {
    if (node.type === 'RestElement') return this.uncover(node)
    if (node.type !== 'AssignmentExpression' || node.operator !== '=') return this.toTarget(node, DESTRUCTURING)

    return assignmentPattern(this.toTarget(node.left, DESTRUCTURING), node.right, node.loc)
  }

  private toProperty(property: Property | RestElement): AssignmentProperty | RestElement {
    if (property.type === 'RestElement') return this.uncover(property)

    const { key, value, shorthand, loc } = this.uncover(this.dataProperty(property))
    const target = shorthand ? value as Identifier | AssignmentPattern : this.toElement(value) as PatternElement

    return patternProperty(key as Identifier | Literal, target, shorthand, loc)
  }

  // Methods and accessors are not targets.
  private dataProperty(property: Property): Property {
    if (property.kind !== 'init' || property.method) throw this.errors.at(`Invalid ${DESTRUCTURING} target`, property.loc)

    return property
  }

  private lastRest(items: { type: string }[], loc: SourceLocation) {
    const rest = items.findIndex(item => item.type === 'RestElement')
    if (rest >= 0 && rest < items.length - 1) throw this.errors.at('A rest element must be last in a destructuring pattern', loc)
  }

  private toObjectPattern(node: ObjectExpression): ObjectPattern {
    const properties = (node.properties as (Property | RestElement)[]).map(property => this.toProperty(property))

    this.lastRest(properties, node.loc)

    return { type: 'ObjectPattern', properties, loc: node.loc }
  }

  private toArrayPattern(node: ArrayExpression): ArrayPattern {
    const elements = (node.elements as (Expression | RestElement)[]).map(element => this.toElement(element))

    this.lastRest(elements, node.loc)

    return { type: 'ArrayPattern', elements, loc: node.loc }
  }
}

/**
 * The `yy` helpers of patterns.
 *
 * @param patterns the parse's pattern builder
 * @returns the helpers
 */
export function patternHelpers(patterns: PatternBuilder) {
  return {
    objectPattern(properties: (AssignmentProperty | RestElement)[], loc: JisonLoc): ObjectPattern {
      return { type: 'ObjectPattern', properties, loc: toLoc(loc) }
    },
    arrayPattern(elements: (PatternElement | RestElement)[], loc: JisonLoc): ArrayPattern {
      return { type: 'ArrayPattern', elements, loc: toLoc(loc) }
    },
    patternProperty(key: Identifier | Literal, value: PatternElement, loc: JisonLoc): AssignmentProperty {
      return patternProperty(key, value, false, toLoc(loc))
    },
    // `{ a }` / `{ a = 1 }` in a binding pattern.
    shorthandPatternProperty(id: Identifier, init: Expression | null, loc: JisonLoc): AssignmentProperty {
      const name = patterns.shorthandName(id)

      return patternProperty(id, init ? assignmentPattern(name, init, toLoc(loc)) : name, true, toLoc(loc))
    },
    // `{ a = 1 }` in an object literal: valid only if the literal becomes a pattern.
    coverInitializedName(id: Identifier, init: Expression, loc: JisonLoc): Property {
      const value = assignmentPattern(patterns.shorthandName(id), init, toLoc(loc))

      return patterns.cover(patternProperty(id, value, true, toLoc(loc)) as unknown as Property)
    },
    // `...rest` in an object or array literal: valid only if the literal becomes a pattern.
    coverRest(argument: Identifier, loc: JisonLoc): Expression {
      return patterns.cover<RestElement>({ type: 'RestElement', argument, loc: toLoc(loc) }) as unknown as Expression
    },
  }
}

// Inline helpers of the emitted code (§11.3, P4, P6): emitted once at the top of a file when used.
import type { Node } from '@/parser/ast'

const INTERFACE = `const $interface = (() => {
  const implemented = new WeakMap();
  const extendsInterface = (iface, target) =>
    iface === target || iface.parents.some(parent => extendsInterface(parent, target));
  const define = (name, parents) => Object.freeze({
    name,
    parents,
    toString: () => \`[interface \${name}]\`,
    [Symbol.hasInstance](value) {
      let proto = Object(value) === value ? Object.getPrototypeOf(value) : null;
      for (; proto; proto = Object.getPrototypeOf(proto)) {
        if ((implemented.get(proto.constructor) ?? []).some(iface => extendsInterface(iface, this))) return true;
      }
      return false;
    },
  });
  define.implement = (cls, interfaces) => implemented.set(cls, interfaces);
  return define;
})();`

/** The helpers, by the base name the emitter asks for. */
const HELPERS: Record<string, (name: string) => string> = {
  // P6: `print` writes its arguments like `console.log`
  print: name => `const ${name} = (...args) => console.log(...args);`,
  // P4, D39: `typeof null` is 'null'
  typeof: name => `function ${name}(value) {\n  return value === null ? 'null' : typeof value;\n}`,
  // P8: interfaces are values for `instanceof` (D32); classes record what they implement
  interface: name => INTERFACE.replaceAll('$interface', name),
}

// Every identifier name in a tree (also property keys: a safe over-approximation of the names in use).
function collectNames(node: unknown, names: Set<string>) {
  if (Array.isArray(node)) node.forEach(child => collectNames(child, names))
  // eslint-disable-next-line no-use-before-define -- mutual recursion
  else if (node && typeof node === 'object') collectNodeNames(node as Node, names)
}

function collectNodeNames(node: Node, names: Set<string>) {
  if (node.type === 'Identifier') names.add(node.name)

  Object.entries(node).forEach(([key, child]) => {
    if (key !== 'loc') collectNames(child, names)
  })
}

/**
 * The helpers a file uses, named so that they cannot clash with the program's own names.
 */
export class Helpers {
  private readonly names = new Set<string>()
  private readonly used = new Map<string, string>()

  constructor(program: Node) {
    collectNames(program, this.names)
  }

  /**
   * Marks a helper as used.
   *
   * @param helper the helper (`typeof`, …)
   * @returns the name to call it by
   */
  use(helper: string): string {
    let name = this.used.get(helper)

    if (name === undefined) {
      name = this.uniqueName(`$${helper}`)
      this.used.set(helper, name)
    }

    return name
  }

  /**
   * Reserves a name for a local of the emitted code.
   *
   * @param base the preferred name
   * @returns a name no program identifier uses
   */
  reserve(base: string): string {
    return this.uniqueName(base)
  }

  /**
   * Uses `print` under its own name: it stands for the PScript global (P6).
   */
  usePrint() {
    this.used.set('print', 'print')
  }

  private uniqueName(base: string): string {
    let name = base

    for (let i = 2; this.names.has(name); i++) name = `${base}${i}`
    this.names.add(name)

    return name
  }

  /**
   * The code of the used helpers, in a stable order.
   *
   * @returns one entry per helper
   */
  code(): string[] {
    return Object.keys(HELPERS).filter(helper => this.used.has(helper)).map(helper => HELPERS[helper](this.used.get(helper)!))
  }
}

// Bytecode contract (§5.4): the instruction set.
// Each instruction is an opcode followed by its operands, one number each, in `FunctionProto.code`.
// Jump operands are absolute offsets into `code`. Stack effects are written `before → after`,
// with the top of the stack rightmost.

export enum Op {
  CONST,
  UNDEFINED,
  NULL,
  TRUE,
  FALSE,
  POP,
  DUP,
  DUP2,
  SWAP,
  ROT3,
  ROT4,
  LOAD,
  STORE,
  INIT,
  LOAD_GLOBAL,
  STORE_GLOBAL,
  DECLARE_GLOBAL,
  INIT_GLOBAL,
  TYPEOF_GLOBAL,
  LOAD_IMPORT,
  PUSH_ENV,
  POP_ENV,
  COPY_ENV,
  GET_PROP,
  SET_PROP,
  GET_INDEX,
  SET_INDEX,
  GET_PROP_PRIV,
  SET_PROP_PRIV,
  GET_SUPER,
  GET_SUPER_INDEX,
  ADD,
  SUB,
  MUL,
  DIV,
  MOD,
  POW,
  EQ,
  NE,
  LT,
  LE,
  GT,
  GE,
  INSTANCEOF,
  IN,
  NEG,
  POS,
  NOT,
  TYPEOF,
  TO_STRING,
  CONCAT,
  INC,
  DEC,
  JUMP,
  JUMP_IF_FALSE,
  JUMP_IF_TRUE,
  AND_JUMP,
  OR_JUMP,
  NULLISH_JUMP,
  ARRAY,
  OBJECT,
  DEFINE_PROP,
  DEFINE_PROP_INDEX,
  DEFINE_GETTER,
  DEFINE_SETTER,
  CLOSURE,
  CALL,
  CALL_METHOD,
  NEW,
  SUPER_CALL,
  RETURN,
  THIS,
  CLASS,
  LOAD_IMPLICIT,
  STORE_IMPLICIT,
  CALL_IMPLICIT,
  INTERFACE,
  GET_ITER,
  ITER_NEXT,
  THROW,
  TRY,
  END_TRY,
  ENTER_FINALLY,
  END_FINALLY,
  HALT,
}

/**
 * Static description of an opcode, used by the compiler, the disassembler and the assembler.
 */
export interface OpcodeInfo {
  /** operand names, in encoding order */
  operands: readonly string[]
  /** indexes into `operands` that hold absolute jump targets */
  jumps: readonly number[]
  /** stack effect, `before → after` */
  stack: string
}

/** Flags of `DECLARE_GLOBAL`. */
export enum GlobalFlags {
  None = 0,
  Const = 1,
}

// LOAD_IMPLICIT / STORE_IMPLICIT / CALL_IMPLICIT carry their fallback inline (§5.4: "fallback
// operands follow i"). To keep the encoding fixed-width there are always two: `depth slot` when
// the implicit name's `outer` is 'lexical', `k(name) 0` when it is 'global'.

const JUMP_OPERANDS = new Set(['target', 'catchTarget', 'finallyTarget'])

function info(operands: string, stack: string): OpcodeInfo {
  const names = operands ? operands.split(' ') : []

  return {
    operands: names,
    jumps: names.flatMap((name, i) => JUMP_OPERANDS.has(name) ? [i] : []),
    stack,
  }
}

export const OPCODES: Readonly<Record<Op, OpcodeInfo>> = {
  [Op.CONST]: info('k', '→ v'), // push constants[k]
  [Op.UNDEFINED]: info('', '→ v'),
  [Op.NULL]: info('', '→ v'),
  [Op.TRUE]: info('', '→ v'),
  [Op.FALSE]: info('', '→ v'),
  [Op.POP]: info('', 'v →'),
  [Op.DUP]: info('', 'a → a a'),
  [Op.DUP2]: info('', 'a b → a b a b'), // compound member assignment
  [Op.SWAP]: info('', 'a b → b a'),
  [Op.ROT3]: info('', 'a b c → c a b'), // postfix member update
  [Op.ROT4]: info('', 'a b c d → d a b c'), // postfix computed-member update
  [Op.LOAD]: info('depth slot', '→ v'), // TDZ check
  [Op.STORE]: info('depth slot', 'v → v'), // assignment; TDZ check
  [Op.INIT]: info('depth slot', 'v →'), // initialise let/const/class/function binding
  [Op.LOAD_GLOBAL]: info('k', '→ v'), // script bindings, then globals; ReferenceError if missing
  [Op.STORE_GLOBAL]: info('k', 'v → v'), // ReferenceError if undeclared; TypeError if read-only
  [Op.DECLARE_GLOBAL]: info('k flags', '→'), // top-level let/const/class/function of a script; flags: GlobalFlags
  [Op.INIT_GLOBAL]: info('k', 'v →'),
  [Op.TYPEOF_GLOBAL]: info('k', '→ s'), // typeof undeclared
  [Op.LOAD_IMPORT]: info('i', '→ v'), // live binding through frame.module.importCells[i]; TDZ check
  [Op.PUSH_ENV]: info('size', '→'), // new block environment
  [Op.POP_ENV]: info('', '→'),
  [Op.COPY_ENV]: info('', '→'), // per-iteration copy of the innermost env (for-let)
  [Op.GET_PROP]: info('k', 'obj → v'), // runtime.getProperty with the frame's home class
  [Op.SET_PROP]: info('k', 'obj v → v'),
  [Op.GET_INDEX]: info('', 'obj key → v'),
  [Op.SET_INDEX]: info('', 'obj key v → v'),
  [Op.GET_PROP_PRIV]: info('depth k', 'obj → v'), // private member of the class depth hops out, else GET_PROP
  [Op.SET_PROP_PRIV]: info('depth k', 'obj v → v'), // same for writes
  [Op.GET_SUPER]: info('k', '→ v'), // lookup on the home object's parent prototype
  [Op.GET_SUPER_INDEX]: info('', 'key → v'),
  [Op.ADD]: info('', 'a b → r'),
  [Op.SUB]: info('', 'a b → r'),
  [Op.MUL]: info('', 'a b → r'),
  [Op.DIV]: info('', 'a b → r'),
  [Op.MOD]: info('', 'a b → r'),
  [Op.POW]: info('', 'a b → r'),
  [Op.EQ]: info('', 'a b → bool'), // strict, no coercion (D1)
  [Op.NE]: info('', 'a b → bool'), // strict, no coercion (D1)
  [Op.LT]: info('', 'a b → bool'),
  [Op.LE]: info('', 'a b → bool'),
  [Op.GT]: info('', 'a b → bool'),
  [Op.GE]: info('', 'a b → bool'),
  [Op.INSTANCEOF]: info('', 'a b → bool'), // classes and interfaces (D32)
  [Op.IN]: info('', 'a b → bool'), // applies the access rules
  [Op.NEG]: info('', 'a → r'),
  [Op.POS]: info('', 'a → r'), // ToNumber
  [Op.NOT]: info('', 'a → r'),
  [Op.TYPEOF]: info('', 'a → r'),
  [Op.TO_STRING]: info('', 'v → s'), // ToString; may call a script toString()
  [Op.CONCAT]: info('n', 's1…sn → s'), // template literals
  [Op.INC]: info('', 'n → n+1'), // operand already ToNumber'd via POS
  [Op.DEC]: info('', 'n → n-1'), // operand already ToNumber'd via POS
  [Op.JUMP]: info('target', '→'),
  [Op.JUMP_IF_FALSE]: info('target', 'v →'), // pops
  [Op.JUMP_IF_TRUE]: info('target', 'v →'), // pops
  [Op.AND_JUMP]: info('target', 'v → v | (popped)'), // if falsy: keep and jump; else pop
  [Op.OR_JUMP]: info('target', 'v → v | (popped)'), // if truthy: keep and jump; else pop
  [Op.NULLISH_JUMP]: info('target', 'v → v | (popped)'), // if NOT nullish: keep and jump; else pop
  [Op.ARRAY]: info('n', 'v1…vn → arr'),
  [Op.OBJECT]: info('', '→ obj'),
  [Op.DEFINE_PROP]: info('k', 'obj v → obj'), // object literal init; sets home object for methods
  [Op.DEFINE_PROP_INDEX]: info('', 'obj key v → obj'), // computed keys (COULD)
  [Op.DEFINE_GETTER]: info('k', 'obj fn → obj'), // object-literal getter (R18)
  [Op.DEFINE_SETTER]: info('k', 'obj fn → obj'), // object-literal setter (R18)
  [Op.CLOSURE]: info('k', '→ fn'), // captures env, this (arrows), home class/object
  [Op.CALL]: info('argc', 'fn a1…an → r'), // this = null (D37)
  [Op.CALL_METHOD]: info('argc', 'recv fn a1…an → r'), // this = recv
  [Op.NEW]: info('argc', 'ctor a1…an → obj'),
  [Op.SUPER_CALL]: info('argc', 'a1…an → this'), // binds this, runs field initialisers
  [Op.RETURN]: info('', 'v →'),
  [Op.THIS]: info('', '→ this'), // ReferenceError in a derived ctor before super()
  [Op.CLASS]: info('k', 'superclass|EMPTY i1…in → cls'), // n = template.interfaceCount
  [Op.LOAD_IMPLICIT]: info('i fallbackA fallbackB', '→ v'), // implicit member read (D33); fallback: depth slot or k(name) 0
  [Op.STORE_IMPLICIT]: info('i fallbackA fallbackB', 'v → v'), // implicit member write
  [Op.CALL_IMPLICIT]: info('i argc fallbackA fallbackB', 'a1…an → r'), // implicit method call
  [Op.INTERFACE]: info('k n', 'p1…pn → iface'), // interface from template and n parents
  [Op.GET_ITER]: info('', 'iterable → iter'), // arrays/strings; else TypeError
  [Op.ITER_NEXT]: info('target', 'iter → iter v | (pops iter, jumps)'),
  [Op.THROW]: info('', 'v →'),
  [Op.TRY]: info('catchTarget finallyTarget', '→'), // push handler (-1 = none)
  [Op.END_TRY]: info('', '→'), // pop handler
  [Op.ENTER_FINALLY]: info('', '→'), // completion-record handling (§5.6.5)
  [Op.END_FINALLY]: info('', '→'), // completion-record handling (§5.6.5)
  [Op.HALT]: info('', 'v →'), // end of script; v is the completion value
}

// Members of class instances and classes (§4.5.3): private first (home class and enclosing classes),
// then the member index with protected checks, then hidden privates (AccessError), then D36's "no member".
import { find, functionProperty, noMember, onlyGetter, own, resolve, type Found } from './lookup'
import { accessError, typeError } from './script-error'
import {
  Class,
  HostObject,
  ModuleNamespace,
  type Accessor,
  type AccessContext,
  type HostAccess,
  type MemberEntry,
  Object as ScriptObject,
  type PrivateEntry,
  type PrivateKey,
  type Value,
} from './values'

function enclosingClasses(home: Class | null): Class[] {
  const classes: Class[] = []

  for (let current = home; current; current = current.outerClass) classes.push(current)

  return classes
}

/**
 * Whether `sub` is `cls` or one of its subclasses.
 *
 * @param sub a class
 * @param cls another class
 * @returns true when `sub` extends `cls` (directly or not) or is `cls`
 */
export function extendsClass(sub: Class | null, cls: Class): boolean {
  let current = sub

  while (current && current !== cls) current = current.superClass

  return current !== null
}

function sameLine(a: Class, b: Class): boolean {
  return extendsClass(a, b) || extendsClass(b, a)
}

// Protected members are usable from the declaring class's inheritance line, also from nested classes (D4).
function canUseProtected(home: Class | null, owner: Class): boolean {
  return enclosingClasses(home).some(cls => sameLine(cls, owner))
}

function privatesOf(cls: Class, isStatic: boolean): Map<string, PrivateEntry> {
  return isStatic ? cls.staticPrivateIndex : cls.privateIndex
}

function halfAccess(entry: MemberEntry, half: 'get' | 'set') {
  return (half === 'get' ? entry.getAccess : entry.setAccess) ?? entry.access
}

function onlySetter(key: string): never {
  throw typeError(`'${key}' has only a setter`)
}

function cannotAssignMethod(key: string, owner: Class): never {
  throw typeError(`Cannot assign to method '${key}' of class '${owner.name}'`)
}

function privateOwnerInChain(start: Class | null, key: string, isStatic: boolean): Class | null {
  let cls = start

  while (cls && !privatesOf(cls, isStatic).has(key)) cls = cls.superClass

  return cls
}

function ownStaticIn(start: Class | null, key: string): Found {
  let found: Found = null

  for (let cls = start; cls && !found; cls = cls.superClass) found = own(cls, key)

  return found
}

/**
 * The host object behind a member access, with the access to it.
 */
interface HostPart {
  /** the host object (or host class) */
  target: object
  /** reads and writes its properties */
  access: HostAccess
}

// The nearest host class in a class chain.
function hostClassOf(cls: Class | null): Class | null {
  let current = cls

  while (current && !current.host) current = current.superClass

  return current
}

function hostPartOf(cls: Class, target: object | undefined): HostPart | null {
  return target ? { target, access: cls.hostAccess as HostAccess } : null
}

function hostProps({ host, target }: HostObject): [string, Value][] {
  return host.keys(target).map(key => [key, host.get(target, key)])
}

function hasUndeclared(object: ScriptObject, key: string): boolean {
  return object.props.has(key) || find(object.proto, key) !== null
}

/**
 * One access to a member of a class instance (`isStatic` false) or a class (`isStatic` true).
 */
class MemberAccess {
  constructor(
    private ctx: AccessContext,
    private receiver: ScriptObject,
    readonly key: string,
    private isStatic: boolean,
  ) {}

  // The class whose member index applies: the instance's class, or the class itself for statics.
  get cls(): Class {
    return this.isStatic ? this.receiver as Class : this.receiver.klass as Class
  }

  get description(): string {
    return this.isStatic ? `Class '${this.cls.name}'` : this.cls.name || 'anonymous'
  }

  get entry(): MemberEntry | undefined {
    return (this.isStatic ? this.cls.staticMemberIndex : this.cls.memberIndex).get(this.key)
  }

  // Step 1: a private member of the home class (or an enclosing class) that the receiver has.
  privateOwner(): Class | undefined {
    for (let cls = this.ctx.homeClass; cls; cls = cls.outerClass) {
      if (privatesOf(cls, this.isStatic).has(this.key) && this.belongsTo(cls)) return cls
    }

    return undefined
  }

  belongsTo(cls: Class): boolean {
    return this.isStatic ? this.receiver === cls : extendsClass(this.receiver.klass ?? null, cls)
  }

  readPrivate(owner: Class): Value {
    const entry = privatesOf(owner, this.isStatic).get(this.key) as PrivateEntry
    if (entry.kind === 'field') return this.privateField(entry.key as PrivateKey)

    return entry.kind === 'method' ? entry.fn as Value : this.callGetter(entry.get)
  }

  private privateField(key: PrivateKey): Value {
    return this.receiver.privates?.get(key) ?? null
  }

  writePrivate(owner: Class, value: Value) {
    const entry = privatesOf(owner, this.isStatic).get(this.key) as PrivateEntry

    if (entry.kind === 'method') cannotAssignMethod(this.key, owner)
    if (entry.kind === 'accessor') this.callSetter(entry.set, owner, value)
    else this.storePrivate(entry.key as PrivateKey, value)
  }

  private storePrivate(key: PrivateKey, value: Value) {
    this.receiver.privates ??= new Map()
    this.receiver.privates.set(key, value)
  }

  private callGetter(getter: MemberEntry['get']): Value {
    return getter ? this.ctx.callFunction(getter, this.receiver, []) : onlySetter(this.key)
  }

  private callSetter(setter: MemberEntry['set'], owner: Class, value: Value) {
    if (!setter) onlyGetter(this.key, owner.name)
    this.ctx.callFunction(setter, this.receiver, [value])
  }

  // Step 2: protected members are usable only from the same inheritance line (D4).
  checkAccess(entry: MemberEntry, half: 'get' | 'set') {
    if (halfAccess(entry, half) !== 'protected' || canUseProtected(this.ctx.homeClass, entry.owner)) return

    const where = `of class '${entry.owner.name}' from outside its class hierarchy`

    throw accessError(`Cannot access protected member '${this.key}' ${where}`)
  }

  // Step 4: a private member of a class in the chain that the caller cannot use.
  checkHiddenPrivate() {
    const owner = privateOwnerInChain(this.cls, this.key, this.isStatic)

    if (owner) throw accessError(`Cannot access private member '${this.key}' of class '${owner.name}'`)
  }

  // A declared public/protected member: fields read the stored value (null until initialised, D37), methods give
  // their function, accessors call the getter.
  readDeclared(entry: MemberEntry): Value {
    this.checkAccess(entry, 'get')

    if (entry.kind === 'method') return entry.fn as Value

    return entry.kind === 'field' ? this.fieldValue() : this.callGetter(entry.get)
  }

  private fieldValue(): Value {
    if (!this.isStatic) return this.receiver.props.has(this.key) ? this.receiver.props.get(this.key) as Value : null

    const found = this.ownStatic()

    return found ? found[0] as Value : null
  }

  // Static fields live on the class that declares them and are inherited by subclasses.
  private ownStatic(): Found {
    return ownStaticIn(this.cls, this.key)
  }

  // Methods cannot be reassigned (D29); accessors call their setter. Returns whether the write was handled.
  writeDeclared(entry: MemberEntry, value: Value): boolean {
    this.checkAccess(entry, 'set')

    if (entry.kind === 'method') cannotAssignMethod(this.key, entry.owner)
    if (entry.kind === 'field') return false
    this.callSetter(entry.set, entry.owner, value)

    return true
  }

  // Not declared: built-in data on the prototypes (an error's `name`), the host part of a host-class instance (or a
  // host class's statics), else a hidden private or no member at all.
  readUndeclared(): Value {
    if (this.receiver.props.has(this.key)) return this.receiver.props.get(this.key) as Value
    this.checkHiddenPrivate()

    const host = this.hostPart()
    if (host) return host.access.get(host.target, this.key)

    const found = this.builtin() ?? noMember(this.description, this.key)

    return resolve(this.ctx, found[0], this.receiver)
  }

  // Function properties of classes, data and methods of built-in prototypes.
  private builtin(): Found {
    const fnProperty = this.isStatic ? functionProperty(this.cls, this.key) : null

    return fnProperty ?? find(this.receiver.proto, this.key)
  }

  // Host parts (of instances of script classes extending host classes, and of host classes) are open (§5.8.1).
  hostPart(): HostPart | null {
    const cls = hostClassOf(this.cls)

    return cls && hostPartOf(cls, this.isStatic ? cls.host : this.receiver.hostTarget)
  }

  checkUndeclaredWrite() {
    if (!this.isStatic && hasUndeclared(this.receiver, this.key)) return
    this.checkHiddenPrivate()

    if (this.isStatic) this.notExtensible()
    noMember(this.description, this.key)
  }

  private notExtensible(): never {
    throw typeError(`Cannot add property '${this.key}' to class '${this.cls.name}': classes are not extensible`)
  }

  store(value: Value) {
    if (this.receiver.frozen) throw typeError(`Cannot assign to read only property '${this.key}' of object`)
    this.receiver.props.set(this.key, value)
  }
}

function read(access: MemberAccess): Value {
  const owner = access.privateOwner()
  if (owner) return access.readPrivate(owner)

  const { entry } = access

  return entry ? access.readDeclared(entry) : access.readUndeclared()
}

function writeUndeclared(access: MemberAccess, value: Value) {
  const host = access.hostPart()
  if (host) {
    host.access.set(host.target, access.key, value)

    return
  }
  access.checkUndeclaredWrite()
  access.store(value)
}

function writePublic(access: MemberAccess, value: Value) {
  const { entry } = access
  if (!entry) writeUndeclared(access, value)
  else if (!access.writeDeclared(entry, value)) access.store(value)
}

function write(access: MemberAccess, value: Value) {
  const owner = access.privateOwner()
  if (owner) {
    access.writePrivate(owner, value)

    return
  }
  writePublic(access, value)
}

/**
 * Reads a member of a class instance (§4.5.3).
 *
 * @param ctx access context (its home class decides private and protected access)
 * @param object the instance
 * @param key member name
 * @returns the value
 */
export function getInstanceMember(ctx: AccessContext, object: ScriptObject, key: string): Value {
  return read(new MemberAccess(ctx, object, key, false))
}

/**
 * Reads a static member of a class (§4.5.3, D29).
 *
 * @param ctx access context
 * @param cls the class
 * @param key member name
 * @returns the value
 */
export function getClassMember(ctx: AccessContext, cls: Class, key: string): Value {
  return read(new MemberAccess(ctx, cls, key, true))
}

/**
 * Writes a member of a class instance: declared fields (and inherited built-in data such as an error's `name`)
 * are writable; methods and undeclared names are not (D29, D36).
 *
 * @param ctx access context
 * @param object the instance
 * @param key member name
 * @param value the new value
 */
export function setInstanceMember(ctx: AccessContext, object: ScriptObject, key: string, value: Value) {
  write(new MemberAccess(ctx, object, key, false), value)
}

/**
 * Writes a static member: static fields (own or inherited) are writable; static methods, name/length and new
 * names are not (D29).
 *
 * @param ctx access context
 * @param cls the class
 * @param key member name
 * @param value the new value
 */
export function setClassMember(ctx: AccessContext, cls: Class, key: string, value: Value) {
  write(new MemberAccess(ctx, cls, key, true), value)
}

// The class `depth` hops out from the home class (GET_PROP_PRIV / SET_PROP_PRIV, §5.6.6).
function enclosingAt(ctx: AccessContext, depth: number): Class | null {
  let cls = ctx.homeClass

  for (let i = 0; i < depth && cls; i++) cls = cls.outerClass

  return cls
}

/**
 * The operands of `GET_PROP_PRIV` / `SET_PROP_PRIV`.
 */
export interface PrivateRef {
  /** how many classes out from the home class */
  depth: number
  /** member name */
  key: string
}

function hasPrivate(cls: Class | null, receiver: Value, key: string): cls is Class {
  return cls !== null && receiver instanceof ScriptObject && privatesOf(cls, receiver === cls).has(key)
}

// The private member access of `GET_PROP_PRIV depth k`, when the receiver has that class's private member.
function privateAccess(ctx: AccessContext, receiver: Value, { depth, key }: PrivateRef): [MemberAccess, Class] | null {
  const cls = enclosingAt(ctx, depth)
  if (!hasPrivate(cls, receiver, key)) return null

  const access = new MemberAccess(ctx, receiver as ScriptObject, key, receiver === cls)

  return access.belongsTo(cls) ? [access, cls] : null
}

/**
 * `GET_PROP_PRIV depth k`: the private member of the class `depth` hops out from the home class, when the receiver
 * has it (§5.6.6).
 *
 * @param ctx access context
 * @param receiver the object read from
 * @param ref class depth and member name
 * @returns `[value]`, or null when the generic path applies
 */
export function getPrivateMember(ctx: AccessContext, receiver: Value, ref: PrivateRef): [Value] | null {
  const found = privateAccess(ctx, receiver, ref)

  return found && [found[0].readPrivate(found[1])]
}

/**
 * `SET_PROP_PRIV depth k`: writes the private member like {@link getPrivateMember} reads it.
 *
 * @param ctx access context
 * @param receiver the object written to
 * @param ref class depth and member name
 * @param value the new value
 * @returns whether the private member was written (false: use the generic path)
 */
export function setPrivateMember(ctx: AccessContext, receiver: Value, ref: PrivateRef, value: Value): boolean {
  const found = privateAccess(ctx, receiver, ref)
  if (found) found[0].writePrivate(found[1], value)

  return found !== null
}

function visibleEntry(ctx: AccessContext, entry: MemberEntry): boolean {
  return entry.access === 'public' || canUseProtected(ctx.homeClass, entry.owner)
}

/**
 * `key in object` for class instances and classes: true only for members the caller may use (§4.5.2).
 *
 * @param ctx access context
 * @param object an instance or a class
 * @param key member name
 * @returns whether the member exists and is accessible
 */
export function hasClassMember(ctx: AccessContext, object: ScriptObject, key: string): boolean {
  const access = new MemberAccess(ctx, object, key, object instanceof Class)
  if (access.privateOwner()) return true

  const { entry } = access

  return entry ? visibleEntry(ctx, entry) : hasUndeclared(object, key)
}

/**
 * Whether an own property of a class instance is public (reflection shows public members only, §4.5.2).
 *
 * @param object a class instance
 * @param key own property name
 * @returns true for public fields and built-in data
 */
export function isPublicField(object: ScriptObject, key: string): boolean {
  const entry = object.klass?.memberIndex.get(key)

  return !entry || entry.access === 'public'
}

/**
 * The own properties reflection shows (§4.5.2): public members only, for class instances; the exports of a module
 * namespace (§4.7.2).
 *
 * @param object any object
 * @returns key/value pairs in insertion order
 */
export function publicProps(object: ScriptObject): [string, Value | Accessor][] {
  if (object instanceof ModuleNamespace) return object.names.map(name => [name, object.read(name)])
  if (object instanceof HostObject) return hostProps(object)

  return [...object.props].filter(([key]) => isPublicField(object, key))
}

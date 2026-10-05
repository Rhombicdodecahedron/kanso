// Kotlin semantics for translated code. Translated bundles call these through `$rt.k`.
//
// Representation: List/Array -> JS Array, Map -> Map, Set -> Set, Char -> 1-length string,
// ByteArray -> Int8Array, Long/Int/Double -> number, null/undefined -> null.

export type Fn = (...args: any[]) => any;

// ---------- exceptions ----------

export class Throwable extends Error {
  cause: unknown;
  constructor(message?: string | null, cause?: unknown) {
    super(message ?? undefined);
    this.name = new.target.name;
    this.cause = cause ?? null;
  }
  get localizedMessage(): string | null {
    return this.message || null;
  }
  getMessage(): string | null {
    return this.message || null;
  }
  printStackTrace(): void {
    console.warn(this);
  }
}
export class Exception extends Throwable {}
export class RuntimeException extends Exception {}
export class IllegalStateException extends RuntimeException {}
export class IllegalArgumentException extends RuntimeException {}
export class NumberFormatException extends IllegalArgumentException {}
export class NullPointerException extends RuntimeException {}
export class IndexOutOfBoundsException extends RuntimeException {}
export class NoSuchElementException extends RuntimeException {}
export class UnsupportedOperationException extends RuntimeException {}
export class ClassCastException extends RuntimeException {}
export class ArithmeticException extends RuntimeException {}
export class ConcurrentModificationException extends RuntimeException {}
export class NotImplementedError extends Throwable {}
export class IOException extends Exception {}
export class UnknownHostException extends IOException {}
export class SocketTimeoutException extends IOException {}
export class CancellationException extends IllegalStateException {}
export class SerializationException extends IllegalArgumentException {}
export class DateTimeException extends RuntimeException {}
export class DateTimeParseException extends DateTimeException {}
export class ParseException extends Exception {}
export class UnsupportedEncodingException extends IOException {}
export class GeneralSecurityException extends Exception {}
export class InterruptedException extends Exception {}
export class TimeoutCancellationException extends CancellationException {}

/** Kotlin's `catch (e: T)` - plain JS errors count as runtime exceptions. */
export function isCatch(e: unknown, T: any): boolean {
  if (T === Throwable || T === Exception || T === RuntimeException) return e instanceof Error || e instanceof Throwable;
  if (T === IllegalStateException && e instanceof TypeError) return false;
  return e instanceof T;
}

/** Thrown to unwind a non-local `break`/`continue` out of an inlined lambda. */
export class NonLocalJump {
  constructor(readonly token: object, readonly kind: 'break' | 'continue') {}
}

/** Thrown to unwind a non-local `return` out of an inlined lambda. */
export class NonLocalReturn {
  constructor(readonly token: object, readonly value: unknown) {}
}

export function nn<T>(x: T | null | undefined, what?: string): T {
  if (x === null || x === undefined) throw new NullPointerException(what ? `${what} was null` : 'Null value (!!)');
  return x;
}

export function error(message: unknown): never {
  throw new IllegalStateException(String(message));
}

// ---------- type predicates ----------

export const isStr = (x: unknown): x is string => typeof x === 'string';
export const isNum = (x: unknown): x is number => typeof x === 'number';
export const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
export const isArr = (x: unknown): x is any[] => Array.isArray(x);
export const isMap = (x: unknown): x is Map<any, any> => x instanceof Map;
export const isSet = (x: unknown): x is Set<any> => x instanceof Set;
export const isBytes = (x: unknown): x is Int8Array => x instanceof Int8Array;
export const isTyped = (x: unknown): boolean => ArrayBuffer.isView(x) && !(x instanceof DataView);

/** Values whose Kotlin behaviour comes only from the stdlib shim, never from JS methods. */
export function isBuiltin(x: unknown): boolean {
  return (
    x === null ||
    x === undefined ||
    typeof x !== 'object' ||
    (Array.isArray(x) && Object.getPrototypeOf(x) === Array.prototype) ||
    x instanceof Map ||
    x instanceof Set ||
    ArrayBuffer.isView(x) ||
    x instanceof RegExp
  );
}

// Type markers for `is`/`as` checks against Kotlin built-in types.
export const KTypes = {
  Any: (x: unknown) => x !== null && x !== undefined,
  String: isStr,
  CharSequence: isStr,
  Char: (x: unknown) => typeof x === 'string' && x.length === 1,
  Int: (x: unknown) => Number.isInteger(x),
  Long: (x: unknown) => Number.isInteger(x),
  Short: (x: unknown) => Number.isInteger(x),
  Byte: (x: unknown) => Number.isInteger(x),
  Double: isNum,
  Float: isNum,
  Number: isNum,
  Boolean: isBool,
  List: isArr,
  MutableList: isArr,
  ArrayList: isArr,
  Array: isArr,
  Collection: (x: unknown) => isArr(x) || isSet(x),
  Iterable: (x: unknown) => isArr(x) || isSet(x),
  Set: isSet,
  MutableSet: isSet,
  HashSet: isSet,
  Map: isMap,
  MutableMap: isMap,
  HashMap: isMap,
  LinkedHashMap: isMap,
  ByteArray: isBytes,
  Function: (x: unknown) => typeof x === 'function',
} as const;

export type TypeRef = Fn | { $is: (x: unknown) => boolean } | ((x: unknown) => boolean);

export function is(x: unknown, T: any): boolean {
  if (x === null || x === undefined) return false;
  if (T && typeof T.$is === 'function') return T.$is(x);
  if (typeof T === 'function') {
    if (T.prototype && (x instanceof T)) return true;
    if (T.$interface) return implementsInterface(x, T);
    if (!T.prototype || T.$pred) return T(x) === true;
    return false;
  }
  return false;
}

export function asType<T>(x: unknown, T: any, safe: boolean): T | null {
  if (x === null || x === undefined) {
    if (safe) return null;
    return x as any;
  }
  if (is(x, T)) return x as T;
  if (safe) return null;
  // Unsafe casts to unknown/erased types are allowed through, like JVM generics erasure.
  if (T === undefined) return x as T;
  throw new ClassCastException(`${describe(x)} cannot be cast to ${T?.name ?? T}`);
}

// Interfaces translate to classes flagged `$interface`; implementers list them in `$interfaces`.
export function implementsInterface(x: any, I: any): boolean {
  let proto = Object.getPrototypeOf(x);
  while (proto) {
    const ctor = proto.constructor;
    if (ctor === I) return true;
    const list: any[] | undefined = Object.prototype.hasOwnProperty.call(ctor, '$interfaces') ? ctor.$interfaces : undefined;
    if (list && list.some((i) => i === I || inheritsInterface(i, I))) return true;
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}
function inheritsInterface(i: any, I: any): boolean {
  if (i === I) return true;
  if (Object.getPrototypeOf(i) === I) return true;
  return (i.$interfaces ?? []).some((j: any) => inheritsInterface(j, I));
}

/** Copy default methods of implemented interfaces onto a class (Kotlin interface default methods). */
export function mixin(C: any, interfaces: any[]): void {
  C.$interfaces = interfaces;
  for (const I of interfaces) {
    let proto = I.prototype;
    while (proto && proto !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'constructor' || Object.prototype.hasOwnProperty.call(C.prototype, key)) continue;
        if (hasInChain(C.prototype, key)) continue;
        Object.defineProperty(C.prototype, key, Object.getOwnPropertyDescriptor(proto, key)!);
      }
      proto = Object.getPrototypeOf(proto);
    }
  }
}
function hasInChain(proto: any, key: string): boolean {
  let p = Object.getPrototypeOf(proto);
  while (p && p !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(p, key)) return true;
    p = Object.getPrototypeOf(p);
  }
  return false;
}

export function describe(x: unknown): string {
  if (x === null || x === undefined) return 'null';
  if (Array.isArray(x)) return 'List';
  if (typeof x === 'object') return (x as any).constructor?.name ?? 'Object';
  return typeof x;
}

// ---------- equality / hashing / toString ----------

export function eq(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a !== 'object') return false;
  if (typeof a.equals === 'function') return a.equals(b);
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof Set) {
    if (!(b instanceof Set) || a.size !== b.size) return false;
    for (const v of a) if (!setHas(b, v)) return false;
    return true;
  }
  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !eq(v, b.get(k))) return false;
    return true;
  }
  return false;
}

export function setHas(s: Set<any>, v: any): boolean {
  if (s.has(v)) return true;
  if (v === null || typeof v !== 'object') return false;
  for (const x of s) if (eq(x, v)) return true;
  return false;
}

const identityHashes = new WeakMap<object, number>();
let nextIdentity = 0x1b6d3586;

/** Object.hashCode() for objects without their own: a stable identity hash. */
export function identityHash(x: object): number {
  let h = identityHashes.get(x);
  if (h === undefined) {
    h = nextIdentity = (Math.imul(nextIdentity, 1103515245) + 12345) | 0;
    identityHashes.set(x, h);
  }
  return h;
}

export function hash(x: any): number {
  if (x === null || x === undefined) return 0;
  if ((typeof x === 'object' || typeof x === 'function') && typeof x.hashCode === 'function') return x.hashCode();
  if (typeof x === 'object' && !Array.isArray(x) && !(x instanceof Map) && !(x instanceof Set)) return identityHash(x);
  return stringHash(str(x));
}

export function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export function str(x: any): string {
  if (x === null || x === undefined) return 'null';
  if (typeof x === 'string') return x;
  if (typeof x === 'number') return numStr(x);
  if (Array.isArray(x)) return '[' + x.map(str).join(', ') + ']';
  if (x instanceof Set) return '[' + [...x].map(str).join(', ') + ']';
  if (x instanceof Map) return '{' + [...x].map(([k, v]) => `${str(k)}=${str(v)}`).join(', ') + '}';
  if (typeof x === 'object' && x.toString !== Object.prototype.toString) return x.toString();
  if (typeof x === 'object') return `${x.constructor?.name ?? 'Object'}@${(identityHash(x) >>> 0).toString(16)}`;
  return String(x);
}

function numStr(n: number): string {
  // Kotlin prints doubles with a trailing ".0" but ints without; JS can't tell them apart,
  // so whole numbers print as ints (the common case in source code: page numbers, ids).
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return 'Infinity';
  if (n === -Infinity) return '-Infinity';
  return String(n);
}

/** String template interpolation. */
export function tpl(strings: readonly string[], ...values: any[]): string {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += str(values[i]) + strings[i + 1];
  return out;
}

export function compare(a: any, b: any): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'object' && typeof a.compareTo === 'function') return a.compareTo(b);
  if (typeof a === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------- operators ----------

export function plus(a: any, b: any): any {
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  if (typeof a === 'string') return a + str(b);
  if (Array.isArray(a)) {
    if (Array.isArray(b)) return a.concat(b);
    if (b instanceof Set) return a.concat([...b]);
    return [...a, b];
  }
  if (a instanceof Set) {
    const out = new Set(a);
    if (Array.isArray(b) || b instanceof Set) for (const v of b) out.add(v);
    else out.add(b);
    return out;
  }
  if (a instanceof Map) {
    const out = new Map(a);
    if (b instanceof Map) for (const [k, v] of b) out.set(k, v);
    else if (Array.isArray(b)) for (const p of b) out.set(p.first, p.second);
    else out.set(b.first, b.second);
    return out;
  }
  if (a instanceof Int8Array) {
    const bb = b instanceof Int8Array ? b : Int8Array.of(b);
    const out = new Int8Array(a.length + bb.length);
    out.set(a);
    out.set(bb, a.length);
    return out;
  }
  if (a && typeof a.plus === 'function') return a.plus(b);
  if (typeof a === 'number' && typeof b === 'string') return a + b; // Char + Int handled by caller
  return a + b;
}

export function minus(a: any, b: any): any {
  if (typeof a === 'number') return a - b;
  if (Array.isArray(a)) {
    if (Array.isArray(b) || b instanceof Set) {
      const rm = [...b];
      return a.filter((x) => !rm.some((y) => eq(x, y)));
    }
    const i = a.findIndex((x) => eq(x, b));
    return i < 0 ? [...a] : [...a.slice(0, i), ...a.slice(i + 1)];
  }
  if (a instanceof Set) {
    const out = new Set(a);
    if (Array.isArray(b) || b instanceof Set) for (const v of b) out.delete(v);
    else out.delete(b);
    return out;
  }
  if (a instanceof Map) {
    const out = new Map(a);
    if (Array.isArray(b) || b instanceof Set) for (const k of b) out.delete(k);
    else out.delete(b);
    return out;
  }
  if (a && typeof a.minus === 'function') return a.minus(b);
  return a - b;
}

export function times(a: any, b: any): any {
  if (typeof a === 'number') return typeof b === 'number' ? a * b : b.times(a);
  if (a && typeof a.times === 'function') return a.times(b);
  return a * b;
}

/** Kotlin `/`: integer division when both operands are integers. */
export function div(a: any, b: any): any {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isInteger(a) && Number.isInteger(b)) {
      if (b === 0) throw new ArithmeticException('/ by zero');
      return Math.trunc(a / b);
    }
    return a / b;
  }
  if (a && typeof a.div === 'function') return a.div(b);
  return a / b;
}

export function rem(a: any, b: any): any {
  if (typeof a === 'number' && Number.isInteger(a) && Number.isInteger(b) && b === 0) throw new ArithmeticException('/ by zero');
  return a % b;
}

export function unaryMinus(a: any): any {
  if (typeof a === 'number') return -a;
  if (a && typeof a.unaryMinus === 'function') return a.unaryMinus();
  return -a;
}

/** `a[i]` */
export function getAt(a: any, ...keys: any[]): any {
  const k = keys[0];
  if (typeof a === 'string') return a.charAt(k);
  if (Array.isArray(a) || ArrayBuffer.isView(a)) {
    if (keys.length === 1 && typeof k === 'number') {
      if (k < 0 || k >= (a as any).length) throw new IndexOutOfBoundsException(`Index ${k} out of bounds for length ${(a as any).length}`);
      return (a as any)[k];
    }
  }
  if (a instanceof Map) return mapGet(a, k);
  if (a === null || a === undefined) throw new NullPointerException('Indexing null');
  if (typeof a.get === 'function') return a.get(...keys);
  return a[k];
}

/** `a[i] = v` */
export function setAt(a: any, ...args: any[]): void {
  const v = args[args.length - 1];
  const k = args[0];
  if (Array.isArray(a) || ArrayBuffer.isView(a)) {
    (a as any)[k] = v;
    return;
  }
  if (a instanceof Map) {
    mapSet(a, k, v);
    return;
  }
  if (typeof a.set === 'function') {
    a.set(...args);
    return;
  }
  a[k] = v;
}

// Maps keyed by objects with equals() need structural lookup (data classes, Pairs).
export function mapGet(m: Map<any, any>, k: any): any {
  if (m.has(k)) return m.get(k);
  if (k !== null && typeof k === 'object') for (const [kk, v] of m) if (eq(kk, k)) return v;
  return null;
}
export function mapHas(m: Map<any, any>, k: any): boolean {
  if (m.has(k)) return true;
  if (k !== null && typeof k === 'object') for (const kk of m.keys()) if (eq(kk, k)) return true;
  return false;
}
export function mapSet(m: Map<any, any>, k: any, v: any): void {
  if (k !== null && typeof k === 'object' && !m.has(k)) {
    for (const kk of m.keys()) if (eq(kk, k)) return void m.set(kk, v);
  }
  m.set(k, v);
}

/** `a in b` */
export function contains(container: any, x: any): boolean {
  if (container === null || container === undefined) throw new NullPointerException('in null');
  if (typeof container === 'string') return container.includes(x instanceof Object && x.pattern ? x : str(x));
  if (Array.isArray(container)) return container.some((y) => eq(y, x));
  if (container instanceof Set) return setHas(container, x);
  if (container instanceof Map) return mapHas(container, x);
  if (typeof container.contains === 'function') return container.contains(x);
  return false;
}

// ---------- extension dispatch ----------

export interface ExtDef {
  name: string;
  /** Receiver check. Kotlin resolves statically; we approximate with a runtime check. */
  recv: (x: any) => boolean;
  fn: Fn;
  /** Async variant for higher-order functions whose lambda suspends. */
  async?: Fn;
  /** `true` for extension properties. */
  prop?: boolean;
  set?: Fn;
  /** Returns a promise: callers in suspend code await it. */
  suspend?: boolean;
  /** Its lambda argument is a suspend lambda (may be async) but the call itself is not inlined. */
  suspendLambda?: boolean;
  /** Kotlin `inline` function: its lambda allows non-local return and inherits suspension. */
  inline?: boolean;
  /** Synchronous in Kotlin but async here: makes the calling function async. */
  infect?: boolean;
  /** Parameter names (after the receiver) for named-argument calls. */
  params?: string[];
  /** Reified type parameter: the translator appends a type descriptor ('desc') or class ('class'). */
  reified?: 'desc' | 'class';
  /** Its lambda argument has a receiver (`T.() -> R`), passed as the lambda's first argument. */
  recvLambda?: boolean;
  /** Translator-made candidate for a user member extension: call `self[member](recv, ...)`. */
  member?: string;
  /** Takes the caller's context object (Kotlin context parameter) after the receiver. */
  ctx?: boolean;
}

export const ANY = (_x: unknown) => true;
export const NONNULL = (x: unknown) => x !== null && x !== undefined;

function noSuch(recv: any, name: string): never {
  throw new UnsupportedOperationException(`No method '${name}' on ${describe(recv)}`);
}

/**
 * A Kotlin member function: found on the object's own class chain, never on JS built-in
 * prototypes (so Array#map or Object#toString never shadow stdlib behaviour). A property and a
 * method can share a name in Kotlin; the method then lives under `name$call`.
 */
export function memberFn(recv: any, name: string): Fn | null {
  let proto = Object.getPrototypeOf(recv);
  const own = Object.getOwnPropertyDescriptor(recv, name);
  if (own && typeof own.value === 'function') return own.value;
  while (proto && !BUILTIN_PROTOS.has(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (d) {
      if (typeof d.value === 'function') return d.value;
      break;
    }
    proto = Object.getPrototypeOf(proto);
  }
  const alt = recv[name + '$call'];
  return typeof alt === 'function' ? alt : null;
}

const BUILTIN_PROTOS = new Set<any>([Object.prototype, Array.prototype, Function.prototype, Map.prototype, Set.prototype, String.prototype, Number.prototype, Boolean.prototype, Error.prototype]);

/** Reorder trailing Named arguments for an extension that declares parameter names. */
function argsFor(ext: ExtDef, args: any[]): any[] {
  const last = args[args.length - 1];
  if (!ext.params || !last || last.constructor?.name !== 'Named') return args;
  const out = args.slice(0, -1);
  for (const [k, v] of Object.entries(last.values as Record<string, any>)) {
    const i = ext.params.indexOf(k);
    if (i < 0) return args;
    while (out.length < i) out.push(undefined);
    out[i] = v;
  }
  return out;
}

function findExt(recv: any, cands: readonly ExtDef[]): ExtDef | null {
  for (const c of cands) if (c.recv(recv)) return c;
  return null;
}

/** Method call that may be an extension: members win on objects; built-ins only use extensions. */
export function call(recv: any, name: string, cands: readonly ExtDef[], args: any[], self?: any): any {
  if (!isBuiltin(recv)) {
    const m = memberFn(recv, name);
    if (m) return m.apply(recv, args);
  }
  const ext = findExt(recv, cands);
  if (ext) return ext.member ? self[ext.member](recv, ...args) : ext.ctx ? ext.fn(recv, self, ...args) : ext.fn(recv, ...argsFor(ext, args));
  if (recv === null || recv === undefined) throw new NullPointerException(`Calling '${name}' on null`);
  if (typeof recv === 'function' && name === 'invoke') return recv(...args);
  return noSuch(recv, name);
}

/** Same as `call`, but lambdas may return promises; the result must be awaited. */
export function callAsync(recv: any, name: string, cands: readonly ExtDef[], args: any[], self?: any): any {
  if (!isBuiltin(recv)) {
    const m = memberFn(recv, name);
    if (m) return m.apply(recv, args);
  }
  const ext = findExt(recv, cands);
  if (ext) return ext.member ? self[ext.member](recv, ...args) : ext.ctx ? ext.fn(recv, self, ...args) : (ext.async ?? ext.fn)(recv, ...argsFor(ext, args));
  if (recv === null || recv === undefined) throw new NullPointerException(`Calling '${name}' on null`);
  return noSuch(recv, name);
}

/** Property read that may be an extension property. */
export function prop(recv: any, name: string, cands: readonly ExtDef[], self?: any): any {
  if (!isBuiltin(recv) && name in recv) return recv[name];
  const ext = findExt(recv, cands);
  if (ext) return ext.member ? self[ext.member](recv) : ext.fn(recv);
  if (recv === null || recv === undefined) throw new NullPointerException(`Reading '${name}' of null`);
  if (typeof recv === 'object' && name in recv) return recv[name];
  return noSuch(recv, name);
}

export function setProp(recv: any, name: string, cands: readonly ExtDef[], value: any): void {
  if (!isBuiltin(recv) && name in recv) {
    recv[name] = value;
    return;
  }
  const ext = findExt(recv, cands);
  if (ext?.set) {
    ext.set(recv, value);
    return;
  }
  recv[name] = value;
}

/** Unqualified call inside receiver lambdas: innermost receiver that has the member wins. */
export function icall(receivers: any[], name: string, cands: readonly ExtDef[], args: any[], fallback?: Fn, self?: any): any {
  for (const r of receivers) {
    if (r !== null && r !== undefined && !isBuiltin(r)) {
      const m = memberFn(r, name);
      if (m) return m.apply(r, args);
    }
  }
  for (const r of receivers) {
    const ext = findExt(r, cands);
    if (ext) return ext.member ? self[ext.member](r, ...args) : ext.ctx ? ext.fn(r, self, ...args) : ext.fn(r, ...argsFor(ext, args));
  }
  if (fallback) return fallback(...args);
  throw new UnsupportedOperationException(`Unresolved call '${name}'`);
}

export function icallAsync(receivers: any[], name: string, cands: readonly ExtDef[], args: any[], fallback?: Fn, self?: any): any {
  for (const r of receivers) {
    if (r !== null && r !== undefined && !isBuiltin(r)) {
      const m = memberFn(r, name);
      if (m) return m.apply(r, args);
    }
  }
  for (const r of receivers) {
    const ext = findExt(r, cands);
    if (ext) return ext.member ? self[ext.member](r, ...args) : ext.ctx ? ext.fn(r, self, ...args) : (ext.async ?? ext.fn)(r, ...argsFor(ext, args));
  }
  if (fallback) return fallback(...args);
  throw new UnsupportedOperationException(`Unresolved call '${name}'`);
}

export function iprop(receivers: any[], name: string, cands: readonly ExtDef[], fallback?: () => any, self?: any): any {
  for (const r of receivers) {
    if (r !== null && r !== undefined && !isBuiltin(r) && name in r) return r[name];
  }
  for (const r of receivers) {
    const ext = findExt(r, cands);
    if (ext) return ext.member ? self[ext.member](r) : ext.fn(r);
  }
  if (fallback) return fallback();
  throw new UnsupportedOperationException(`Unresolved property '${name}'`);
}

export function isetProp(receivers: any[], name: string, value: any, fallback?: (v: any) => void): void {
  for (const r of receivers) {
    if (r !== null && r !== undefined && !isBuiltin(r) && name in r) {
      r[name] = value;
      return;
    }
  }
  if (fallback) return fallback(value);
  throw new UnsupportedOperationException(`Unresolved property '${name}'`);
}

// ---------- properties with Kotlin override semantics ----------

/**
 * Declares an overridable property on a class prototype, backed by per-class storage, so
 * `super.x` reads the parent's value and subclasses can override with a getter or a field.
 */
export function defProp(C: any, name: string, mutable: boolean): void {
  const key = `$${C.name}_${name}`;
  Object.defineProperty(C.prototype, name, {
    configurable: true,
    enumerable: false,
    get() {
      const v = this[key];
      return v === undefined ? null : v;
    },
    set: mutable
      ? function (this: any, v: any) {
          this[key] = v;
        }
      : function (this: any, v: any) {
          // Only the class constructor initialises a val.
          this[key] = v;
        },
  });
}

export function initProp(self: any, C: any, name: string, value: any): void {
  self[`$${C.name}_${name}`] = value;
}

export function lazyProp(C: any, name: string, init: (self: any) => any): void {
  const key = `$lazy_${C.name}_${name}`;
  Object.defineProperty(C.prototype, name, {
    configurable: true,
    enumerable: false,
    get() {
      if (!Object.prototype.hasOwnProperty.call(this, key)) {
        Object.defineProperty(this, key, { value: init(this), writable: true, enumerable: false });
      }
      return this[key];
    },
  });
}

/** Kotlin `by lazy {}` on locals/top-level vals. */
export class Lazy<T> {
  private done = false;
  private v: T | undefined;
  constructor(private readonly init: () => T) {}
  get value(): T {
    if (!this.done) {
      this.v = this.init();
      this.done = true;
    }
    return this.v as T;
  }
  isInitialized(): boolean {
    return this.done;
  }
}
export function lazy<T>(a: any, b?: () => T): Lazy<T> {
  return new Lazy(typeof a === 'function' ? a : (b as () => T));
}

// ---------- enums ----------

export function defEnum(C: any, entries: [string, any[]][]): void {
  const values: any[] = [];
  entries.forEach(([name, args], ordinal) => {
    const e = new C(...args);
    Object.defineProperty(e, 'name', { value: name, enumerable: true });
    Object.defineProperty(e, 'ordinal', { value: ordinal, enumerable: true });
    C[name] = e;
    values.push(e);
  });
  C.$values = values;
  C.values = () => [...values];
  C.valueOf = (n: string) => {
    const v = values.find((e) => e.name === n);
    if (!v) throw new IllegalArgumentException(`No enum constant ${C.name}.${n}`);
    return v;
  };
  Object.defineProperty(C, 'entries', { get: () => [...values] });
  if (!Object.prototype.hasOwnProperty.call(C.prototype, 'toString')) {
    C.prototype.toString = function () {
      return this.name;
    };
  }
  C.prototype.compareTo = function (o: any) {
    return this.ordinal - o.ordinal;
  };
}

export function enumValues(C: any): any[] {
  return [...C.$values];
}

// ---------- data classes ----------

export function defData(C: any, fields: string[]): void {
  C.$fields = fields;
  C.prototype.equals = function (o: any) {
    if (this === o) return true;
    if (!o || o.constructor !== this.constructor) return false;
    return fields.every((f) => eq(this[f], o[f]));
  };
  C.prototype.hashCode = function () {
    let h = 0;
    for (const f of fields) h = (Math.imul(31, h) + hash(this[f])) | 0;
    return h;
  };
  if (!Object.prototype.hasOwnProperty.call(C.prototype, 'toString')) {
    C.prototype.toString = function () {
      return `${C.name}(${fields.map((f) => `${f}=${str(this[f])}`).join(', ')})`;
    };
  }
  fields.forEach((f, i) => {
    const comp = `component${i + 1}`;
    if (!Object.prototype.hasOwnProperty.call(C.prototype, comp)) {
      C.prototype[comp] = function () {
        return this[f];
      };
    }
  });
  C.prototype.copy = function (named: Record<string, any> = {}) {
    const args = fields.map((f) => (f in named ? named[f] : this[f]));
    return new C(...args);
  };
}

/** `val (a, b) = x` */
export function component(x: any, n: number): any {
  if (Array.isArray(x)) return n - 1 < x.length ? x[n - 1] : (() => { throw new IndexOutOfBoundsException(`component${n}`); })();
  if (x instanceof Map) throw new UnsupportedOperationException('Destructuring a Map');
  if (typeof x === 'string') return x.charAt(n - 1);
  if (x && typeof x[`component${n}`] === 'function') return x[`component${n}`]();
  throw new UnsupportedOperationException(`component${n} on ${describe(x)}`);
}

// ---------- objects / companions ----------

/** `object Foo` - created on first access, like a JVM singleton. */
export function lazyObject<T>(make: () => T): () => T {
  let inst: T | undefined;
  let made = false;
  return () => {
    if (!made) {
      inst = make();
      made = true;
    }
    return inst as T;
  };
}

// ---------- SAM conversion ----------

/** `Interceptor { chain -> ... }` style SAM constructor for runtime fun-interfaces. */
export function sam(I: any, fn: Fn): any {
  if (typeof I.$sam === 'function') return I.$sam(fn);
  const method: string = I.$samMethod ?? 'invoke';
  const o = Object.create(I.prototype ?? Object.prototype);
  o[method] = fn;
  return o;
}

/** Invoke a value of function type: plain JS function or an object with `invoke`. */
export function invoke(f: any, ...args: any[]): any {
  if (typeof f === 'function') return f(...args);
  if (f && typeof f.invoke === 'function') return f.invoke(...args);
  throw new NullPointerException('Invoking null function');
}

// ---------- callable references ----------

/** `Foo::bar` / `::bar` - member function reference taking the receiver first. */
/** `Type::name` - a function or a property reference; resolved per receiver at call time. */
export function memberRef(name: string, cands: readonly ExtDef[]): Fn {
  return (recv: any, ...args: any[]) => {
    if (!isBuiltin(recv)) {
      const m = memberFn(recv, name);
      if (m) return m.apply(recv, args);
      if (name in recv) return recv[name];
    }
    const ext = findExt(recv, cands);
    if (ext) return ext.prop ? ext.fn(recv) : ext.fn(recv, ...args);
    return call(recv, name, cands, args);
  };
}

export function propRef(name: string, cands: readonly ExtDef[]): Fn {
  return (recv: any) => prop(recv, name, cands);
}

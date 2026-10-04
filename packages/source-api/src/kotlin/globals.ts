// Kotlin/Java top-level functions and java.lang statics available without imports.

import {
  ArithmeticException,
  IllegalArgumentException,
  IllegalStateException,
  NotImplementedError,
  NumberFormatException,
  str,
  compare,
  isCatch,
  NonLocalReturn,
  Lazy,
} from './core';
import { format } from './stdlib';
import { Comparator } from './types';

export function require(cond: boolean, msg?: () => any): void {
  if (!cond) throw new IllegalArgumentException(msg ? str(msg()) : 'Failed requirement.');
}
export function requireNotNull<T>(v: T | null | undefined, msg?: () => any): T {
  if (v === null || v === undefined) throw new IllegalArgumentException(msg ? str(msg()) : 'Required value was null.');
  return v;
}
export function check(cond: boolean, msg?: () => any): void {
  if (!cond) throw new IllegalStateException(msg ? str(msg()) : 'Check failed.');
}
export function checkNotNull<T>(v: T | null | undefined, msg?: () => any): T {
  if (v === null || v === undefined) throw new IllegalStateException(msg ? str(msg()) : 'Required value was null.');
  return v;
}
export function TODO(reason?: string): never {
  throw new NotImplementedError(reason ? `An operation is not implemented: ${reason}` : 'An operation is not implemented.');
}
export function println(x: any = ''): void {
  console.log(str(x));
}
export function print(x: any): void {
  console.log(str(x));
}
export function maxOf(...xs: any[]): any {
  if (xs.length === 2 && typeof xs[1] !== 'number' && xs[1] && typeof xs[1].compare === 'function') return xs[0];
  return xs.reduce((a, b) => (compare(b, a) > 0 ? b : a));
}
export function minOf(...xs: any[]): any {
  return xs.reduce((a, b) => (compare(b, a) < 0 ? b : a));
}

/** kotlin.String: `String(bytes, charset)`, `String(chars)`, `String.format(...)`. */
export const KString = Object.assign(
  (x: any, a?: any, b?: any) => {
    if (x instanceof Int8Array || x instanceof Uint8Array) {
      const bytes = x instanceof Int8Array ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : x;
      if (typeof a === 'number') return new TextDecoder().decode(bytes.subarray(a, a + (b ?? bytes.length - a)));
      const cs = String(a?.name?.() ?? a?.name ?? a ?? 'utf-8').toLowerCase();
      try {
        return new TextDecoder(cs === 'iso-8859-1' ? 'latin1' : cs).decode(bytes);
      } catch {
        return new TextDecoder().decode(bytes);
      }
    }
    if (Array.isArray(x)) return x.join('');
    return str(x);
  },
  {
    format: (fmt: any, ...args: any[]) => {
      // String.format(locale, fmt, args) or String.format(fmt, args)
      if (typeof fmt !== 'string') return format(str(args[0]), args.slice(1));
      return format(fmt, args);
    },
    valueOf: (x: any) => str(x),
    CASE_INSENSITIVE_ORDER: new Comparator((a: string, b: string) => compare(a.toLowerCase(), b.toLowerCase())),
    $fn: true,
  },
);

export const JMath = {
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
  round: (x: number) => Math.floor(x + 0.5),
  rint: Math.round,
  pow: Math.pow,
  sqrt: Math.sqrt,
  random: Math.random,
  log: Math.log,
  log10: Math.log10,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  floorDiv: (a: number, b: number) => Math.floor(a / b),
  floorMod: (a: number, b: number) => ((a % b) + b) % b,
  addExact: (a: number, b: number) => a + b,
  multiplyExact: (a: number, b: number) => a * b,
  toIntExact: (a: number) => a,
  signum: Math.sign,
  PI: Math.PI,
  E: Math.E,
};

export const kmath = {
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  pow: Math.pow,
  sqrt: Math.sqrt,
  ln: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  truncate: Math.trunc,
  sign: Math.sign,
  PI: Math.PI,
  E: Math.E,
};

function parseIntStrict(s: string, radix = 10): number {
  const t = str(s).trim();
  const re = radix === 16 ? /^[+-]?[0-9a-fA-F]+$/ : /^[+-]?\d+$/;
  if (!re.test(t)) throw new NumberFormatException(`For input string: "${s}"`);
  return parseInt(t, radix);
}

export const Integer = {
  parseInt: parseIntStrict,
  valueOf: (x: any, radix?: number) => (typeof x === 'number' ? x : parseIntStrict(x, radix)),
  toString: (x: number, radix?: number) => x.toString(radix),
  toHexString: (x: number) => (x >>> 0).toString(16),
  toBinaryString: (x: number) => (x >>> 0).toString(2),
  MAX_VALUE: 2147483647,
  MIN_VALUE: -2147483648,
  compare: (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0),
  signum: Math.sign,
};
export const JLong = {
  parseLong: parseIntStrict,
  valueOf: (x: any) => (typeof x === 'number' ? x : parseIntStrict(x)),
  toString: (x: number, radix?: number) => x.toString(radix),
  toHexString: (x: number) => x.toString(16),
  MAX_VALUE: Number.MAX_SAFE_INTEGER,
  MIN_VALUE: Number.MIN_SAFE_INTEGER,
  compare: (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0),
};
export const JDouble = {
  parseDouble: (s: string) => {
    const n = Number(str(s).trim());
    if (Number.isNaN(n)) throw new NumberFormatException(`For input string: "${s}"`);
    return n;
  },
  valueOf: (x: any) => Number(x),
  MAX_VALUE: Number.MAX_VALUE,
  MIN_VALUE: Number.MIN_VALUE,
  NaN: NaN,
  POSITIVE_INFINITY: Infinity,
  NEGATIVE_INFINITY: -Infinity,
  isNaN: Number.isNaN,
  compare: (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0),
};
export const Character = {
  isDigit: (c: string) => /\p{Nd}/u.test(c),
  isLetter: (c: string) => /\p{L}/u.test(c),
  isLetterOrDigit: (c: string) => /[\p{L}\p{Nd}]/u.test(c),
  isWhitespace: (c: string) => /\s/.test(c),
  isUpperCase: (c: string) => /\p{Lu}/u.test(c),
  isLowerCase: (c: string) => /\p{Ll}/u.test(c),
  toUpperCase: (c: string) => c.toUpperCase(),
  toLowerCase: (c: string) => c.toLowerCase(),
  getNumericValue: (c: string) => parseInt(c, 36),
  toChars: (cp: number) => [...String.fromCodePoint(cp)],
  MAX_VALUE: '￿',
  MIN_VALUE: '\u0000',
};
export const JBoolean = {
  parseBoolean: (s: string) => str(s).toLowerCase() === 'true',
  valueOf: (s: any) => s === true || str(s).toLowerCase() === 'true',
  TRUE: true,
  FALSE: false,
};

export const JSystem = {
  currentTimeMillis: () => Date.now(),
  nanoTime: () => Math.round((globalThis.performance?.now?.() ?? Date.now()) * 1e6),
  getProperty: (_k: string) => null,
  getenv: (_k: string) => null,
  lineSeparator: () => '\n',
  arraycopy: (src: any, sp: number, dst: any, dp: number, n: number) => {
    for (let i = 0; i < n; i++) dst[dp + i] = src[sp + i];
  },
  out: { println: (x: any) => console.log(str(x)), print: (x: any) => console.log(str(x)) },
  err: { println: (x: any) => console.warn(str(x)) },
};

/** Thread.sleep blocks on the JVM; here it is async and makes its caller async. */
export const Thread = {
  sleep: Object.assign((ms: number) => new Promise((r) => setTimeout(r, ms)), { $infect: true }),
  currentThread: () => ({ name: 'main', isInterrupted: false, interrupt: () => {} }),
};

export const Unit = undefined;

export const Collections = {
  emptyList: () => [],
  emptyMap: () => new Map(),
  emptySet: () => new Set(),
  singletonList: (x: any) => [x],
  unmodifiableList: (x: any[]) => x,
  synchronizedList: (x: any[]) => x,
  synchronizedMap: (x: any) => x,
  reverse: (x: any[]) => void x.reverse(),
  sort: (x: any[], c?: any) => void x.sort(c ? (a, b) => c.compare(a, b) : compare),
  shuffle: (x: any[]) => {
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
  },
};
export const Arrays = {
  asList: (...xs: any[]) => (xs.length === 1 && Array.isArray(xs[0]) ? [...xs[0]] : xs),
  toString: (xs: any[]) => '[' + xs.map(str).join(', ') + ']',
  copyOf: (xs: any, n: number) => xs.slice(0, n),
  copyOfRange: (xs: any, a: number, b: number) => xs.slice(a, b),
  fill: (xs: any, v: any) => xs.fill(v),
  sort: (xs: any[]) => xs.sort(compare),
  equals: (a: any, b: any) => a.length === b.length && a.every((x: any, i: number) => x === b[i]),
};

export class AtomicInteger {
  constructor(private v = 0) {}
  get(): number {
    return this.v;
  }
  set(v: number): void {
    this.v = v;
  }
  incrementAndGet(): number {
    return ++this.v;
  }
  getAndIncrement(): number {
    return this.v++;
  }
  decrementAndGet(): number {
    return --this.v;
  }
  addAndGet(d: number): number {
    return (this.v += d);
  }
  getAndSet(v: number): number {
    const o = this.v;
    this.v = v;
    return o;
  }
  compareAndSet(e: number, v: number): boolean {
    if (this.v !== e) return false;
    this.v = v;
    return true;
  }
}
export class AtomicBoolean {
  constructor(private v = false) {}
  get(): boolean {
    return this.v;
  }
  set(v: boolean): void {
    this.v = v;
  }
  getAndSet(v: boolean): boolean {
    const o = this.v;
    this.v = v;
    return o;
  }
  compareAndSet(e: boolean, v: boolean): boolean {
    if (this.v !== e) return false;
    this.v = v;
    return true;
  }
}
export class AtomicReference<T> {
  constructor(private v: T | null = null) {}
  get(): T | null {
    return this.v;
  }
  set(v: T | null): void {
    this.v = v;
  }
  getAndSet(v: T | null): T | null {
    const o = this.v;
    this.v = v;
    return o;
  }
  compareAndSet(e: T | null, v: T | null): boolean {
    if (this.v !== e) return false;
    this.v = v;
    return true;
  }
}
export class ReentrantLock {
  lock(): void {}
  unlock(): void {}
  tryLock(): boolean {
    return true;
  }
  newCondition(): any {
    return { await: () => {}, signal: () => {}, signalAll: () => {} };
  }
}
export class ConcurrentHashMap extends Map<any, any> {}

export { ArithmeticException, isCatch, NonLocalReturn, Lazy };

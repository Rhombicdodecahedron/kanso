import {
  compare,
  eq,
  hash,
  IllegalArgumentException,
  IndexOutOfBoundsException,
  NoSuchElementException,
  str,
} from './core';

export class Pair<A, B> {
  constructor(
    readonly first: A,
    readonly second: B,
  ) {}
  component1(): A {
    return this.first;
  }
  component2(): B {
    return this.second;
  }
  equals(o: any): boolean {
    return o instanceof Pair && eq(this.first, o.first) && eq(this.second, o.second);
  }
  hashCode(): number {
    return (Math.imul(31, hash(this.first)) + hash(this.second)) | 0;
  }
  toString(): string {
    return `(${str(this.first)}, ${str(this.second)})`;
  }
  toList(): any[] {
    return [this.first, this.second];
  }
  copy(named: { first?: A; second?: B } = {}): Pair<A, B> {
    return new Pair('first' in named ? (named.first as A) : this.first, 'second' in named ? (named.second as B) : this.second);
  }
}

export class Triple<A, B, C> {
  constructor(
    readonly first: A,
    readonly second: B,
    readonly third: C,
  ) {}
  component1(): A {
    return this.first;
  }
  component2(): B {
    return this.second;
  }
  component3(): C {
    return this.third;
  }
  equals(o: any): boolean {
    return o instanceof Triple && eq(this.first, o.first) && eq(this.second, o.second) && eq(this.third, o.third);
  }
  hashCode(): number {
    return (Math.imul(31, (Math.imul(31, hash(this.first)) + hash(this.second)) | 0) + hash(this.third)) | 0;
  }
  toString(): string {
    return `(${str(this.first)}, ${str(this.second)}, ${str(this.third)})`;
  }
}

export class MapEntry<K, V> {
  constructor(
    readonly key: K,
    public value: V,
  ) {}
  component1(): K {
    return this.key;
  }
  component2(): V {
    return this.value;
  }
  toPair(): Pair<K, V> {
    return new Pair(this.key, this.value);
  }
  equals(o: any): boolean {
    return o instanceof MapEntry && eq(this.key, o.key) && eq(this.value, o.value);
  }
  hashCode(): number {
    return hash(this.key) ^ hash(this.value);
  }
  toString(): string {
    return `${str(this.key)}=${str(this.value)}`;
  }
}

/** Kotlin progression; `CharRange` uses the same class with `chars = true`. */
export class IntRange {
  constructor(
    readonly first: number,
    readonly last: number,
    readonly step = 1,
    readonly chars = false,
  ) {
    if (step === 0) throw new IllegalArgumentException('Step must be non-zero.');
  }
  get start(): any {
    return this.chars ? String.fromCharCode(this.first) : this.first;
  }
  get endInclusive(): any {
    return this.chars ? String.fromCharCode(this.last) : this.last;
  }
  get endExclusive(): number {
    return this.last + 1;
  }
  isEmpty(): boolean {
    return this.step > 0 ? this.first > this.last : this.first < this.last;
  }
  contains(x: any): boolean {
    const v = typeof x === 'string' ? x.charCodeAt(0) : x;
    if (this.step > 0) return v >= this.first && v <= this.last && (v - this.first) % this.step === 0;
    return v <= this.first && v >= this.last && (this.first - v) % -this.step === 0;
  }
  *[Symbol.iterator](): Iterator<any> {
    if (this.step > 0) for (let i = this.first; i <= this.last; i += this.step) yield this.chars ? String.fromCharCode(i) : i;
    else for (let i = this.first; i >= this.last; i += this.step) yield this.chars ? String.fromCharCode(i) : i;
  }
  toList(): any[] {
    return [...this];
  }
  get count(): number {
    return this.toList().length;
  }
  reversed(): IntRange {
    return new IntRange(this.last, this.first, -this.step, this.chars);
  }
  equals(o: any): boolean {
    return o instanceof IntRange && ((this.isEmpty() && o.isEmpty()) || (o.first === this.first && o.last === this.last && o.step === this.step));
  }
  toString(): string {
    return this.step > 0 ? `${this.first}..${this.last}` : `${this.first} downTo ${this.last}`;
  }
  random(): number {
    const list = this.toList();
    if (!list.length) throw new NoSuchElementException('Cannot get random in empty range');
    return list[Math.floor(Math.random() * list.length)];
  }
  coerce(v: number): number {
    return Math.min(Math.max(v, this.first), this.last);
  }
}

export function rangeTo(a: any, b: any): IntRange {
  if (typeof a === 'string') return new IntRange(a.charCodeAt(0), b.charCodeAt(0), 1, true);
  return new IntRange(a, b);
}
export function until(a: any, b: any): IntRange {
  if (typeof a === 'string') return new IntRange(a.charCodeAt(0), b.charCodeAt(0) - 1, 1, true);
  return new IntRange(a, b - 1);
}
export function downTo(a: any, b: any): IntRange {
  if (typeof a === 'string') return new IntRange(a.charCodeAt(0), b.charCodeAt(0), -1, true);
  return new IntRange(a, b, -1);
}
export function step(r: IntRange, s: number): IntRange {
  if (s <= 0) throw new IllegalArgumentException(`Step must be positive, was: ${s}.`);
  return new IntRange(r.first, r.last, r.step > 0 ? s : -s, r.chars);
}

export class StringBuilder {
  private s: string;
  constructor(init?: any) {
    this.s = typeof init === 'string' ? init : init != null && typeof init !== 'number' ? str(init) : '';
  }
  append(x: any, start?: number, end?: number): this {
    const v = str(x);
    this.s += start !== undefined ? v.substring(start, end) : v;
    return this;
  }
  appendLine(x?: any): this {
    this.s += (x === undefined ? '' : str(x)) + '\n';
    return this;
  }
  insert(i: number, x: any): this {
    this.s = this.s.slice(0, i) + str(x) + this.s.slice(i);
    return this;
  }
  get length(): number {
    return this.s.length;
  }
  setLength(n: number): void {
    this.s = n <= this.s.length ? this.s.slice(0, n) : this.s.padEnd(n, '\0');
  }
  deleteCharAt(i: number): this {
    this.s = this.s.slice(0, i) + this.s.slice(i + 1);
    return this;
  }
  delete(start: number, end: number): this {
    this.s = this.s.slice(0, start) + this.s.slice(end);
    return this;
  }
  deleteRange(start: number, end: number): this {
    return this.delete(start, end);
  }
  setRange(start: number, end: number, v: string): this {
    this.s = this.s.slice(0, start) + v + this.s.slice(end);
    return this;
  }
  replace(start: number, end: number, v: string): this {
    return this.setRange(start, end, v);
  }
  clear(): this {
    this.s = '';
    return this;
  }
  reverse(): this {
    this.s = [...this.s].reverse().join('');
    return this;
  }
  get(i: number): string {
    if (i < 0 || i >= this.s.length) throw new IndexOutOfBoundsException(`index ${i}`);
    return this.s.charAt(i);
  }
  set(i: number, c: string): void {
    this.setCharAt(i, c);
  }
  setCharAt(i: number, c: string): void {
    this.s = this.s.slice(0, i) + c + this.s.slice(i + 1);
  }
  isEmpty(): boolean {
    return this.s.length === 0;
  }
  isNotEmpty(): boolean {
    return this.s.length > 0;
  }
  indexOf(x: string, from = 0): number {
    return this.s.indexOf(x, from);
  }
  lastIndexOf(x: string): number {
    return this.s.lastIndexOf(x);
  }
  substring(a: number, b?: number): string {
    return this.s.substring(a, b);
  }
  removeSuffix(x: string): string {
    return this.s.endsWith(x) ? this.s.slice(0, this.s.length - x.length) : this.s;
  }
  toString(): string {
    return this.s;
  }
  get lastIndex(): number {
    return this.s.length - 1;
  }
  trim(): string {
    return this.s.trim();
  }
  last(): string {
    return this.s.charAt(this.s.length - 1);
  }
}

/** kotlin.Result */
export class Result<T> {
  private constructor(
    private readonly v: T | undefined,
    private readonly err: unknown,
    private readonly failed: boolean,
  ) {}
  static success<T>(v: T): Result<T> {
    return new Result(v, null, false);
  }
  static failure<T>(e: unknown): Result<T> {
    return new Result<T>(undefined, e, true);
  }
  get isSuccess(): boolean {
    return !this.failed;
  }
  get isFailure(): boolean {
    return this.failed;
  }
  getOrNull(): T | null {
    return this.failed ? null : (this.v as T);
  }
  getOrThrow(): T {
    if (this.failed) throw this.err;
    return this.v as T;
  }
  getOrDefault(d: T): T {
    return this.failed ? d : (this.v as T);
  }
  getOrElse(f: (e: unknown) => T): T {
    return this.failed ? f(this.err) : (this.v as T);
  }
  exceptionOrNull(): unknown {
    return this.failed ? this.err : null;
  }
  onSuccess(f: (v: T) => void): this {
    if (!this.failed) f(this.v as T);
    return this;
  }
  onFailure(f: (e: unknown) => void): this {
    if (this.failed) f(this.err);
    return this;
  }
  map<R>(f: (v: T) => R): Result<R> {
    return this.failed ? (this as any) : Result.success(f(this.v as T));
  }
  mapCatching<R>(f: (v: T) => R): Result<R> {
    if (this.failed) return this as any;
    try {
      return Result.success(f(this.v as T));
    } catch (e) {
      return Result.failure(e);
    }
  }
  recover(f: (e: unknown) => T): Result<T> {
    return this.failed ? Result.success(f(this.err)) : this;
  }
  recoverCatching(f: (e: unknown) => T): Result<T> {
    if (!this.failed) return this;
    try {
      return Result.success(f(this.err));
    } catch (e) {
      return Result.failure(e);
    }
  }
  fold<R>(onSuccess: (v: T) => R, onFailure: (e: unknown) => R): R {
    return this.failed ? onFailure(this.err) : onSuccess(this.v as T);
  }
  toString(): string {
    return this.failed ? `Failure(${str(this.err)})` : `Success(${str(this.v)})`;
  }
}

export function compareValues(a: any, b: any): number {
  return compare(a, b);
}

export class Comparator {
  constructor(readonly compare: (a: any, b: any) => number) {}
  reversed(): Comparator {
    return new Comparator((a, b) => this.compare(b, a));
  }
  thenBy(sel: (x: any) => any): Comparator {
    return new Comparator((a, b) => this.compare(a, b) || compare(sel(a), sel(b)));
  }
  thenByDescending(sel: (x: any) => any): Comparator {
    return new Comparator((a, b) => this.compare(a, b) || compare(sel(b), sel(a)));
  }
  thenComparing(other: any): Comparator {
    const o = toComparator(other);
    return new Comparator((a, b) => this.compare(a, b) || o(a, b));
  }
  then(other: any): Comparator {
    return this.thenComparing(other);
  }
}

export function toComparator(c: any): (a: any, b: any) => number {
  if (typeof c === 'function') return c;
  if (c && typeof c.compare === 'function') return (a, b) => c.compare(a, b);
  return compare;
}

export const comparators = {
  compareBy: (...sels: ((x: any) => any)[]) =>
    new Comparator((a, b) => {
      for (const s of sels) {
        const r = compare(s(a), s(b));
        if (r) return r;
      }
      return 0;
    }),
  compareByDescending: (sel: (x: any) => any) => new Comparator((a, b) => compare(sel(b), sel(a))),
  naturalOrder: () => new Comparator(compare),
  reverseOrder: () => new Comparator((a, b) => compare(b, a)),
  Comparator: (f: (a: any, b: any) => number) => new Comparator(f),
  nullsLast: (c?: any) => {
    const cmp = c ? toComparator(c) : compare;
    return new Comparator((a, b) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : cmp(a, b)));
  },
  nullsFirst: (c?: any) => {
    const cmp = c ? toComparator(c) : compare;
    return new Comparator((a, b) => (a == null ? (b == null ? 0 : -1) : b == null ? 1 : cmp(a, b)));
  },
};

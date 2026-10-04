// kotlin.random.Random (XorWow, bit-exact with the JVM), java.util.Random (48-bit LCG) and
// keiyoushi.utils.SeedRandom (port of davidbau/seedrandom).

import { type ExtDef, IllegalArgumentException } from '../kotlin/core';
import { ext } from '../kotlin/hof';
import { i8, u8 } from './charset';
import { randomFill } from './crypto';

const TWO32 = 4294967296;

function fastLog2(v: number): number {
  return 31 - Math.clz32(v);
}
/** Int.takeUpperBits(bitCount) */
function takeUpperBits(v: number, bitCount: number): number {
  return (v >>> (32 - bitCount)) & (-bitCount >> 31);
}
function toLong(hi: number, lo: number): bigint {
  return BigInt.asIntN(64, (BigInt(hi | 0) << 32n) | BigInt(lo >>> 0));
}
function rangeError(from: any, until: any): never {
  throw new IllegalArgumentException(`Random range is empty: [${from}, ${until}).`);
}

/** Abstract kotlin.random.Random: subclasses implement nextBits. */
export abstract class KRandom {
  abstract nextBits(bitCount: number): number;

  /** nextInt(), nextInt(until), nextInt(from, until) */
  nextInt(a?: number, b?: number): number {
    if (a === undefined) return this.nextBits(32);
    const from = b === undefined ? 0 : a;
    const until = b === undefined ? a : b;
    if (!(until > from)) rangeError(from, until);
    const n = (until - from) | 0;
    if (n > 0 || n === -2147483648) {
      let rnd: number;
      if ((n & -n) === n) rnd = this.nextBits(fastLog2(n));
      else {
        let v: number;
        let bits: number;
        do {
          bits = this.nextInt() >>> 1;
          v = bits % n;
        } while (((bits - v + (n - 1)) | 0) < 0);
        rnd = v;
      }
      return (from + rnd) | 0;
    }
    for (;;) {
      const rnd = this.nextInt();
      if (rnd >= from && rnd < until) return rnd;
    }
  }

  /** 64-bit value as BigInt (exact); nextLong() returns it as a number. */
  nextLongBig(): bigint {
    const hi = this.nextInt();
    const lo = this.nextInt();
    return BigInt.asIntN(64, (BigInt(hi) << 32n) + BigInt(lo));
  }

  /** nextLong(), nextLong(until), nextLong(from, until). Values beyond 2^53 lose precision. */
  nextLong(a?: number | bigint, b?: number | bigint): number {
    if (a === undefined) return Number(this.nextLongBig());
    const from = BigInt(b === undefined ? 0 : a);
    const until = BigInt(b === undefined ? a : b);
    if (!(until > from)) rangeError(from, until);
    const n = BigInt.asIntN(64, until - from);
    if (n > 0n) {
      let rnd: bigint;
      if ((n & -n) === n) {
        const nLow = Number(BigInt.asIntN(32, n));
        const nHigh = Number(BigInt.asIntN(32, n >> 32n));
        if (nLow !== 0) rnd = BigInt(takeUpperBits(this.nextInt(), fastLog2(nLow)) >>> 0);
        else if (nHigh === 1) rnd = BigInt(this.nextInt() >>> 0);
        else rnd = (BigInt(takeUpperBits(this.nextInt(), fastLog2(nHigh))) << 32n) + BigInt(this.nextInt() >>> 0);
      } else {
        let v: bigint;
        let bits: bigint;
        do {
          bits = BigInt.asUintN(64, this.nextLongBig()) >> 1n;
          v = bits % n;
        } while (BigInt.asIntN(64, bits - v + (n - 1n)) < 0n);
        rnd = v;
      }
      return Number(from + rnd);
    }
    for (;;) {
      const rnd = this.nextLongBig();
      if (rnd >= from && rnd < until) return Number(rnd);
    }
  }

  nextBoolean(): boolean {
    return this.nextBits(1) !== 0;
  }

  /** nextDouble(), nextDouble(until), nextDouble(from, until) */
  nextDouble(a?: number, b?: number): number {
    const d = (this.nextBits(26) * 134217728 + this.nextBits(27)) / 9007199254740992;
    if (a === undefined) return d;
    const from = b === undefined ? 0 : a;
    const until = b === undefined ? a : b;
    if (!(until > from)) rangeError(from, until);
    const size = until - from;
    let r: number;
    if (!Number.isFinite(size) && Number.isFinite(from) && Number.isFinite(until)) {
      const r1 = d * (until / 2 - from / 2);
      r = from + r1 + r1;
    } else r = from + d * size;
    return r >= until ? nextDown(until) : r;
  }

  nextFloat(): number {
    return this.nextBits(24) / 16777216;
  }

  /** nextBytes(array), nextBytes(array, from, to), nextBytes(size) */
  nextBytes(a: any, fromIndex = 0, toIndex?: number): Int8Array {
    const array: Int8Array = typeof a === 'number' ? new Int8Array(a) : a instanceof Int8Array ? a : i8(u8(a));
    const to = toIndex ?? array.length;
    if (!(fromIndex >= 0 && fromIndex <= array.length && to >= 0 && to <= array.length)) {
      throw new IllegalArgumentException(`fromIndex (${fromIndex}) or toIndex (${to}) are out of range: 0..${array.length}.`);
    }
    if (fromIndex > to) throw new IllegalArgumentException(`fromIndex (${fromIndex}) must be not greater than toIndex (${to}).`);
    const steps = Math.floor((to - fromIndex) / 4);
    let p = fromIndex;
    for (let s = 0; s < steps; s++) {
      const v = this.nextInt();
      array[p] = v;
      array[p + 1] = v >>> 8;
      array[p + 2] = v >>> 16;
      array[p + 3] = v >>> 24;
      p += 4;
    }
    const remainder = to - p;
    const vr = this.nextBits(remainder * 8);
    for (let i = 0; i < remainder; i++) array[p + i] = vr >>> (i * 8);
    return array;
  }

  /** kotlin.random.nextUBytes: UByteArray as Uint8Array. */
  nextUBytes(a: any): Uint8Array {
    const n = typeof a === 'number' ? a : a.length;
    const out = this.nextBytes(n);
    const res = typeof a === 'number' ? new Uint8Array(n) : u8(a);
    res.set(u8(out));
    return res;
  }
  nextUInt(a?: number, b?: number): number {
    if (a === undefined) return this.nextInt() >>> 0;
    const from = b === undefined ? 0 : a;
    const until = b === undefined ? a : b;
    // compare as signed after flipping the sign bit, like Kotlin
    return (this.nextInt((from ^ 0x80000000) | 0, (until ^ 0x80000000) | 0) ^ 0x80000000) >>> 0;
  }
}

function nextDown(x: number): number {
  if (Number.isNaN(x) || x === -Infinity) return x;
  if (x === 0) return -Number.MIN_VALUE;
  // step the IEEE-754 bit pattern by one ulp toward -Infinity (little-endian word order)
  const f = new Float64Array([x]);
  const w = new Uint32Array(f.buffer);
  const delta = x > 0 ? -1 : 1;
  const lo = w[0] + delta;
  if (lo < 0) {
    w[0] = 0xffffffff;
    w[1] -= 1;
  } else if (lo > 0xffffffff) {
    w[0] = 0;
    w[1] += 1;
  } else w[0] = lo;
  return f[0];
}

export class XorWowRandom extends KRandom {
  private x: number;
  private y: number;
  private z: number;
  private w: number;
  private v: number;
  private addend: number;
  constructor(seed1: number, seed2: number) {
    super();
    this.x = seed1 | 0;
    this.y = seed2 | 0;
    this.z = 0;
    this.w = 0;
    this.v = ~seed1;
    this.addend = (seed1 << 10) ^ (seed2 >>> 4);
    if ((this.x | this.y | this.z | this.w | this.v) === 0) throw new IllegalArgumentException('Initial state must have at least one non-zero element.');
    for (let i = 0; i < 64; i++) this.nextInt();
  }
  override nextInt(a?: number, b?: number): number {
    if (a !== undefined) return super.nextInt(a, b);
    let t = this.x;
    t ^= t >>> 2;
    this.x = this.y;
    this.y = this.z;
    this.z = this.w;
    const v0 = this.v;
    this.w = v0;
    t = t ^ (t << 1) ^ v0 ^ (v0 << 4);
    this.v = t;
    this.addend = (this.addend + 362437) | 0;
    return (t + this.addend) | 0;
  }
  nextBits(bitCount: number): number {
    return takeUpperBits(this.nextInt(), bitCount);
  }
}

function seedParts(seed: number | bigint): [number, number] {
  if (typeof seed === 'bigint') return [Number(BigInt.asIntN(32, seed)), Number(BigInt.asIntN(32, seed >> 32n))];
  const s = Math.trunc(seed);
  return [s | 0, Math.floor(s / TWO32) | 0];
}

function randomSeed(): [number, number] {
  const b = randomFill(new Uint8Array(8));
  const dv = new DataView(b.buffer);
  return [dv.getInt32(0), dv.getInt32(4)];
}

const DefaultRandom: KRandom = (() => {
  const [a, c] = randomSeed();
  return new XorWowRandom(a, c || 1);
})();

type RandomFactory = {
  (seed: number | bigint): KRandom;
  new (seed: number | bigint): KRandom;
  Default: KRandom;
  Companion: KRandom;
  nextInt: KRandom['nextInt'];
  nextLong: KRandom['nextLong'];
  nextDouble: KRandom['nextDouble'];
  nextFloat: KRandom['nextFloat'];
  nextBoolean: KRandom['nextBoolean'];
  nextBytes: KRandom['nextBytes'];
  nextBits: KRandom['nextBits'];
  nextUBytes: KRandom['nextUBytes'];
  nextUInt: KRandom['nextUInt'];
  $is: (x: unknown) => boolean;
};

/**
 * kotlin.random.Random: `Random(seed)` (call or `new`) gives a seeded XorWow generator;
 * `Random.nextInt(...)` etc. use `Random.Default`.
 */
export const Random: RandomFactory = Object.assign(
  function Random(seed: number | bigint): KRandom {
    const [lo, hi] = seedParts(seed);
    return new XorWowRandom(lo, hi);
  } as any,
  {
    Default: DefaultRandom,
    Companion: DefaultRandom,
    nextInt: (a?: number, b?: number) => DefaultRandom.nextInt(a, b),
    nextLong: (a?: number, b?: number) => DefaultRandom.nextLong(a, b),
    nextDouble: (a?: number, b?: number) => DefaultRandom.nextDouble(a, b),
    nextFloat: () => DefaultRandom.nextFloat(),
    nextBoolean: () => DefaultRandom.nextBoolean(),
    nextBytes: (a: any, f?: number, t?: number) => DefaultRandom.nextBytes(a, f, t),
    nextBits: (n: number) => DefaultRandom.nextBits(n),
    nextUBytes: (a: any) => DefaultRandom.nextUBytes(a),
    nextUInt: (a?: number, b?: number) => DefaultRandom.nextUInt(a, b),
    $is: (x: unknown) => x instanceof KRandom,
  },
);
(Random as any).prototype = KRandom.prototype;

/** kotlin.random.nextUBytes / nextUInt as extension functions. */
export const randomExts: ExtDef[] = [
  ext('nextUBytes', (x) => x instanceof KRandom || x === Random, (r: any, a: any) => r.nextUBytes(a)),
  ext('nextUInt', (x) => x instanceof KRandom || x === Random, (r: any, a?: number, b?: number) => r.nextUInt(a, b)),
];

// ---------- java.util.Random ----------

const MULT = 0x5deece66dn;
const MASK48 = (1n << 48n) - 1n;
let seedUniquifier = 8682522807148012n;

export class JavaRandom {
  private seed = 0n;
  private nextNextGaussian = 0;
  private haveNextNextGaussian = false;
  constructor(seed?: number | bigint) {
    if (seed === undefined) {
      seedUniquifier = BigInt.asIntN(64, seedUniquifier * 1181783497276652981n);
      const [a, b] = randomSeed();
      this.setSeed(seedUniquifier ^ toLong(a, b));
    } else this.setSeed(seed);
  }
  setSeed(seed: number | bigint): void {
    const s = typeof seed === 'bigint' ? seed : BigInt(Math.trunc(seed));
    this.seed = (s ^ MULT) & MASK48;
    this.haveNextNextGaussian = false;
  }
  protected next(bits: number): number {
    this.seed = (this.seed * MULT + 0xbn) & MASK48;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  }
  /** nextInt(), nextInt(bound), nextInt(origin, bound) */
  nextInt(a?: number, b?: number): number {
    if (a === undefined) return this.next(32);
    if (b !== undefined) {
      if (a >= b) throw new IllegalArgumentException('bound must be greater than origin');
      // RandomSupport.boundedNextInt (JDK 17+)
      let r = this.next(32);
      const n = (b - a) | 0;
      const m = (n - 1) | 0;
      if ((n & m) === 0) return ((r & m) + a) | 0;
      if (n > 0) {
        for (let u = r >>> 1; ((u + m - (r = u % n)) | 0) < 0; u = this.next(32) >>> 1);
        return (r + a) | 0;
      }
      while (r < a || r >= b) r = this.next(32);
      return r;
    }
    const bound = a;
    if (bound <= 0) throw new IllegalArgumentException('bound must be positive');
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    let bits: number;
    let val: number;
    do {
      bits = this.next(31);
      val = bits % bound;
    } while (((bits - val + (bound - 1)) | 0) < 0);
    return val;
  }
  nextLong(): number {
    return Number(BigInt.asIntN(64, (BigInt(this.next(32)) << 32n) + BigInt(this.next(32))));
  }
  nextBoolean(): boolean {
    return this.next(1) !== 0;
  }
  nextFloat(): number {
    return this.next(24) / 16777216;
  }
  nextDouble(): number {
    return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992;
  }
  nextGaussian(): number {
    if (this.haveNextNextGaussian) {
      this.haveNextNextGaussian = false;
      return this.nextNextGaussian;
    }
    let v1: number;
    let v2: number;
    let s: number;
    do {
      v1 = 2 * this.nextDouble() - 1;
      v2 = 2 * this.nextDouble() - 1;
      s = v1 * v1 + v2 * v2;
    } while (s >= 1 || s === 0);
    const multiplier = Math.sqrt((-2 * Math.log(s)) / s);
    this.nextNextGaussian = v2 * multiplier;
    this.haveNextNextGaussian = true;
    return v1 * multiplier;
  }
  nextBytes(bytes: any): void {
    const a = u8(bytes);
    for (let i = 0; i < a.length; ) {
      for (let rnd = this.nextInt(), n = Math.min(a.length - i, 4); n-- > 0; rnd >>= 8) a[i++] = rnd & 0xff;
    }
  }
}

// ---------- keiyoushi.utils.SeedRandom ----------

const WIDTH = 256;
const CHUNKS = 6;
const DIGITS = 52;
const MASK = WIDTH - 1;

class ARC4 {
  private i = 0;
  private j = 0;
  private readonly s = new Int32Array(WIDTH);
  constructor(key: number[]) {
    const k = key.length === 0 ? [0] : key;
    for (let n = 0; n < WIDTH; n++) this.s[n] = n;
    let j = 0;
    for (let n = 0; n < WIDTH; n++) {
      const t = this.s[n];
      j = MASK & (j + k[n % k.length] + t);
      this.s[n] = this.s[j];
      this.s[j] = t;
    }
    this.g(WIDTH);
  }
  g(count: number): number {
    let r = 0;
    const s = this.s;
    while (count-- > 0) {
      this.i = MASK & (this.i + 1);
      const t = s[this.i];
      this.j = MASK & (this.j + t);
      const sj = s[this.j];
      s[this.i] = sj;
      s[this.j] = t;
      r = r * WIDTH + s[MASK & (sj + t)];
    }
    return r;
  }
}

export class SeedRandom {
  private readonly startdenom = Math.pow(WIDTH, CHUNKS);
  private readonly significance = Math.pow(2, DIGITS);
  private readonly overflow = this.significance * 2;
  private readonly arc4: ARC4;
  constructor(seed: string) {
    this.arc4 = new ARC4(SeedRandom.mixkey(String(seed)));
  }
  nextDouble(): number {
    let n = this.arc4.g(CHUNKS);
    let d = this.startdenom;
    let x = 0;
    while (n < this.significance) {
      n = (n + x) * WIDTH;
      d *= WIDTH;
      x = this.arc4.g(1);
    }
    while (n >= this.overflow) {
      n /= 2;
      d /= 2;
      x = Math.floor(x / 2);
    }
    return (n + x) / d;
  }
  shuffle<T>(list: T[]): T[] {
    const keys: number[] = [];
    for (let i = 0; i < list.length; i++) keys.push(i);
    const resp: T[] = [];
    for (let k = 0; k < list.length; k++) {
      const r = Math.floor(this.nextDouble() * keys.length);
      resp.push(list[keys.splice(r, 1)[0]]);
    }
    return resp;
  }
  private static mixkey(seed: string): number[] {
    const key = new Array<number>(WIDTH).fill(0);
    let smear = 0;
    for (let j = 0; j < seed.length; j++) {
      smear ^= key[MASK & j] * 19;
      key[MASK & j] = MASK & (smear + seed.charCodeAt(j));
    }
    return key.slice(0, Math.min(seed.length, WIDTH));
  }
}

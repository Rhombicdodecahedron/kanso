// java.nio.ByteBuffer / ByteOrder subset, plus keiyoushi.utils Binary.kt and Crypto.kt.

import { type ExtDef, IllegalArgumentException, IllegalStateException, IndexOutOfBoundsException, RuntimeException } from '../kotlin/core';
import { ext } from '../kotlin/hof';
import { BufferedSource, Buffer as OkioBuffer } from '../okhttp';
import { i8, isByteArray, u8 } from './charset';

export class BufferUnderflowException extends RuntimeException {}
export class BufferOverflowException extends RuntimeException {}
export class InvalidMarkException extends IllegalStateException {}

export class ByteOrder {
  private constructor(private readonly n: string) {}
  static readonly BIG_ENDIAN = new ByteOrder('BIG_ENDIAN');
  static readonly LITTLE_ENDIAN = new ByteOrder('LITTLE_ENDIAN');
  static nativeOrder(): ByteOrder {
    return ByteOrder.LITTLE_ENDIAN;
  }
  toString(): string {
    return this.n;
  }
}

export class ByteBuffer {
  private readonly view: DataView;
  private pos: number;
  private lim: number;
  private mk = -1;
  private le = false;

  private constructor(
    private readonly bytes: Int8Array,
    private readonly offset: number,
    private readonly cap: number,
    pos = 0,
    lim = cap,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset + offset, cap);
    this.pos = pos;
    this.lim = lim;
  }

  static allocate(capacity: number): ByteBuffer {
    if (capacity < 0) throw new IllegalArgumentException(`capacity < 0: (${capacity} < 0)`);
    return new ByteBuffer(new Int8Array(capacity), 0, capacity);
  }
  static allocateDirect(capacity: number): ByteBuffer {
    return ByteBuffer.allocate(capacity);
  }
  /** wrap(array) or wrap(array, offset, length): shares the array. */
  static wrap(array: any, offset?: number, length?: number): ByteBuffer {
    const a = array instanceof Int8Array ? array : i8(u8(array));
    if (offset === undefined) return new ByteBuffer(a, 0, a.length);
    const len = length ?? a.length - offset;
    if (offset < 0 || len < 0 || offset + len > a.length) throw new IndexOutOfBoundsException();
    return new ByteBuffer(a, 0, a.length, offset, offset + len);
  }

  // ----- buffer state -----
  capacity(): number {
    return this.cap;
  }
  position(newPosition?: number): any {
    if (newPosition === undefined) return this.pos;
    if (newPosition < 0 || newPosition > this.lim) throw new IllegalArgumentException(`newPosition > limit: (${newPosition} > ${this.lim})`);
    if (this.mk > newPosition) this.mk = -1;
    this.pos = newPosition;
    return this;
  }
  limit(newLimit?: number): any {
    if (newLimit === undefined) return this.lim;
    if (newLimit < 0 || newLimit > this.cap) throw new IllegalArgumentException(`newLimit > capacity: (${newLimit} > ${this.cap})`);
    this.lim = newLimit;
    if (this.pos > newLimit) this.pos = newLimit;
    if (this.mk > newLimit) this.mk = -1;
    return this;
  }
  mark(): this {
    this.mk = this.pos;
    return this;
  }
  reset(): this {
    if (this.mk < 0) throw new InvalidMarkException();
    this.pos = this.mk;
    return this;
  }
  clear(): this {
    this.pos = 0;
    this.lim = this.cap;
    this.mk = -1;
    return this;
  }
  flip(): this {
    this.lim = this.pos;
    this.pos = 0;
    this.mk = -1;
    return this;
  }
  rewind(): this {
    this.pos = 0;
    this.mk = -1;
    return this;
  }
  remaining(): number {
    return Math.max(0, this.lim - this.pos);
  }
  hasRemaining(): boolean {
    return this.pos < this.lim;
  }
  isReadOnly(): boolean {
    return false;
  }
  hasArray(): boolean {
    return true;
  }
  isDirect(): boolean {
    return false;
  }
  array(): Int8Array {
    return this.bytes;
  }
  arrayOffset(): number {
    return this.offset;
  }
  /** order() -> ByteOrder, order(ByteOrder) -> this */
  order(bo?: ByteOrder): any {
    if (bo === undefined) return this.le ? ByteOrder.LITTLE_ENDIAN : ByteOrder.BIG_ENDIAN;
    this.le = bo === ByteOrder.LITTLE_ENDIAN;
    return this;
  }
  slice(index?: number, length?: number): ByteBuffer {
    const start = index ?? this.pos;
    const len = length ?? this.remaining();
    const b = new ByteBuffer(this.bytes, this.offset + start, len);
    return b;
  }
  duplicate(): ByteBuffer {
    const b = new ByteBuffer(this.bytes, this.offset, this.cap, this.pos, this.lim);
    b.le = this.le;
    b.mk = this.mk;
    return b;
  }
  asReadOnlyBuffer(): ByteBuffer {
    return this.duplicate();
  }
  compact(): this {
    const rem = this.remaining();
    const base = this.offset;
    this.bytes.copyWithin(base, base + this.pos, base + this.pos + rem);
    this.pos = rem;
    this.lim = this.cap;
    this.mk = -1;
    return this;
  }

  // ----- index helpers -----
  private next(n: number): number {
    if (this.lim - this.pos < n) throw new BufferUnderflowException();
    const p = this.pos;
    this.pos += n;
    return p;
  }
  private nextPut(n: number): number {
    if (this.lim - this.pos < n) throw new BufferOverflowException();
    const p = this.pos;
    this.pos += n;
    return p;
  }
  private check(i: number, n: number): number {
    if (i < 0 || n > this.lim - i) throw new IndexOutOfBoundsException(`Index ${i} out of bounds for length ${this.lim}`);
    return i;
  }

  // ----- get -----
  /** get(), get(index), get(dst), get(dst, offset, length), get(index, dst[, offset, length]) */
  get(a?: any, b?: any, c?: any, d?: any): any {
    if (a === undefined) return this.view.getInt8(this.next(1));
    if (typeof a === 'number' && b === undefined) return this.view.getInt8(this.check(a, 1));
    if (typeof a === 'number') {
      const dst = u8(b);
      const off = c ?? 0;
      const len = d ?? dst.length - off;
      this.check(a, len);
      dst.set(new Uint8Array(this.view.buffer, this.view.byteOffset + a, len), off);
      return this;
    }
    const dst = u8(a);
    const off = b ?? 0;
    const len = c ?? dst.length - off;
    if (off < 0 || len < 0 || off + len > dst.length) throw new IndexOutOfBoundsException();
    const p = this.next(len);
    dst.set(new Uint8Array(this.view.buffer, this.view.byteOffset + p, len), off);
    return this;
  }
  getShort(i?: number): number {
    return this.view.getInt16(i === undefined ? this.next(2) : this.check(i, 2), this.le);
  }
  getChar(i?: number): string {
    return String.fromCharCode(this.view.getUint16(i === undefined ? this.next(2) : this.check(i, 2), this.le));
  }
  getInt(i?: number): number {
    return this.view.getInt32(i === undefined ? this.next(4) : this.check(i, 4), this.le);
  }
  getLong(i?: number): number {
    const p = i === undefined ? this.next(8) : this.check(i, 8);
    const a = this.view.getInt32(p, this.le);
    const b = this.view.getInt32(p + 4, this.le);
    const [hi, lo] = this.le ? [b, a] : [a, b];
    return Number(BigInt.asIntN(64, (BigInt(hi) << 32n) | BigInt(lo >>> 0)));
  }
  getFloat(i?: number): number {
    return this.view.getFloat32(i === undefined ? this.next(4) : this.check(i, 4), this.le);
  }
  getDouble(i?: number): number {
    return this.view.getFloat64(i === undefined ? this.next(8) : this.check(i, 8), this.le);
  }
  // Kotlin property syntax for Java getters: `buffer.int`, `buffer.short`, ...
  get short(): number {
    return this.getShort();
  }
  get char(): string {
    return this.getChar();
  }
  get int(): number {
    return this.getInt();
  }
  get long(): number {
    return this.getLong();
  }
  get float(): number {
    return this.getFloat();
  }
  get double(): number {
    return this.getDouble();
  }

  // ----- put -----
  /** put(byte), put(index, byte), put(src: ByteArray|ByteBuffer), put(src, offset, length) */
  put(a: any, b?: any, c?: any): this {
    if (typeof a === 'number' && b === undefined) {
      this.view.setInt8(this.nextPut(1), toByte(a));
      return this;
    }
    if (typeof a === 'number' && typeof b === 'number') {
      this.view.setInt8(this.check(a, 1), toByte(b));
      return this;
    }
    let src: Uint8Array;
    if (a instanceof ByteBuffer) {
      const n = a.remaining();
      src = new Uint8Array(a.view.buffer, a.view.byteOffset + a.pos, n).slice();
      a.pos += n;
    } else {
      const all = u8(a);
      const off = b ?? 0;
      const len = c ?? all.length - off;
      if (off < 0 || len < 0 || off + len > all.length) throw new IndexOutOfBoundsException();
      src = all.subarray(off, off + len);
    }
    const p = this.nextPut(src.length);
    new Uint8Array(this.view.buffer, this.view.byteOffset + p, src.length).set(src);
    return this;
  }
  private at(args: any[], n: number): [number, any] {
    return args.length >= 2 ? [this.check(args[0], n), args[1]] : [this.nextPut(n), args[0]];
  }
  putShort(...args: any[]): this {
    const [i, v] = this.at(args, 2);
    this.view.setInt16(i, Number(v) << 16 >> 16, this.le);
    return this;
  }
  putChar(...args: any[]): this {
    const [i, v] = this.at(args, 2);
    this.view.setUint16(i, typeof v === 'string' ? v.charCodeAt(0) : Number(v) & 0xffff, this.le);
    return this;
  }
  putInt(...args: any[]): this {
    const [i, v] = this.at(args, 4);
    this.view.setInt32(i, Number(v) | 0, this.le);
    return this;
  }
  putLong(...args: any[]): this {
    const [i, v] = this.at(args, 8);
    const big = BigInt.asIntN(64, typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v))));
    const hi = Number(BigInt.asIntN(32, big >> 32n));
    const lo = Number(BigInt.asIntN(32, big));
    this.view.setInt32(i, this.le ? lo : hi, this.le);
    this.view.setInt32(i + 4, this.le ? hi : lo, this.le);
    return this;
  }
  putFloat(...args: any[]): this {
    const [i, v] = this.at(args, 4);
    this.view.setFloat32(i, Number(v), this.le);
    return this;
  }
  putDouble(...args: any[]): this {
    const [i, v] = this.at(args, 8);
    this.view.setFloat64(i, Number(v), this.le);
    return this;
  }

  equals(o: unknown): boolean {
    if (!(o instanceof ByteBuffer) || o.remaining() !== this.remaining()) return false;
    for (let i = 0; i < this.remaining(); i++) if (this.view.getInt8(this.pos + i) !== o.view.getInt8(o.pos + i)) return false;
    return true;
  }
  toString(): string {
    return `java.nio.HeapByteBuffer[pos=${this.pos} lim=${this.lim} cap=${this.cap}]`;
  }
}

const toByte = (v: number) => (Number(v) << 24) >> 24;

// ---------- keiyoushi.utils Binary.kt ----------

const BYTES = isByteArray;
const STR = (x: any) => typeof x === 'string';

function b(arr: any, i: number): number {
  if (i < 0 || i >= arr.length) throw new IndexOutOfBoundsException(`Index ${i} out of bounds for length ${arr.length}`);
  return arr[i] & 0xff;
}
function setB(arr: any, i: number, v: number): void {
  if (i < 0 || i >= arr.length) throw new IndexOutOfBoundsException(`Index ${i} out of bounds for length ${arr.length}`);
  arr[i] = arr instanceof Int8Array ? (v << 24) >> 24 : v & 0xff;
}

export const readIntLittleEndian = ext('readIntLittleEndian', BYTES, (a, o: number) => b(a, o) | (b(a, o + 1) << 8) | (b(a, o + 2) << 16) | (b(a, o + 3) << 24));
export const readIntBigEndian = ext('readIntBigEndian', BYTES, (a, o: number) => (b(a, o) << 24) | (b(a, o + 1) << 16) | (b(a, o + 2) << 8) | b(a, o + 3));
export const writeIntLittleEndian = ext('writeIntLittleEndian', BYTES, (a, o: number, v: number) => {
  setB(a, o, v);
  setB(a, o + 1, v >>> 8);
  setB(a, o + 2, v >>> 16);
  setB(a, o + 3, v >>> 24);
});
export const writeIntBigEndian = ext('writeIntBigEndian', BYTES, (a, o: number, v: number) => {
  setB(a, o, v >>> 24);
  setB(a, o + 1, v >>> 16);
  setB(a, o + 2, v >>> 8);
  setB(a, o + 3, v);
});
export const readUShortLittleEndian = ext('readUShortLittleEndian', BYTES, (a, o: number) => b(a, o) | (b(a, o + 1) << 8));
export const readUShortBigEndian = ext('readUShortBigEndian', BYTES, (a, o: number) => (b(a, o) << 8) | b(a, o + 1));
export const readUIntLittleEndian = ext('readUIntLittleEndian', BYTES, (a, o: number) => (b(a, o) | (b(a, o + 1) << 8) | (b(a, o + 2) << 16) | (b(a, o + 3) << 24)) >>> 0);
export const readLongLittleEndian = ext('readLongLittleEndian', BYTES, (a, o: number) => {
  let v = 0n;
  for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(b(a, o + k));
  return Number(BigInt.asIntN(64, v));
});

// ---------- keiyoushi.utils Crypto.kt ----------

export function decodeHexString(s: string): Int8Array {
  if (s.length % 2 !== 0) throw new IllegalArgumentException(`Unexpected hex string: ${s}`);
  const out = new Int8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = (hexDigit(s[i * 2]) << 4) + hexDigit(s[i * 2 + 1]);
  return out;
}
function hexDigit(c: string): number {
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'a' && c <= 'f') return c.charCodeAt(0) - 87;
  if (c >= 'A' && c <= 'F') return c.charCodeAt(0) - 55;
  throw new IllegalArgumentException(`Unexpected hex digit: ${c}`);
}

/** RC4 keystream state (keiyoushi.utils private class Rc4). */
export class Rc4 {
  private readonly s = new Uint8Array(256);
  private a = 0;
  private b = 0;
  constructor(key: any, skip = 0) {
    const k = u8(key);
    if (k.length === 0) throw new IllegalArgumentException('RC4 key must not be empty');
    if (k.length > 256) throw new IllegalArgumentException(`RC4 key must not exceed 256 bytes, got ${k.length}`);
    if (skip < 0) throw new IllegalArgumentException(`RC4 skip must be non-negative, got ${skip}`);
    const s = this.s;
    for (let i = 0; i < 256; i++) s[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + s[i] + k[i % k.length]) & 0xff;
      const t = s[i];
      s[i] = s[j];
      s[j] = t;
    }
    for (let n = 0; n < skip; n++) {
      this.a = (this.a + 1) & 0xff;
      this.b = (this.b + s[this.a]) & 0xff;
      const t = s[this.a];
      s[this.a] = s[this.b];
      s[this.b] = t;
    }
  }
  apply(data: Uint8Array, offset: number, length: number): void {
    const s = this.s;
    let a = this.a;
    let b = this.b;
    for (let i = offset; i < offset + length; i++) {
      a = (a + 1) & 0xff;
      const sa = s[a];
      b = (b + sa) & 0xff;
      const sb = s[b];
      s[a] = sb;
      s[b] = sa;
      data[i] ^= s[(sa + sb) & 0xff];
    }
    this.a = a;
    this.b = b;
  }
}

export function rc4Bytes(data: any, key: any, skip = 0): Int8Array {
  const out = u8(data).slice();
  new Rc4(key, skip).apply(out, 0, out.length);
  return i8(out);
}

const SOURCE = (x: any) => x instanceof BufferedSource || x instanceof OkioBuffer;

/** Fully read an okio-like source into bytes. */
export function readSource(src: any): Uint8Array {
  if (src instanceof BufferedSource || src instanceof OkioBuffer) return src.readAll();
  if (typeof src?.readByteArray === 'function') return u8(src.readByteArray());
  throw new IllegalArgumentException('Not a Source');
}

export const binaryExts: ExtDef[] = [
  readIntLittleEndian,
  readIntBigEndian,
  writeIntLittleEndian,
  writeIntBigEndian,
  readUShortLittleEndian,
  readUShortBigEndian,
  readUIntLittleEndian,
  readLongLittleEndian,
];

export const decodeHexExt = ext('decodeHex', STR, (s: string) => decodeHexString(s));
export const rc4Exts: ExtDef[] = [
  ext('rc4', BYTES, (data, key, skip?: number) => rc4Bytes(data, key, skip ?? 0)),
  ext('rc4', SOURCE, (src, key, skip?: number) => new BufferedSource(u8(rc4Bytes(readSource(src), key, skip ?? 0)))),
];

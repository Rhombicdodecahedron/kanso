// java.util.zip subset (Inflater, InflaterInputStream, GZIPInputStream, ZipInputStream) and
// keiyoushi.utils Inflater.kt, on top of fflate (pure JS).

import { gunzipSync, inflateSync, unzipSync, unzlibSync } from 'fflate';
import { Exception, type ExtDef, IllegalStateException, IOException } from '../kotlin/core';
import { ext } from '../kotlin/hof';
import { BufferedSource, InputStream, Buffer as OkioBuffer } from '../okhttp';
import { concatBytes, i8, isByteArray, u8, utf8String } from './charset';
import { readSource } from './binary';

export class DataFormatException extends Exception {}
export class ZipException extends IOException {}

/** Bytes of an InputStream-like value (okhttp InputStream, our streams, or a byte array). */
export function streamBytes(src: any): Uint8Array {
  if (isByteArray(src)) return u8(src);
  if (src instanceof InputStream) return u8(src.readBytes());
  if (src instanceof BufferedSource || src instanceof OkioBuffer) return src.readAll();
  if (src && typeof src.readBytes === 'function') return u8(src.readBytes());
  if (src && typeof src.readByteArray === 'function') return u8(src.readByteArray());
  throw new IOException('Unsupported input stream');
}

function inflateRaw(data: Uint8Array, nowrap: boolean): Uint8Array {
  return nowrap ? inflateSync(data) : unzlibSync(data);
}

function fflateError(e: any, Ex: new (m?: string) => Error): Error {
  return new Ex(e?.message ?? String(e));
}

/** An InputStream over bytes produced on construction. */
class BytesInputStream extends InputStream {
  constructor(data: Uint8Array) {
    super(data);
  }
}

export class Inflater {
  private input: Uint8Array[] = [];
  private output: Uint8Array | null = null;
  private outPos = 0;
  private totalIn = 0;
  constructor(private readonly nowrap = false) {}
  setInput(b: any, off = 0, len?: number): void {
    const a = u8(b);
    const part = a.slice(off, off + (len ?? a.length - off));
    this.input.push(part);
    this.totalIn += part.length;
  }
  needsInput(): boolean {
    return this.output === null && !this.tryInflate();
  }
  needsDictionary(): boolean {
    return false;
  }
  setDictionary(_b: any): void {}
  private tryInflate(): boolean {
    if (this.output) return true;
    if (!this.input.length) return false;
    try {
      this.output = inflateRaw(concatBytes(this.input), this.nowrap);
      return true;
    } catch (e: any) {
      if (e?.code === 0) return false; // unexpected EOF: wait for more input
      throw fflateError(e, DataFormatException);
    }
  }
  /** inflate(buf) / inflate(buf, off, len) -> number of bytes written */
  inflate(buf: any, off = 0, len?: number): number {
    if (!this.tryInflate()) return 0;
    const dst = u8(buf);
    const n = Math.min(len ?? dst.length - off, this.output!.length - this.outPos);
    dst.set(this.output!.subarray(this.outPos, this.outPos + n), off);
    this.outPos += n;
    return n;
  }
  finished(): boolean {
    return this.output !== null && this.outPos >= this.output.length;
  }
  getRemaining(): number {
    return 0;
  }
  get remaining(): number {
    return 0;
  }
  getTotalIn(): number {
    return this.totalIn;
  }
  get totalOut(): number {
    return this.outPos;
  }
  getTotalOut(): number {
    return this.outPos;
  }
  getBytesRead(): number {
    return this.totalIn;
  }
  getBytesWritten(): number {
    return this.outPos;
  }
  reset(): void {
    this.input = [];
    this.output = null;
    this.outPos = 0;
    this.totalIn = 0;
  }
  end(): void {
    this.reset();
  }
  /** Inflate everything at once (runtime helper). */
  $all(): Uint8Array {
    if (!this.tryInflate()) throw new ZipException('Unexpected end of ZLIB input stream');
    return this.output!;
  }
}

export class InflaterInputStream extends BytesInputStream {
  constructor(src: any, inflater?: Inflater, _size?: number) {
    const inf = inflater ?? new Inflater();
    inf.setInput(streamBytes(src));
    let out: Uint8Array;
    try {
      out = inf.$all();
    } catch (e: any) {
      throw e instanceof ZipException ? e : new ZipException(e?.message ?? String(e));
    }
    super(out);
  }
}

export class GZIPInputStream extends BytesInputStream {
  constructor(src: any, _size?: number) {
    const data = streamBytes(src);
    if (data.length < 2 || data[0] !== 0x1f || data[1] !== 0x8b) throw new ZipException('Not in GZIP format');
    let out: Uint8Array;
    try {
      out = gunzipSync(data);
    } catch (e: any) {
      throw fflateError(e, e?.code === 0 ? EOFException : ZipException);
    }
    super(out);
  }
}

export class EOFException extends IOException {}

export class ZipEntry {
  constructor(
    readonly name: string,
    readonly size: number,
    readonly compressedSize: number,
  ) {}
  getName(): string {
    return this.name;
  }
  getSize(): number {
    return this.size;
  }
  getCompressedSize(): number {
    return this.compressedSize;
  }
  get isDirectory(): boolean {
    return this.name.endsWith('/');
  }
  isDirectory$call(): boolean {
    return this.isDirectory;
  }
  toString(): string {
    return this.name;
  }
}

/** java.util.zip.ZipInputStream: `nextEntry` / `getNextEntry()` then read the entry's bytes. */
export class ZipInputStream extends InputStream {
  private entries: [ZipEntry, Uint8Array][];
  private idx = -1;
  private cur: Uint8Array = new Uint8Array(0);
  private p = 0;
  constructor(src: any, _charset?: any) {
    super(new Uint8Array(0));
    const data = streamBytes(src);
    const order: [string, number, number][] = [];
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(data, {
        filter: (f) => {
          order.push([f.name, f.originalSize, f.size]);
          return true;
        },
      });
    } catch (e: any) {
      throw new ZipException(e?.message ?? String(e));
    }
    this.entries = order.map(([n, s, c]) => [new ZipEntry(n, s, c), files[n] ?? new Uint8Array(0)]);
  }
  getNextEntry(): ZipEntry | null {
    this.idx++;
    if (this.idx >= this.entries.length) {
      this.cur = new Uint8Array(0);
      this.p = 0;
      return null;
    }
    this.cur = this.entries[this.idx][1];
    this.p = 0;
    return this.entries[this.idx][0];
  }
  get nextEntry(): ZipEntry | null {
    return this.getNextEntry();
  }
  closeEntry(): void {
    this.p = this.cur.length;
  }
  override read(buf?: any, off = 0, len?: number): number {
    if (buf === undefined) return this.p < this.cur.length ? this.cur[this.p++] : -1;
    if (this.p >= this.cur.length) return -1;
    const dst = u8(buf);
    const n = Math.min(len ?? dst.length - off, this.cur.length - this.p);
    dst.set(this.cur.subarray(this.p, this.p + n), off);
    this.p += n;
    return n;
  }
  override readBytes(): Int8Array {
    const out = this.cur.slice(this.p);
    this.p = this.cur.length;
    return i8(out);
  }
  override available(): number {
    return this.p < this.cur.length ? 1 : 0;
  }
  override close(): void {}
  override bufferedReader(): any {
    const text = utf8String(this.cur, this.p);
    return { readText: () => text, readLines: () => text.split('\n'), close: () => {} };
  }
}

// ---------- keiyoushi.utils.inflate ----------

function inflateBytes(data: Uint8Array, nowrap: boolean): Uint8Array {
  try {
    return inflateRaw(data, nowrap);
  } catch (e: any) {
    if (e instanceof IllegalStateException) throw e;
    throw new ZipException(e?.message ?? String(e));
  }
}

export const inflateExts: ExtDef[] = [
  ext('inflate', isByteArray, (b: any, nowrap?: boolean) => i8(inflateBytes(u8(b), nowrap ?? false))),
  ext(
    'inflate',
    (x) => x instanceof BufferedSource || x instanceof OkioBuffer,
    (src: any, nowrap?: boolean) => new OkioBuffer().write(inflateBytes(readSource(src), nowrap ?? false)),
  ),
];

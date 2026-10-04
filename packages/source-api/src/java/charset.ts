// java.nio.charset.Charset, kotlin.text.Charsets / StandardCharsets, and pure-JS byte <-> string
// conversion (no TextEncoder/TextDecoder dependency for UTF-8, Latin-1 and ASCII, so it runs on Hermes).

import { IllegalArgumentException, IndexOutOfBoundsException, UnsupportedEncodingException } from '../kotlin/core';

export type Bytes = Int8Array | Uint8Array;

// ---------- byte array helpers ----------

/** View any byte array (or number list) as unsigned bytes without copying when possible. */
export function u8(b: any): Uint8Array {
  if (b instanceof Uint8Array) return b;
  if (b instanceof Int8Array) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (Array.isArray(b)) return Uint8Array.from(b, (x) => Number(x) & 0xff);
  if (b === null || b === undefined) throw new IllegalArgumentException('Null byte array');
  throw new IllegalArgumentException(`Not a byte array: ${typeof b}`);
}

/** View unsigned bytes as a signed Kotlin ByteArray without copying. */
export function i8(b: Uint8Array | Int8Array): Int8Array {
  if (b instanceof Int8Array) return b;
  return new Int8Array(b.buffer, b.byteOffset, b.byteLength);
}

/** Copy of a byte range as fresh unsigned bytes. */
export function u8copy(b: any, off = 0, len?: number): Uint8Array {
  const src = u8(b);
  const n = len ?? src.length - off;
  if (off < 0 || n < 0 || off + n > src.length) throw new IndexOutOfBoundsException(`Range [${off}, ${off + n}) out of bounds for length ${src.length}`);
  return src.slice(off, off + n);
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const isByteArray = (x: unknown): boolean => x instanceof Int8Array || x instanceof Uint8Array;

// ---------- UTF-8 ----------

/** UTF-8 encode like Java: unpaired surrogates become '?'. */
export function utf8Bytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c >= 0xd800 && c <= 0xdfff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
        out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else out.push(0x3f);
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/** UTF-8 decode with U+FFFD for each maximal malformed subpart (WHATWG / JDK behaviour). */
export function utf8String(b: Uint8Array, start = 0, end = b.length): string {
  let out = '';
  const chunk: number[] = [];
  const flush = () => {
    out += String.fromCharCode.apply(null, chunk);
    chunk.length = 0;
  };
  let i = start;
  while (i < end) {
    const c = b[i];
    if (c < 0x80) {
      chunk.push(c);
      i++;
    } else {
      let need = 0;
      let cp = 0;
      let lo = 0x80;
      let hi = 0xbf;
      if (c >= 0xc2 && c <= 0xdf) {
        need = 1;
        cp = c & 0x1f;
      } else if (c >= 0xe0 && c <= 0xef) {
        need = 2;
        cp = c & 0xf;
        if (c === 0xe0) lo = 0xa0;
        if (c === 0xed) {
          // JDK: an encoded surrogate (ED A0..BF xx) is one malformed sequence of length 3.
          const b2 = i + 1 < end ? b[i + 1] : -1;
          const b3 = i + 2 < end ? b[i + 2] : -1;
          if (b2 >= 0xa0 && b2 <= 0xbf && (b3 & 0xc0) === 0x80) {
            chunk.push(0xfffd);
            i += 3;
            continue;
          }
          hi = 0x9f;
        }
      } else if (c >= 0xf0 && c <= 0xf4) {
        need = 3;
        cp = c & 7;
        if (c === 0xf0) lo = 0x90;
        if (c === 0xf4) hi = 0x8f;
      } else {
        chunk.push(0xfffd);
        i++;
        if (chunk.length > 8192) flush();
        continue;
      }
      let j = i + 1;
      let ok = true;
      for (let k = 0; k < need; k++, j++) {
        const d = j < end ? b[j] : -1;
        if (d < lo || d > hi) {
          ok = false;
          break;
        }
        lo = 0x80;
        hi = 0xbf;
        cp = (cp << 6) | (d & 0x3f);
      }
      if (!ok) {
        chunk.push(0xfffd);
        i = j;
      } else {
        if (cp >= 0x10000) {
          cp -= 0x10000;
          chunk.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        } else chunk.push(cp);
        i = j;
      }
    }
    if (chunk.length > 8192) flush();
  }
  flush();
  return out;
}

// ---------- Charset ----------

const ALIASES: Record<string, string> = {
  UTF8: 'UTF-8',
  'UTF-8': 'UTF-8',
  'ISO-8859-1': 'ISO-8859-1',
  ISO8859_1: 'ISO-8859-1',
  'ISO_8859_1': 'ISO-8859-1',
  'ISO8859-1': 'ISO-8859-1',
  LATIN1: 'ISO-8859-1',
  'L1': 'ISO-8859-1',
  'US-ASCII': 'US-ASCII',
  ASCII: 'US-ASCII',
  'UTF-16': 'UTF-16',
  UTF16: 'UTF-16',
  'UTF-16BE': 'UTF-16BE',
  'UTF-16LE': 'UTF-16LE',
  'UTF-32': 'UTF-32',
  GBK: 'GBK',
  GB2312: 'GB2312',
  GB18030: 'GB18030',
  BIG5: 'Big5',
  SHIFT_JIS: 'Shift_JIS',
  SJIS: 'Shift_JIS',
  'EUC-JP': 'EUC-JP',
  'EUC-KR': 'EUC-KR',
  'WINDOWS-1252': 'windows-1252',
  'WINDOWS-1251': 'windows-1251',
};

export class Charset {
  private constructor(private readonly n: string) {}
  /** Kotlin code calls `charset.name()`; runtime code reads `charset.name`. */
  get name(): string {
    return this.n;
  }
  name$call(): string {
    return this.n;
  }
  displayName(): string {
    return this.n;
  }
  aliases(): Set<string> {
    return new Set();
  }
  canEncode(): boolean {
    return true;
  }
  toString(): string {
    return this.n;
  }
  equals(o: unknown): boolean {
    return o instanceof Charset && o.n === this.n;
  }
  hashCode(): number {
    let h = 0;
    for (let i = 0; i < this.n.length; i++) h = (31 * h + this.n.charCodeAt(i)) | 0;
    return h;
  }
  encode(s: string): any {
    return encodeString(s, this);
  }
  decode(b: any): string {
    return decodeBytes(b, this);
  }

  private static cache = new Map<string, Charset>();
  static forName(name: string): Charset {
    const key = String(name).trim();
    const canonical = ALIASES[key.toUpperCase()] ?? key;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:+-]*$/.test(key)) throw new IllegalArgumentException(`Illegal charset name: ${name}`);
    let c = Charset.cache.get(canonical);
    if (!c) {
      if (!ALIASES[key.toUpperCase()] && !textDecoderSupports(canonical)) throw new UnsupportedCharsetException(name);
      c = new Charset(canonical);
      Charset.cache.set(canonical, c);
    }
    return c;
  }
  static isSupported(name: string): boolean {
    try {
      Charset.forName(name);
      return true;
    } catch {
      return false;
    }
  }
  static defaultCharset(): Charset {
    return Charset.forName('UTF-8');
  }
}

export class UnsupportedCharsetException extends IllegalArgumentException {
  constructor(readonly charsetName: string) {
    super(charsetName);
  }
  getCharsetName(): string {
    return this.charsetName;
  }
}

function textDecoderSupports(name: string): boolean {
  const TD = (globalThis as any).TextDecoder;
  if (!TD) return false;
  try {
    new TD(name.toLowerCase());
    return true;
  } catch {
    return false;
  }
}

/** kotlin.text.Charsets / java.nio.charset.StandardCharsets */
export const Charsets = {
  UTF_8: Charset.forName('UTF-8'),
  ISO_8859_1: Charset.forName('ISO-8859-1'),
  US_ASCII: Charset.forName('US-ASCII'),
  UTF_16: Charset.forName('UTF-16'),
  UTF_16BE: Charset.forName('UTF-16BE'),
  UTF_16LE: Charset.forName('UTF-16LE'),
  UTF_32: Charset.forName('UTF-32'),
};
export const StandardCharsets = Charsets;

/** Accepts a Charset, a charset name, or null/undefined (UTF-8). */
export function toCharset(cs: any): Charset {
  if (cs === null || cs === undefined) return Charsets.UTF_8;
  if (cs instanceof Charset) return cs;
  if (typeof cs === 'string') {
    try {
      return Charset.forName(cs);
    } catch (e) {
      throw new UnsupportedEncodingException(cs);
    }
  }
  if (typeof cs.name === 'string') return Charset.forName(cs.name);
  if (typeof cs.name === 'function') return Charset.forName(cs.name());
  return Charsets.UTF_8;
}

export function encodeString(s: string, cs?: any): Uint8Array {
  const name = toCharset(cs).name;
  switch (name) {
    case 'UTF-8':
      return utf8Bytes(s);
    case 'ISO-8859-1':
    case 'US-ASCII': {
      const max = name === 'US-ASCII' ? 0x7f : 0xff;
      const out = new Uint8Array(s.length);
      let o = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        // A surrogate pair is one unmappable character -> a single '?'
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) i++;
        out[o++] = c <= max ? c : 0x3f;
      }
      return out.slice(0, o);
    }
    case 'UTF-16':
    case 'UTF-16BE':
    case 'UTF-16LE': {
      const le = name === 'UTF-16LE';
      const bom = name === 'UTF-16' ? 2 : 0;
      const out = new Uint8Array(bom + s.length * 2);
      if (bom) {
        out[0] = 0xfe;
        out[1] = 0xff;
      }
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        out[bom + i * 2] = le ? c & 0xff : c >> 8;
        out[bom + i * 2 + 1] = le ? c >> 8 : c & 0xff;
      }
      return out;
    }
    default:
      // TextEncoder only does UTF-8; other legacy encoders are not available in pure JS.
      return utf8Bytes(s);
  }
}

export function decodeBytes(bytes: any, cs?: any, off = 0, len?: number): string {
  const b = u8(bytes);
  const end = len === undefined ? b.length : off + len;
  if (off < 0 || end > b.length || end < off) throw new IndexOutOfBoundsException(`offset ${off}, length ${len}, size ${b.length}`);
  const name = toCharset(cs).name;
  switch (name) {
    case 'UTF-8':
      return utf8String(b, off, end);
    case 'ISO-8859-1':
    case 'US-ASCII': {
      let out = '';
      for (let i = off; i < end; i += 8192) {
        const part = Array.from(b.subarray(i, Math.min(end, i + 8192)), (x) => (name === 'US-ASCII' && x > 0x7f ? 0xfffd : x));
        out += String.fromCharCode.apply(null, part);
      }
      return out;
    }
    case 'UTF-16':
    case 'UTF-16BE':
    case 'UTF-16LE': {
      let le = name === 'UTF-16LE';
      let i = off;
      if (name === 'UTF-16' && end - i >= 2) {
        if (b[i] === 0xfe && b[i + 1] === 0xff) i += 2;
        else if (b[i] === 0xff && b[i + 1] === 0xfe) {
          le = true;
          i += 2;
        }
      }
      let out = '';
      for (; i + 1 < end; i += 2) out += String.fromCharCode(le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
      if (i < end) out += '�';
      return out;
    }
    default: {
      const TD = (globalThis as any).TextDecoder;
      if (TD) {
        try {
          return new TD(name.toLowerCase()).decode(b.subarray(off, end));
        } catch {
          /* fall through */
        }
      }
      return utf8String(b, off, end);
    }
  }
}

/**
 * Kotlin `String(bytes)`, `String(bytes, charset)`, `String(bytes, offset, length[, charset])`,
 * `String(chars)` and `String(chars, offset, length)`.
 */
export function StringFromBytes(data: any, a?: any, b?: any, c?: any): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) {
    const chars = data.map((x) => (typeof x === 'number' ? String.fromCharCode(x) : String(x)));
    return typeof a === 'number' ? chars.slice(a, a + (b ?? chars.length - a)).join('') : chars.join('');
  }
  if (typeof a === 'number') return decodeBytes(data, c, a, b);
  return decodeBytes(data, a);
}

// ---------- hex ----------

const HEX = '0123456789abcdef';

export function toHex(bytes: any, upper = false): string {
  const b = u8(bytes);
  let out = '';
  for (let i = 0; i < b.length; i++) out += HEX[b[i] >> 4] + HEX[b[i] & 15];
  return upper ? out.toUpperCase() : out;
}

export function fromHex(s: string): Int8Array {
  if (s.length % 2 !== 0) throw new IllegalArgumentException(`Expected an even number of hex digits: ${s}`);
  const out = new Int8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = hexDigit(s, i * 2);
    const lo = hexDigit(s, i * 2 + 1);
    out[i] = (hi << 4) | lo;
  }
  return out;
}

function hexDigit(s: string, i: number): number {
  const c = s.charCodeAt(i);
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  throw new IllegalArgumentException(`Expected a hexadecimal digit at index ${i}, but was ${s[i]}`);
}

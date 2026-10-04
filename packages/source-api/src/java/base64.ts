// android.util.Base64 and java.util.Base64.

import { IllegalArgumentException } from '../kotlin/core';
import { encodeString, i8, u8, u8copy } from './charset';

const STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function table(alpha: string): Int16Array {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < 64; i++) t[alpha.charCodeAt(i)] = i;
  t[61] = -2; // '='
  return t;
}
const DEC_STD = table(STD);
const DEC_URL = table(URL);

/** Plain base64 of bytes, optional padding. */
function encodeRaw(b: Uint8Array, alpha: string, pad: boolean): string {
  let out = '';
  const n = b.length - (b.length % 3);
  for (let i = 0; i < n; i += 3) {
    const v = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out += alpha[v >> 18] + alpha[(v >> 12) & 63] + alpha[(v >> 6) & 63] + alpha[v & 63];
  }
  const r = b.length - n;
  if (r === 1) {
    const v = b[n] << 16;
    out += alpha[v >> 18] + alpha[(v >> 12) & 63] + (pad ? '==' : '');
  } else if (r === 2) {
    const v = (b[n] << 16) | (b[n + 1] << 8);
    out += alpha[v >> 18] + alpha[(v >> 12) & 63] + alpha[(v >> 6) & 63] + (pad ? '=' : '');
  }
  return out;
}

function wrapLines(s: string, width: number, nl: string, trailing: boolean): string {
  if (s.length === 0) return s;
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += width) lines.push(s.slice(i, i + width));
  return lines.join(nl) + (trailing ? nl : '');
}

function inputBytes(input: any): Uint8Array {
  if (typeof input === 'string') {
    // Base64 text is ASCII; Java/Android take the low byte of each char.
    const out = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input.charCodeAt(i) & 0xff;
    return out;
  }
  return u8(input);
}

function asciiBytes(s: string): Int8Array {
  return i8(encodeString(s, 'US-ASCII'));
}

// ---------- android.util.Base64 ----------

export class AndroidBase64 {
  static readonly DEFAULT = 0;
  static readonly NO_PADDING = 1;
  static readonly NO_WRAP = 2;
  static readonly CRLF = 4;
  static readonly URL_SAFE = 8;
  static readonly NO_CLOSE = 16;

  /** encodeToString(input, flags) or encodeToString(input, offset, len, flags) */
  static encodeToString(input: any, a: number, b?: number, c?: number): string {
    const [bytes, flags] = b === undefined ? [u8(input), a] : [u8copy(input, a, b), c ?? 0];
    let s = encodeRaw(bytes, flags & AndroidBase64.URL_SAFE ? URL : STD, !(flags & AndroidBase64.NO_PADDING));
    if (!(flags & AndroidBase64.NO_WRAP)) s = wrapLines(s, 76, flags & AndroidBase64.CRLF ? '\r\n' : '\n', true);
    return s;
  }

  /** encode(input, flags) or encode(input, offset, len, flags) -> ByteArray */
  static encode(input: any, a: number, b?: number, c?: number): Int8Array {
    return asciiBytes(AndroidBase64.encodeToString(input, a, b, c));
  }

  /** decode(String|ByteArray, flags) or decode(ByteArray, offset, len, flags). Skips non-alphabet chars like Android. */
  static decode(input: any, a: number, b?: number, c?: number): Int8Array {
    let bytes = inputBytes(input);
    let flags = a;
    if (b !== undefined) {
      bytes = bytes.subarray(a, a + b);
      flags = c ?? 0;
    }
    const t = flags & AndroidBase64.URL_SAFE ? DEC_URL : DEC_STD;
    const out = new Uint8Array(Math.floor((bytes.length * 3) / 4) + 3);
    let o = 0;
    let state = 0;
    let acc = 0;
    const bad = () => new IllegalArgumentException('bad base-64');
    for (let i = 0; i < bytes.length; i++) {
      const d = t[bytes[i]];
      if (state <= 3) {
        if (d >= 0) {
          acc = (acc << 6) | d;
          if (++state === 4) {
            out[o++] = (acc >> 16) & 0xff;
            out[o++] = (acc >> 8) & 0xff;
            out[o++] = acc & 0xff;
            state = 0;
            acc = 0;
          }
        } else if (d === -2) {
          if (state === 2) {
            out[o++] = (acc >> 4) & 0xff;
            state = 4;
          } else if (state === 3) {
            out[o++] = (acc >> 10) & 0xff;
            out[o++] = (acc >> 2) & 0xff;
            state = 5;
          } else throw bad();
        }
      } else if (state === 4) {
        if (d === -2) state = 5;
        else if (d !== -1) throw bad();
      } else if (d !== -1) throw bad();
    }
    switch (state) {
      case 1:
      case 4:
        throw bad();
      case 2:
        out[o++] = (acc >> 4) & 0xff;
        break;
      case 3:
        out[o++] = (acc >> 10) & 0xff;
        out[o++] = (acc >> 2) & 0xff;
        break;
    }
    return i8(out.slice(0, o));
  }
}

// ---------- java.util.Base64 ----------

export class Base64Encoder {
  constructor(
    private readonly url: boolean,
    private readonly lineLength: number,
    private readonly pad: boolean,
  ) {}
  private enc(input: any): string {
    const s = encodeRaw(u8(input), this.url ? URL : STD, this.pad);
    return this.lineLength > 0 ? wrapLines(s, this.lineLength, '\r\n', false) : s;
  }
  encodeToString(input: any): string {
    return this.enc(input);
  }
  encode(input: any, dst?: any): any {
    const out = asciiBytes(this.enc(input));
    if (dst !== undefined) {
      u8(dst).set(u8(out));
      return out.length;
    }
    return out;
  }
  withoutPadding(): Base64Encoder {
    return new Base64Encoder(this.url, this.lineLength, false);
  }
}

export class Base64Decoder {
  constructor(
    private readonly url: boolean,
    private readonly mime: boolean,
  ) {}
  decode(input: any, dst?: any): any {
    const bytes = inputBytes(input);
    const t = this.url ? DEC_URL : DEC_STD;
    const out = new Uint8Array(Math.floor((bytes.length * 3) / 4) + 3);
    let o = 0;
    let acc = 0;
    let n = 0;
    let i = 0;
    while (i < bytes.length) {
      const d = t[bytes[i++]];
      if (d < 0) {
        if (d === -2) {
          if ((n === 2 && (i === bytes.length || bytes[i++] !== 61)) || n === 0) {
            throw new IllegalArgumentException('Input byte array has wrong 4-byte ending unit');
          }
          break;
        }
        if (this.mime) continue;
        throw new IllegalArgumentException(`Illegal base64 character ${bytes[i - 1].toString(16)}`);
      }
      acc = (acc << 6) | d;
      if (++n === 4) {
        out[o++] = (acc >> 16) & 0xff;
        out[o++] = (acc >> 8) & 0xff;
        out[o++] = acc & 0xff;
        n = 0;
        acc = 0;
      }
    }
    if (n === 1) throw new IllegalArgumentException('Last unit does not have enough valid bits');
    while (i < bytes.length) {
      if (this.mime && t[bytes[i++]] < 0) continue;
      throw new IllegalArgumentException('Input byte array has incorrect ending byte at ' + i);
    }
    if (n === 2) out[o++] = (acc >> 4) & 0xff;
    else if (n === 3) {
      out[o++] = (acc >> 10) & 0xff;
      out[o++] = (acc >> 2) & 0xff;
    }
    const res = i8(out.slice(0, o));
    if (dst !== undefined) {
      u8(dst).set(u8(res));
      return res.length;
    }
    return res;
  }
}

const BASIC_ENC = new Base64Encoder(false, 0, true);
const URL_ENC = new Base64Encoder(true, 0, true);
const MIME_ENC = new Base64Encoder(false, 76, true);
const BASIC_DEC = new Base64Decoder(false, false);
const URL_DEC = new Base64Decoder(true, false);
const MIME_DEC = new Base64Decoder(false, true);

export class JavaBase64 {
  static Encoder = Base64Encoder;
  static Decoder = Base64Decoder;
  static getEncoder(): Base64Encoder {
    return BASIC_ENC;
  }
  static getUrlEncoder(): Base64Encoder {
    return URL_ENC;
  }
  static getMimeEncoder(lineLength?: number): Base64Encoder {
    return lineLength === undefined ? MIME_ENC : new Base64Encoder(false, Math.floor(lineLength / 4) * 4, true);
  }
  static getDecoder(): Base64Decoder {
    return BASIC_DEC;
  }
  static getUrlDecoder(): Base64Decoder {
    return URL_DEC;
  }
  static getMimeDecoder(): Base64Decoder {
    return MIME_DEC;
  }
}

/** kotlin.io.encoding.Base64 (Default / UrlSafe / Mime). */
class KotlinBase64 {
  constructor(
    private readonly url: boolean,
    private readonly mime: boolean,
  ) {}
  encode(source: any, start = 0, end?: number): string {
    const b = u8(source).subarray(start, end);
    const s = encodeRaw(b, this.url ? URL : STD, true);
    return this.mime ? wrapLines(s, 76, '\r\n', false) : s;
  }
  encodeToByteArray(source: any, start = 0, end?: number): Int8Array {
    return asciiBytes(this.encode(source, start, end));
  }
  decode(source: any, start = 0, end?: number): Int8Array {
    const b = inputBytes(source).subarray(start, end);
    return new Base64Decoder(this.url, this.mime).decode(b);
  }
}
export const KBase64 = Object.assign(new KotlinBase64(false, false), {
  Default: new KotlinBase64(false, false),
  UrlSafe: new KotlinBase64(true, false),
  Mime: new KotlinBase64(false, true),
});

// java.security.MessageDigest, javax.crypto.{Mac, Cipher, SecretKeyFactory}, key/parameter specs,
// java.security.SecureRandom. Pure JS on top of @noble/hashes and @noble/ciphers.

import { gcm, unsafe as aes } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha224, sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { GeneralSecurityException, IllegalArgumentException, IllegalStateException, IndexOutOfBoundsException } from '../kotlin/core';
import { concatBytes, i8, u8, u8copy, utf8Bytes } from './charset';

// ---------- exceptions ----------

export class NoSuchAlgorithmException extends GeneralSecurityException {}
export class NoSuchPaddingException extends GeneralSecurityException {}
export class InvalidKeyException extends GeneralSecurityException {}
export class InvalidAlgorithmParameterException extends GeneralSecurityException {}
export class InvalidKeySpecException extends GeneralSecurityException {}
export class IllegalBlockSizeException extends GeneralSecurityException {}
export class BadPaddingException extends GeneralSecurityException {}
export class AEADBadTagException extends BadPaddingException {}
export class ShortBufferException extends GeneralSecurityException {}

// ---------- hashes ----------

type HashFn = any;

const DIGESTS: Record<string, [string, HashFn]> = {
  MD5: ['MD5', md5],
  SHA: ['SHA-1', sha1],
  SHA1: ['SHA-1', sha1],
  'SHA-1': ['SHA-1', sha1],
  'SHA-224': ['SHA-224', sha224],
  SHA224: ['SHA-224', sha224],
  'SHA-256': ['SHA-256', sha256],
  SHA256: ['SHA-256', sha256],
  'SHA-384': ['SHA-384', sha384],
  SHA384: ['SHA-384', sha384],
  'SHA-512': ['SHA-512', sha512],
  SHA512: ['SHA-512', sha512],
};

function byteArg(input: any): Uint8Array {
  if (typeof input === 'number') return Uint8Array.of(input & 0xff);
  return u8(input);
}

/** `(bytes)`, `(bytes, offset, len)` or `(byte)` as unsigned bytes. */
function rangeArg(input: any, off?: number, len?: number): Uint8Array {
  if (typeof input === 'number') return Uint8Array.of(input & 0xff);
  const b = u8(input);
  if (off === undefined) return b;
  const n = len ?? b.length - off;
  if (off < 0 || n < 0 || off + n > b.length) throw new IndexOutOfBoundsException(`offset ${off}, len ${n}, size ${b.length}`);
  return b.subarray(off, off + n);
}

export class MessageDigest {
  private h: any;
  private constructor(
    private readonly alg: string,
    private readonly fn: HashFn,
  ) {
    this.h = fn.create();
  }
  static getInstance(algorithm: string, _provider?: any): MessageDigest {
    const d = DIGESTS[String(algorithm).toUpperCase()];
    if (!d) throw new NoSuchAlgorithmException(`${algorithm} MessageDigest not available`);
    return new MessageDigest(d[0], d[1]);
  }
  static isEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    const x = u8(a);
    const y = u8(b);
    if (x.length !== y.length) return false;
    let r = 0;
    for (let i = 0; i < x.length; i++) r |= x[i] ^ y[i];
    return r === 0;
  }
  get algorithm(): string {
    return this.alg;
  }
  getAlgorithm(): string {
    return this.alg;
  }
  get digestLength(): number {
    return this.fn.outputLen;
  }
  getDigestLength(): number {
    return this.fn.outputLen;
  }
  update(input: any, off?: number, len?: number): void {
    this.h.update(rangeArg(input, off, len));
  }
  /** digest(), digest(input) or digest(buf, offset, len) -> written length */
  digest(input?: any, off?: number, len?: number): any {
    if (input !== undefined && off !== undefined) {
      const out = this.h.digest() as Uint8Array;
      this.reset();
      const dst = u8(input);
      if ((len ?? 0) < out.length) throw new DigestException('partial digests not returned');
      if (off + out.length > dst.length) throw new DigestException('insufficient space in the output buffer to store the digest');
      dst.set(out, off);
      return out.length;
    }
    if (input !== undefined && input !== null) this.h.update(byteArg(input));
    const out = this.h.digest() as Uint8Array;
    this.reset();
    return i8(out);
  }
  reset(): void {
    this.h = this.fn.create();
  }
  clone(): MessageDigest {
    const c = new MessageDigest(this.alg, this.fn);
    c.h = this.h.clone();
    return c;
  }
  toString(): string {
    return `${this.alg} Message Digest from Kanso`;
  }
}
export class DigestException extends GeneralSecurityException {}

// ---------- keys and specs ----------

export class SecretKeySpec {
  static $params = ['key', 'algorithm'];
  private readonly k: Uint8Array;
  private readonly alg: string;
  /** SecretKeySpec(key, algorithm) or SecretKeySpec(key, offset, len, algorithm) */
  constructor(key: any, a: any, b?: any, c?: any) {
    if (key === null || key === undefined) throw new IllegalArgumentException('Missing argument');
    if (typeof a === 'number') {
      this.k = u8copy(key, a, b);
      this.alg = String(c);
    } else {
      this.k = u8copy(key);
      this.alg = String(a);
    }
    if (this.k.length === 0) throw new IllegalArgumentException('Empty key');
  }
  get encoded(): Int8Array {
    return i8(this.k.slice());
  }
  getEncoded(): Int8Array {
    return this.encoded;
  }
  get algorithm(): string {
    return this.alg;
  }
  getAlgorithm(): string {
    return this.alg;
  }
  get format(): string {
    return 'RAW';
  }
  getFormat(): string {
    return 'RAW';
  }
  /** Raw key bytes for runtime use. */
  get $raw(): Uint8Array {
    return this.k;
  }
}

export class IvParameterSpec {
  private readonly v: Uint8Array;
  constructor(iv: any, off?: number, len?: number) {
    if (iv === null || iv === undefined) throw new IllegalArgumentException('IV missing');
    this.v = u8copy(iv, off ?? 0, len);
  }
  get iv(): Int8Array {
    return i8(this.v.slice());
  }
  getIV(): Int8Array {
    return this.iv;
  }
  get $raw(): Uint8Array {
    return this.v;
  }
}

export class GCMParameterSpec {
  private readonly v: Uint8Array;
  /** GCMParameterSpec(tLen bits, iv) or GCMParameterSpec(tLen, iv, offset, len) */
  constructor(
    private readonly tagBits: number,
    iv: any,
    off?: number,
    len?: number,
  ) {
    if (tagBits < 0) throw new IllegalArgumentException('Length argument is negative');
    this.v = u8copy(iv, off ?? 0, len);
  }
  get tLen(): number {
    return this.tagBits;
  }
  getTLen(): number {
    return this.tagBits;
  }
  get iv(): Int8Array {
    return i8(this.v.slice());
  }
  getIV(): Int8Array {
    return this.iv;
  }
  get $raw(): Uint8Array {
    return this.v;
  }
}

export class PBEKeySpec {
  private readonly pw: string;
  readonly saltBytes: Uint8Array | null;
  constructor(
    password: any,
    salt?: any,
    readonly iterationCount = 0,
    readonly keyLength = 0,
  ) {
    this.pw = password == null ? '' : typeof password === 'string' ? password : Array.from(password as ArrayLike<any>, (c) => (typeof c === 'number' ? String.fromCharCode(c) : String(c))).join('');
    this.saltBytes = salt == null ? null : u8copy(salt);
  }
  getPassword(): string[] {
    return [...this.pw];
  }
  get password(): string[] {
    return this.getPassword();
  }
  getSalt(): Int8Array | null {
    return this.saltBytes ? i8(this.saltBytes.slice()) : null;
  }
  get salt(): Int8Array | null {
    return this.getSalt();
  }
  getIterationCount(): number {
    return this.iterationCount;
  }
  getKeyLength(): number {
    return this.keyLength;
  }
  clearPassword(): void {}
  get $password(): string {
    return this.pw;
  }
}

/** Raw bytes of a key-like argument: SecretKeySpec, any `getEncoded()` key, or a byte array. */
function keyBytes(key: any): Uint8Array {
  if (key === null || key === undefined) throw new InvalidKeyException('No key given');
  if (key instanceof SecretKeySpec) return key.$raw;
  if (ArrayBuffer.isView(key)) return u8(key);
  if (typeof key.getEncoded === 'function') return u8(key.getEncoded());
  if (key.encoded) return u8(key.encoded);
  throw new InvalidKeyException('Unsupported key type');
}

export class SecretKeyFactory {
  private constructor(
    private readonly alg: string,
    private readonly hash: HashFn,
  ) {}
  static getInstance(algorithm: string, _provider?: any): SecretKeyFactory {
    const m = /^PBKDF2WithHmac(SHA1|SHA224|SHA256|SHA384|SHA512)$/i.exec(String(algorithm));
    if (!m) throw new NoSuchAlgorithmException(`${algorithm} SecretKeyFactory not available`);
    const name = m[1].toUpperCase();
    return new SecretKeyFactory(`PBKDF2WithHmac${name}`, DIGESTS[name][1]);
  }
  get algorithm(): string {
    return this.alg;
  }
  getAlgorithm(): string {
    return this.alg;
  }
  generateSecret(spec: any): SecretKeySpec {
    if (!(spec instanceof PBEKeySpec)) throw new InvalidKeySpecException('Invalid key spec');
    if (!spec.saltBytes) throw new InvalidKeySpecException('Salt not found');
    if (spec.keyLength <= 0) throw new InvalidKeySpecException('Key length not found');
    if (spec.iterationCount <= 0) throw new InvalidKeySpecException('Iteration count not found');
    const dk = pbkdf2(this.hash, utf8Bytes(spec.$password), spec.saltBytes, { c: spec.iterationCount, dkLen: Math.ceil(spec.keyLength / 8) });
    return new SecretKeySpec(dk, this.alg);
  }
}

// ---------- Mac ----------

const MACS: Record<string, [string, HashFn]> = {
  HMACMD5: ['HmacMD5', md5],
  HMACSHA1: ['HmacSHA1', sha1],
  HMACSHA224: ['HmacSHA224', sha224],
  HMACSHA256: ['HmacSHA256', sha256],
  HMACSHA384: ['HmacSHA384', sha384],
  HMACSHA512: ['HmacSHA512', sha512],
};

export class Mac {
  private h: any = null;
  private key: Uint8Array | null = null;
  private constructor(
    private readonly alg: string,
    private readonly fn: HashFn,
  ) {}
  static getInstance(algorithm: string, _provider?: any): Mac {
    const m = MACS[String(algorithm).toUpperCase().replace(/-/g, '')];
    if (!m) throw new NoSuchAlgorithmException(`Algorithm ${algorithm} not available`);
    return new Mac(m[0], m[1]);
  }
  get algorithm(): string {
    return this.alg;
  }
  getAlgorithm(): string {
    return this.alg;
  }
  get macLength(): number {
    return this.fn.outputLen;
  }
  getMacLength(): number {
    return this.fn.outputLen;
  }
  init(key: any, _params?: any): void {
    this.key = keyBytes(key).slice();
    this.h = hmac.create(this.fn, this.key);
  }
  private st(): any {
    if (!this.h) throw new IllegalStateException('MAC not initialized');
    return this.h;
  }
  update(input: any, off?: number, len?: number): void {
    this.st().update(rangeArg(input, off, len));
  }
  /** doFinal(), doFinal(input) or doFinal(output, outOffset) */
  doFinal(input?: any, outOff?: number): any {
    if (input !== undefined && outOff !== undefined) {
      const out = this.st().digest() as Uint8Array;
      this.reset();
      u8(input).set(out, outOff);
      return undefined;
    }
    if (input !== undefined && input !== null) this.st().update(byteArg(input));
    const out = this.st().digest() as Uint8Array;
    this.reset();
    return i8(out);
  }
  reset(): void {
    if (this.key) this.h = hmac.create(this.fn, this.key);
  }
}

// ---------- SecureRandom ----------

export function randomFill(b: Uint8Array): Uint8Array {
  const c = (globalThis as any).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    for (let i = 0; i < b.length; i += 65536) c.getRandomValues(b.subarray(i, Math.min(b.length, i + 65536)));
  } else {
    for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  }
  return b;
}

export class SecureRandom {
  constructor(_seed?: any) {}
  static getInstance(_alg?: string, _provider?: any): SecureRandom {
    return new SecureRandom();
  }
  static getInstanceStrong(): SecureRandom {
    return new SecureRandom();
  }
  static getSeed(n: number): Int8Array {
    return i8(randomFill(new Uint8Array(n)));
  }
  setSeed(_seed: any): void {}
  nextBytes(b: any): void {
    randomFill(u8(b));
  }
  generateSeed(n: number): Int8Array {
    return SecureRandom.getSeed(n);
  }
  private int32(): number {
    const b = randomFill(new Uint8Array(4));
    return (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  }
  nextInt(a?: number, b?: number): number {
    if (a === undefined) return this.int32();
    const [lo, hi] = b === undefined ? [0, a] : [a, b];
    if (hi <= lo) throw new IllegalArgumentException('bound must be greater than origin');
    const n = hi - lo;
    let r: number;
    do r = this.int32() >>> 0;
    while (r >= 4294967296 - (4294967296 % n));
    return lo + (r % n);
  }
  nextLong(): number {
    return this.int32() * 4294967296 + (this.int32() >>> 0);
  }
  nextDouble(): number {
    const b = randomFill(new Uint8Array(7));
    let v = 0;
    for (let i = 0; i < 7; i++) v = v * 256 + b[i];
    return Math.floor(v / 8) / 9007199254740992;
  }
  nextFloat(): number {
    return (this.int32() >>> 8) / 16777216;
  }
  nextBoolean(): boolean {
    return (this.int32() & 1) !== 0;
  }
}

// ---------- AES block primitive ----------

class AesKey {
  readonly enc: Uint32Array;
  private decK: Uint32Array | null = null;
  constructor(readonly raw: Uint8Array) {
    if (raw.length !== 16 && raw.length !== 24 && raw.length !== 32) throw new InvalidKeyException(`Invalid AES key length: ${raw.length} bytes`);
    this.enc = aes.expandKeyLE(raw.slice());
  }
  get dec(): Uint32Array {
    return (this.decK ??= aes.expandKeyDecLE(this.raw.slice()));
  }
  /** Encrypt/decrypt the 16-byte block at src[si] into dst[di]. */
  block(decrypt: boolean, src: Uint8Array, si: number, dst: Uint8Array, di: number): void {
    const w = (o: number) => src[o] | (src[o + 1] << 8) | (src[o + 2] << 16) | (src[o + 3] << 24);
    const r = (decrypt ? aes.decrypt : aes.encrypt)(decrypt ? this.dec : this.enc, w(si), w(si + 4), w(si + 8), w(si + 12));
    const put = (o: number, v: number) => {
      dst[o] = v & 0xff;
      dst[o + 1] = (v >>> 8) & 0xff;
      dst[o + 2] = (v >>> 16) & 0xff;
      dst[o + 3] = (v >>> 24) & 0xff;
    };
    put(di, r.s0);
    put(di + 4, r.s1);
    put(di + 8, r.s2);
    put(di + 12, r.s3);
  }
}

// ---------- Cipher ----------

type Mode = 'ECB' | 'CBC' | 'CTR' | 'GCM';
type Padding = 'NONE' | 'PKCS5' | 'ZERO';

const PADDINGS: Record<string, Padding> = {
  NOPADDING: 'NONE',
  PKCS5PADDING: 'PKCS5',
  PKCS7PADDING: 'PKCS5',
  ZEROBYTEPADDING: 'ZERO',
};

export class Cipher {
  static readonly ENCRYPT_MODE = 1;
  static readonly DECRYPT_MODE = 2;
  static readonly WRAP_MODE = 3;
  static readonly UNWRAP_MODE = 4;
  static readonly PUBLIC_KEY = 1;
  static readonly PRIVATE_KEY = 2;
  static readonly SECRET_KEY = 3;

  private key: AesKey | null = null;
  private op = 0;
  private ivBytes: Uint8Array | null = null;
  private tagLen = 16;
  // running state
  private pending = new Uint8Array(0);
  private chain = new Uint8Array(16);
  private ctr = new Uint8Array(16);
  private ks = new Uint8Array(16);
  private ksPos = 16;
  private aad: Uint8Array[] = [];
  private gcmData: Uint8Array[] = [];

  private constructor(
    private readonly transformation: string,
    private readonly mode: Mode,
    private readonly padding: Padding,
  ) {}

  static getInstance(transformation: string, _provider?: any): Cipher {
    const parts = String(transformation).split('/').map((p) => p.trim());
    const alg = parts[0].toUpperCase();
    if (alg !== 'AES' && !/^AES_?(128|192|256)$/.test(alg)) throw new NoSuchAlgorithmException(`Cannot find any provider supporting ${transformation}`);
    const modeName = (parts[1] ?? 'ECB').toUpperCase();
    if (!['ECB', 'CBC', 'CTR', 'GCM'].includes(modeName)) throw new NoSuchAlgorithmException(`Cannot find any provider supporting ${transformation}`);
    const mode = modeName as Mode;
    const padName = (parts[2] ?? (mode === 'CTR' || mode === 'GCM' ? 'NoPadding' : 'PKCS5Padding')).toUpperCase();
    const padding = PADDINGS[padName];
    if (!padding) throw new NoSuchPaddingException(`Unsupported padding ${parts[2]}`);
    if ((mode === 'CTR' || mode === 'GCM') && padding !== 'NONE') throw new NoSuchPaddingException(`${mode} mode must be used with NoPadding`);
    return new Cipher(String(transformation), mode, padding);
  }

  get algorithm(): string {
    return this.transformation;
  }
  getAlgorithm(): string {
    return this.transformation;
  }
  get blockSize(): number {
    return 16;
  }
  getBlockSize(): number {
    return 16;
  }
  get iv(): Int8Array | null {
    return this.ivBytes ? i8(this.ivBytes.slice()) : null;
  }
  getIV(): Int8Array | null {
    return this.iv;
  }
  getOutputSize(inputLen: number): number {
    const total = this.pending.length + inputLen;
    if (this.mode === 'GCM') return this.op === Cipher.ENCRYPT_MODE ? total + this.tagLen : Math.max(0, total - this.tagLen);
    if (this.mode === 'CTR' || this.op === Cipher.DECRYPT_MODE) return total;
    return this.padding === 'PKCS5' ? (Math.floor(total / 16) + 1) * 16 : Math.ceil(total / 16) * 16;
  }

  /** init(opmode, key), init(opmode, key, params), init(opmode, key, random), init(opmode, key, params, random) */
  init(opmode: number, key: any, params?: any, _random?: any): void {
    if (opmode !== Cipher.ENCRYPT_MODE && opmode !== Cipher.DECRYPT_MODE && opmode !== Cipher.WRAP_MODE && opmode !== Cipher.UNWRAP_MODE) {
      throw new InvalidParameterException('Invalid operation mode');
    }
    this.op = opmode === Cipher.WRAP_MODE ? Cipher.ENCRYPT_MODE : opmode === Cipher.UNWRAP_MODE ? Cipher.DECRYPT_MODE : opmode;
    this.key = new AesKey(keyBytes(key).slice());
    let iv: Uint8Array | null = null;
    this.tagLen = 16;
    if (params instanceof IvParameterSpec) iv = params.$raw.slice();
    else if (params instanceof GCMParameterSpec) {
      iv = params.$raw.slice();
      const t = params.tLen;
      if (t % 8 !== 0 || t < 96 || t > 128) throw new InvalidAlgorithmParameterException(`Unsupported TLen value.  Must be one of {128, 120, 112, 104, 96}`);
      this.tagLen = t / 8;
    } else if (params && !(params instanceof SecureRandom) && typeof params.getIV === 'function') iv = u8copy(params.getIV());
    if (this.mode === 'ECB') {
      if (iv) throw new InvalidAlgorithmParameterException('ECB mode cannot use IV');
    } else if (!iv) {
      if (this.op === Cipher.DECRYPT_MODE) throw new InvalidKeyException('Parameters missing');
      iv = randomFill(new Uint8Array(this.mode === 'GCM' ? 12 : 16));
    }
    if (iv && this.mode !== 'GCM' && iv.length !== 16) throw new InvalidAlgorithmParameterException('Wrong IV length: must be 16 bytes long');
    if (iv && this.mode === 'GCM' && iv.length === 0) throw new InvalidAlgorithmParameterException('IV is empty');
    this.ivBytes = iv;
    this.resetState();
  }

  private resetState(): void {
    this.pending = new Uint8Array(0);
    if (this.ivBytes && this.mode !== 'GCM') {
      this.chain = this.ivBytes.slice();
      this.ctr = this.ivBytes.slice();
    }
    this.ksPos = 16;
    this.aad = [];
    this.gcmData = [];
  }

  private requireInit(): AesKey {
    if (!this.key) throw new IllegalStateException('Cipher not initialized');
    return this.key;
  }

  updateAAD(src: any, off?: number, len?: number): void {
    this.requireInit();
    if (this.mode !== 'GCM') throw new IllegalStateException('AAD is only supported in GCM mode');
    this.aad.push(rangeArg(src, off, len).slice());
  }

  /** update(input) or update(input, offset, len) -> output bytes (possibly empty) */
  update(input: any, off?: number, len?: number): Int8Array {
    this.requireInit();
    const data = rangeArg(input, off, len);
    return i8(this.process(data, false));
  }

  /** doFinal(), doFinal(input), doFinal(input, offset, len) */
  doFinal(input?: any, off?: number, len?: number): Int8Array {
    this.requireInit();
    const data = input === undefined || input === null ? new Uint8Array(0) : rangeArg(input, off, len);
    try {
      return i8(this.process(data, true));
    } finally {
      this.resetState();
    }
  }

  wrap(key: any): Int8Array {
    return this.doFinal(keyBytes(key));
  }
  unwrap(wrapped: any, algorithm: string, _type: number): SecretKeySpec {
    return new SecretKeySpec(this.doFinal(wrapped), algorithm);
  }

  private process(data: Uint8Array, final: boolean): Uint8Array {
    const key = this.key!;
    const dec = this.op === Cipher.DECRYPT_MODE;
    if (this.mode === 'GCM') {
      this.gcmData.push(data.slice());
      return final ? this.gcmFinal(key, dec) : new Uint8Array(0);
    }
    if (this.mode === 'CTR') return this.ctrXor(key, data);

    let buf = this.pending.length ? concatBytes([this.pending, data]) : data;
    if (final) {
      if (!dec) {
        const r = buf.length % 16;
        if (this.padding === 'PKCS5') {
          const p = new Uint8Array(buf.length + 16 - r);
          p.set(buf);
          p.fill(16 - r, buf.length);
          buf = p;
        } else if (this.padding === 'ZERO') {
          if (r) {
            const p = new Uint8Array(buf.length + 16 - r);
            p.set(buf);
            buf = p;
          }
        } else if (r) throw new IllegalBlockSizeException('Input length not multiple of 16 bytes');
      } else if (buf.length % 16) {
        throw new IllegalBlockSizeException(
          this.padding === 'PKCS5' ? 'Input length must be multiple of 16 when decrypting with padded cipher' : 'Input length not multiple of 16 bytes',
        );
      }
      this.pending = new Uint8Array(0);
      let out = this.blocks(key, dec, buf, buf.length);
      if (dec && this.padding === 'PKCS5') {
        const n = out.length ? out[out.length - 1] : 0;
        let ok = n >= 1 && n <= 16 && n <= out.length;
        for (let i = out.length - n; ok && i < out.length; i++) if (out[i] !== n) ok = false;
        if (!ok) throw new BadPaddingException('Given final block not properly padded. Such issues can arise if a bad key is used during decryption.');
        out = out.subarray(0, out.length - n);
      } else if (dec && this.padding === 'ZERO') {
        let e = out.length;
        while (e > 0 && out[e - 1] === 0) e--;
        out = out.subarray(0, e);
      }
      return out;
    }
    let n = buf.length - (buf.length % 16);
    // A padded decrypt keeps the last full block back until doFinal, like the JDK.
    if (dec && this.padding !== 'NONE' && n === buf.length && n > 0) n -= 16;
    this.pending = buf.slice(n);
    return this.blocks(key, dec, buf, n);
  }

  /** ECB/CBC over the first n bytes (multiple of 16) of buf. */
  private blocks(key: AesKey, dec: boolean, buf: Uint8Array, n: number): Uint8Array {
    const out = new Uint8Array(n);
    const cbc = this.mode === 'CBC';
    const tmp = new Uint8Array(16);
    for (let i = 0; i < n; i += 16) {
      if (!cbc) key.block(dec, buf, i, out, i);
      else if (dec) {
        key.block(true, buf, i, out, i);
        for (let j = 0; j < 16; j++) out[i + j] ^= this.chain[j];
        this.chain.set(buf.subarray(i, i + 16));
      } else {
        for (let j = 0; j < 16; j++) tmp[j] = buf[i + j] ^ this.chain[j];
        key.block(false, tmp, 0, out, i);
        this.chain.set(out.subarray(i, i + 16));
      }
    }
    return out;
  }

  private ctrXor(key: AesKey, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      if (this.ksPos === 16) {
        key.block(false, this.ctr, 0, this.ks, 0);
        for (let j = 15; j >= 0; j--) if (++this.ctr[j] <= 0xff) break;
        else this.ctr[j] = 0;
        this.ksPos = 0;
      }
      out[i] = data[i] ^ this.ks[this.ksPos++];
    }
    return out;
  }

  private gcmFinal(key: AesKey, dec: boolean): Uint8Array {
    const data = concatBytes(this.gcmData);
    const aad = this.aad.length ? concatBytes(this.aad) : undefined;
    const iv = this.ivBytes!;
    const mk = () => gcm(key.raw.slice(), iv.slice(), aad?.slice());
    const t = this.tagLen;
    if (!dec) {
      const full = mk().encrypt(data);
      return t === 16 ? full : full.subarray(0, data.length + t);
    }
    if (data.length < t) throw new AEADBadTagException('Input data too short to contain an expected tag length of ' + t + 'bytes');
    if (t === 16) {
      try {
        return mk().decrypt(data);
      } catch {
        throw new AEADBadTagException('Tag mismatch');
      }
    }
    // Truncated tag: recover plaintext from the keystream, then recompute and compare the tag prefix.
    const ct = data.subarray(0, data.length - t);
    const ks = mk().encrypt(new Uint8Array(ct.length));
    const pt = new Uint8Array(ct.length);
    for (let i = 0; i < ct.length; i++) pt[i] = ct[i] ^ ks[i];
    const tag = mk().encrypt(pt).subarray(ct.length, ct.length + t);
    let diff = 0;
    for (let i = 0; i < t; i++) diff |= tag[i] ^ data[ct.length + i];
    if (diff) throw new AEADBadTagException('Tag mismatch');
    return pt;
  }
}

export class InvalidParameterException extends IllegalArgumentException {}

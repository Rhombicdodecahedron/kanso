import { describe, expect, it } from 'vitest';
import { call, isCatch, prop } from '../src/kotlin/core';
import { AndroidBase64 as Base64, JavaBase64, KBase64 } from '../src/java/base64';
import { ByteBuffer, ByteOrder } from '../src/java/binary';
import { Charset, Charsets, StringFromBytes, decodeBytes, encodeString } from '../src/java/charset';
import {
  AEADBadTagException,
  BadPaddingException,
  Cipher,
  GCMParameterSpec,
  IvParameterSpec,
  Mac,
  MessageDigest,
  PBEKeySpec,
  SecretKeyFactory,
  SecretKeySpec,
} from '../src/java/crypto';
import { cryptoExts, cryptoModules } from '../src/java/cryptoModules';
import { JavaRandom, Random, SeedRandom } from '../src/java/random';
import { URLDecoder, URLEncoder } from '../src/java/urlcodec';
import { GZIPInputStream, Inflater, ZipInputStream } from '../src/java/zip';
import { BufferedSource } from '../src/okhttp';
import { gzipSync, zipSync, zlibSync, deflateSync } from 'fflate';

const exts = (name: string) => {
  const all: any[] = [...cryptoExts];
  for (const v of Object.values(cryptoModules)) if (Array.isArray(v)) all.push(...v);
  return all.filter((d) => d.name === name);
};
const c = (recv: any, name: string, ...args: any[]) => call(recv, name, exts(name), args);

const utf8 = (s: string) => c(s, 'toByteArray', Charsets.UTF_8) as Int8Array;
const hex = (b: any) => c(b, 'toHexString') as string;
const unhex = (s: string) => c(s, 'decodeHex') as Int8Array;

describe('Base64', () => {
  it('android DEFAULT wraps at 76 chars with trailing newline', () => {
    expect(Base64.encodeToString(utf8('hello'), Base64.DEFAULT)).toBe('aGVsbG8=\n');
    expect(Base64.encodeToString(new Int8Array(0), Base64.DEFAULT)).toBe('');
    const s57 = Base64.encodeToString(new Int8Array(57), Base64.DEFAULT);
    expect(s57).toBe('A'.repeat(76) + '\n');
    const s58 = Base64.encodeToString(new Int8Array(58), Base64.DEFAULT);
    expect(s58).toBe('A'.repeat(76) + '\nAA==\n');
    expect(Base64.encodeToString(new Int8Array(58), Base64.CRLF)).toBe('A'.repeat(76) + '\r\nAA==\r\n');
  });
  it('android flags', () => {
    const b = Int8Array.from([-5, -1, -2, 0x61]);
    expect(Base64.encodeToString(b, Base64.NO_WRAP)).toBe('+//+YQ==');
    expect(Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING)).toBe('-__-YQ');
    expect(Base64.encodeToString(b, 1, 2, Base64.NO_WRAP)).toBe('//4=');
    expect([...Base64.encode(utf8('a'), Base64.NO_WRAP)]).toEqual([...utf8('YQ==')]);
  });
  it('android decode is lenient like Android', () => {
    expect(StringFromBytes(Base64.decode('aGVs\nbG8=\n', Base64.DEFAULT))).toBe('hello');
    expect(StringFromBytes(Base64.decode('aGVsbG8', Base64.DEFAULT))).toBe('hello');
    expect(StringFromBytes(Base64.decode(' aGVs bG8= ', Base64.NO_WRAP))).toBe('hello');
    expect([...Base64.decode('-__-YQ', Base64.URL_SAFE)]).toEqual([-5, -1, -2, 0x61]);
    expect([...Base64.decode(utf8('YQ=='), Base64.DEFAULT)]).toEqual([0x61]);
    expect(() => Base64.decode('a', Base64.DEFAULT)).toThrow('bad base-64');
    expect(() => Base64.decode('YQ=a', Base64.DEFAULT)).toThrow('bad base-64');
  });
  it('java.util.Base64', () => {
    expect(JavaBase64.getUrlEncoder().withoutPadding().encodeToString(unhex('fbfffe'))).toBe('-__-');
    expect(JavaBase64.getEncoder().encodeToString(utf8('hello'))).toBe('aGVsbG8=');
    expect(JavaBase64.getMimeEncoder().encodeToString(new Int8Array(60))).toBe('A'.repeat(76) + '\r\nAAAA');
    expect(hex(JavaBase64.getDecoder().decode('YQ'))).toBe('61');
    expect(() => JavaBase64.getDecoder().decode('YQ=')).toThrow('Input byte array has wrong 4-byte ending unit');
    expect(() => JavaBase64.getDecoder().decode('YQ==\n')).toThrow();
    expect(hex(JavaBase64.getMimeDecoder().decode('Y\r\nQ=='))).toBe('61');
    expect(KBase64.Default.encode(utf8('hi'))).toBe('aGk=');
    expect(hex(KBase64.UrlSafe.decode('-__-'))).toBe('fbfffe');
  });
});

describe('MessageDigest / Mac', () => {
  it('digests known vectors', () => {
    expect(hex(MessageDigest.getInstance('MD5').digest(utf8('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(hex(MessageDigest.getInstance('SHA-1').digest(utf8('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(hex(MessageDigest.getInstance('SHA-256').digest(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(MessageDigest.getInstance('sha-512').digest(utf8('abc')))).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
    const md = MessageDigest.getInstance('MD5');
    md.update(utf8('a'));
    md.update(utf8('bc'));
    expect(hex(md.digest())).toBe('900150983cd24fb0d6963f7d28e17f72');
    // digest() resets
    expect(hex(md.digest())).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md.digestLength).toBe(16);
    expect(prop(md, 'digestLength', [])).toBe(16);
    expect(() => MessageDigest.getInstance('FOO')).toThrow();
  });
  it('HMAC RFC 4231 / RFC 2202 vectors', () => {
    const key = new SecretKeySpec(new Int8Array(20).fill(0x0b), 'HmacSHA256');
    const mac = Mac.getInstance('HmacSHA256');
    mac.init(key);
    expect(hex(mac.doFinal(utf8('Hi There')))).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
    // reusable after doFinal
    mac.update(utf8('Hi '));
    mac.update(utf8('There'));
    expect(hex(mac.doFinal())).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
    const m512 = Mac.getInstance('HmacSHA512');
    m512.init(new SecretKeySpec(utf8('Jefe'), 'HmacSHA512'));
    expect(hex(m512.doFinal(utf8('what do ya want for nothing?')))).toBe(
      '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
    );
    const m1 = Mac.getInstance('HmacSHA1');
    m1.init(new SecretKeySpec(utf8('Jefe'), 'HmacSHA1'));
    expect(hex(m1.doFinal(utf8('what do ya want for nothing?')))).toBe('effcdf6ae5eb2fa2d27416d5f184df9c259a7c79');
  });
  it('PBKDF2WithHmacSHA512 matches the JVM', () => {
    const f = SecretKeyFactory.getInstance('PBKDF2WithHmacSHA512');
    const k = f.generateSecret(new PBEKeySpec([...'password'], utf8('salt'), 1000, 256));
    expect(hex(k.encoded)).toBe('afe6c5530785b6cc6b1c6453384731bd5ee432ee549fd42fb6695779ad8a1c5b');
  });
});

describe('Cipher', () => {
  const key = unhex('000102030405060708090a0b0c0d0e0f');
  const iv = unhex('0f0e0d0c0b0a09080706050403020100');
  const pt = utf8('The quick brown fox jumps over the lazy dog');
  const JVM = {
    cbc: '6f40de04ce96f3426280fc4c87d9209aa2112afaf1970696d85445e1ff6817db4b32306ba0028ebe4202250343a631f5',
    ecb: 'f7021c01de43c8147cd2477a7eba55b3698dc29f6db0d5eda4eec682b3393abb021cf4d15412037af882263fd186b880',
    ctr: '74c19cb2c539328b6f3f9eae03d9f74a21c9dc851f2b0d341d92fe9a2c4b212bd3bad8d08fb9109ab5acd2',
    gcm128aad: '760cb07ebd4b55000e07a4ca6e7a9c547ac3394f2a3451b3209e7b1ab20fb0e83df45da93c7f56915861257688110140d74cab9fda5d14aa946c37',
    gcm96: '760cb07ebd4b55000e07a4ca6e7a9c547ac3394f2a3451b3209e7b1ab20fb0e83df45da93c7f56915861255a48f48d96bea9fccd0ab5fa',
  };
  const ks = new SecretKeySpec(key, 'AES');

  it('AES/CBC/PKCS5Padding round-trips and matches the JVM', () => {
    const enc = Cipher.getInstance('AES/CBC/PKCS5Padding');
    enc.init(Cipher.ENCRYPT_MODE, ks, new IvParameterSpec(iv));
    expect(hex(enc.doFinal(pt))).toBe(JVM.cbc);
    const dec = Cipher.getInstance('AES/CBC/PKCS7Padding');
    dec.init(Cipher.DECRYPT_MODE, ks, new IvParameterSpec(iv));
    expect(StringFromBytes(dec.doFinal(unhex(JVM.cbc)), Charsets.UTF_8)).toBe('The quick brown fox jumps over the lazy dog');
    // streaming update + doFinal gives the same result
    const ct = unhex(JVM.cbc);
    const a = dec.update(ct.subarray(0, 20));
    const b = dec.update(ct.subarray(20));
    const f = dec.doFinal();
    expect(StringFromBytes(Int8Array.from([...a, ...b, ...f]))).toBe('The quick brown fox jumps over the lazy dog');
  });
  it('ECB, CTR and NoPadding', () => {
    const e = Cipher.getInstance('AES/ECB/PKCS5Padding');
    e.init(Cipher.ENCRYPT_MODE, ks);
    expect(hex(e.doFinal(pt))).toBe(JVM.ecb);
    const aes = Cipher.getInstance('AES');
    aes.init(Cipher.DECRYPT_MODE, ks);
    expect(StringFromBytes(aes.doFinal(unhex(JVM.ecb)))).toBe('The quick brown fox jumps over the lazy dog');

    const ctr = Cipher.getInstance('AES/CTR/NoPadding');
    ctr.init(Cipher.ENCRYPT_MODE, ks, new IvParameterSpec(iv));
    expect(hex(ctr.doFinal(pt))).toBe(JVM.ctr);
    ctr.init(Cipher.DECRYPT_MODE, ks, new IvParameterSpec(iv));
    const p1 = ctr.update(unhex(JVM.ctr).subarray(0, 7));
    const p2 = ctr.doFinal(unhex(JVM.ctr).subarray(7));
    expect(StringFromBytes(Int8Array.from([...p1, ...p2]))).toBe('The quick brown fox jumps over the lazy dog');

    const np = Cipher.getInstance('AES/CBC/NoPadding');
    np.init(Cipher.DECRYPT_MODE, ks, new IvParameterSpec(iv));
    expect(hex(np.doFinal(unhex(JVM.cbc)).subarray(0, 16))).toBe(hex(pt.subarray(0, 16)));
    np.init(Cipher.ENCRYPT_MODE, ks, new IvParameterSpec(iv));
    expect(() => np.doFinal(pt)).toThrow('Input length not multiple of 16 bytes');
  });
  it('bad padding throws BadPaddingException', () => {
    const dec = Cipher.getInstance('AES/CBC/PKCS5Padding');
    dec.init(Cipher.DECRYPT_MODE, new SecretKeySpec(new Int8Array(16), 'AES'), new IvParameterSpec(iv));
    let err: unknown;
    try {
      dec.doFinal(unhex(JVM.cbc));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadPaddingException);
  });
  it('AES/GCM/NoPadding with AAD and truncated tags', () => {
    const g = Cipher.getInstance('AES/GCM/NoPadding');
    const nonce = iv.subarray(0, 12);
    g.init(Cipher.ENCRYPT_MODE, ks, new GCMParameterSpec(128, nonce));
    g.updateAAD(utf8('aad'));
    expect(hex(g.doFinal(pt))).toBe(JVM.gcm128aad);
    g.init(Cipher.DECRYPT_MODE, ks, new GCMParameterSpec(128, nonce));
    g.updateAAD(utf8('aad'));
    expect(StringFromBytes(g.doFinal(unhex(JVM.gcm128aad)))).toBe('The quick brown fox jumps over the lazy dog');

    g.init(Cipher.ENCRYPT_MODE, ks, new GCMParameterSpec(96, nonce));
    expect(hex(g.doFinal(pt))).toBe(JVM.gcm96);
    g.init(Cipher.DECRYPT_MODE, ks, new GCMParameterSpec(96, nonce));
    expect(StringFromBytes(g.doFinal(unhex(JVM.gcm96)))).toBe('The quick brown fox jumps over the lazy dog');
    const tampered = unhex(JVM.gcm96);
    tampered[0] ^= 1;
    g.init(Cipher.DECRYPT_MODE, ks, new GCMParameterSpec(96, nonce));
    expect(() => g.doFinal(tampered)).toThrow(AEADBadTagException);
  });
  it('decrypts an OpenSSL "Salted__" payload via EVP_BytesToKey (Madara CryptoAES)', () => {
    // echo -n '{"chapter":"https://example.com/img/001.jpg"}' | openssl enc -aes-256-cbc -md md5 -pass pass:madara-secret -base64 -A
    const cipherText = 'U2FsdGVkX1/D5rQ9MtrmFp2ZvMyAywF5kRPYLCHZFhVeKXNcKF4gxGLng81IHmGrVWZBVWhtz10bY/s6yX3XQA==';
    const ctBytes = Base64.decode(cipherText, Base64.DEFAULT);
    expect(StringFromBytes(ctBytes.subarray(0, 8))).toBe('Salted__');
    const salt = ctBytes.slice(8, 16);
    const body = ctBytes.slice(16);
    const md = MessageDigest.getInstance('MD5');
    // generateKeyAndIV(32, 16, 1, salt, password, md5), written like CryptoAES.kt
    const password = utf8('madara-secret');
    const digestLength = md.digestLength;
    const required = Math.floor((32 + 16 + digestLength - 1) / digestLength) * digestLength;
    const generated = new Int8Array(required);
    let generatedLength = 0;
    md.reset();
    while (generatedLength < 48) {
      if (generatedLength > 0) md.update(generated, generatedLength - digestLength, digestLength);
      md.update(password);
      md.update(salt, 0, 8);
      md.digest(generated, generatedLength, digestLength);
      generatedLength += digestLength;
    }
    const cipher = Cipher.getInstance('AES/CBC/PKCS7PADDING');
    cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(generated.slice(0, 32), 'AES'), new IvParameterSpec(generated.slice(32, 48)));
    expect(c(cipher.doFinal(body), 'toString', Charsets.UTF_8)).toBe('{"chapter":"https://example.com/img/001.jpg"}');
  });
});

describe('charsets and string extensions', () => {
  it('encodes and decodes like the JVM', () => {
    expect(hex(c('aé€😀', 'toByteArray', Charsets.ISO_8859_1))).toBe('61e93f3f');
    expect(hex(c('aé', 'toByteArray', Charsets.US_ASCII))).toBe('613f');
    expect(hex(c('é', 'toByteArray'))).toBe('c3a9');
    // malformed UTF-8 -> U+FFFD exactly like java.lang.String
    const bad = unhex('e28241c080f09f9880ffeda080');
    const s = StringFromBytes(bad, Charsets.UTF_8);
    expect(hex(encodeString(s, 'UTF-16BE'))).toBe('fffd0041fffdfffdd83dde00fffdfffd');
    expect(c(utf8('héllo'), 'decodeToString')).toBe('héllo');
    expect(StringFromBytes(utf8('héllo'), 1, 2, Charsets.UTF_8)).toBe('é');
    expect(decodeBytes(Int8Array.from([0xe9 - 256]), Charset.forName('ISO-8859-1'))).toBe('é');
    expect(Charsets.UTF_8.name).toBe('UTF-8');
    expect(call(Charsets.UTF_8, 'name', [], [])).toBe('UTF-8');
    expect(Charset.forName('utf8')).toBe(Charsets.UTF_8);
  });
  it('hex helpers', () => {
    expect(hex(Int8Array.from([0, 15, -1, 16]))).toBe('000fff10');
    expect([...c('000FFF10', 'hexToByteArray')]).toEqual([0, 15, -1, 16]);
    expect([...unhex('00ff7f80')]).toEqual([0, -1, 127, -128]);
    expect(() => unhex('abc')).toThrow('Unexpected hex string: abc');
    expect(() => unhex('zz')).toThrow('Unexpected hex digit: z');
    expect(c(255, 'toHexString')).toBe('000000ff');
    expect(c(-1, 'toHexString')).toBe('ffffffff');
  });
  it('kotlin.experimental byte ops wrap to Byte', () => {
    const [xor] = cryptoModules['kotlin.experimental.xor'] as any[];
    const [inv] = cryptoModules['kotlin.experimental.inv'] as any[];
    expect(xor.fn(-128, 127)).toBe(-1);
    expect(xor.fn(0x55, -1)).toBe(-86);
    expect(inv.fn(0)).toBe(-1);
  });
});

describe('URLEncoder / URLDecoder', () => {
  it('uses Java form encoding', () => {
    expect(URLEncoder.encode("a b+c&d=é/~!*'()._-😀", 'UTF-8')).toBe('a+b%2Bc%26d%3D%C3%A9%2F%7E%21*%27%28%29._-%F0%9F%98%80');
    expect(URLEncoder.encode('ü', Charsets.ISO_8859_1)).toBe('%FC');
    expect(URLEncoder.encode('\ud800x')).toBe('%3Fx');
    expect(URLDecoder.decode('a+b%20c%E2%82%AC%2B', 'UTF-8')).toBe('a b c€+');
    expect(URLDecoder.decode('%FC', Charsets.ISO_8859_1)).toBe('ü');
    expect(() => URLDecoder.decode('%4', 'UTF-8')).toThrow('Incomplete trailing escape');
    expect(() => URLDecoder.decode('%zz', 'UTF-8')).toThrow('Illegal hex characters');
  });
});

describe('ByteBuffer', () => {
  it('reads and writes with byte order, sharing the array', () => {
    const arr = new Int8Array(16);
    const bb = ByteBuffer.wrap(arr).order(ByteOrder.LITTLE_ENDIAN);
    bb.putInt(0x01020304).putShort(-2).put(-1);
    expect(bb.position()).toBe(7);
    expect([...arr.subarray(0, 7)]).toEqual([4, 3, 2, 1, -2, -1, -1]);
    expect(bb.getInt(0)).toBe(0x01020304);
    bb.order(ByteOrder.BIG_ENDIAN).putInt(8, -2);
    expect([...arr.subarray(8, 12)]).toEqual([-1, -1, -1, -2]);
    bb.flip();
    expect(bb.remaining()).toBe(7);
    expect(prop(bb, 'int', [])).toBe(0x04030201);
    expect(bb.short).toBe(-257); // still BIG_ENDIAN
    expect(bb.get()).toBe(-1);
    expect(() => bb.get()).toThrow();
    const lb = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN);
    lb.putLong(0, 0x123456789);
    expect(lb.getLong(0)).toBe(0x123456789);
    lb.order(ByteOrder.BIG_ENDIAN).putLong(8, -2);
    expect(hex(lb.array().subarray(8))).toBe('fffffffffffffffe');
    expect(lb.getLong(8)).toBe(-2);
    expect(lb.order(ByteOrder.LITTLE_ENDIAN).getLong(0)).toBe(0x123456789);
    expect(lb.order()).toBe(ByteOrder.LITTLE_ENDIAN);
  });
  it('supports the ebookjapan header writer', () => {
    const bb = ByteBuffer.allocate(8).putShort(800).putShort(1200).put(4).put(64).put(1).put(Int8Array.from([9]));
    expect(hex(bb.array())).toBe('032004b004400109');
  });
});

describe('keiyoushi.utils', () => {
  it('Binary.kt', () => {
    const b = unhex('01020304ff7f0080');
    expect(c(b, 'readIntLittleEndian', 0)).toBe(0x04030201);
    expect(c(b, 'readIntBigEndian', 0)).toBe(0x01020304);
    expect(c(b, 'readUShortLittleEndian', 4)).toBe(0x7fff);
    expect(c(b, 'readUShortBigEndian', 4)).toBe(0xff7f);
    expect(c(unhex('ffffffff'), 'readUIntLittleEndian', 0)).toBe(4294967295);
    expect(c(unhex('ffffffff'), 'readIntLittleEndian', 0)).toBe(-1);
    expect(c(unhex('0100000000000000'), 'readLongLittleEndian', 0)).toBe(1);
    const w = new Int8Array(8);
    c(w, 'writeIntLittleEndian', 0, -2);
    c(w, 'writeIntBigEndian', 4, 0x01020304);
    expect(hex(w)).toBe('feffffff01020304');
    expect(() => c(new Int8Array(3), 'readIntBigEndian', 0)).toThrow();
  });
  it('rc4 matches the RFC 6229-style test vector', () => {
    // Key "Key", plaintext "Plaintext" -> BBF316E8D940AF0AD3 (Wikipedia RC4 vectors)
    expect(hex(c(utf8('Plaintext'), 'rc4', utf8('Key')))).toBe('bbf316e8d940af0ad3');
    expect(hex(c(utf8('Attack at dawn'), 'rc4', utf8('Secret')))).toBe('45a01f645fc35b383552544b9bf5');
    const src = new BufferedSource(new Uint8Array(c(utf8('Plaintext'), 'rc4', utf8('Key'), 0).buffer));
    expect(c(src, 'rc4', utf8('Key')).readUtf8()).toBe('Plaintext');
    // skip discards keystream bytes
    const full = c(new Int8Array(10), 'rc4', utf8('Key'));
    expect(hex(c(new Int8Array(5), 'rc4', utf8('Key'), 5))).toBe(hex(full.subarray(5)));
  });
  it('inflate (zlib and raw), Inflater, GZIPInputStream, ZipInputStream', () => {
    const data = utf8('hello hello hello hello');
    const z = Int8Array.from(zlibSync(new Uint8Array(data.buffer)));
    expect(c(c(z, 'inflate'), 'decodeToString')).toBe('hello hello hello hello');
    const raw = Int8Array.from(deflateSync(new Uint8Array(data.buffer)));
    expect(c(c(raw, 'inflate', true), 'decodeToString')).toBe('hello hello hello hello');
    expect(c(new BufferedSource(new Uint8Array(z.buffer)), 'inflate').readUtf8()).toBe('hello hello hello hello');

    const inf = new Inflater();
    inf.setInput(z);
    const out = new Int8Array(512);
    const n = inf.inflate(out);
    inf.end();
    expect(StringFromBytes(out, 0, n)).toBe('hello hello hello hello');

    const gz = new GZIPInputStream(Int8Array.from(gzipSync(new Uint8Array(data.buffer))));
    expect(c(gz.readBytes(), 'decodeToString')).toBe('hello hello hello hello');

    const zip = zipSync({ '2.txt': new Uint8Array(utf8('two').buffer), '10.txt': new Uint8Array(utf8('ten').buffer) });
    const zis = new ZipInputStream(Int8Array.from(zip));
    const names: string[] = [];
    let e;
    while ((e = zis.nextEntry) !== null) names.push(`${e.name}=${StringFromBytes(zis.readBytes())}`);
    expect(names).toEqual(['2.txt=two', '10.txt=ten']);
  });
  it('SeedRandom matches davidbau/seedrandom', () => {
    // From the seedrandom README: Math.seedrandom('hello.'); Math.random() == 0.9282578795792454
    expect(new SeedRandom('hello.').nextDouble()).toBe(0.9282578795792454);
    const shuffled = new SeedRandom('abc').shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
    expect([...shuffled].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('Random', () => {
  it('kotlin.random.Random(seed) matches the JVM XorWow sequence', () => {
    const r = Random(42);
    expect([r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()]).toEqual([972016666, 1740578880, -408207414, -112774692, 1162768683]);
    expect([0, 1, 2, 3, 4].map(() => r.nextInt(100))).toEqual([32, 21, 40, 69, 87]);
    expect([0, 1, 2, 3, 4].map(() => r.nextInt(5, 17))).toEqual([9, 12, 12, 16, 7]);
    expect([0, 1, 2].map(() => r.nextInt(64))).toEqual([60, 37, 7]);
    expect([0, 1, 2].map(() => r.nextDouble())).toEqual([0.08548125910056925, 0.6353973221914591, 0.8041839195069418]);
    expect([0, 1, 2].map(() => r.nextLong(1000000007))).toEqual([203947716, 199794732, 473897927]);
    expect(hex(r.nextBytes(7))).toBe('50b495712a9274');
    expect(r.nextBoolean()).toBe(true);
    expect(Math.fround(r.nextFloat())).toBe(Math.fround(0.016640425));

    const r2 = new (Random as any)(-1);
    expect([r2.nextInt(1000), r2.nextInt(1000), r2.nextInt(1000)]).toEqual([666, 404, 311]);
    const r3 = Random(1234567890123);
    expect([r3.nextInt(), r3.nextInt()]).toEqual([-978035486, 581284957]);
    expect(isCatch(r3, Random)).toBe(true);
  });
  it('Random.Default companion functions', () => {
    for (let i = 0; i < 50; i++) {
      const v = Random.nextInt(4, 9);
      expect(v >= 4 && v < 9).toBe(true);
    }
    expect(Random.nextBytes(16).length).toBe(16);
    expect(Random.Default.nextInt(1)).toBe(0);
  });
  it('java.util.Random matches the JVM LCG', () => {
    const j = new JavaRandom(42);
    expect(j.nextInt()).toBe(-1170105035);
    expect(j.nextInt(100)).toBe(63);
    expect(j.nextInt(64)).toBe(43);
    expect(j.nextLong()).toBe(884324181205335268);
    expect(j.nextDouble()).toBe(0.9420735430282128);
    expect(j.nextInt(5, 17)).toBe(7);
    expect(j.nextBoolean()).toBe(true);
    const b = new Int8Array(6);
    j.nextBytes(b);
    expect(hex(b)).toBe('9a0c6117bd67');
  });
});

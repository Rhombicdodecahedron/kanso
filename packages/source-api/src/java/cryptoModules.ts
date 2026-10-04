// FQN map for the crypto / encoding / binary runtime (merged into src/modules.ts).

import { type ExtDef, hash } from '../kotlin/core';
import { ext } from '../kotlin/hof';
import { AndroidBase64, JavaBase64, KBase64 } from './base64';
import { binaryExts, ByteBuffer, ByteOrder, BufferOverflowException, BufferUnderflowException, decodeHexExt, rc4Exts } from './binary';
import { Charset, Charsets, StandardCharsets, StringFromBytes, UnsupportedCharsetException, decodeBytes, encodeString, fromHex, i8, isByteArray, toHex } from './charset';
import {
  AEADBadTagException,
  BadPaddingException,
  Cipher,
  GCMParameterSpec,
  IllegalBlockSizeException,
  InvalidAlgorithmParameterException,
  InvalidKeyException,
  InvalidKeySpecException,
  IvParameterSpec,
  Mac,
  MessageDigest,
  NoSuchAlgorithmException,
  NoSuchPaddingException,
  PBEKeySpec,
  SecretKeyFactory,
  SecretKeySpec,
  SecureRandom,
} from './crypto';
import { JavaRandom, Random, randomExts, SeedRandom } from './random';
import { URLDecoder, URLEncoder } from './urlcodec';
import { DataFormatException, GZIPInputStream, Inflater, InflaterInputStream, inflateExts, ZipEntry, ZipException, ZipInputStream } from './zip';

const BYTES = isByteArray;
const STR = (x: any) => typeof x === 'string';
const NUM = (x: any) => typeof x === 'number';
const toByte = (n: number) => (n << 24) >> 24;

/**
 * Kotlin stdlib extensions on ByteArray/String that deal with charsets and hex. They must be
 * consulted before the generic stdlib ones (stdlib `toString`/`toByteArray` are less specific).
 */
export const cryptoExts: ExtDef[] = [
  // ByteArray.toString(charset) - without a charset the JVM prints the array identity.
  ext('toString', BYTES, (b: any, charset?: any) => (charset === undefined ? `[B@${(hash(b) >>> 0).toString(16)}` : decodeBytes(b, charset))),
  ext('decodeToString', BYTES, (b: any, start = 0, end?: number) => decodeBytes(b, 'UTF-8', start, (end ?? b.length) - start)),
  ext('toByteArray', STR, (s: string, charset?: any) => i8(encodeString(s, charset))),
  ext('toHexString', BYTES, (b: any, format?: any) => toHex(b, !!(format?.upperCase ?? format?.isUpperCase))),
  ext('toHexString', NUM, (n: number) => (Number.isInteger(n) && n >= -2147483648 && n <= 0xffffffff ? (n >>> 0).toString(16).padStart(8, '0') : BigInt.asUintN(64, BigInt(Math.trunc(n))).toString(16).padStart(16, '0'))),
  ext('hexToByteArray', STR, (s: string) => fromHex(s)),
];

/** kotlin.experimental Byte bit operations. */
export const byteOps: Record<string, ExtDef> = {
  xor: ext('xor', NUM, (a: number, b: number) => toByte(a ^ b)),
  and: ext('and', NUM, (a: number, b: number) => toByte(a & b)),
  or: ext('or', NUM, (a: number, b: number) => toByte(a | b)),
  inv: ext('inv', NUM, (a: number) => toByte(~a)),
};

const named = (defs: ExtDef[], name: string) => defs.filter((d) => d.name === name);

export const cryptoModules: Record<string, unknown> = {
  // encoding
  'android.util.Base64': AndroidBase64,
  'java.util.Base64': JavaBase64,
  'kotlin.io.encoding.Base64': KBase64,
  'kotlin.text.Charsets': Charsets,
  'java.nio.charset.StandardCharsets': StandardCharsets,
  'java.nio.charset.Charset': Charset,
  'java.nio.charset.UnsupportedCharsetException': UnsupportedCharsetException,
  'kotlin.text.String': StringFromBytes,
  'kotlin.text.toByteArray': named(cryptoExts, 'toByteArray'),
  'kotlin.text.decodeToString': named(cryptoExts, 'decodeToString'),
  'kotlin.text.toHexString': named(cryptoExts, 'toHexString'),
  'kotlin.text.hexToByteArray': named(cryptoExts, 'hexToByteArray'),
  'kotlin.io.toString': named(cryptoExts, 'toString'),
  'java.net.URLEncoder': URLEncoder,
  'java.net.URLDecoder': URLDecoder,

  // java.security / javax.crypto
  'java.security.MessageDigest': MessageDigest,
  'java.security.SecureRandom': SecureRandom,
  'java.security.NoSuchAlgorithmException': NoSuchAlgorithmException,
  'java.security.InvalidKeyException': InvalidKeyException,
  'java.security.InvalidAlgorithmParameterException': InvalidAlgorithmParameterException,
  'java.security.spec.InvalidKeySpecException': InvalidKeySpecException,
  'javax.crypto.Cipher': Cipher,
  'javax.crypto.Mac': Mac,
  'javax.crypto.SecretKeyFactory': SecretKeyFactory,
  'javax.crypto.SecretKey': SecretKeySpec,
  'javax.crypto.spec.SecretKeySpec': SecretKeySpec,
  'javax.crypto.spec.IvParameterSpec': IvParameterSpec,
  'javax.crypto.spec.GCMParameterSpec': GCMParameterSpec,
  'javax.crypto.spec.PBEKeySpec': PBEKeySpec,
  'javax.crypto.BadPaddingException': BadPaddingException,
  'javax.crypto.AEADBadTagException': AEADBadTagException,
  'javax.crypto.IllegalBlockSizeException': IllegalBlockSizeException,
  'javax.crypto.NoSuchPaddingException': NoSuchPaddingException,

  // java.nio
  'java.nio.ByteBuffer': ByteBuffer,
  'java.nio.ByteOrder': ByteOrder,
  'java.nio.BufferUnderflowException': BufferUnderflowException,
  'java.nio.BufferOverflowException': BufferOverflowException,

  // random
  'kotlin.random.Random': Random,
  'kotlin.random.nextUBytes': named(randomExts, 'nextUBytes'),
  'kotlin.random.nextUInt': named(randomExts, 'nextUInt'),
  'java.util.Random': JavaRandom,
  'kotlin.experimental.xor': [byteOps.xor],
  'kotlin.experimental.and': [byteOps.and],
  'kotlin.experimental.or': [byteOps.or],
  'kotlin.experimental.inv': [byteOps.inv],

  // java.util.zip
  'java.util.zip.Inflater': Inflater,
  'java.util.zip.InflaterInputStream': InflaterInputStream,
  'java.util.zip.GZIPInputStream': GZIPInputStream,
  'java.util.zip.ZipInputStream': ZipInputStream,
  'java.util.zip.ZipEntry': ZipEntry,
  'java.util.zip.DataFormatException': DataFormatException,
  'java.util.zip.ZipException': ZipException,

  // keiyoushi.utils (Crypto.kt, Binary.kt, Inflater.kt, SeedRandom.kt)
  'keiyoushi.utils.decodeHex': [decodeHexExt],
  'keiyoushi.utils.rc4': rc4Exts,
  'keiyoushi.utils.readIntLittleEndian': named(binaryExts, 'readIntLittleEndian'),
  'keiyoushi.utils.readIntBigEndian': named(binaryExts, 'readIntBigEndian'),
  'keiyoushi.utils.writeIntLittleEndian': named(binaryExts, 'writeIntLittleEndian'),
  'keiyoushi.utils.writeIntBigEndian': named(binaryExts, 'writeIntBigEndian'),
  'keiyoushi.utils.readUShortLittleEndian': named(binaryExts, 'readUShortLittleEndian'),
  'keiyoushi.utils.readUShortBigEndian': named(binaryExts, 'readUShortBigEndian'),
  'keiyoushi.utils.readUIntLittleEndian': named(binaryExts, 'readUIntLittleEndian'),
  'keiyoushi.utils.readLongLittleEndian': named(binaryExts, 'readLongLittleEndian'),
  'keiyoushi.utils.inflate': inflateExts,
  'keiyoushi.utils.SeedRandom': SeedRandom,
};


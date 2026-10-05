// kotlinx.serialization.protobuf + keiyoushi.utils.Protobuf: a protobuf codec driven by the same
// type descriptors as JSON (`$serial` field lists). Field numbers come from `SerialField.proto`
// (the translator emits it from @ProtoNumber); otherwise element index + 1, like kotlinx.
//
// Semantics follow keiyoushi's ProtobufSourceDecoder / ProtobufSinkEncoder: enums are ordinals,
// absent nullable fields decode to null, absent lists to empty lists, repeated scalars are written
// unpacked unless @ProtoPacked, and defaults are skipped unless encodeDefaults / @EncodeDefault.

import { eq, IOException, isStr, SerializationException, str, type ExtDef } from '../kotlin/core';
import { Named } from '../kotlin/named';
import { MediaType, RequestBody, Response, ResponseBody, BufferedSource, Buffer as OkBuffer } from '../okhttp';
import { AndroidBase64 } from '../java/base64';
import { MissingFieldException, T, type Desc, type SerialField, type SerialInfo } from './json';

const WIRE_VARINT = 0;
const WIRE_I64 = 1;
const WIRE_LEN = 2;
const WIRE_I32 = 5;

type IntType = 'DEFAULT' | 'SIGNED' | 'FIXED';

// ---------- reader ----------

class Reader {
  pos: number;
  constructor(
    readonly buf: Uint8Array,
    start = 0,
    public end = buf.length,
  ) {
    this.pos = start;
  }
  exhausted(): boolean {
    return this.pos >= this.end;
  }
  private byte(): number {
    if (this.pos >= this.end) throw new IOException('Unexpected end of protobuf input');
    return this.buf[this.pos++];
  }
  /** Unsigned 64-bit varint as [lo, hi] uint32 halves. */
  varint(): [number, number] {
    let lo = 0;
    let hi = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      if (shift < 28) lo |= (b & 0x7f) << shift;
      else if (shift === 28) {
        lo |= (b & 0x0f) << 28;
        hi |= (b & 0x7f) >> 4;
      } else if (shift < 64) hi |= (b & 0x7f) << (shift - 32);
      else throw new IOException('Malformed varint');
      if (b < 0x80) break;
      shift += 7;
    }
    return [lo >>> 0, hi >>> 0];
  }
  varint32(): number {
    return this.varint()[0];
  }
  length(): number {
    const [lo, hi] = this.varint();
    const n = hi * 4294967296 + lo;
    if (n > this.end - this.pos) throw new IOException(`Length ${n} runs past the enclosing message (${this.end - this.pos} bytes left)`);
    return n;
  }
  bytes(n: number): Uint8Array {
    if (n > this.end - this.pos) throw new IOException('Unexpected end of protobuf input');
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  view(n: number): DataView {
    const b = this.bytes(n);
    return new DataView(b.buffer, b.byteOffset, n);
  }
  skip(wire: number, field: number): void {
    switch (wire) {
      case WIRE_VARINT:
        this.varint();
        return;
      case WIRE_I64:
        this.bytes(8);
        return;
      case WIRE_LEN:
        this.bytes(this.length());
        return;
      case WIRE_I32:
        this.bytes(4);
        return;
    }
    throw new IOException(`Unsupported start group or end group wire type: ${wire} for field ${field}`);
  }
}

const signed64 = (lo: number, hi: number) => (hi | 0) * 4294967296 + lo;

function zigzag64(lo: number, hi: number): number {
  const u = (BigInt(hi) << 32n) | BigInt(lo);
  return Number(BigInt.asIntN(64, (u >> 1n) ^ -(u & 1n)));
}

// ---------- writer ----------

class Writer {
  buf = new Uint8Array(64);
  len = 0;
  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.len));
    this.buf = b;
  }
  byte(b: number): void {
    this.ensure(1);
    this.buf[this.len++] = b;
  }
  raw(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }
  /** Varint of a 32-bit unsigned value. */
  varint32(v: number): void {
    v >>>= 0;
    while (v > 0x7f) {
      this.byte((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.byte(v);
  }
  /** Varint of a signed 64-bit integer (negative values take 10 bytes). */
  varint64(n: number): void {
    if (n >= 0 && n <= 0xffffffff && Number.isInteger(n)) return this.varint32(n);
    let u = BigInt.asUintN(64, BigInt(Math.trunc(n)));
    while (u > 0x7fn) {
      this.byte(Number(u & 0x7fn) | 0x80);
      u >>= 7n;
    }
    this.byte(Number(u));
  }
  tag(field: number, wire: number): void {
    this.varint64(field * 8 + wire);
  }
  fixed32(bits: (v: DataView) => void): void {
    this.ensure(4);
    bits(new DataView(this.buf.buffer, this.len, 4));
    this.len += 4;
  }
  fixed64(bits: (v: DataView) => void): void {
    this.ensure(8);
    bits(new DataView(this.buf.buffer, this.len, 8));
    this.len += 8;
  }
  lengthDelimited(bytes: Uint8Array): void {
    this.varint64(bytes.length);
    this.raw(bytes);
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

const utf8 = new TextEncoder();
const utf8d = new TextDecoder();

// ---------- class metadata ----------

interface Elem {
  f: SerialField;
  /** index into the constructor arguments, or -1 for body properties */
  ctorIndex: number;
  number: number;
  intType: IntType;
}

interface ClassInfo {
  info: SerialInfo;
  elems: Elem[];
  byNumber: Map<number, number>;
  ctorCount: number;
  defaults: any | null | undefined;
}

const classInfos = new WeakMap<any, ClassInfo>();

function classInfo(cls: any): ClassInfo {
  let ci = classInfos.get(cls);
  if (ci) return ci;
  const info: SerialInfo | undefined = cls?.$serial;
  if (!info) throw new SerializationException(`Class ${cls?.name} is not @Serializable`);
  const elems: Elem[] = [];
  let ctorIndex = 0;
  let index = 0;
  for (const f of info.fields) {
    const ci = f.body ? -1 : ctorIndex++;
    if (f.json.startsWith('\u0000')) continue; // @Transient: not an element
    elems.push({ f, ctorIndex: ci, number: f.proto ?? index + 1, intType: f.protoType ?? 'DEFAULT' });
    index++;
  }
  const byNumber = new Map<number, number>();
  elems.forEach((e, i) => byNumber.set(e.number, i));
  ci = { info, elems, byNumber, ctorCount: ctorIndex, defaults: undefined };
  classInfos.set(cls, ci);
  return ci;
}

/** Default values, read off an instance built with every constructor argument omitted. */
function defaultsOf(cls: any, ci: ClassInfo): any | null {
  if (ci.defaults === undefined) {
    try {
      ci.defaults = new cls(...new Array(ci.ctorCount).fill(undefined));
    } catch {
      ci.defaults = null;
    }
  }
  return ci.defaults;
}

const unwrap = (d: Desc): Desc => (d.k === 'nullable' ? unwrap((d as any).of) : d);
const isRepeated = (d: Desc) => d.k === 'list' || d.k === 'set' || d.k === 'array$';
const elemOf = (d: Desc): Desc => (d as any).of;

function resolveParams(d: Desc, typeArgs: Desc[]): Desc {
  if (d.k === 'typeParam') return typeArgs[(d as any).i] ?? T.any;
  return d;
}

/** A value class's single underlying field, or null. */
function inlineField(d: Desc): SerialField | null {
  if (d.k !== 'cls') return null;
  const info: SerialInfo | undefined = (d as any).cls?.$serial;
  return info?.inline ? (info.fields.find((f) => !f.body) ?? null) : null;
}

/** Packed on the wire: numeric/bool/enum scalars (not strings, bytes or messages). */
function isPackable(d: Desc): boolean {
  const inl = inlineField(d);
  if (inl) return isPackable(unwrap(inl.type));
  return ['int', 'long', 'double', 'float', 'bool', 'char', 'enum'].includes(d.k);
}
/** Written packed (with @ProtoPacked): primitives only, not enums. */
function isPackedWhenWritten(d: Desc): boolean {
  const inl = inlineField(d);
  if (inl) return isPackedWhenWritten(unwrap(inl.type));
  return ['int', 'long', 'double', 'float', 'bool', 'char'].includes(d.k);
}

// ---------- decoding ----------

function expect(r: { wire: number; field: number }, wire: number, check: boolean): void {
  if (check && r.wire !== wire) throw new IOException(`Expected wire type ${wire} for field ${r.field}, but found ${r.wire}`);
}

function readScalar(rd: Reader, d0: Desc, wire: number, field: number, intType: IntType, check: boolean, typeArgs: Desc[]): any {
  const d = resolveParams(unwrap(d0), typeArgs);
  const ctx = { wire, field };
  switch (d.k) {
    case 'int':
    case 'char': {
      let v: number;
      if (intType === 'FIXED') {
        expect(ctx, WIRE_I32, check);
        v = rd.view(4).getInt32(0, true);
      } else {
        expect(ctx, WIRE_VARINT, check);
        const lo = rd.varint32();
        v = intType === 'SIGNED' ? (lo >>> 1) ^ -(lo & 1) : lo | 0;
      }
      return d.k === 'char' ? String.fromCharCode(v & 0xffff) : v;
    }
    case 'long':
      if (intType === 'FIXED') {
        expect(ctx, WIRE_I64, check);
        return Number(rd.view(8).getBigInt64(0, true));
      } else {
        expect(ctx, WIRE_VARINT, check);
        const [lo, hi] = rd.varint();
        return intType === 'SIGNED' ? zigzag64(lo, hi) : signed64(lo, hi);
      }
    case 'bool': {
      expect(ctx, WIRE_VARINT, check);
      const [lo, hi] = rd.varint();
      return lo !== 0 || hi !== 0;
    }
    case 'float':
      expect(ctx, WIRE_I32, check);
      return rd.view(4).getFloat32(0, true);
    case 'double':
      expect(ctx, WIRE_I64, check);
      return rd.view(8).getFloat64(0, true);
    case 'str':
      expect(ctx, WIRE_LEN, check);
      return utf8d.decode(rd.bytes(rd.length()));
    case 'bytes':
      expect(ctx, WIRE_LEN, check);
      return Int8Array.from(rd.bytes(rd.length()), (b) => (b << 24) >> 24);
    case 'enum': {
      expect(ctx, WIRE_VARINT, check);
      const ordinal = rd.varint32() | 0;
      const values = (d as any).cls.$values;
      const e = values?.[ordinal];
      if (!e) throw new SerializationException(`${(d as any).cls.name} does not contain element with ordinal ${ordinal}`);
      return e;
    }
    case 'cls': {
      const cls = (d as any).cls;
      const inl = inlineField(d);
      if (inl) return new cls(readScalar(rd, inl.type, wire, field, intType, check, typeArgs));
      expect(ctx, WIRE_LEN, check);
      const n = rd.length();
      const sub = new Reader(rd.buf, rd.pos, rd.pos + n);
      rd.pos += n;
      return decodeMessage(sub, cls, ((d as any).args ?? []).map((a: Desc) => resolveParams(a, typeArgs)));
    }
    case 'any':
      // untyped (e.g. ByteArray without a `bytes` descriptor): best effort by wire type
      if (wire === WIRE_VARINT) {
        const [lo, hi] = rd.varint();
        return signed64(lo, hi);
      }
      if (wire === WIRE_I64) return rd.view(8).getFloat64(0, true);
      if (wire === WIRE_I32) return rd.view(4).getInt32(0, true);
      return Int8Array.from(rd.bytes(rd.length()), (b) => (b << 24) >> 24);
  }
  throw new SerializationException(`Unsupported protobuf type '${d.k}' for field ${field}`);
}

function readRepeatedInto(rd: Reader, list: any[], d: Desc, wire: number, field: number, intType: IntType, typeArgs: Desc[]): void {
  const el = resolveParams(elemOf(d), typeArgs);
  const ue = unwrap(el);
  if (isRepeated(ue) || ue.k === 'map') throw new SerializationException('Nested collections are not supported in protobuf');
  if (wire === WIRE_LEN && isPackable(ue)) {
    const n = rd.length();
    const sub = new Reader(rd.buf, rd.pos, rd.pos + n);
    rd.pos += n;
    const elemWire = ue.k === 'double' || (ue.k === 'long' && intType === 'FIXED') ? WIRE_I64 : ue.k === 'float' || (intType === 'FIXED' && ue.k === 'int') ? WIRE_I32 : WIRE_VARINT;
    while (!sub.exhausted()) list.push(readScalar(sub, el, elemWire, field, intType, false, typeArgs));
    return;
  }
  list.push(readScalar(rd, el, wire, field, intType, true, typeArgs));
}

function readMapEntry(rd: Reader, map: Map<any, any>, d: Desc, wire: number, field: number, typeArgs: Desc[]): void {
  expect({ wire, field }, WIRE_LEN, true);
  const n = rd.length();
  const sub = new Reader(rd.buf, rd.pos, rd.pos + n);
  rd.pos += n;
  let key: any = null;
  let value: any = null;
  while (!sub.exhausted()) {
    const tag = sub.varint32();
    const f = tag >>> 3;
    const w = tag & 7;
    if (f === 1) key = readScalar(sub, (d as any).key, w, f, 'DEFAULT', true, typeArgs);
    else if (f === 2) value = readScalar(sub, (d as any).value, w, f, 'DEFAULT', true, typeArgs);
    else sub.skip(w, f);
  }
  map.set(key, value);
}

/** Variants of a @ProtoOneOf field: field number -> [subclass, element index in it]. */
function oneOfVariants(d: Desc): Map<number, [any, number]> {
  const out = new Map<number, [any, number]>();
  const cls = (unwrap(d) as any).cls;
  const subs = cls?.$serial?.subclasses?.() ?? {};
  for (const sub of Object.values(subs) as any[]) {
    classInfo(sub).elems.forEach((e, i) => out.set(e.number, [sub, i]));
  }
  return out;
}

function decodeMessage(rd: Reader, cls: any, typeArgs: Desc[]): any {
  const ci = classInfo(cls);
  const { info, elems } = ci;
  if (info.object) return cls.$instance ? cls.$instance() : new cls();
  if (info.custom) throw new SerializationException(`Custom serializers are not supported in protobuf (${cls.name})`);
  if (info.subclasses) throw new SerializationException(`Polymorphic ${cls.name} is not supported in protobuf without @ProtoOneOf`);
  const values: any[] = new Array(elems.length).fill(undefined);
  const seen: boolean[] = new Array(elems.length).fill(false);
  const oneOfs: [number, Map<number, [any, number]>][] = [];
  elems.forEach((e, i) => {
    if (e.f.oneOf) oneOfs.push([i, oneOfVariants(e.f.type)]);
  });
  while (!rd.exhausted()) {
    const [lo, hi] = rd.varint();
    const header = hi * 4294967296 + lo;
    const field = Math.floor(header / 8);
    const wire = lo & 7;
    if (field === 0) throw new IOException('0 is not a valid protobuf field number, the input may be corrupted');
    const idx = ci.byNumber.get(field);
    if (idx === undefined || elems[idx].f.oneOf) {
      const variant = oneOfs.find(([, m]) => m.has(field));
      if (!variant) {
        rd.skip(wire, field);
        continue;
      }
      const [i, m] = variant;
      const [sub, si] = m.get(field)!;
      const subCi = classInfo(sub);
      const se = subCi.elems[si];
      const v = readScalar(rd, se.f.type, wire, field, se.intType, true, typeArgs);
      const args = new Array(subCi.ctorCount).fill(undefined);
      if (se.ctorIndex >= 0) args[se.ctorIndex] = v;
      const inst = new sub(...args);
      if (se.ctorIndex < 0) inst[se.f.name] = v;
      values[i] = inst;
      seen[i] = true;
      continue;
    }
    const e = elems[idx];
    const t = resolveParams(unwrap(e.f.type), typeArgs);
    seen[idx] = true;
    if (isRepeated(t)) {
      if (!Array.isArray(values[idx])) values[idx] = [];
      readRepeatedInto(rd, values[idx], t, wire, field, e.intType, typeArgs);
    } else if (t.k === 'map') {
      if (!(values[idx] instanceof Map)) values[idx] = new Map();
      readMapEntry(rd, values[idx], t, wire, field, typeArgs);
    } else values[idx] = readScalar(rd, t, wire, field, e.intType, true, typeArgs);
  }
  const ctorArgs: any[] = new Array(ci.ctorCount).fill(undefined);
  const body: [string, any][] = [];
  elems.forEach((e, i) => {
    let v = values[i];
    const t = resolveParams(unwrap(e.f.type), typeArgs);
    if (seen[i] && t.k === 'set') v = new Set(v);
    if (!seen[i]) {
      if (e.f.type.k === 'nullable') v = null;
      else if (isRepeated(t)) v = t.k === 'set' ? new Set() : [];
      else if (!e.f.optional) throw new MissingFieldException(`Field '${e.f.name}' is required for type with serial name '${info.serialName ?? cls.name}', but it was missing`);
    }
    if (e.ctorIndex >= 0) ctorArgs[e.ctorIndex] = v;
    else if (v !== undefined) body.push([e.f.name, v]);
  });
  const obj = new cls(...ctorArgs);
  for (const [k, v] of body) obj[k] = v;
  return obj;
}

function toU8(bytes: any): Uint8Array {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof Int8Array) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes, (b) => b & 0xff);
  throw new SerializationException(`Expected a ByteArray, got ${typeof bytes}`);
}

/** Decodes a whole protobuf message (or a kotlinx root list: count, then untagged elements). */
export function decodeProtoBytes(bytes: any, desc: Desc): any {
  const rd = new Reader(toU8(bytes));
  const d = unwrap(desc ?? T.any);
  if (d.k === 'cls') return decodeMessage(rd, (d as any).cls, (d as any).args ?? []);
  if (isRepeated(d)) {
    const out: any[] = [];
    if (rd.exhausted()) return d.k === 'set' ? new Set() : out;
    const count = rd.varint32();
    const el = unwrap(elemOf(d));
    for (let i = 0; i < count; i++) {
      const wire = el.k === 'cls' && !inlineField(el) ? WIRE_LEN : el.k === 'str' || el.k === 'bytes' ? WIRE_LEN : el.k === 'double' ? WIRE_I64 : el.k === 'float' ? WIRE_I32 : WIRE_VARINT;
      out.push(readScalar(rd, el, wire, -1, 'DEFAULT', false, []));
    }
    return d.k === 'set' ? new Set(out) : out;
  }
  throw new SerializationException(`Protobuf root must be a message or a list, got '${d.k}'`);
}

// ---------- encoding ----------

function inferDesc(v: any): Desc {
  if (typeof v === 'string') return T.str;
  if (typeof v === 'boolean') return T.bool;
  if (typeof v === 'number') return Number.isInteger(v) ? T.long : T.double;
  if (v instanceof Int8Array || v instanceof Uint8Array) return T.bytes;
  if (Array.isArray(v)) return T.list(v.length ? inferDesc(v[0]) : T.any);
  if (v instanceof Set) return T.set(v.size ? inferDesc(v.values().next().value) : T.any);
  if (v instanceof Map) return T.map(T.any, T.any);
  const C = v?.constructor;
  if (C?.$enum) return { k: 'enum', cls: C };
  if (C?.$serial) return T.cls(C);
  return T.any;
}

function writeField(w: Writer, field: number, d0: Desc, v: any, intType: IntType, packed: boolean, encodeDefaults: boolean, typeArgs: Desc[]): void {
  if (v === null || v === undefined) return;
  let d = resolveParams(unwrap(d0), typeArgs);
  if (d.k === 'any') d = inferDesc(v);
  if (isRepeated(d)) {
    const el = resolveParams(elemOf(d), typeArgs);
    const items = [...v];
    if (packed && isPackedWhenWritten(unwrap(el))) {
      const inner = new Writer();
      for (const x of items) writeScalar(inner, -1, el, x, intType, encodeDefaults, typeArgs);
      if (inner.len) {
        w.tag(field, WIRE_LEN);
        w.lengthDelimited(inner.result());
      }
      return;
    }
    for (const x of items) writeField(w, field, el, x, intType, false, encodeDefaults, typeArgs);
    return;
  }
  if (d.k === 'map') {
    for (const [k, x] of v as Map<any, any>) {
      const entry = new Writer();
      writeField(entry, 1, (d as any).key, k, 'DEFAULT', false, encodeDefaults, typeArgs);
      writeField(entry, 2, (d as any).value, x, 'DEFAULT', false, encodeDefaults, typeArgs);
      w.tag(field, WIRE_LEN);
      w.lengthDelimited(entry.result());
    }
    return;
  }
  writeScalar(w, field, d, v, intType, encodeDefaults, typeArgs);
}

/** field < 0: no tag (packed element or root list element). */
function writeScalar(w: Writer, field: number, d0: Desc, v: any, intType: IntType, encodeDefaults: boolean, typeArgs: Desc[]): void {
  let d = resolveParams(unwrap(d0), typeArgs);
  if (d.k === 'any') d = inferDesc(v);
  const tagged = field >= 0;
  const tag = (wire: number) => tagged && w.tag(field, wire);
  switch (d.k) {
    case 'int':
    case 'char':
    case 'long': {
      const n = d.k === 'char' ? str(v).charCodeAt(0) : Number(v);
      const is64 = d.k === 'long';
      if (intType === 'FIXED') {
        if (is64) {
          tag(WIRE_I64);
          w.fixed64((dv) => dv.setBigInt64(0, BigInt.asIntN(64, BigInt(Math.trunc(n))), true));
        } else {
          tag(WIRE_I32);
          w.fixed32((dv) => dv.setInt32(0, n | 0, true));
        }
        return;
      }
      tag(WIRE_VARINT);
      if (intType === 'SIGNED') {
        if (is64) {
          const b = BigInt(Math.trunc(n));
          w.varint64(Number(BigInt.asUintN(64, (b << 1n) ^ (b >> 63n))));
          return;
        }
        w.varint32(((n << 1) ^ (n >> 31)) >>> 0);
        return;
      }
      w.varint64(is64 ? Math.trunc(n) : n | 0);
      return;
    }
    case 'bool':
      tag(WIRE_VARINT);
      w.byte(v ? 1 : 0);
      return;
    case 'float':
      tag(WIRE_I32);
      w.fixed32((dv) => dv.setFloat32(0, Number(v), true));
      return;
    case 'double':
      tag(WIRE_I64);
      w.fixed64((dv) => dv.setFloat64(0, Number(v), true));
      return;
    case 'str':
      tag(WIRE_LEN);
      w.lengthDelimited(utf8.encode(str(v)));
      return;
    case 'bytes':
      tag(WIRE_LEN);
      w.lengthDelimited(toU8(v));
      return;
    case 'enum':
      tag(WIRE_VARINT);
      w.varint64(v.ordinal);
      return;
    case 'cls': {
      const inl = inlineField(d);
      if (inl) return writeScalar(w, field, inl.type, v[inl.name], intType, encodeDefaults, typeArgs);
      const inner = new Writer();
      encodeMessage(inner, v, (d as any).cls, encodeDefaults, ((d as any).args ?? []).map((a: Desc) => resolveParams(a, typeArgs)));
      tag(WIRE_LEN);
      w.lengthDelimited(inner.result());
      return;
    }
  }
  throw new SerializationException(`Unsupported protobuf type '${d.k}'`);
}

function encodeMessage(w: Writer, value: any, cls0: any, encodeDefaults: boolean, typeArgs: Desc[]): void {
  // a subclass instance encoded through its declared base: use the runtime class
  const cls = value?.constructor?.$serial && value.constructor !== cls0 && value instanceof cls0 ? value.constructor : cls0;
  const ci = classInfo(cls);
  if (ci.info.object) return;
  if (ci.info.custom) throw new SerializationException(`Custom serializers are not supported in protobuf (${cls.name})`);
  if (ci.info.subclasses && !(value instanceof cls && value.constructor !== cls)) throw new SerializationException(`Polymorphic ${cls.name} is not supported in protobuf without @ProtoOneOf`);
  let defaults: any = undefined;
  for (const e of ci.elems) {
    const v = value[e.f.name];
    if (e.f.optional && !encodeDefaults && !e.f.encodeDefault) {
      if (defaults === undefined) defaults = defaultsOf(cls, ci);
      if (defaults !== null && eq(v, defaults[e.f.name])) continue;
    }
    if (v === null || v === undefined) continue;
    if (e.f.oneOf) {
      // the chosen variant's own fields are written straight into this message
      encodeMessage(w, v, v.constructor, encodeDefaults, []);
      continue;
    }
    writeField(w, e.number, e.f.type, v, e.intType, !!e.f.packed, encodeDefaults, typeArgs);
  }
}

export function encodeProtoBytes(value: any, desc: Desc | null | undefined, encodeDefaults = false): Int8Array {
  const w = new Writer();
  let d = unwrap(desc ?? T.any);
  if (d.k === 'any') d = inferDesc(value);
  if (d.k === 'cls') encodeMessage(w, value, (d as any).cls, encodeDefaults, (d as any).args ?? []);
  else if (isRepeated(d)) {
    const items = [...value];
    w.varint64(items.length);
    const el = elemOf(d);
    for (const x of items) writeScalar(w, -1, el.k === 'any' ? inferDesc(x) : el, x, 'DEFAULT', encodeDefaults, []);
  } else throw new SerializationException(`Protobuf root must be a message or a list, got '${d.k}'`);
  const out = w.result();
  return new Int8Array(out.buffer, out.byteOffset, out.byteLength);
}

// ---------- kotlinx.serialization.protobuf.ProtoBuf ----------

const isDescLike = (x: any) => !!x && typeof x === 'object' && !(x instanceof Named) && typeof x.k === 'string';

function toDesc(d: any): Desc {
  if (isDescLike(d)) return d;
  if (typeof d === 'function' && d.$serial) return T.cls(d);
  return T.any;
}

export interface ProtoBufConfig {
  encodeDefaults: boolean;
}

export class ProtoBuf {
  constructor(readonly config: ProtoBufConfig = { encodeDefaults: false }) {}
  static Default = new ProtoBuf();
  /** `ProtoBuf { encodeDefaults = true }` / `ProtoBuf(from) { ... }` */
  static $invoke = Object.assign((a?: any, b?: any) => ProtoBuf.build(a, b), { $recvLambda: true });
  static build(a?: any, b?: any): ProtoBuf {
    const from: ProtoBuf = a instanceof ProtoBuf ? a : ProtoBuf.Default;
    const fn = typeof a === 'function' ? a : b;
    const cfg = { ...from.config };
    if (fn) fn(cfg);
    return new ProtoBuf(cfg);
  }
  get encodeDefaults(): boolean {
    return this.config.encodeDefaults;
  }
  /** encodeToByteArray(serializer, value) or encodeToByteArray(value[, reified desc]) */
  encodeToByteArray(a: any, b?: any): Int8Array {
    if (b === undefined) return encodeProtoBytes(a, null, this.config.encodeDefaults);
    if (isDescLike(a) || (typeof a === 'function' && a.$serial)) return encodeProtoBytes(b, toDesc(a), this.config.encodeDefaults);
    return encodeProtoBytes(a, toDesc(b), this.config.encodeDefaults);
  }
  /** decodeFromByteArray(deserializer, bytes) or decodeFromByteArray(bytes, reified desc) */
  decodeFromByteArray(a: any, b?: any): any {
    const aBytes = a instanceof Int8Array || a instanceof Uint8Array || Array.isArray(a);
    return aBytes ? decodeProtoBytes(a, toDesc(b)) : decodeProtoBytes(b, toDesc(a));
  }
  decodeFromHexString(a: any, b?: any): any {
    const [hex, d] = typeof a === 'string' ? [a, b] : [b, a];
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return decodeProtoBytes(bytes, toDesc(d));
  }
  encodeToHexString(a: any, b?: any): string {
    return Array.from(toU8(this.encodeToByteArray(a, b)), (x) => x.toString(16).padStart(2, '0')).join('');
  }
}
(ProtoBuf as any).Companion = ProtoBuf.Default;

export const ProtoIntegerType = { DEFAULT: 'DEFAULT', SIGNED: 'SIGNED', FIXED: 'FIXED' };

// ---------- keiyoushi.utils (Protobuf.kt) ----------

export const protoInstance = ProtoBuf.Default;
export const PROTOBUF_MEDIA_TYPE = MediaType.get('application/protobuf');

/** Splits trailing reified descriptor from the user arguments. */
function split(args: any[]): { rest: any[]; desc: Desc } {
  const a = [...args];
  const desc = a.length && isDescLike(a[a.length - 1]) ? a.pop() : T.any;
  return { rest: a, desc };
}

function protoOf(rest: any[]): ProtoBuf {
  for (const x of rest) {
    if (x instanceof ProtoBuf) return x;
    if (x instanceof Named && x.values.proto instanceof ProtoBuf) return x.values.proto;
  }
  return protoInstance;
}

function sourceBytes(src: any): Uint8Array {
  if (src instanceof Uint8Array || src instanceof Int8Array) return toU8(src);
  if (src && typeof src.readAll === 'function') return src.readAll();
  if (src && typeof src.readByteArray === 'function') return toU8(src.readByteArray());
  if (src && typeof src.readBytes === 'function') return toU8(src.readBytes());
  throw new SerializationException('Cannot read protobuf bytes from source');
}

const isBytes = (x: any) => x instanceof Int8Array || x instanceof Uint8Array;

const parseAsProto: ExtDef[] = [
  {
    name: 'parseAsProto',
    recv: (x) => x instanceof Response,
    reified: 'desc',
    params: ['transform'],
    fn: (r: Response, ...args: any[]) => {
      const { rest, desc } = split(args);
      const transform = rest.find((x) => typeof x === 'function') ?? (rest.find((x) => x instanceof Named) as Named | undefined)?.values.transform;
      try {
        const source = r.body.source();
        return decodeProtoBytes(sourceBytes(typeof transform === 'function' ? transform(source) : source), desc);
      } finally {
        r.close();
      }
    },
  },
  {
    name: 'parseAsProto',
    recv: (x) => x instanceof ResponseBody,
    reified: 'desc',
    fn: (b: ResponseBody, ...args: any[]) => {
      try {
        return decodeProtoBytes(b.raw, split(args).desc);
      } finally {
        b.close();
      }
    },
  },
];

const decodeProto: ExtDef[] = [
  {
    name: 'decodeProto',
    recv: isBytes,
    reified: 'desc',
    params: ['proto'],
    fn: (bytes: any, ...args: any[]) => {
      const { rest, desc } = split(args);
      return protoOf(rest).decodeFromByteArray(bytes, desc);
    },
  },
  {
    name: 'decodeProto',
    recv: (x) => x instanceof BufferedSource,
    reified: 'desc',
    params: ['byteCount'],
    fn: (src: BufferedSource, ...args: any[]) => {
      const { rest, desc } = split(args);
      const n = rest.find((x) => typeof x === 'number') ?? (rest.find((x) => x instanceof Named) as Named | undefined)?.values.byteCount ?? -1;
      return decodeProtoBytes(n >= 0 ? toU8(src.readByteArray(n)) : src.readAll(), desc);
    },
  },
];

const encodeProto: ExtDef[] = [
  {
    // BufferedSink.encodeProto(value, encodeDefaults = false)
    name: 'encodeProto',
    recv: (x) => x instanceof OkBuffer,
    reified: 'desc',
    params: ['value', 'encodeDefaults'],
    fn: (sink: OkBuffer, ...args: any[]) => {
      const { rest, desc } = split(args);
      const n = rest[rest.length - 1] instanceof Named ? (rest.pop() as Named).values : {};
      const value = rest[0] ?? n.value;
      const encodeDefaults = rest[1] ?? n.encodeDefaults ?? false;
      sink.write(encodeProtoBytes(value, desc, encodeDefaults));
    },
  },
  {
    name: 'encodeProto',
    recv: (x) => x !== null && x !== undefined,
    reified: 'desc',
    params: ['proto'],
    fn: (v: any, ...args: any[]) => {
      const { rest, desc } = split(args);
      return protoOf(rest).encodeToByteArray(desc, v);
    },
  },
];

class ProtoRequestBody extends RequestBody {
  contentLength(): number {
    return -1;
  }
}

const toRequestBodyProto: ExtDef = {
  name: 'toRequestBodyProto',
  recv: (x) => x !== null && x !== undefined,
  reified: 'desc',
  params: ['mediaType', 'encodeDefaults'],
  fn: (v: any, ...args: any[]) => {
    const { rest, desc } = split(args);
    const n = rest[rest.length - 1] instanceof Named ? (rest.pop() as Named).values : {};
    const mediaType = rest[0] ?? n.mediaType ?? PROTOBUF_MEDIA_TYPE;
    const encodeDefaults = rest[1] ?? n.encodeDefaults ?? false;
    return new ProtoRequestBody(toU8(encodeProtoBytes(v, desc, encodeDefaults)), mediaType);
  },
};

const decodeProtoBase64: ExtDef = {
  name: 'decodeProtoBase64',
  recv: isStr,
  reified: 'desc',
  params: ['proto'],
  fn: (s: string, ...args: any[]) => {
    const { rest, desc } = split(args);
    return protoOf(rest).decodeFromByteArray(AndroidBase64.decode(s, AndroidBase64.NO_WRAP), desc);
  },
};

const encodeProtoBase64: ExtDef = {
  name: 'encodeProtoBase64',
  recv: (x) => x !== null && x !== undefined,
  reified: 'desc',
  params: ['proto'],
  fn: (v: any, ...args: any[]) => {
    const { rest, desc } = split(args);
    return AndroidBase64.encodeToString(protoOf(rest).encodeToByteArray(desc, v), AndroidBase64.NO_WRAP);
  },
};

// kotlinx.serialization.encodeToByteArray / decodeFromByteArray (reified BinaryFormat extensions)
const encodeToByteArray: ExtDef = {
  name: 'encodeToByteArray',
  recv: (x) => x instanceof ProtoBuf,
  reified: 'desc',
  fn: (p: ProtoBuf, value: any, desc?: any) => p.encodeToByteArray(toDesc(desc), value),
};
const decodeFromByteArray: ExtDef = {
  name: 'decodeFromByteArray',
  recv: (x) => x instanceof ProtoBuf,
  reified: 'desc',
  fn: (p: ProtoBuf, bytes: any, desc?: any) => p.decodeFromByteArray(bytes, desc),
};

export const protobufModules: Record<string, unknown> = {
  'keiyoushi.utils.protoInstance': protoInstance,
  'keiyoushi.utils.PROTOBUF_MEDIA_TYPE': PROTOBUF_MEDIA_TYPE,
  'keiyoushi.utils.parseAsProto': parseAsProto,
  'keiyoushi.utils.decodeProto': decodeProto,
  'keiyoushi.utils.encodeProto': encodeProto,
  'keiyoushi.utils.toRequestBodyProto': [toRequestBodyProto],
  'keiyoushi.utils.decodeProtoBase64': [decodeProtoBase64],
  'keiyoushi.utils.encodeProtoBase64': [encodeProtoBase64],
  'kotlinx.serialization.protobuf.ProtoBuf': ProtoBuf,
  'kotlinx.serialization.protobuf.ProtoIntegerType': ProtoIntegerType,
  // String.encodeToByteArray() (stdlib) stays reachable when this import shadows the name
  'kotlinx.serialization.encodeToByteArray': [encodeToByteArray, { name: 'encodeToByteArray', recv: isStr, fn: (s: string) => Int8Array.from(utf8.encode(s), (b) => (b << 24) >> 24) }],
  'kotlinx.serialization.decodeFromByteArray': [decodeFromByteArray],
  'kotlinx.serialization.builtins.ByteArraySerializer': () => T.bytes,
};

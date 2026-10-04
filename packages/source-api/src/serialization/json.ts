// kotlinx.serialization (JSON) - element tree, typed decoding via type descriptors emitted by the
// translator for reified calls (`parseAs<List<Dto>>()`), and encoding by walking values.

import { IllegalArgumentException, isCatch, NumberFormatException, SerializationException, str } from '../kotlin/core';
import { Named } from '../kotlin/named';

// ---------- element tree ----------

export abstract class JsonElement {
  static $is(x: unknown): boolean {
    return x instanceof JsonObject || x instanceof JsonArray || x instanceof JsonPrimitive;
  }
}

export class JsonPrimitive {
  constructor(
    /** Raw content (for strings: the unquoted text). */
    readonly content: string,
    readonly isString: boolean,
  ) {}
  static of(v: any): JsonPrimitive {
    if (v === null || v === undefined) return JsonNull;
    if (typeof v === 'string') return new JsonPrimitive(v, true);
    if (typeof v === 'boolean' || typeof v === 'number') return new JsonPrimitive(String(v), false);
    return new JsonPrimitive(str(v), true);
  }
  get contentOrNull(): string | null {
    return this === JsonNull ? null : this.content;
  }
  toString(): string {
    return this.isString ? JSON.stringify(this.content) : this.content;
  }
  equals(o: any): boolean {
    return o instanceof JsonPrimitive && o.content === this.content && o.isString === this.isString;
  }
  hashCode(): number {
    return 0;
  }
  toJS(): any {
    if (this === JsonNull) return null;
    if (this.isString) return this.content;
    if (this.content === 'true') return true;
    if (this.content === 'false') return false;
    return Number(this.content);
  }
}
(JsonPrimitive as any).$params = ['value'];

class JsonNullImpl extends JsonPrimitive {
  constructor() {
    super('null', false);
  }
}
export const JsonNull: JsonPrimitive = new JsonNullImpl();
(JsonNull as any).$is = (x: unknown) => x === JsonNull;

/** JsonObject is a Map<String, JsonElement> so Kotlin map operations apply directly. */
export class JsonObject extends Map<string, any> {
  constructor(entries?: any) {
    super();
    if (entries instanceof Map) for (const [k, v] of entries) super.set(k, v);
    else if (entries) for (const [k, v] of Object.entries(entries)) super.set(k, v);
  }
  toString(): string {
    return '{' + [...this].map(([k, v]) => JSON.stringify(k) + ':' + str(v)).join(',') + '}';
  }
  equals(o: any): boolean {
    return o instanceof JsonObject && o.toString() === this.toString();
  }
  hashCode(): number {
    return 0;
  }
  toJS(): any {
    const o: Record<string, any> = {};
    for (const [k, v] of this) o[k] = elementToJS(v);
    return o;
  }
}

/** JsonArray is a List<JsonElement>. */
export class JsonArray extends Array<any> {
  static from$(xs: any[]): JsonArray {
    const a = new JsonArray();
    for (const x of xs) a.push(x);
    return a;
  }
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }
  toString(): string {
    return '[' + this.map((v) => str(v)).join(',') + ']';
  }
  equals(o: any): boolean {
    return o instanceof JsonArray && o.toString() === this.toString();
  }
  hashCode(): number {
    return 0;
  }
  toJS(): any {
    return this.map(elementToJS);
  }
}

export function elementToJS(e: any): any {
  if (e instanceof JsonObject || e instanceof JsonArray || e instanceof JsonPrimitive) return e.toJS();
  return e;
}

/** Plain JS value (from JSON.parse) -> element tree. */
export function toElement(v: any): any {
  if (v === null || v === undefined) return JsonNull;
  if (v instanceof JsonObject || v instanceof JsonArray || v instanceof JsonPrimitive) return v;
  if (Array.isArray(v)) return JsonArray.from$(v.map(toElement));
  if (typeof v === 'object') {
    const o = new JsonObject();
    for (const k of Object.keys(v)) Map.prototype.set.call(o, k, toElement(v[k]));
    return o;
  }
  if (typeof v === 'number') return new JsonPrimitive(numberText(v), false);
  return JsonPrimitive.of(v);
}

function numberText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

// Accessors (kotlinx.serialization.json extension properties).
export function jsonObject(e: any): JsonObject {
  if (e instanceof JsonObject) return e;
  throw new IllegalArgumentException(`Element ${describeEl(e)} is not a JsonObject`);
}
export function jsonArray(e: any): JsonArray {
  if (e instanceof JsonArray) return e;
  throw new IllegalArgumentException(`Element ${describeEl(e)} is not a JsonArray`);
}
export function jsonPrimitive(e: any): JsonPrimitive {
  if (e instanceof JsonPrimitive) return e;
  throw new IllegalArgumentException(`Element ${describeEl(e)} is not a JsonPrimitive`);
}
export function jsonNull(e: any): JsonPrimitive {
  if (e === JsonNull) return e;
  throw new IllegalArgumentException(`Element ${describeEl(e)} is not a JsonNull`);
}
function describeEl(e: any): string {
  return e?.constructor?.name ?? String(e);
}
export function primInt(p: JsonPrimitive): number {
  const v = primIntOrNull(p);
  if (v === null) throw new NumberFormatException(`Invalid number format: '${p.content}'`);
  return v;
}
export function primIntOrNull(p: JsonPrimitive): number | null {
  if (p === JsonNull) return null;
  return /^-?\d+$/.test(p.content) ? parseInt(p.content, 10) : null;
}
export function primDouble(p: JsonPrimitive): number {
  const v = primDoubleOrNull(p);
  if (v === null) throw new NumberFormatException(`Invalid number format: '${p.content}'`);
  return v;
}
export function primDoubleOrNull(p: JsonPrimitive): number | null {
  if (p === JsonNull) return null;
  const n = Number(p.content);
  return p.content.trim() !== '' && !Number.isNaN(n) ? n : null;
}
export function primBoolean(p: JsonPrimitive): boolean {
  const v = primBooleanOrNull(p);
  if (v === null) throw new IllegalStateException2(`${p.content} does not represent a Boolean`);
  return v;
}
export function primBooleanOrNull(p: JsonPrimitive): boolean | null {
  const c = p.content.toLowerCase();
  return c === 'true' ? true : c === 'false' ? false : null;
}
class IllegalStateException2 extends IllegalArgumentException {}

// ---------- builders ----------

export class JsonObjectBuilder {
  readonly map = new Map<string, any>();
  put(key: string, value: any): any {
    const prev = this.map.get(key) ?? null;
    this.map.set(key, value instanceof JsonObject || value instanceof JsonArray || value instanceof JsonPrimitive ? value : JsonPrimitive.of(value));
    return prev;
  }
  build(): JsonObject {
    return new JsonObject(this.map);
  }
}

export class JsonArrayBuilder {
  readonly list: any[] = [];
  add(value: any): boolean {
    this.list.push(value instanceof JsonObject || value instanceof JsonArray || value instanceof JsonPrimitive ? value : JsonPrimitive.of(value));
    return true;
  }
  addAll(values: any): boolean {
    for (const v of values) this.add(v);
    return true;
  }
  build(): JsonArray {
    return JsonArray.from$(this.list);
  }
}

// ---------- type descriptors ----------

export type Desc =
  | { k: 'str' | 'int' | 'long' | 'double' | 'float' | 'bool' | 'char' | 'unit' | 'any' }
  | { k: 'element' | 'object' | 'array' | 'primitive' }
  | { k: 'list' | 'set'; of: Desc }
  | { k: 'array$'; of: Desc }
  | { k: 'map'; key: Desc; value: Desc }
  | { k: 'pair'; a: Desc; b: Desc }
  | { k: 'nullable'; of: Desc }
  | { k: 'cls'; cls: any; args?: Desc[] }
  | { k: 'enum'; cls: any }
  | { k: 'custom'; ser: any }
  | { k: 'typeParam'; i: number };

export const T = {
  str: { k: 'str' } as Desc,
  int: { k: 'int' } as Desc,
  long: { k: 'long' } as Desc,
  double: { k: 'double' } as Desc,
  float: { k: 'float' } as Desc,
  bool: { k: 'bool' } as Desc,
  char: { k: 'char' } as Desc,
  unit: { k: 'unit' } as Desc,
  any: { k: 'any' } as Desc,
  element: { k: 'element' } as Desc,
  object: { k: 'object' } as Desc,
  array: { k: 'array' } as Desc,
  primitive: { k: 'primitive' } as Desc,
  list: (of: Desc): Desc => ({ k: 'list', of }),
  set: (of: Desc): Desc => ({ k: 'set', of }),
  arr: (of: Desc): Desc => ({ k: 'array$', of }),
  map: (key: Desc, value: Desc): Desc => ({ k: 'map', key, value }),
  pair: (a: Desc, b: Desc): Desc => ({ k: 'pair', a, b }),
  nullable: (of: Desc): Desc => ({ k: 'nullable', of }),
  cls: (cls: any, ...args: Desc[]): Desc => (cls?.$enum ? { k: 'enum', cls } : { k: 'cls', cls, args }),
  custom: (ser: any): Desc => ({ k: 'custom', ser }),
  param: (i: number): Desc => ({ k: 'typeParam', i }),
};

/**
 * Serializable class metadata emitted by the translator:
 *   static $serial = { fields: [{ name, json, alt?, type, optional, nullable }], sealed?, discriminator? }
 * Constructor parameters follow `fields` order.
 */
export interface SerialField {
  name: string;
  json: string;
  alt?: string[];
  type: Desc;
  optional: boolean;
  /** body property (not a constructor parameter) */
  body?: boolean;
}
export interface SerialInfo {
  fields: SerialField[];
  serialName?: string;
  /** subclasses of a sealed/polymorphic base, keyed by serial name */
  subclasses?: () => Record<string, any>;
  discriminator?: string;
  /** class-level custom serializer (@Serializable(with = X::class)) */
  custom?: () => any;
  object?: boolean;
}

export interface JsonConfig {
  ignoreUnknownKeys: boolean;
  isLenient: boolean;
  explicitNulls: boolean;
  coerceInputValues: boolean;
  encodeDefaults: boolean;
  classDiscriminator: string;
  prettyPrint: boolean;
  allowSpecialFloatingPointValues: boolean;
  useAlternativeNames: boolean;
  decodeEnumsCaseInsensitive: boolean;
  namingStrategy: any;
}

const DEFAULT_CONFIG: JsonConfig = {
  ignoreUnknownKeys: true,
  isLenient: true,
  explicitNulls: false,
  coerceInputValues: true,
  encodeDefaults: true,
  classDiscriminator: 'type',
  prettyPrint: false,
  allowSpecialFloatingPointValues: true,
  useAlternativeNames: true,
  decodeEnumsCaseInsensitive: false,
  namingStrategy: null,
};

export class MissingFieldException extends SerializationException {}

export class Json {
  constructor(readonly config: JsonConfig = DEFAULT_CONFIG) {}

  static Default = new Json();

  /** Kotlin `Json { ... }` / `Json(from) { ... }` - a function call, not a constructor. */
  static $invoke = Object.assign((a?: any, b?: any) => Json.build(a, b), { $recvLambda: true });

  /** `Json { ignoreUnknownKeys = true }` - the builder receives a mutable config. */
  static build(a?: any, b?: any): Json {
    const from: Json = a instanceof Json ? a : Json.Default;
    const fn = typeof a === 'function' ? a : b;
    const cfg = { ...from.config };
    if (fn) fn(cfg);
    return new Json(cfg);
  }

  parseToJsonElement(s: string): any {
    return toElement(parseJsonText(s, this.config.isLenient));
  }

  decodeFromString(a: any, b?: any): any {
    // decodeFromString<T>(string) -> (string, desc); decodeFromString(serializer, string)
    const [text, desc] = typeof a === 'string' ? [a, b] : [b, a];
    return decodeValue(parseJsonText(str(text), this.config.isLenient), toDesc(desc), this.config, []);
  }

  decodeFromJsonElement(a: any, b?: any): any {
    const isDescFirst = a && (a.k || a.$serializer || a.deserialize);
    const [el, desc] = isDescFirst ? [b, a] : [a, b];
    return decodeValue(elementToJS(el), toDesc(desc), this.config, []);
  }

  decodeFromStream(a: any, b?: any): any {
    const isDescFirst = a && (a.k || a.$serializer || a.deserialize);
    const [stream, desc] = isDescFirst ? [b, a] : [a, b];
    const text = typeof stream.readUtf8 === 'function' ? stream.readUtf8() : new TextDecoder().decode(stream.readBytes());
    return this.decodeFromString(text, desc);
  }

  encodeToString(a: any, b?: any): string {
    const value = b === undefined ? a : isDescLike(a) ? b : a;
    const js = encodeValue(value, this.config);
    return JSON.stringify(js, null, this.config.prettyPrint ? 4 : undefined);
  }

  encodeToJsonElement(a: any, b?: any): any {
    const value = b === undefined ? a : isDescLike(a) ? b : a;
    return toElement(encodeValue(value, this.config));
  }
}
(Json as any).Companion = Json.Default;

function isDescLike(x: any): boolean {
  return !!x && typeof x === 'object' && (typeof x.k === 'string' || typeof x.serialize === 'function' || typeof x.deserialize === 'function');
}

function toDesc(d: any): Desc {
  if (!d) return T.any;
  if (typeof d.k === 'string') return d;
  if (typeof d.deserialize === 'function') return T.custom(d);
  if (typeof d === 'function' && d.$serial) return T.cls(d);
  return T.any;
}

/** Lenient parse: kotlinx accepts unquoted keys/strings in lenient mode; we accept standard JSON. */
export function parseJsonText(s: string, _lenient: boolean): any {
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new SerializationException(`Unexpected JSON token: ${(e as Error).message}\nJSON input: ${s.slice(0, 200)}`);
  }
}

// ---------- decoding ----------

function decodeValue(v: any, d: Desc, cfg: JsonConfig, typeArgs: Desc[]): any {
  switch (d.k) {
    case 'typeParam':
      return decodeValue(v, typeArgs[(d as any).i] ?? T.any, cfg, []);
    case 'nullable':
      if (v === null || v === undefined) return null;
      return decodeValue(v, (d as any).of, cfg, typeArgs);
    case 'any':
      return v;
    case 'element':
    case 'object':
    case 'array':
    case 'primitive': {
      const el = toElement(v);
      if (d.k === 'object' && !(el instanceof JsonObject)) throw new SerializationException(`Expected JsonObject, got ${describeEl(el)}`);
      if (d.k === 'array' && !(el instanceof JsonArray)) throw new SerializationException(`Expected JsonArray, got ${describeEl(el)}`);
      return el;
    }
    case 'unit':
      return undefined;
  }
  if (v === null || v === undefined) throw new SerializationException(`Expected ${d.k} but found null`);
  switch (d.k) {
    case 'str':
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') {
        if (cfg.isLenient) return String(v);
      }
      throw new SerializationException(`Expected string literal but found ${JSON.stringify(v)}`);
    case 'char':
      return str(v).charAt(0);
    case 'int':
    case 'long': {
      const n = typeof v === 'string' && cfg.isLenient ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isFinite(n) || (typeof v === 'string' && v.trim() === '')) throw new SerializationException(`Expected number but found ${JSON.stringify(v)}`);
      if (!Number.isInteger(n)) throw new SerializationException(`Unexpected JSON token: expected integer, got ${n}`);
      return n;
    }
    case 'double':
    case 'float': {
      const n = typeof v === 'string' && cfg.isLenient ? Number(v) : v;
      if (typeof n !== 'number' || Number.isNaN(n)) throw new SerializationException(`Expected number but found ${JSON.stringify(v)}`);
      return n;
    }
    case 'bool':
      if (typeof v === 'boolean') return v;
      if (cfg.isLenient && (v === 'true' || v === 'false')) return v === 'true';
      throw new SerializationException(`Expected boolean but found ${JSON.stringify(v)}`);
    case 'list':
    case 'array$':
    case 'set': {
      if (!Array.isArray(v)) throw new SerializationException(`Expected JSON array but found ${typeof v}`);
      const out = v.map((x) => decodeValue(x, (d as any).of, cfg, typeArgs));
      return d.k === 'set' ? new Set(out) : out;
    }
    case 'map': {
      if (typeof v !== 'object' || Array.isArray(v)) throw new SerializationException('Expected JSON object for map');
      const m = new Map();
      for (const k of Object.keys(v)) m.set(decodeKey(k, (d as any).key), decodeValue(v[k], (d as any).value, cfg, typeArgs));
      return m;
    }
    case 'pair': {
      return new (require$Pair())(decodeValue(v.first, (d as any).a, cfg, typeArgs), decodeValue(v.second, (d as any).b, cfg, typeArgs));
    }
    case 'enum':
      return decodeEnum(v, (d as any).cls, cfg);
    case 'custom':
      return runCustomDeserializer((d as any).ser, v, cfg);
    case 'cls':
      return decodeClass(v, (d as any).cls, cfg, ((d as any).args ?? []).map((a: Desc) => (a.k === 'typeParam' ? typeArgs[(a as any).i] ?? T.any : a)));
  }
  return v;
}

let PairCtor: any = null;
export function setPairCtor(P: any): void {
  PairCtor = P;
}
function require$Pair(): any {
  return PairCtor;
}

function decodeKey(k: string, d: Desc): any {
  if (d.k === 'int' || d.k === 'long' || d.k === 'double' || d.k === 'float') return Number(k);
  if (d.k === 'bool') return k === 'true';
  if (d.k === 'enum') return (d as any).cls.$values.find((e: any) => serialNameOfEnum(e) === k);
  return k;
}

function serialNameOfEnum(e: any): string {
  return e.constructor.$serialNames?.[e.name] ?? e.name;
}

function decodeEnum(v: any, cls: any, cfg: JsonConfig): any {
  const s = str(v);
  const found = cls.$values.find((e: any) => serialNameOfEnum(e) === s) ?? (cfg.decodeEnumsCaseInsensitive ? cls.$values.find((e: any) => serialNameOfEnum(e).toLowerCase() === s.toLowerCase()) : undefined);
  if (!found) throw new SerializationException(`${cls.name} does not contain element with name '${s}'`);
  return found;
}

function decodeClass(v: any, cls: any, cfg: JsonConfig, typeArgs: Desc[]): any {
  const info: SerialInfo | undefined = cls.$serial;
  if (!info) throw new SerializationException(`Class ${cls.name} is not @Serializable`);
  if (info.custom) return runCustomDeserializer(info.custom(), v, cfg);
  if (info.object) return cls.$instance ? cls.$instance() : new cls();
  if (info.subclasses) {
    if (typeof v !== 'object' || v === null) throw new SerializationException(`Expected object for polymorphic ${cls.name}`);
    const disc = info.discriminator ?? cfg.classDiscriminator;
    const name = v[disc];
    const sub = info.subclasses()[name];
    if (!sub) throw new SerializationException(`Polymorphic serializer was not found for class discriminator '${name}'`);
    const { [disc]: _ignored, ...rest } = v;
    return decodeClass(rest, sub, cfg, typeArgs);
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new SerializationException(`Expected JSON object for ${cls.name}, got ${Array.isArray(v) ? 'array' : typeof v}`);
  }
  const ctorArgs: any[] = [];
  const bodyProps: [string, any][] = [];
  for (const f of info.fields) {
    let raw: any = undefined;
    let present = false;
    for (const key of [f.json, ...(f.alt ?? [])]) {
      if (Object.prototype.hasOwnProperty.call(v, key)) {
        raw = v[key];
        present = true;
        break;
      }
    }
    let val: any = undefined;
    if (present) {
      const nullable = f.type.k === 'nullable';
      if (raw === null && !nullable && f.optional && cfg.coerceInputValues) val = undefined;
      else {
        try {
          val = decodeValue(raw, f.type, cfg, typeArgs);
        } catch (e) {
          if (f.optional && cfg.coerceInputValues && f.type.k === 'enum') val = undefined;
          else if (isCatch(e, SerializationException)) throw new SerializationException(`${(e as Error).message} at ${cls.name}.${f.name}`);
          else throw e;
        }
      }
    } else if (!f.optional) {
      if (f.type.k === 'nullable' && !cfg.explicitNulls) val = null;
      else throw new MissingFieldException(`Field '${f.json}' is required for type with serial name '${info.serialName ?? cls.name}', but it was missing`);
    }
    if (f.body) bodyProps.push([f.name, val]);
    else ctorArgs.push(val);
  }
  const obj = new cls(...ctorArgs);
  for (const [k, val] of bodyProps) if (val !== undefined) obj[k] = val;
  return obj;
}

/** Custom KSerializer / JsonTransformingSerializer support. */
function runCustomDeserializer(ser: any, v: any, cfg: JsonConfig): any {
  const s = typeof ser === 'function' && !ser.prototype?.deserialize ? ser() : ser;
  if (typeof s.transformDeserialize === 'function') {
    const el = s.transformDeserialize(toElement(v));
    return decodeValue(elementToJS(el), s.$inner ?? T.any, cfg, []);
  }
  if (typeof s.deserialize === 'function') return s.deserialize(new JsonDecoder(v, cfg));
  throw new SerializationException('Unsupported custom serializer');
}

export class JsonDecoder {
  constructor(
    private readonly v: any,
    private readonly cfg: JsonConfig,
  ) {}
  decodeJsonElement(): any {
    return toElement(this.v);
  }
  decodeString(): string {
    return str(this.v);
  }
  decodeInt(): number {
    return Number(this.v);
  }
  decodeLong(): number {
    return Number(this.v);
  }
  decodeDouble(): number {
    return Number(this.v);
  }
  decodeFloat(): number {
    return Number(this.v);
  }
  decodeBoolean(): boolean {
    return this.v === true || this.v === 'true';
  }
  decodeNull(): null {
    return null;
  }
  decodeNotNullMark(): boolean {
    return this.v !== null;
  }
  decodeSerializableValue(d: any): any {
    return decodeValue(this.v, toDesc(d), this.cfg, []);
  }
  get json(): Json {
    return new Json(this.cfg);
  }
}

// ---------- encoding ----------

function encodeValue(v: any, cfg: JsonConfig): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return v;
  if (v instanceof JsonPrimitive || v instanceof JsonObject || v instanceof JsonArray) return elementToJS(v);
  if (Array.isArray(v)) return v.map((x) => encodeValue(x, cfg));
  if (v instanceof Set) return [...v].map((x) => encodeValue(x, cfg));
  if (v instanceof Map) {
    const o: Record<string, any> = {};
    for (const [k, x] of v) o[typeof k === 'object' && k?.name ? serialNameOfEnum(k) : str(k)] = encodeValue(x, cfg);
    return o;
  }
  if (v instanceof Named) return encodeValue(v.values, cfg);
  const cls = v.constructor;
  if (cls?.$enum) return serialNameOfEnum(v);
  const info: SerialInfo | undefined = cls?.$serial;
  if (info) {
    if (info.custom) {
      const s = info.custom();
      if (typeof s.transformSerialize === 'function') return elementToJS(s.transformSerialize(toElement(encodePlain(v, info, cfg))));
      if (typeof s.serialize === 'function') {
        const enc = new JsonEncoder(cfg);
        s.serialize(enc, v);
        return enc.out;
      }
    }
    const out = encodePlain(v, info, cfg);
    const parent = Object.getPrototypeOf(cls);
    if (parent?.$serial?.subclasses) out[parent.$serial.discriminator ?? cfg.classDiscriminator] = info.serialName ?? cls.name;
    return out;
  }
  if (v.first !== undefined && v.second !== undefined && typeof v.component1 === 'function') return { first: encodeValue(v.first, cfg), second: encodeValue(v.second, cfg) };
  if (typeof v.toJSON === 'function') return v.toJSON();
  const o: Record<string, any> = {};
  for (const k of Object.keys(v)) o[k] = encodeValue(v[k], cfg);
  return o;
}

function encodePlain(v: any, info: SerialInfo, cfg: JsonConfig): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of info.fields) {
    const x = v[f.name];
    if ((x === null || x === undefined) && !cfg.explicitNulls) continue;
    out[f.json] = encodeValue(x, cfg);
  }
  return out;
}

export class JsonEncoder {
  out: any = null;
  constructor(private readonly cfg: JsonConfig) {}
  encodeJsonElement(e: any): void {
    this.out = elementToJS(e);
  }
  encodeString(s: string): void {
    this.out = s;
  }
  encodeInt(n: number): void {
    this.out = n;
  }
  encodeLong(n: number): void {
    this.out = n;
  }
  encodeDouble(n: number): void {
    this.out = n;
  }
  encodeBoolean(b: boolean): void {
    this.out = b;
  }
  encodeNull(): void {
    this.out = null;
  }
  encodeSerializableValue(_d: any, v: any): void {
    this.out = encodeValue(v, this.cfg);
  }
}

/** `serializer<T>()` returns a descriptor usable wherever a KSerializer is expected. */
export function serializer(d: Desc): Desc {
  return d;
}

export function buildJsonObject(f: (b: JsonObjectBuilder) => any): JsonObject {
  const b = new JsonObjectBuilder();
  f(b);
  return b.build();
}
export async function buildJsonObjectAsync(f: (b: JsonObjectBuilder) => any): Promise<JsonObject> {
  const b = new JsonObjectBuilder();
  await f(b);
  return b.build();
}
export function buildJsonArray(f: (b: JsonArrayBuilder) => any): JsonArray {
  const b = new JsonArrayBuilder();
  f(b);
  return b.build();
}
export function putJsonObject(b: JsonObjectBuilder, key: string, f: (b: JsonObjectBuilder) => any): any {
  return b.put(key, buildJsonObject(f));
}
export function putJsonArray(b: JsonObjectBuilder, key: string, f: (b: JsonArrayBuilder) => any): any {
  return b.put(key, buildJsonArray(f));
}
export function addJsonObject(b: JsonArrayBuilder, f: (b: JsonObjectBuilder) => any): boolean {
  return b.add(buildJsonObject(f));
}
export function addJsonArray(b: JsonArrayBuilder, f: (b: JsonArrayBuilder) => any): boolean {
  return b.add(buildJsonArray(f));
}

// ---------- custom serializers ----------

/** kotlinx.serialization.json.JsonTransformingSerializer<T>(tSerializer) */
export class JsonTransformingSerializer {
  readonly $inner: Desc;
  constructor(inner: any) {
    this.$inner = inner && typeof inner.k === 'string' ? inner : T.any;
  }
  transformDeserialize(e: any): any {
    return e;
  }
  transformSerialize(e: any): any {
    return e;
  }
  get descriptor(): any {
    return { serialName: this.constructor.name, kind: 'CLASS' };
  }
}

/** KSerializer is an interface; user serializers implement deserialize(decoder)/serialize(encoder, v). */
export class KSerializer {
  static $interface = true;
}

export const PrimitiveKind = { STRING: 'STRING', INT: 'INT', LONG: 'LONG', BOOLEAN: 'BOOLEAN', DOUBLE: 'DOUBLE', FLOAT: 'FLOAT' };
export function PrimitiveSerialDescriptor(serialName: string, kind: any): any {
  return { serialName, kind };
}
export function buildClassSerialDescriptor(serialName: string, ..._rest: any[]): any {
  return { serialName, kind: 'CLASS' };
}

export const builtinSerializers = {
  ListSerializer: (d: Desc) => T.list(d),
  SetSerializer: (d: Desc) => T.set(d),
  MapSerializer: (k: Desc, v: Desc) => T.map(k, v),
  PairSerializer: (a: Desc, b: Desc) => T.pair(a, b),
  nullable: (d: Desc) => T.nullable(d),
};

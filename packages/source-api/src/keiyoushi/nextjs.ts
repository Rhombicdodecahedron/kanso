// keiyoushi.utils.NextJs (+ keiyoushi.utils.reactFlight): Next.js App Router (RSC flight data via
// `self.__next_f.push`) and Pages Router (`__NEXT_DATA__`) extraction.

import { error as kError, IllegalArgumentException, isStr, ParseException, type ExtDef } from '../kotlin/core';
import { Document, Jsoup } from '../jsoup';
import { Response } from '../okhttp';
import { JDate } from '../java/legacy';
import { JsonArray, JsonNull, JsonObject, JsonPrimitive, T, type Desc, type SerialInfo } from '../serialization/json';
import { jsonInstance } from './index';

const NEXT_F_REGEX = /self\.__next_f\.push\(\s*(\[.*\])\s*\)\s*;?\s*$/s;

type El = any;
type Predicate = (e: El) => boolean;

const isObj = (e: El): e is JsonObject => e instanceof JsonObject;
const isArr = (e: El): e is JsonArray => e instanceof JsonArray;
const isStrPrim = (e: El): boolean => e instanceof JsonPrimitive && e !== JsonNull && e.isString;

function parseEl(s: string): El {
  return jsonInstance.parseToJsonElement(s);
}

function extractValueNextJs(payload: El, predicate: Predicate, deserializer: any): any {
  if (!isObj(payload) && !isArr(payload)) return null;
  if (predicate(payload) === true) return jsonInstance.decodeFromJsonElement(deserializer, payload);
  const children: Iterable<El> = isObj(payload) ? payload.values() : payload;
  for (const child of children) {
    const result = extractValueNextJs(child, predicate, deserializer);
    if (result !== null && result !== undefined) return result;
  }
  return null;
}

/** Resolves React Flight `$` markers and outlined model references (see NextJs.kt). */
function resolveNextJsRefs(element: El, chunkCache: Map<string, string>, modelCache: Map<string, El>, resolving: ReadonlySet<string> = new Set()): El {
  if (isObj(element)) {
    const o = new JsonObject();
    for (const [k, v] of element) Map.prototype.set.call(o, k, resolveNextJsRefs(v, chunkCache, modelCache, resolving));
    return o;
  }
  if (isArr(element)) return JsonArray.from$(element.map((x: El) => resolveNextJsRefs(x, chunkCache, modelCache, resolving)));
  if (!(element instanceof JsonPrimitive)) return element;
  const s = element.content;
  if (!(isStrPrim(element) && s.startsWith('$') && s.length >= 2)) return element;
  if (s === '$undefined') return JsonNull;
  if (s === '$Infinity' || s === '$-Infinity' || s === '$NaN' || s === '$-0') return new JsonPrimitive(s.substring(1), true);
  switch (s[1]) {
    case '$':
      return new JsonPrimitive(s.substring(1), true);
    case 'D':
    case 'n':
      return new JsonPrimitive(s.substring(2), true);
    case 'Q':
      return resolveMapRef(s.substring(2), chunkCache, modelCache, resolving) ?? element;
    case 'W':
      return resolveSetRef(s.substring(2), chunkCache, modelCache, resolving) ?? element;
    case 'L':
    case '@':
      return resolveModelRef(s.substring(2), chunkCache, modelCache, resolving) ?? element;
    default:
      return resolveModelRef(s.substring(1), chunkCache, modelCache, resolving) ?? element;
  }
}

function resolveModelRef(reference: string, chunkCache: Map<string, string>, modelCache: Map<string, El>, resolving: ReadonlySet<string>): El | null {
  const segments = reference.split(':');
  const id = segments[0];
  if (segments.length === 1) {
    const chunk = chunkCache.get(id);
    if (chunk !== undefined) return new JsonPrimitive(chunk, true);
  }
  if (resolving.has(id)) return null;
  const guard = new Set(resolving).add(id);
  let value = modelCache.get(id);
  if (value === undefined) return null;
  for (let i = 1; i < segments.length; i++) {
    if (isStrPrim(value) && (value as JsonPrimitive).content.startsWith('$')) value = resolveNextJsRefs(value, chunkCache, modelCache, guard);
    value = walkRefSegment(value, segments[i]);
    if (value === null || value === undefined) return null;
  }
  return resolveNextJsRefs(value, chunkCache, modelCache, guard);
}

function toIntOrNull(s: string): number | null {
  return /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null;
}

function walkRefSegment(value: El, segment: string): El | null {
  if (isObj(value)) return value.get(segment) ?? null;
  if (isArr(value)) {
    if (value.length >= 4 && isStrPrim(value[0]) && value[0].content === '$') {
      if (segment === 'type') return value[1];
      if (segment === 'key') return value[2];
      if (segment === 'props') return value[3];
    }
    const i = toIntOrNull(segment);
    return i === null ? null : (value[i] ?? null);
  }
  return null;
}

function resolveMapRef(id: string, chunkCache: Map<string, string>, modelCache: Map<string, El>, resolving: ReadonlySet<string>): El | null {
  if (resolving.has(id)) return null;
  const entries = modelCache.get(id);
  if (!isArr(entries)) return null;
  const resolved = resolveNextJsRefs(entries, chunkCache, modelCache, new Set(resolving).add(id));
  if (!isArr(resolved)) return null;
  const o = new JsonObject();
  for (const p of resolved) {
    if (!isArr(p) || p.length !== 2) continue;
    const [k, v] = p;
    const key = k instanceof JsonPrimitive ? k.content : String(k);
    Map.prototype.set.call(o, key, v);
  }
  return o;
}

function resolveSetRef(id: string, chunkCache: Map<string, string>, modelCache: Map<string, El>, resolving: ReadonlySet<string>): El | null {
  if (resolving.has(id)) return null;
  const values = modelCache.get(id);
  if (!isArr(values)) return null;
  return resolveNextJsRefs(values, chunkCache, modelCache, new Set(resolving).add(id));
}

function extractAppRouterPayloads(doc: Document, chunkCache: Map<string, string>, modelCache: Map<string, El>): El[] {
  const out: El[] = [];
  for (const el of doc.select('script:not([src])')) {
    const script = el.data();
    if (!script.includes('self.__next_f.push')) continue;
    try {
      const raw = NEXT_F_REGEX.exec(script)?.[1];
      if (raw === undefined) continue;
      const arr = parseEl(raw);
      if (!isArr(arr)) continue;
      const item = arr[1];
      if (item === undefined) continue;
      if (!(item instanceof JsonPrimitive)) throw new IllegalArgumentException('Element is not a JsonPrimitive');
      const content = item.contentOrNull;
      if (content === null) continue;
      out.push(...extractRscPayloads(content, chunkCache, modelCache));
    } catch {
      // malformed push: skipped like the Kotlin helper
    }
  }
  return out;
}

function extractPagesRouterPayloads(doc: Document): El[] {
  const data = doc.selectFirst('script#__NEXT_DATA__')?.data();
  if (data === undefined || data === null) return [];
  try {
    const root = parseEl(data);
    if (!isObj(root)) throw new IllegalArgumentException('Element is not a JsonObject');
    const props = root.get('props');
    let pageProps: El = null;
    if (props !== undefined && props !== null) {
      if (!isObj(props)) throw new IllegalArgumentException('Element is not a JsonObject');
      pageProps = props.get('pageProps') ?? null;
    }
    return pageProps !== null ? [pageProps, root] : [root];
  } catch {
    return [];
  }
}

const HEX = /^[0-9a-fA-F]+$/;

function extractRscPayloads(body: string, chunkCache: Map<string, string>, modelCache: Map<string, El>): El[] {
  const results: El[] = [];
  let pos = 0;
  while (pos < body.length) {
    const colonIdx = body.indexOf(':', pos);
    if (colonIdx === -1) break;
    const id = body.substring(pos, colonIdx);
    if (id === '' || !HEX.test(id)) {
      pos++;
      continue;
    }
    pos = colonIdx + 1;
    if (pos >= body.length) break;
    if (body[pos] === 'T') {
      // T<hexLen>,<content>: the length counts UTF-8 bytes, not UTF-16 units.
      pos++;
      const commaIdx = body.indexOf(',', pos);
      if (commaIdx === -1) break;
      const lenText = body.substring(pos, commaIdx);
      if (!HEX.test(lenText)) break;
      const byteLen = parseInt(lenText, 16);
      pos = commaIdx + 1;
      let bytes = 0;
      const start = pos;
      while (pos < body.length && bytes < byteLen) {
        const c = body.charCodeAt(pos);
        if (c < 0x80) bytes += 1;
        else if (c < 0x800) bytes += 2;
        else if (c >= 0xd800 && c <= 0xdbff) {
          bytes += 4;
          pos++;
        } else bytes += 3;
        pos++;
      }
      const chunkContent = body.substring(start, pos);
      chunkCache.set(id, chunkContent);
      try {
        results.push(parseEl(chunkContent));
      } catch {
        // plain-text chunk
      }
    } else {
      const [element, end] = parseJsonAt(body, pos);
      if (element !== null) {
        results.push(element);
        modelCache.set(id, element);
      }
      pos = end;
    }
  }
  return results;
}

const WS = /\s/;

function parseJsonAt(body: string, start: number): [El | null, number] {
  if (start >= body.length) return [null, start];
  let depth = 0;
  let inString = false;
  let escape = false;
  let i = start;
  const tryParse = (s: string, end: number): [El | null, number] => {
    try {
      return [parseEl(s), end];
    } catch {
      return [null, end];
    }
  };
  while (i < body.length) {
    const c = body[i++];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (--depth === 0) return tryParse(body.substring(start, i), i);
    }
    if (depth === 0 && WS.test(c)) return tryParse(body.substring(start, i - 1), i);
  }
  return [null, i];
}

// ---------- predicate inference ----------

function unwrapNullable(d: Desc): Desc {
  return d.k === 'nullable' ? unwrapNullable((d as any).of) : d;
}

/** Predicate matching objects that contain every non-optional, non-nullable field of the type. */
export function inferredNextJsPredicate(desc: Desc): Predicate {
  const d = unwrapNullable(desc ?? T.any);
  const isList = d.k === 'list';
  const elem = isList ? unwrapNullable((d as any).of) : d;
  const info: SerialInfo | undefined = elem.k === 'cls' ? (elem as any).cls?.$serial : undefined;
  const requiredKeys: string[][] = [];
  for (const f of info?.fields ?? []) {
    if (f.optional || f.body || f.type.k === 'nullable' || f.json.startsWith('\u0000')) continue;
    requiredKeys.push([f.json, ...(f.alt ?? [])]);
  }
  if (!requiredKeys.length) {
    const name = info?.serialName ?? (elem as any).cls?.name ?? elem.k;
    throw new IllegalArgumentException(`Cannot infer a predicate for ${name}: all fields are optional or nullable. Provide an explicit predicate instead.`);
  }
  const has = (o: JsonObject) => requiredKeys.every((alts) => alts.some((k) => o.has(k)));
  if (isList) return (e) => isArr(e) && e.length > 0 && isObj(e[0]) && has(e[0]);
  return (e) => isObj(e) && has(e);
}

// ---------- public API ----------

const isDescLike = (x: any) => !!x && typeof x === 'object' && typeof x.k === 'string';
const isDeserializer = (x: any) => isDescLike(x) || (!!x && typeof x.deserialize === 'function') || (typeof x === 'function' && !!x.$serial);

/** Args: (predicate?, deserializer?) + reified descriptor appended by the translator. */
function nextArgs(args: any[]): { predicate: Predicate; deserializer: any } {
  const a = [...args];
  const desc: Desc = a.length && isDescLike(a[a.length - 1]) ? a.pop() : T.any;
  let predicate: Predicate | null = null;
  let deserializer: any = null;
  for (const x of a) {
    if (typeof x === 'function' && !x.$serial && predicate === null) predicate = x;
    else if (isDeserializer(x)) deserializer = typeof x === 'function' ? T.cls(x) : x;
  }
  if (deserializer === null) deserializer = desc;
  if (predicate === null) predicate = inferredNextJsPredicate(isDescLike(deserializer) ? deserializer : desc);
  return { predicate, deserializer };
}

function fromPayloads(payloads: El[], chunkCache: Map<string, string>, modelCache: Map<string, El>, predicate: Predicate, deserializer: any): any {
  for (const payload of payloads) {
    const resolved = resolveNextJsRefs(payload, chunkCache, modelCache);
    const result = extractValueNextJs(resolved, predicate, deserializer);
    if (result !== null && result !== undefined) return result;
  }
  return null;
}

export function documentExtractNextJs(doc: Document, predicate: Predicate, deserializer: any): any {
  const chunkCache = new Map<string, string>();
  const modelCache = new Map<string, El>();
  let payloads = extractAppRouterPayloads(doc, chunkCache, modelCache);
  if (!payloads.length) payloads = extractPagesRouterPayloads(doc);
  return fromPayloads(payloads, chunkCache, modelCache, predicate, deserializer);
}

export function stringExtractNextJsRsc(body: string, predicate: Predicate, deserializer: any): any {
  const chunkCache = new Map<string, string>();
  const modelCache = new Map<string, El>();
  return fromPayloads(extractRscPayloads(body, chunkCache, modelCache), chunkCache, modelCache, predicate, deserializer);
}

export function responseExtractNextJs(r: Response, predicate: Predicate, deserializer: any): any {
  const contentType = r.header('Content-Type') ?? '';
  try {
    if (contentType.includes('text/x-component')) return stringExtractNextJsRsc(r.body.string(), predicate, deserializer);
    if (contentType.includes('text/html')) return documentExtractNextJs(Jsoup.parse(r.body.string(), r.request.url.toString()), predicate, deserializer);
    return kError(`Unsupported Content-Type for Next.js extraction: ${contentType}`);
  } finally {
    r.close();
  }
}

export const extractNextJs: ExtDef[] = [
  {
    name: 'extractNextJs',
    recv: (x) => x instanceof Document,
    reified: 'desc',
    fn: (doc: Document, ...args: any[]) => {
      const { predicate, deserializer } = nextArgs(args);
      return documentExtractNextJs(doc, predicate, deserializer);
    },
  },
  {
    name: 'extractNextJs',
    recv: (x) => x instanceof Response,
    reified: 'desc',
    fn: (r: Response, ...args: any[]) => {
      const { predicate, deserializer } = nextArgs(args);
      return responseExtractNextJs(r, predicate, deserializer);
    },
  },
];

export const extractNextJsRsc: ExtDef[] = [
  {
    name: 'extractNextJsRsc',
    recv: isStr,
    reified: 'desc',
    fn: (s: string, ...args: any[]) => {
      const { predicate, deserializer } = nextArgs(args);
      return stringExtractNextJsRsc(s, predicate, deserializer);
    },
  },
];

// ---------- keiyoushi.utils.reactFlight ----------

const ISO_MILLIS = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+)\.(\d+)Z/;

export const ReactFlightDateSerializer = {
  descriptor: { serialName: 'ReactFlightDate', kind: 'STRING' },
  serialize(): never {
    throw new IllegalArgumentException('Stub !');
  },
  deserialize(decoder: any): JDate {
    const s: string = decoder.decodeString();
    const m = ISO_MILLIS.exec(s);
    if (!m) throw new ParseException(`Unparseable date: "${s}"`);
    const [, y, mo, d, h, mi, sec, ms] = m.map(Number);
    return new JDate(Date.UTC(y, mo - 1, d, h, mi, sec, ms));
  },
};

export const ReactFlightBigIntSerializer = {
  descriptor: { serialName: 'ReactFlightBigInt', kind: 'STRING' },
  serialize(): never {
    throw new IllegalArgumentException('Stub !');
  },
  /** java.math.BigInteger has no runtime class here: values decode to a JS bigint. */
  deserialize(decoder: any): bigint {
    const raw: string = decoder.decodeString();
    if (!/^[+-]?\d+$/.test(raw)) throw new IllegalArgumentException(`Failed to parse BigInt: ${raw}`);
    return BigInt(raw);
  },
};

export const ReactFlightNumberSerializer = {
  descriptor: { serialName: 'ReactFlightNumber', kind: 'STRING' },
  serialize(): never {
    throw new IllegalArgumentException('Stub !');
  },
  deserialize(decoder: any): number {
    const raw: string = decoder.decodeJsonElement().content;
    switch (raw) {
      case 'Infinity':
        return Infinity;
      case '-Infinity':
        return -Infinity;
      case 'NaN':
        return NaN;
      case '-0':
        return -0;
    }
    const n = raw.trim() === '' ? NaN : Number(raw);
    if (Number.isNaN(n)) throw new IllegalArgumentException(`Failed to parse Number: ${raw}`);
    return n;
  },
};

export const nextJsModules: Record<string, unknown> = {
  'keiyoushi.utils.extractNextJs': extractNextJs,
  'keiyoushi.utils.extractNextJsRsc': extractNextJsRsc,
  'keiyoushi.utils.reactFlight.ReactFlightDateSerializer': ReactFlightDateSerializer,
  'keiyoushi.utils.reactFlight.ReactFlightBigIntSerializer': ReactFlightBigIntSerializer,
  'keiyoushi.utils.reactFlight.ReactFlightNumberSerializer': ReactFlightNumberSerializer,
  // typealiases (`@Serializable(with = ...) Date`): descriptors usable in field types
  'keiyoushi.utils.reactFlight.ReactFlightDate': T.custom(ReactFlightDateSerializer),
  'keiyoushi.utils.reactFlight.ReactFlightBigInt': T.custom(ReactFlightBigIntSerializer),
  'keiyoushi.utils.reactFlight.ReactFlightNumber': T.custom(ReactFlightNumberSerializer),
};

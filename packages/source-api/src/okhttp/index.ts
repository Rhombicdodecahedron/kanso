// okhttp3.* - requests, headers, bodies, responses and an async interceptor chain that ends
// in a host-provided transport (fetch in Node, the app's networking on device).

import { IllegalArgumentException, IllegalStateException, IOException, str } from '../kotlin/core';
import { Named } from '../kotlin/named';
import { Pair } from '../kotlin/types';
import { utf8Encode } from '../kotlin/stdlib';
import { canonicalize, FORM_ENCODE_SET, HttpUrl, HttpUrlBuilder, toHttpUrl } from './url';

export { HttpUrl, HttpUrlBuilder };

// ---------- host transport port ----------

export interface TransportRequest {
  url: string;
  method: string;
  headers: [string, string][];
  body: Uint8Array | null;
  followRedirects: boolean;
  timeoutMs: number;
}

export interface TransportResponse {
  url: string;
  code: number;
  message: string;
  headers: [string, string][];
  body: Uint8Array;
}

export interface Transport {
  execute(req: TransportRequest): Promise<TransportResponse>;
}

let defaultTransport: Transport | null = null;
export function setDefaultTransport(t: Transport): void {
  defaultTransport = t;
}

// ---------- media types ----------

export class MediaType {
  constructor(
    readonly mediaType: string,
    readonly type: string,
    readonly subtype: string,
    private readonly params: Record<string, string>,
  ) {}
  static parse(s: string): MediaType | null {
    const m = /^\s*([^/\s;]+)\/([^\s;]+)\s*(;.*)?$/.exec(s);
    if (!m) return null;
    const params: Record<string, string> = {};
    for (const p of (m[3] ?? '').split(';').slice(1)) {
      const [k, v] = p.split('=');
      if (k && v) params[k.trim().toLowerCase()] = v.trim().replace(/^"|"$/g, '');
    }
    return new MediaType(s.trim(), m[1].toLowerCase(), m[2].toLowerCase(), params);
  }
  static get(s: string): MediaType {
    const m = MediaType.parse(s);
    if (!m) throw new IllegalArgumentException(`No subtype found for: "${s}"`);
    return m;
  }
  charset(def: any = null): any {
    const c = this.params.charset;
    return c ? { name: () => c, toString: () => c, displayName: () => c } : def;
  }
  parameter(name: string): string | null {
    return this.params[name.toLowerCase()] ?? null;
  }
  toString(): string {
    return this.mediaType;
  }
  equals(o: any): boolean {
    return o instanceof MediaType && o.mediaType === this.mediaType;
  }
}
export const toMediaType = (s: string) => MediaType.get(s);
export const toMediaTypeOrNull = (s: string) => MediaType.parse(s);

// ---------- headers ----------

export class Headers {
  constructor(readonly pairs: [string, string][]) {}
  static of(...args: any[]): Headers {
    if (args.length === 1 && args[0] instanceof Map) return new Headers([...args[0]].map(([k, v]) => [str(k), str(v)]));
    const pairs: [string, string][] = [];
    for (let i = 0; i + 1 < args.length; i += 2) pairs.push([str(args[i]).trim(), str(args[i + 1]).trim()]);
    return new Headers(pairs);
  }
  static headersOf(...args: any[]): Headers {
    return Headers.of(...args);
  }
  get(name: string): string | null {
    const n = name.toLowerCase();
    for (let i = this.pairs.length - 1; i >= 0; i--) if (this.pairs[i][0].toLowerCase() === n) return this.pairs[i][1];
    return null;
  }
  values(name: string): string[] {
    const n = name.toLowerCase();
    return this.pairs.filter(([k]) => k.toLowerCase() === n).map(([, v]) => v);
  }
  names(): Set<string> {
    return new Set(this.pairs.map(([k]) => k));
  }
  name(i: number): string {
    return this.pairs[i][0];
  }
  value(i: number): string {
    return this.pairs[i][1];
  }
  get size(): number {
    return this.pairs.length;
  }
  newBuilder(): HeadersBuilder {
    const b = new HeadersBuilder();
    b.pairs = this.pairs.map(([k, v]) => [k, v]);
    return b;
  }
  toMultimap(): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const [k, v] of this.pairs) {
      const key = k.toLowerCase();
      m.set(key, [...(m.get(key) ?? []), v]);
    }
    return m;
  }
  *[Symbol.iterator](): Iterator<Pair<string, string>> {
    for (const [k, v] of this.pairs) yield new Pair(k, v);
  }
  toString(): string {
    return this.pairs.map(([k, v]) => `${k}: ${v}`).join('\n');
  }
  equals(o: any): boolean {
    return o instanceof Headers && o.toString() === this.toString();
  }
}

export class HeadersBuilder {
  pairs: [string, string][] = [];
  add(a: string, b?: string): this {
    if (b === undefined) {
      const i = a.indexOf(':');
      if (i < 0) throw new IllegalArgumentException(`Unexpected header: ${a}`);
      this.pairs.push([a.slice(0, i).trim(), a.slice(i + 1).trim()]);
    } else {
      this.pairs.push([checkName(a), str(b).trim()]);
    }
    return this;
  }
  addUnsafeNonAscii(a: string, b: string): this {
    this.pairs.push([a, b]);
    return this;
  }
  addAll(h: Headers): this {
    for (const [k, v] of h.pairs) this.pairs.push([k, v]);
    return this;
  }
  set(name: string, value: any): this {
    this.removeAll(name);
    this.pairs.push([checkName(name), str(value).trim()]);
    return this;
  }
  removeAll(name: string): this {
    const n = name.toLowerCase();
    this.pairs = this.pairs.filter(([k]) => k.toLowerCase() !== n);
    return this;
  }
  get(name: string): string | null {
    return new Headers(this.pairs).get(name);
  }
  build(): Headers {
    return new Headers(this.pairs.map(([k, v]) => [k, v]));
  }
}
(Headers as any).Builder = HeadersBuilder;
(Headers as any).Companion = { headersOf: Headers.of, of: Headers.of };

function checkName(n: string): string {
  const s = str(n);
  if (!s) throw new IllegalArgumentException('name is empty');
  return s;
}

export function toHeaders(m: Map<string, string>): Headers {
  return Headers.of(m);
}

// ---------- bodies ----------

export class RequestBody {
  constructor(
    readonly bytes: Uint8Array,
    private readonly type: MediaType | null,
  ) {}
  contentType(): MediaType | null {
    return this.type;
  }
  contentLength(): number {
    return this.bytes.length;
  }
  static create(a: any, b: any): RequestBody {
    // create(MediaType?, String|ByteArray) (old) or create(String|ByteArray, MediaType?) (new)
    if (a instanceof MediaType || a === null) return toRequestBody(b, a);
    return toRequestBody(a, b);
  }
  writeTo(sink: any): void {
    sink.write(this.bytes);
  }
  /** Debug helper: body as text. */
  text(): string {
    return new TextDecoder().decode(this.bytes);
  }
}
(RequestBody as any).Companion = {
  create: RequestBody.create,
  toRequestBody: (x: any, t?: any) => toRequestBody(x, t),
};

export function toRequestBody(content: any, type: MediaType | null = null, offset = 0, count?: number): RequestBody {
  let bytes: Uint8Array;
  if (typeof content === 'string') bytes = toU8(utf8Encode(content));
  else if (content instanceof Uint8Array || content instanceof Int8Array) bytes = toU8(content);
  else bytes = toU8(utf8Encode(str(content)));
  if (offset || count !== undefined) bytes = bytes.subarray(offset, count === undefined ? undefined : offset + count);
  return new RequestBody(bytes, type);
}

function toU8(b: Uint8Array | Int8Array): Uint8Array {
  return b instanceof Uint8Array ? b : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

const FORM_TYPE = MediaType.get('application/x-www-form-urlencoded');

export class FormBody extends RequestBody {
  constructor(
    readonly encodedNames: string[],
    readonly encodedValues: string[],
  ) {
    super(toU8(utf8Encode(encodedNames.map((n, i) => `${n}=${encodedValues[i]}`).join('&'))), FORM_TYPE);
  }
  get size(): number {
    return this.encodedNames.length;
  }
  name(i: number): string {
    return decodeURIComponent(this.encodedNames[i].replace(/\+/g, ' '));
  }
  value(i: number): string {
    return decodeURIComponent(this.encodedValues[i].replace(/\+/g, ' '));
  }
  encodedName(i: number): string {
    return this.encodedNames[i];
  }
  encodedValue(i: number): string {
    return this.encodedValues[i];
  }
}

export class FormBodyBuilder {
  private names: string[] = [];
  private values: string[] = [];
  constructor(_charset?: any) {}
  add(name: string, value: any): this {
    this.names.push(canonicalize(str(name), FORM_ENCODE_SET, { plusIsSpace: true }));
    this.values.push(canonicalize(str(value), FORM_ENCODE_SET, { plusIsSpace: true }));
    return this;
  }
  addEncoded(name: string, value: any): this {
    this.names.push(canonicalize(str(name), FORM_ENCODE_SET, { alreadyEncoded: true, plusIsSpace: true }));
    this.values.push(canonicalize(str(value), FORM_ENCODE_SET, { alreadyEncoded: true, plusIsSpace: true }));
    return this;
  }
  build(): FormBody {
    return new FormBody([...this.names], [...this.values]);
  }
}
(FormBody as any).Builder = FormBodyBuilder;

export class MultipartBody extends RequestBody {
  static FORM = MediaType.get('multipart/form-data');
  static MIXED = MediaType.get('multipart/mixed');
  constructor(bytes: Uint8Array, type: MediaType) {
    super(bytes, type);
  }
}

class MultipartPart {
  constructor(
    readonly headers: [string, string][],
    readonly body: RequestBody,
  ) {}
}

export class MultipartBodyBuilder {
  private boundary: string;
  private type = MultipartBody.MIXED;
  private parts: MultipartPart[] = [];
  constructor(boundary?: string) {
    this.boundary = boundary ?? 'kanso' + Math.random().toString(36).slice(2);
  }
  setType(t: MediaType): this {
    this.type = t;
    return this;
  }
  addFormDataPart(name: string, a: any, b?: RequestBody): this {
    let disp = `form-data; name="${name}"`;
    let body: RequestBody;
    if (b !== undefined) {
      if (a !== null) disp += `; filename="${a}"`;
      body = b;
    } else body = toRequestBody(str(a));
    const headers: [string, string][] = [['Content-Disposition', disp]];
    const ct = body.contentType();
    if (ct && b !== undefined) headers.push(['Content-Type', ct.toString()]);
    this.parts.push(new MultipartPart(headers, body));
    return this;
  }
  addPart(a: any, b?: RequestBody): this {
    if (b) this.parts.push(new MultipartPart((a as Headers).pairs, b));
    else this.parts.push(new MultipartPart([], a));
    return this;
  }
  build(): MultipartBody {
    const chunks: Uint8Array[] = [];
    const enc = (s: string) => toU8(utf8Encode(s));
    for (const p of this.parts) {
      chunks.push(enc(`--${this.boundary}\r\n`));
      for (const [k, v] of p.headers) chunks.push(enc(`${k}: ${v}\r\n`));
      chunks.push(enc(`Content-Length: ${p.body.contentLength()}\r\n\r\n`));
      chunks.push(p.body.bytes);
      chunks.push(enc('\r\n'));
    }
    chunks.push(enc(`--${this.boundary}--\r\n`));
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return new MultipartBody(out, MediaType.get(`${this.type.mediaType}; boundary=${this.boundary}`));
  }
}
(MultipartBody as any).Builder = MultipartBodyBuilder;
(MultipartBody as any).Part = MultipartPart;

export class ResponseBody {
  private consumedText: string | null = null;
  constructor(
    readonly raw: Uint8Array,
    private readonly type: MediaType | null,
  ) {}
  string(): string {
    if (this.consumedText === null) {
      const charset = this.type?.charset()?.name?.() ?? sniffCharset(this.raw) ?? 'utf-8';
      try {
        this.consumedText = new TextDecoder(charset.toLowerCase()).decode(this.raw);
      } catch {
        this.consumedText = new TextDecoder().decode(this.raw);
      }
    }
    return this.consumedText;
  }
  bytes(): Int8Array {
    return new Int8Array(this.raw.buffer, this.raw.byteOffset, this.raw.byteLength);
  }
  byteString(): any {
    return { toByteArray: () => this.bytes(), utf8: () => this.string(), hex: () => [...this.raw].map((b) => b.toString(16).padStart(2, '0')).join('') };
  }
  byteStream(): InputStream {
    return new InputStream(this.raw);
  }
  charStream(): any {
    return { readText: () => this.string() };
  }
  source(): BufferedSource {
    return new BufferedSource(this.raw);
  }
  contentType(): MediaType | null {
    return this.type;
  }
  contentLength(): number {
    return this.raw.length;
  }
  close(): void {}
  static create(a: any, b: any): ResponseBody {
    if (a instanceof MediaType || a === null) return toResponseBody(b, a);
    return toResponseBody(a, b);
  }
}
(ResponseBody as any).Companion = {
  create: ResponseBody.create,
  toResponseBody: (x: any, t?: any) => toResponseBody(x, t),
};

function sniffCharset(raw: Uint8Array): string | null {
  // Honour <meta charset> for legacy-encoded sites, like Jsoup does.
  const head = new TextDecoder('latin1').decode(raw.subarray(0, 2048));
  const m = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  return m ? m[1] : null;
}

export function toResponseBody(content: any, type: MediaType | null = null): ResponseBody {
  if (typeof content === 'string') return new ResponseBody(toU8(utf8Encode(content)), type);
  if (content instanceof Uint8Array || content instanceof Int8Array) return new ResponseBody(toU8(content), type);
  if (content instanceof BufferedSource || content instanceof Buffer) return new ResponseBody(content.readAll(), type);
  return new ResponseBody(toU8(utf8Encode(str(content))), type);
}

/** java.io.InputStream subset. */
export class InputStream {
  private pos = 0;
  constructor(readonly data: Uint8Array) {}
  read(buf?: any, off = 0, len?: number): number {
    if (buf === undefined) return this.pos < this.data.length ? this.data[this.pos++] : -1;
    if (this.pos >= this.data.length) return -1;
    const n = Math.min(len ?? buf.length - off, this.data.length - this.pos);
    for (let i = 0; i < n; i++) buf[off + i] = this.data[this.pos + i];
    this.pos += n;
    return n;
  }
  readBytes(): Int8Array {
    const out = this.data.subarray(this.pos);
    this.pos = this.data.length;
    return new Int8Array(out.buffer, out.byteOffset, out.byteLength);
  }
  available(): number {
    return this.data.length - this.pos;
  }
  close(): void {}
  bufferedReader(): any {
    const text = new TextDecoder().decode(this.data.subarray(this.pos));
    return { readText: () => text, readLines: () => text.split('\n'), close: () => {} };
  }
}

/** okio.Buffer / BufferedSource subset. */
export class Buffer {
  chunks: number[] = [];
  write(b: any): this {
    for (const x of b instanceof Uint8Array || b instanceof Int8Array ? toU8(b) : utf8Encode(str(b))) this.chunks.push(x & 0xff);
    return this;
  }
  writeUtf8(s: string): this {
    return this.write(toU8(utf8Encode(s)));
  }
  readUtf8(): string {
    const s = new TextDecoder().decode(Uint8Array.from(this.chunks));
    this.chunks = [];
    return s;
  }
  readByteArray(): Int8Array {
    const out = Int8Array.from(this.chunks.map((x) => (x << 24) >> 24));
    this.chunks = [];
    return out;
  }
  readAll(): Uint8Array {
    const out = Uint8Array.from(this.chunks);
    this.chunks = [];
    return out;
  }
  get size(): number {
    return this.chunks.length;
  }
  close(): void {}
}

export class BufferedSource {
  private pos = 0;
  constructor(readonly data: Uint8Array) {}
  readUtf8(): string {
    const s = new TextDecoder().decode(this.data.subarray(this.pos));
    this.pos = this.data.length;
    return s;
  }
  readByteArray(n?: number): Int8Array {
    const end = n === undefined ? this.data.length : this.pos + n;
    const out = this.data.subarray(this.pos, end);
    this.pos = end;
    return new Int8Array(out.buffer, out.byteOffset, out.byteLength);
  }
  readAll(): Uint8Array {
    const out = this.data.subarray(this.pos);
    this.pos = this.data.length;
    return out;
  }
  exhausted(): boolean {
    return this.pos >= this.data.length;
  }
  inputStream(): InputStream {
    return new InputStream(this.data.subarray(this.pos));
  }
  close(): void {}
}

// ---------- cache control ----------

export class CacheControl {
  constructor(
    readonly noCache: boolean,
    readonly noStore: boolean,
    readonly maxAgeSeconds: number,
    readonly onlyIfCached: boolean,
    readonly forceNetwork: boolean,
  ) {}
  static FORCE_NETWORK = new CacheControl(true, false, -1, false, true);
  static FORCE_CACHE = new CacheControl(false, false, -1, true, false);
  toString(): string {
    const parts: string[] = [];
    if (this.noCache) parts.push('no-cache');
    if (this.noStore) parts.push('no-store');
    if (this.maxAgeSeconds >= 0) parts.push(`max-age=${this.maxAgeSeconds}`);
    if (this.onlyIfCached) parts.push('only-if-cached');
    return parts.join(', ');
  }
}
export class CacheControlBuilder {
  private nc = false;
  private ns = false;
  private age = -1;
  private oic = false;
  noCache(): this {
    this.nc = true;
    return this;
  }
  noStore(): this {
    this.ns = true;
    return this;
  }
  maxAge(v: any, unit?: any): this {
    this.age = toSeconds(v, unit);
    return this;
  }
  maxStale(): this {
    return this;
  }
  minFresh(): this {
    return this;
  }
  onlyIfCached(): this {
    this.oic = true;
    return this;
  }
  noTransform(): this {
    return this;
  }
  immutable(): this {
    return this;
  }
  build(): CacheControl {
    return new CacheControl(this.nc, this.ns, this.age, this.oic, false);
  }
}
(CacheControl as any).Builder = CacheControlBuilder;

function toSeconds(v: any, unit?: any): number {
  if (v && typeof v.inWholeSeconds === 'number') return v.inWholeSeconds;
  if (typeof v === 'number' && unit && typeof unit.toSeconds === 'function') return unit.toSeconds(v);
  return Number(v);
}

// ---------- requests ----------

export class Request {
  constructor(
    readonly url: HttpUrl,
    readonly method: string,
    readonly headers: Headers,
    readonly body: RequestBody | null,
    readonly cacheControl: CacheControl | null,
    readonly tags: Map<any, any>,
  ) {}
  header(name: string): string | null {
    return this.headers.get(name);
  }
  headers$call(name: string): string[] {
    return this.headers.values(name);
  }
  newBuilder(): RequestBuilder {
    const b = new RequestBuilder();
    b.$url = this.url;
    b.$method = this.method;
    b.$headers = this.headers.newBuilder();
    b.$body = this.body;
    b.$cache = this.cacheControl;
    b.$tags = new Map(this.tags);
    return b;
  }
  tag(type?: any): any {
    if (type === undefined) return this.tags.get(Object) ?? null;
    return this.tags.get(type) ?? null;
  }
  get isHttps(): boolean {
    return this.url.isHttps;
  }
  toString(): string {
    return `Request{method=${this.method}, url=${this.url}}`;
  }
}

export class RequestBuilder {
  $url: HttpUrl | null = null;
  $method = 'GET';
  $headers = new HeadersBuilder();
  $body: RequestBody | null = null;
  $cache: CacheControl | null = null;
  $tags = new Map<any, any>();

  url(u: any): this {
    if (u instanceof HttpUrl) this.$url = u;
    else {
      let s = str(u);
      if (/^ws:/i.test(s)) s = 'http:' + s.slice(3);
      else if (/^wss:/i.test(s)) s = 'https:' + s.slice(4);
      this.$url = toHttpUrl(s);
    }
    return this;
  }
  header(name: string, value: any): this {
    this.$headers.set(name, value);
    return this;
  }
  addHeader(name: string, value: any): this {
    this.$headers.add(name, str(value));
    return this;
  }
  removeHeader(name: string): this {
    this.$headers.removeAll(name);
    return this;
  }
  headers(h: Headers): this {
    this.$headers = h.newBuilder();
    return this;
  }
  cacheControl(c: CacheControl): this {
    this.$cache = c;
    const v = c.toString();
    if (v) this.$headers.set('Cache-Control', v);
    else this.$headers.removeAll('Cache-Control');
    return this;
  }
  get(): this {
    return this.method('GET', null);
  }
  head(): this {
    return this.method('HEAD', null);
  }
  post(b: RequestBody): this {
    return this.method('POST', b);
  }
  put(b: RequestBody): this {
    return this.method('PUT', b);
  }
  patch(b: RequestBody): this {
    return this.method('PATCH', b);
  }
  delete(b: RequestBody | null = null): this {
    return this.method('DELETE', b);
  }
  method(m: string, b: RequestBody | null): this {
    this.$method = m;
    this.$body = b ?? null;
    return this;
  }
  tag(a: any, b?: any): this {
    if (b === undefined) this.$tags.set(Object, a);
    else this.$tags.set(a, b);
    return this;
  }
  build(): Request {
    if (!this.$url) throw new IllegalStateException('url == null');
    return new Request(this.$url, this.$method, this.$headers.build(), this.$body, this.$cache, new Map(this.$tags));
  }
}
(Request as any).Builder = RequestBuilder;

/** eu.kanade.tachiyomi.network.GET / POST / PUT / DELETE helpers (legacy API). */
export function GET(url: any, headers: Headers = new Headers([]), cache: CacheControl | Named | null = null): Request {
  let h = headers;
  let c = cache;
  if (headers instanceof Named) ({ headers: h = new Headers([]), cache: c = null } = headers.values as any);
  if (cache instanceof Named) c = (cache.values as any).cache ?? null;
  const b = new RequestBuilder().url(url).headers(h);
  if (c instanceof CacheControl) b.cacheControl(c);
  return b.build();
}
export function POST(url: any, headers: Headers = new Headers([]), body: RequestBody = new FormBodyBuilder().build(), cache: CacheControl | null = null): Request {
  let h = headers;
  let bd = body;
  let c = cache;
  for (const a of [headers, body, cache] as any[]) {
    if (a instanceof Named) {
      h = a.values.headers ?? h;
      bd = a.values.body ?? bd;
      c = a.values.cache ?? c;
    }
  }
  const b = new RequestBuilder().url(url).headers(h instanceof Headers ? h : new Headers([])).post(bd instanceof RequestBody ? bd : new FormBodyBuilder().build());
  if (c instanceof CacheControl) b.cacheControl(c);
  return b.build();
}
export function PUT(url: any, headers: Headers = new Headers([]), body: RequestBody = new FormBodyBuilder().build()): Request {
  return new RequestBuilder().url(url).headers(headers).put(body).build();
}
export function DELETE(url: any, headers: Headers = new Headers([]), body: RequestBody | null = null): Request {
  return new RequestBuilder().url(url).headers(headers).delete(body).build();
}
export function PATCH(url: any, headers: Headers = new Headers([]), body: RequestBody): Request {
  return new RequestBuilder().url(url).headers(headers).patch(body).build();
}

// ---------- responses ----------

export class Protocol {
  constructor(readonly name: string) {}
  static HTTP_1_1 = new Protocol('http/1.1');
  static HTTP_2 = new Protocol('h2');
  toString(): string {
    return this.name;
  }
}

export class Response {
  constructor(
    readonly request: Request,
    readonly code: number,
    readonly message: string,
    readonly headers: Headers,
    readonly body: ResponseBody,
    readonly protocol: Protocol = Protocol.HTTP_1_1,
    readonly priorResponse: Response | null = null,
  ) {}
  get isSuccessful(): boolean {
    return this.code >= 200 && this.code < 300;
  }
  get isRedirect(): boolean {
    return [300, 301, 302, 303, 307, 308].includes(this.code);
  }
  get networkResponse(): Response | null {
    return this;
  }
  get cacheResponse(): Response | null {
    return null;
  }
  get sentRequestAtMillis(): number {
    return 0;
  }
  get receivedResponseAtMillis(): number {
    return 0;
  }
  header(name: string, def: string | null = null): string | null {
    return this.headers.get(name) ?? def;
  }
  headers$call(name: string): string[] {
    return this.headers.values(name);
  }
  peekBody(_n: number): ResponseBody {
    return new ResponseBody(this.body.raw, this.body.contentType());
  }
  newBuilder(): ResponseBuilder {
    const b = new ResponseBuilder();
    b.$request = this.request;
    b.$code = this.code;
    b.$message = this.message;
    b.$headers = this.headers.newBuilder();
    b.$body = this.body;
    b.$protocol = this.protocol;
    return b;
  }
  close(): void {}
  closeQuietly(): void {}
  toString(): string {
    return `Response{protocol=${this.protocol}, code=${this.code}, message=${this.message}, url=${this.request.url}}`;
  }
}

export class ResponseBuilder {
  $request: Request | null = null;
  $code = -1;
  $message = '';
  $headers = new HeadersBuilder();
  $body: ResponseBody | null = null;
  $protocol = Protocol.HTTP_1_1;
  request(r: Request): this {
    this.$request = r;
    return this;
  }
  code(c: number): this {
    this.$code = c;
    return this;
  }
  message(m: string): this {
    this.$message = m;
    return this;
  }
  protocol(p: Protocol): this {
    this.$protocol = p;
    return this;
  }
  header(n: string, v: string): this {
    this.$headers.set(n, v);
    return this;
  }
  addHeader(n: string, v: string): this {
    this.$headers.add(n, v);
    return this;
  }
  removeHeader(n: string): this {
    this.$headers.removeAll(n);
    return this;
  }
  headers(h: Headers): this {
    this.$headers = h.newBuilder();
    return this;
  }
  body(b: ResponseBody | null): this {
    this.$body = b;
    return this;
  }
  build(): Response {
    if (!this.$request) throw new IllegalStateException('request == null');
    if (this.$code < 0) throw new IllegalStateException(`code < 0: ${this.$code}`);
    return new Response(this.$request, this.$code, this.$message, this.$headers.build(), this.$body ?? new ResponseBody(new Uint8Array(), null), this.$protocol);
  }
}
(Response as any).Builder = ResponseBuilder;

// eu.kanade.tachiyomi.network.HttpException
export class HttpException extends IllegalStateException {
  constructor(readonly code: number) {
    super(`HTTP error ${code}`);
  }
}

// ---------- interceptors / client ----------

export interface Chain {
  request(): Request;
  proceed(r: Request): Promise<Response>;
  call(): Call;
  connectTimeoutMillis(): number;
  readTimeoutMillis(): number;
  withReadTimeout(..._a: any[]): Chain;
  withConnectTimeout(..._a: any[]): Chain;
}

/** `Interceptor { chain -> ... }` - interceptors may be functions or objects with intercept(). */
export class Interceptor {
  static $samMethod = 'intercept';
  static $interface = true;
  static $sam(fn: (c: Chain) => any): any {
    const o = Object.create(Interceptor.prototype);
    o.intercept = fn;
    return o;
  }
  static Chain = class {};
}

function interceptOf(i: any): (c: Chain) => any {
  if (typeof i === 'function') return i;
  if (i && typeof i.intercept === 'function') return (c) => i.intercept(c);
  throw new IllegalArgumentException('Not an interceptor');
}

export interface CookieJar {
  saveFromResponse(url: HttpUrl, cookies: Cookie[]): void;
  loadForRequest(url: HttpUrl): Cookie[];
}

export class Cookie {
  constructor(
    readonly name: string,
    readonly value: string,
    readonly domain: string,
    readonly path: string,
    readonly expiresAt: number,
    readonly secure: boolean,
    readonly httpOnly: boolean,
    readonly hostOnly: boolean,
  ) {}
  static parse(url: HttpUrl, header: string): Cookie | null {
    const parts = header.split(';').map((p) => p.trim());
    const [nv, ...attrs] = parts;
    const i = nv.indexOf('=');
    if (i <= 0) return null;
    let domain = url.host;
    let path = '/';
    let expires = 253402300799999;
    let secure = false;
    let httpOnly = false;
    let hostOnly = true;
    for (const a of attrs) {
      const [k, v = ''] = a.split('=');
      const key = k.toLowerCase();
      if (key === 'domain' && v) {
        domain = v.replace(/^\./, '').toLowerCase();
        hostOnly = false;
      } else if (key === 'path' && v) path = v;
      else if (key === 'max-age') expires = Date.now() + parseInt(v, 10) * 1000;
      else if (key === 'expires') {
        const t = Date.parse(v);
        if (!Number.isNaN(t)) expires = t;
      } else if (key === 'secure') secure = true;
      else if (key === 'httponly') httpOnly = true;
    }
    return new Cookie(nv.slice(0, i).trim(), nv.slice(i + 1).trim(), domain, path, expires, secure, httpOnly, hostOnly);
  }
  static parseAll(url: HttpUrl, headers: Headers): Cookie[] {
    return headers.values('Set-Cookie').map((h) => Cookie.parse(url, h)).filter((c): c is Cookie => !!c);
  }
  matches(url: HttpUrl): boolean {
    const hostOk = this.hostOnly ? url.host === this.domain : url.host === this.domain || url.host.endsWith('.' + this.domain);
    return hostOk && url.encodedPath.startsWith(this.path) && (!this.secure || url.isHttps) && this.expiresAt > Date.now();
  }
  newBuilder(): CookieBuilder {
    const b = new CookieBuilder();
    Object.assign(b, { n: this.name, v: this.value, d: this.domain, p: this.path, e: this.expiresAt, s: this.secure, h: this.httpOnly, ho: this.hostOnly });
    return b;
  }
  toString(): string {
    return `${this.name}=${this.value}; domain=${this.domain}; path=${this.path}`;
  }
}

export class CookieBuilder {
  n = '';
  v = '';
  d = '';
  p = '/';
  e = 253402300799999;
  s = false;
  h = false;
  ho = false;
  name(x: string): this {
    this.n = x;
    return this;
  }
  value(x: string): this {
    this.v = x;
    return this;
  }
  domain(x: string): this {
    this.d = x;
    this.ho = false;
    return this;
  }
  hostOnlyDomain(x: string): this {
    this.d = x;
    this.ho = true;
    return this;
  }
  path(x: string): this {
    this.p = x;
    return this;
  }
  expiresAt(x: number): this {
    this.e = x;
    return this;
  }
  secure(): this {
    this.s = true;
    return this;
  }
  httpOnly(): this {
    this.h = true;
    return this;
  }
  build(): Cookie {
    return new Cookie(this.n, this.v, this.d, this.p, this.e, this.s, this.h, this.ho);
  }
}
(Cookie as any).Builder = CookieBuilder;

/** In-memory cookie jar shared by all clients of one runtime (the host may replace it). */
export class MemoryCookieJar implements CookieJar {
  cookies: Cookie[] = [];
  saveFromResponse(_url: HttpUrl, cookies: Cookie[]): void {
    for (const c of cookies) {
      this.cookies = this.cookies.filter((x) => !(x.name === c.name && x.domain === c.domain && x.path === c.path));
      if (c.expiresAt > Date.now()) this.cookies.push(c);
    }
  }
  loadForRequest(url: HttpUrl): Cookie[] {
    return this.cookies.filter((c) => c.matches(url));
  }
}
export const CookieJarNoCookies: CookieJar = { saveFromResponse() {}, loadForRequest: () => [] };

export interface ClientConfig {
  transport: Transport;
  interceptors: any[];
  networkInterceptors: any[];
  cookieJar: CookieJar;
  followRedirects: boolean;
  timeoutMs: number;
  /** Owning source, for the `context(source)` network helpers. */
  source: any;
}

export class Call {
  private canceled = false;
  constructor(
    readonly client: OkHttpClient,
    readonly req: Request,
  ) {}
  request(): Request {
    return this.req;
  }
  cancel(): void {
    this.canceled = true;
  }
  isCanceled(): boolean {
    return this.canceled;
  }
  /** OkHttp's blocking execute(); async here, the translator awaits it. */
  execute(): Promise<Response> {
    return this.client.$run(this);
  }
  await(): Promise<Response> {
    return this.client.$run(this);
  }
  async awaitSuccess(): Promise<Response> {
    const r = await this.client.$run(this);
    if (!r.isSuccessful) {
      r.close();
      throw new HttpException(r.code);
    }
    return r;
  }
  enqueue(cb: any): void {
    this.client.$run(this).then(
      (r) => cb.onResponse(this, r),
      (e) => cb.onFailure(this, e instanceof IOException ? e : new IOException(String(e?.message ?? e), e)),
    );
  }
  clone(): Call {
    return new Call(this.client, this.req);
  }
}

export class OkHttpClient {
  constructor(readonly cfg: ClientConfig) {}

  newCall(r: Request): Call {
    return new Call(this, r);
  }
  newBuilder(): OkHttpClientBuilder {
    const b = new OkHttpClientBuilder();
    b.cfg = { ...this.cfg, interceptors: [...this.cfg.interceptors], networkInterceptors: [...this.cfg.networkInterceptors] };
    return b;
  }
  interceptors(): any[] {
    return this.cfg.interceptors;
  }
  networkInterceptors(): any[] {
    return this.cfg.networkInterceptors;
  }
  get cookieJar(): CookieJar {
    return this.cfg.cookieJar;
  }
  get followRedirects(): boolean {
    return this.cfg.followRedirects;
  }
  get connectTimeoutMillis(): number {
    return this.cfg.timeoutMs;
  }
  get readTimeoutMillis(): number {
    return this.cfg.timeoutMs;
  }
  get callTimeoutMillis(): number {
    return this.cfg.timeoutMs;
  }
  get dispatcher(): any {
    return { cancelAll: () => {}, executorService: null };
  }
  get connectionPool(): any {
    return { evictAll: () => {} };
  }

  async $run(call: Call): Promise<Response> {
    const app = this.cfg.interceptors.map(interceptOf);
    const net = this.cfg.networkInterceptors.map(interceptOf);
    const all = [...app, (c: Chain) => this.$network(c, net)];
    const chainAt = (i: number, req: Request): Chain => ({
      request: () => req,
      proceed: async (r: Request) => {
        if (i >= all.length) throw new IllegalStateException('No more interceptors');
        const res = await all[i](chainAt(i + 1, r));
        if (!(res instanceof Response)) throw new IllegalStateException('Interceptor returned no response');
        return res;
      },
      call: () => call,
      connectTimeoutMillis: () => this.cfg.timeoutMs,
      readTimeoutMillis: () => this.cfg.timeoutMs,
      withReadTimeout: () => chainAt(i, req),
      withConnectTimeout: () => chainAt(i, req),
    });
    return chainAt(0, call.req).proceed(call.req);
  }

  private async $network(chain: Chain, net: ((c: Chain) => any)[]): Promise<Response> {
    let req = chain.request();
    let prior: Response | null = null;
    for (let hop = 0; hop < 20; hop++) {
      const res: Response = await this.$networkOnce(req, net, chain.call());
      if (!this.cfg.followRedirects || !res.isRedirect) return prior ? withPrior(res, prior) : res;
      const loc = res.header('Location');
      if (!loc) return res;
      const next = req.url.resolve(loc);
      if (!next) return res;
      const keepBody = res.code === 307 || res.code === 308;
      const b = req.newBuilder().url(next);
      if (!keepBody && req.method !== 'GET' && req.method !== 'HEAD') b.method('GET', null).removeHeader('Content-Type').removeHeader('Content-Length');
      if (next.host !== req.url.host) b.removeHeader('Authorization');
      prior = res;
      req = b.build();
    }
    throw new IOException('Too many follow-up requests: 21');
  }

  private async $networkOnce(req: Request, net: ((c: Chain) => any)[], call: Call): Promise<Response> {
    const terminal = async (r: Request): Promise<Response> => {
      const cookies = this.cfg.cookieJar.loadForRequest(r.url);
      const headers = r.headers.newBuilder();
      if (cookies.length && !headers.get('Cookie')) headers.set('Cookie', cookies.map((c) => `${c.name}=${c.value}`).join('; '));
      if (r.body && !headers.get('Content-Type') && r.body.contentType()) headers.set('Content-Type', r.body.contentType()!.toString());
      if (call.isCanceled()) throw new IOException('Canceled');
      let tr: TransportResponse;
      try {
        tr = await this.cfg.transport.execute({
          url: r.url.toString(),
          method: r.method,
          headers: headers.build().pairs,
          body: r.body ? r.body.bytes : null,
          followRedirects: false,
          timeoutMs: this.cfg.timeoutMs,
        });
      } catch (e: any) {
        if (e instanceof IOException) throw e;
        throw new IOException(String(e?.message ?? e), e);
      }
      const respHeaders = new Headers(tr.headers);
      const ct = respHeaders.get('Content-Type');
      const res = new Response(r, tr.code, tr.message, respHeaders, new ResponseBody(tr.body, ct ? MediaType.parse(ct) : null));
      const set = Cookie.parseAll(r.url, respHeaders);
      if (set.length) this.cfg.cookieJar.saveFromResponse(r.url, set);
      return res;
    };
    const run = (i: number, r: Request): Promise<Response> => {
      if (i >= net.length) return terminal(r);
      const chain: Chain = {
        request: () => r,
        proceed: (nr) => run(i + 1, nr),
        call: () => call,
        connectTimeoutMillis: () => this.cfg.timeoutMs,
        readTimeoutMillis: () => this.cfg.timeoutMs,
        withReadTimeout: () => chain,
        withConnectTimeout: () => chain,
      };
      return Promise.resolve(net[i](chain));
    };
    return run(0, req);
  }
}

function withPrior(res: Response, prior: Response): Response {
  return new Response(res.request, res.code, res.message, res.headers, res.body, res.protocol, prior);
}

export class OkHttpClientBuilder {
  cfg: ClientConfig = {
    transport: defaultTransport!,
    interceptors: [],
    networkInterceptors: [],
    cookieJar: new MemoryCookieJar(),
    followRedirects: true,
    timeoutMs: 30_000,
    source: null,
  };
  addInterceptor(i: any): this {
    this.cfg.interceptors.push(typeof i === 'function' ? Interceptor.$sam(i) : i);
    return this;
  }
  addNetworkInterceptor(i: any): this {
    this.cfg.networkInterceptors.push(typeof i === 'function' ? Interceptor.$sam(i) : i);
    return this;
  }
  interceptors(): any[] {
    return this.cfg.interceptors;
  }
  networkInterceptors(): any[] {
    return this.cfg.networkInterceptors;
  }
  cookieJar(j: CookieJar): this {
    this.cfg.cookieJar = j;
    return this;
  }
  followRedirects(b: boolean): this {
    this.cfg.followRedirects = b;
    return this;
  }
  followSslRedirects(_b: boolean): this {
    return this;
  }
  connectTimeout(v: any, unit?: any): this {
    this.cfg.timeoutMs = Math.max(this.cfg.timeoutMs, toSeconds(v, unit) * 1000);
    return this;
  }
  readTimeout(v: any, unit?: any): this {
    return this.connectTimeout(v, unit);
  }
  writeTimeout(v: any, unit?: any): this {
    return this.connectTimeout(v, unit);
  }
  callTimeout(v: any, unit?: any): this {
    return this.connectTimeout(v, unit);
  }
  retryOnConnectionFailure(_b: boolean): this {
    return this;
  }
  protocols(_p: any): this {
    return this;
  }
  cache(_c: any): this {
    return this;
  }
  dns(_d: any): this {
    return this;
  }
  proxy(_p: any): this {
    return this;
  }
  hostnameVerifier(_h: any): this {
    return this;
  }
  sslSocketFactory(..._a: any[]): this {
    return this;
  }
  eventListener(_e: any): this {
    return this;
  }
  connectionPool(_p: any): this {
    return this;
  }
  dispatcher(_d: any): this {
    return this;
  }
  build(): OkHttpClient {
    if (!this.cfg.transport) throw new IllegalStateException('No network transport configured');
    return new OkHttpClient({ ...this.cfg, interceptors: [...this.cfg.interceptors], networkInterceptors: [...this.cfg.networkInterceptors] });
  }
}
(OkHttpClient as any).Builder = OkHttpClientBuilder;

export const TimeUnit = {
  MILLISECONDS: { name: 'MILLISECONDS', toSeconds: (v: number) => v / 1000, toMillis: (v: number) => v },
  SECONDS: { name: 'SECONDS', toSeconds: (v: number) => v, toMillis: (v: number) => v * 1000 },
  MINUTES: { name: 'MINUTES', toSeconds: (v: number) => v * 60, toMillis: (v: number) => v * 60_000 },
  HOURS: { name: 'HOURS', toSeconds: (v: number) => v * 3600, toMillis: (v: number) => v * 3_600_000 },
  DAYS: { name: 'DAYS', toSeconds: (v: number) => v * 86400, toMillis: (v: number) => v * 86_400_000 },
};

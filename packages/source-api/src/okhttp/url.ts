// okhttp3.HttpUrl with OkHttp's canonicalisation rules, plus RFC 3986 reference resolution.

import { IllegalArgumentException, str } from '../kotlin/core';

const HEX = '0123456789ABCDEF';

// OkHttp encode sets.
const PATH_SEGMENT_ENCODE_SET = ' "<>^`{}|/\\?#';
const PATH_SEGMENT_ENCODE_SET_URI = '[]';
const QUERY_ENCODE_SET = ' "\'<>#';
const QUERY_COMPONENT_ENCODE_SET = " !\"#$&'(),/:;<=>?@[]\\^`{|}~";
const QUERY_COMPONENT_REENCODE_SET = ' "\'<>#&=';
const FRAGMENT_ENCODE_SET = '';
export const FORM_ENCODE_SET = ' "\':;<=>@[]^`{}|/\\?#&!$(),~';

function utf8Bytes(cp: number): number[] {
  if (cp < 0x80) return [cp];
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)];
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
}

function pct(b: number): string {
  return '%' + HEX[(b >> 4) & 0xf] + HEX[b & 0xf];
}

/**
 * OkHttp's canonicalize(): percent-encode chars in `encodeSet`, controls and non-ASCII.
 * `alreadyEncoded` keeps valid %XX escapes; `plusIsSpace` encodes '+' as %2B and keeps
 * nothing else special (used for decoded query components).
 */
export function canonicalize(
  input: string,
  encodeSet: string,
  { alreadyEncoded = false, strict = false, plusIsSpace = false, unicodeAllowed = false } = {},
): string {
  let out = '';
  for (let i = 0; i < input.length; ) {
    const cp = input.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    const ch = input.slice(i, i + len);
    if (alreadyEncoded && (ch === '\t' || ch === '\n' || ch === '\f' || ch === '\r')) {
      // dropped
    } else if (ch === ' ' && encodeSet === FORM_ENCODE_SET) {
      out += '+';
    } else if (ch === '+' && plusIsSpace) {
      out += alreadyEncoded ? '+' : '%2B';
    } else if (
      cp < 0x20 ||
      cp === 0x7f ||
      (cp >= 0x80 && !unicodeAllowed) ||
      encodeSet.includes(ch) ||
      (ch === '%' && (!alreadyEncoded || (strict && !isPercentEncoded(input, i))))
    ) {
      for (const b of utf8Bytes(cp)) out += pct(b);
    } else {
      out += ch;
    }
    i += len;
  }
  return out;
}

function isPercentEncoded(s: string, i: number): boolean {
  return i + 2 < s.length && s[i] === '%' && /[0-9a-fA-F]/.test(s[i + 1]) && /[0-9a-fA-F]/.test(s[i + 2]);
}

export function percentDecode(s: string, plusIsSpace = false): string {
  const bytes: number[] = [];
  let out = '';
  const flush = () => {
    if (bytes.length) {
      out += new TextDecoder().decode(Uint8Array.from(bytes));
      bytes.length = 0;
    }
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '%' && isPercentEncodedAt(s, i)) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      flush();
      out += c === '+' && plusIsSpace ? ' ' : c;
    }
  }
  flush();
  return out;
}

function isPercentEncodedAt(s: string, i: number): boolean {
  return i + 2 < s.length + 0 && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3));
}

function defaultPort(scheme: string): number {
  return scheme === 'https' ? 443 : scheme === 'http' ? 80 : -1;
}

type Query = [string, string | null][];

export class HttpUrl {
  constructor(
    readonly scheme: string,
    readonly username: string,
    readonly password: string,
    readonly host: string,
    readonly port: number,
    /** encoded segments */
    readonly encodedPathSegments: string[],
    /** encoded name/value pairs, or null when there is no query at all */
    readonly encodedQueryPairs: Query | null,
    readonly encodedFragment: string | null,
  ) {}

  static Companion = {
    get: (s: string) => HttpUrl.get(s),
    parse: (s: string) => HttpUrl.parse(s),
  };

  static get(s: string): HttpUrl {
    const u = parseHttpUrl(str(s));
    if (!u) throw new IllegalArgumentException(`Expected URL scheme 'http' or 'https' but was '${s}'`);
    return u;
  }
  static parse(s: string): HttpUrl | null {
    return parseHttpUrl(str(s));
  }

  get isHttps(): boolean {
    return this.scheme === 'https';
  }
  get encodedUsername(): string {
    return this.username;
  }
  get encodedPassword(): string {
    return this.password;
  }
  get encodedPath(): string {
    return '/' + this.encodedPathSegments.join('/');
  }
  get pathSegments(): string[] {
    return this.encodedPathSegments.map((s) => percentDecode(s));
  }
  get pathSize(): number {
    return this.encodedPathSegments.length;
  }
  get encodedQuery(): string | null {
    if (!this.encodedQueryPairs) return null;
    return this.encodedQueryPairs.map(([n, v]) => (v === null ? n : `${n}=${v}`)).join('&');
  }
  get query(): string | null {
    if (!this.encodedQueryPairs) return null;
    return this.encodedQueryPairs.map(([n, v]) => (v === null ? percentDecode(n, true) : `${percentDecode(n, true)}=${percentDecode(v, true)}`)).join('&');
  }
  get querySize(): number {
    return this.encodedQueryPairs?.length ?? 0;
  }
  get queryParameterNames(): Set<string> {
    return new Set((this.encodedQueryPairs ?? []).map(([n]) => percentDecode(n, true)));
  }
  get fragment(): string | null {
    return this.encodedFragment === null ? null : percentDecode(this.encodedFragment);
  }
  queryParameter(name: string): string | null {
    for (const [n, v] of this.encodedQueryPairs ?? []) if (percentDecode(n, true) === name) return v === null ? null : percentDecode(v, true);
    return null;
  }
  queryParameterValues(name: string): (string | null)[] {
    return (this.encodedQueryPairs ?? []).filter(([n]) => percentDecode(n, true) === name).map(([, v]) => (v === null ? null : percentDecode(v, true)));
  }
  queryParameterName(i: number): string {
    return percentDecode(this.encodedQueryPairs![i][0], true);
  }
  queryParameterValue(i: number): string | null {
    const v = this.encodedQueryPairs![i][1];
    return v === null ? null : percentDecode(v, true);
  }
  topPrivateDomain(): string | null {
    const parts = this.host.split('.');
    if (parts.length < 2 || /^\d+$/.test(parts[parts.length - 1])) return null;
    const twoLevel = /^(co|com|net|org|gov|edu|ac|or|ne|go)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
    return parts.slice(twoLevel ? -3 : -2).join('.');
  }
  resolve(link: string): HttpUrl | null {
    const r = resolveUrl(this.toString(), str(link));
    return r ? parseHttpUrl(r) : null;
  }
  newBuilder(link?: string): HttpUrlBuilder | null {
    if (link !== undefined) {
      const r = this.resolve(link);
      return r ? r.newBuilder() : null;
    }
    const b = new HttpUrlBuilder();
    b.$scheme = this.scheme;
    b.$username = this.username;
    b.$password = this.password;
    b.$host = this.host;
    b.$port = this.port;
    b.$segments = [...this.encodedPathSegments];
    b.$query = this.encodedQueryPairs ? this.encodedQueryPairs.map(([n, v]) => [n, v] as [string, string | null]) : null;
    b.$fragment = this.encodedFragment;
    return b;
  }
  redact(): string {
    return this.newBuilder('/...')!.username('').password('').build().toString();
  }
  uri(): string {
    return this.toString();
  }
  toUri(): string {
    return this.toString();
  }
  url(): string {
    return this.toString();
  }
  toUrl(): string {
    return this.toString();
  }
  equals(o: any): boolean {
    return o instanceof HttpUrl && o.toString() === this.toString();
  }
  hashCode(): number {
    let h = 0;
    const s = this.toString();
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h;
  }
  toString(): string {
    let s = this.scheme + '://';
    if (this.username || this.password) {
      s += this.username;
      if (this.password) s += ':' + this.password;
      s += '@';
    }
    s += this.host.includes(':') ? `[${this.host}]` : this.host;
    if (this.port !== defaultPort(this.scheme)) s += ':' + this.port;
    s += this.encodedPath;
    const q = this.encodedQuery;
    if (q !== null) s += '?' + q;
    if (this.encodedFragment !== null) s += '#' + this.encodedFragment;
    return s;
  }
}

export class HttpUrlBuilder {
  $scheme: string | null = null;
  $username = '';
  $password = '';
  $host: string | null = null;
  $port = -1;
  $segments: string[] = [''];
  $query: Query | null = null;
  $fragment: string | null = null;

  scheme(s: string): this {
    const l = s.toLowerCase();
    if (l !== 'http' && l !== 'https') throw new IllegalArgumentException(`unexpected scheme: ${s}`);
    this.$scheme = l;
    return this;
  }
  username(u: string): this {
    this.$username = canonicalize(u, ' "\':;<=>@[]^`{}|/\\?#');
    return this;
  }
  encodedUsername(u: string): this {
    this.$username = canonicalize(u, ' "\':;<=>@[]^`{}|/\\?#', { alreadyEncoded: true });
    return this;
  }
  password(p: string): this {
    this.$password = canonicalize(p, ' "\':;<=>@[]^`{}|/\\?#');
    return this;
  }
  encodedPassword(p: string): this {
    this.$password = canonicalize(p, ' "\':;<=>@[]^`{}|/\\?#', { alreadyEncoded: true });
    return this;
  }
  host(h: string): this {
    const host = canonicalHost(h);
    if (!host) throw new IllegalArgumentException(`unexpected host: ${h}`);
    this.$host = host;
    return this;
  }
  port(p: number): this {
    if (p <= 0 || p > 65535) throw new IllegalArgumentException(`unexpected port: ${p}`);
    this.$port = p;
    return this;
  }
  addPathSegment(seg: string): this {
    this.pushSegments(seg, false, false);
    return this;
  }
  addPathSegments(segs: string): this {
    this.pushSegments(segs, true, false);
    return this;
  }
  addEncodedPathSegment(seg: string): this {
    this.pushSegments(seg, false, true);
    return this;
  }
  addEncodedPathSegments(segs: string): this {
    this.pushSegments(segs, true, true);
    return this;
  }
  setPathSegment(i: number, seg: string): this {
    this.$segments[i] = canonicalize(seg, PATH_SEGMENT_ENCODE_SET);
    return this;
  }
  setEncodedPathSegment(i: number, seg: string): this {
    this.$segments[i] = canonicalize(seg, PATH_SEGMENT_ENCODE_SET, { alreadyEncoded: true });
    return this;
  }
  removePathSegment(i: number): this {
    this.$segments.splice(i, 1);
    if (this.$segments.length === 0) this.$segments.push('');
    return this;
  }
  encodedPath(p: string): this {
    if (!p.startsWith('/')) throw new IllegalArgumentException(`unexpected encodedPath: ${p}`);
    this.$segments = resolvePath(p).slice(1).split('/').map((s) => canonicalize(s, PATH_SEGMENT_ENCODE_SET, { alreadyEncoded: true }));
    return this;
  }
  query(q: string | null): this {
    this.$query = q === null ? null : splitQuery(canonicalize(q, QUERY_ENCODE_SET, { plusIsSpace: true }));
    return this;
  }
  encodedQuery(q: string | null): this {
    this.$query = q === null ? null : splitQuery(canonicalize(q, QUERY_ENCODE_SET, { alreadyEncoded: true, plusIsSpace: true }));
    return this;
  }
  addQueryParameter(name: string, value: string | null): this {
    (this.$query ??= []).push([
      canonicalize(str(name), QUERY_COMPONENT_ENCODE_SET, { plusIsSpace: true }),
      value === null || value === undefined ? null : canonicalize(str(value), QUERY_COMPONENT_ENCODE_SET, { plusIsSpace: true }),
    ]);
    return this;
  }
  addEncodedQueryParameter(name: string, value: string | null): this {
    (this.$query ??= []).push([
      canonicalize(str(name), QUERY_COMPONENT_REENCODE_SET, { alreadyEncoded: true, plusIsSpace: true }),
      value === null || value === undefined ? null : canonicalize(str(value), QUERY_COMPONENT_REENCODE_SET, { alreadyEncoded: true, plusIsSpace: true }),
    ]);
    return this;
  }
  setQueryParameter(name: string, value: string | null): this {
    this.removeAllQueryParameters(name);
    return this.addQueryParameter(name, value);
  }
  setEncodedQueryParameter(name: string, value: string | null): this {
    this.removeAllEncodedQueryParameters(name);
    return this.addEncodedQueryParameter(name, value);
  }
  removeAllQueryParameters(name: string): this {
    if (this.$query) {
      const enc = canonicalize(name, QUERY_COMPONENT_ENCODE_SET, { plusIsSpace: true });
      this.$query = this.$query.filter(([n]) => n !== enc && percentDecode(n, true) !== name);
      if (!this.$query.length) this.$query = null;
    }
    return this;
  }
  removeAllEncodedQueryParameters(name: string): this {
    if (this.$query) {
      this.$query = this.$query.filter(([n]) => n !== name);
      if (!this.$query.length) this.$query = null;
    }
    return this;
  }
  fragment(f: string | null): this {
    this.$fragment = f === null ? null : canonicalize(f, FRAGMENT_ENCODE_SET, { unicodeAllowed: true });
    return this;
  }
  encodedFragment(f: string | null): this {
    this.$fragment = f === null ? null : canonicalize(f, FRAGMENT_ENCODE_SET, { alreadyEncoded: true, unicodeAllowed: true });
    return this;
  }
  build(): HttpUrl {
    if (!this.$scheme) throw new IllegalArgumentException('scheme == null');
    if (!this.$host) throw new IllegalArgumentException('host == null');
    const port = this.$port === -1 ? defaultPort(this.$scheme) : this.$port;
    return new HttpUrl(this.$scheme, this.$username, this.$password, this.$host, port, [...this.$segments], this.$query ? this.$query.map((p) => [...p] as [string, string | null]) : null, this.$fragment);
  }
  toString(): string {
    return this.build().toString();
  }

  private pushSegments(input: string, multiple: boolean, encoded: boolean): void {
    const parts = multiple ? input.split(/[/\\]/) : [input];
    for (const p of parts) {
      const seg = canonicalize(p, PATH_SEGMENT_ENCODE_SET, { alreadyEncoded: encoded });
      if (seg === '.' || seg.toLowerCase() === '%2e') continue;
      if (seg === '..' || /^(%2e|\.)(%2e|\.)$/i.test(seg)) {
        if (this.$segments.length > 1 || this.$segments[0] !== '') {
          const last = this.$segments.pop();
          if (last === '' && this.$segments.length) this.$segments.pop();
          this.$segments.push('');
        }
        continue;
      }
      if (this.$segments[this.$segments.length - 1] === '') this.$segments[this.$segments.length - 1] = seg;
      else this.$segments.push(seg);
    }
  }
}

(HttpUrl as any).Builder = HttpUrlBuilder;

function splitQuery(q: string): Query {
  return q.split('&').map((p) => {
    const i = p.indexOf('=');
    return i < 0 ? [p, null] : [p.slice(0, i), p.slice(i + 1)];
  });
}

function canonicalHost(h: string): string | null {
  let host = percentDecode(h).trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host || /[\s#%/:?@[\\\]]/.test(host.replace(/:/g, host.includes('.') ? ':' : ''))) {
    if (!/^[0-9a-f:]+$/.test(host)) return null;
  }
  // Non-ASCII hosts would need punycode; keep as-is (rare for manga sites).
  return host;
}

const URL_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(?:([^@/?#]*)@)?(\[[^\]]+\]|[^:/?#]*)(?::(\d*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;

export function parseHttpUrl(input: string): HttpUrl | null {
  const s = input.trim().replace(/[\t\n\r]/g, '').replace(/\\/g, '/');
  const m = URL_RE.exec(s);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return null;
  const host = canonicalHost(m[3]);
  if (!host) return null;
  let username = '';
  let password = '';
  if (m[2] !== undefined) {
    const i = m[2].indexOf(':');
    username = canonicalize(i < 0 ? m[2] : m[2].slice(0, i), ' "\':;<=>@[]^`{}|/\\?#', { alreadyEncoded: true });
    password = i < 0 ? '' : canonicalize(m[2].slice(i + 1), ' "\':;<=>@[]^`{}|/\\?#', { alreadyEncoded: true });
  }
  let port = defaultPort(scheme);
  if (m[4]) {
    port = parseInt(m[4], 10);
    if (!(port > 0 && port <= 65535)) return null;
  }
  const rawPath = m[5] || '/';
  const path = resolvePath(rawPath.startsWith('/') ? rawPath : '/' + rawPath);
  const segments = path
    .slice(1)
    .split('/')
    .map((seg) => canonicalize(seg, PATH_SEGMENT_ENCODE_SET, { alreadyEncoded: true }));
  const query = m[6] === undefined ? null : splitQuery(canonicalize(m[6], QUERY_ENCODE_SET, { alreadyEncoded: true, plusIsSpace: true }));
  const fragment = m[7] === undefined ? null : canonicalize(m[7], FRAGMENT_ENCODE_SET, { alreadyEncoded: true, unicodeAllowed: true });
  return new HttpUrl(scheme, username, password, host, port, segments, query, fragment);
}

/** RFC 3986 remove_dot_segments */
function resolvePath(path: string): string {
  const input = path.split('/');
  const out: string[] = [];
  for (let i = 0; i < input.length; i++) {
    const seg = input[i];
    if (seg === '.' || seg.toLowerCase() === '%2e') {
      if (i === input.length - 1) out.push('');
      continue;
    }
    if (seg === '..' || /^(%2e|\.)(%2e|\.)$/i.test(seg)) {
      if (out.length > 1) out.pop();
      if (i === input.length - 1) out.push('');
      continue;
    }
    out.push(seg);
  }
  const joined = out.join('/');
  return joined.startsWith('/') ? joined : '/' + joined;
}

const ABS_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/** Resolve `ref` against `base` like a browser / java.net.URL. Returns null if impossible. */
export function resolveUrl(base: string, ref: string): string | null {
  const r = ref.trim().replace(/[\t\n\r]/g, '');
  if (ABS_RE.test(r)) {
    const scheme = ABS_RE.exec(r)![1].toLowerCase();
    if (scheme === 'http' || scheme === 'https') {
      // "http:/path" or "https:path" relative-with-scheme forms are rare; treat as absolute.
      const u = parseHttpUrl(r);
      return u ? u.toString() : r;
    }
    return r;
  }
  const b = parseHttpUrl(base);
  if (!b) return null;
  if (r.startsWith('//')) {
    const u = parseHttpUrl(b.scheme + ':' + r);
    return u ? u.toString() : null;
  }
  const [beforeFrag, frag] = splitOnce(r, '#');
  const [pathPart, query] = splitOnce(beforeFrag, '?');
  let path: string;
  let q: string | null;
  if (pathPart === '') {
    path = b.encodedPath;
    q = query !== null ? query : b.encodedQuery;
  } else if (pathPart.startsWith('/')) {
    path = resolvePath(pathPart);
    q = query;
  } else {
    const dir = b.encodedPath.slice(0, b.encodedPath.lastIndexOf('/') + 1);
    path = resolvePath(dir + pathPart);
    q = query;
  }
  let s = `${b.scheme}://${b.toString().slice(b.scheme.length + 3).split(/[/?#]/)[0]}${path}`;
  if (q !== null) s += '?' + q;
  if (frag !== null) s += '#' + frag;
  const u = parseHttpUrl(s);
  return u ? u.toString() : s;
}

function splitOnce(s: string, sep: string): [string, string | null] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, null] : [s.slice(0, i), s.slice(i + 1)];
}

export function toHttpUrl(s: string): HttpUrl {
  return HttpUrl.get(s);
}
export function toHttpUrlOrNull(s: string): HttpUrl | null {
  return HttpUrl.parse(s);
}

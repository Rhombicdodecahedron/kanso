// keiyoushi.network.* and keiyoushi.utils.* (the extension repo's `core` module).

import { IllegalStateException, type ExtDef, isStr, NullPointerException, str, is as kIs } from '../kotlin/core';
import { Named, positional } from '../kotlin/named';
import { ext, extProp, hof } from '../kotlin/hof';
import { NoSuchElementException } from '../kotlin/core';
import { Jsoup, Element, Elements, Parser, type Document } from '../jsoup';
import {
  BufferedSource,
  CacheControl,
  CacheControlBuilder,
  HttpException,
  Headers,
  InputStream,
  MediaType,
  OkHttpClient,
  OkHttpClientBuilder,
  Request,
  RequestBuilder,
  RequestBody,
  Response,
  toRequestBody,
} from '../okhttp';
import { HttpUrl, toHttpUrl } from '../okhttp/url';
import {
  elementToJS,
  Json,
  JsonArray,
  JsonNull,
  JsonObject,
  JsonPrimitive,
  jsonArray,
  jsonObject,
  jsonPrimitive,
  primBoolean,
  primBooleanOrNull,
  primDouble,
  primDoubleOrNull,
  primInt,
  primIntOrNull,
  T,
  type Desc,
} from '../serialization/json';
import { getPreferencesFor } from '../source';
import { Lazy } from '../kotlin/core';

const isClient = (x: any) => x instanceof OkHttpClient;
const isBuilder = (x: any) => x instanceof OkHttpClientBuilder;
const isResponse = (x: any) => x instanceof Response;
const isEl = (x: any) => x instanceof JsonObject || x instanceof JsonArray || x instanceof JsonPrimitive;
const isElOrNull = (x: any) => x === null || x === undefined || isEl(x);

export const jsonInstance = new Json();
export const JSON_MEDIA_TYPE = MediaType.get('application/json');
export const DEFAULT_CACHE_CONTROL = new CacheControlBuilder().maxAge(600).build();

// ---------- network ----------

function sourceHeaders(client: OkHttpClient): Headers {
  const src = client.cfg.source;
  if (!src) throw new IllegalStateException('Request helper without headers needs a source context');
  return src.headers;
}

async function send(client: OkHttpClient, req: Request, ensureSuccess: boolean): Promise<Response> {
  const call = client.newCall(req);
  return ensureSuccess ? call.awaitSuccess() : call.await();
}

/** Overloads: (url, headers, cacheControl?, ensureSuccess?) and (url, cacheControl?, ensureSuccess?). */
function getArgs(client: OkHttpClient, args: any[]) {
  const n = args[args.length - 1] instanceof Named ? (args.pop() as Named).values : {};
  const [url, a, b, c] = args;
  let headers: Headers;
  let cache: CacheControl;
  let ensure: boolean;
  if (a instanceof Headers) {
    headers = a;
    cache = b ?? n.cacheControl ?? DEFAULT_CACHE_CONTROL;
    ensure = c ?? n.ensureSuccess ?? true;
  } else {
    headers = n.headers ?? sourceHeaders(client);
    cache = a instanceof CacheControl ? a : (n.cacheControl ?? DEFAULT_CACHE_CONTROL);
    ensure = typeof a === 'boolean' ? a : (b ?? n.ensureSuccess ?? true);
  }
  return { url: url instanceof HttpUrl ? url : toHttpUrl(str(url)), headers, cache, ensure };
}

function bodyArgs(client: OkHttpClient, args: any[]) {
  const n = args[args.length - 1] instanceof Named ? (args.pop() as Named).values : {};
  const [url, a, b, c] = args;
  let headers: Headers;
  let body: RequestBody;
  let ensure: boolean;
  if (a instanceof Headers) {
    headers = a;
    body = b ?? n.body;
    ensure = c ?? n.ensureSuccess ?? true;
  } else {
    headers = n.headers ?? sourceHeaders(client);
    body = a ?? n.body;
    ensure = b ?? n.ensureSuccess ?? true;
  }
  return { url: url instanceof HttpUrl ? url : toHttpUrl(str(url)), headers, body, ensure };
}

const networkGet: ExtDef = {
  name: 'get',
  recv: isClient,
  suspend: true,
  fn: (client: OkHttpClient, ...args: any[]) => {
    const { url, headers, cache, ensure } = getArgs(client, args);
    return send(client, new RequestBuilder().url(url).headers(headers).cacheControl(cache).build(), ensure);
  },
};
const networkHead: ExtDef = {
  name: 'head',
  recv: isClient,
  suspend: true,
  fn: (client: OkHttpClient, ...args: any[]) => {
    const { url, headers, cache, ensure } = getArgs(client, args);
    return send(client, new RequestBuilder().url(url).headers(headers).cacheControl(cache).head().build(), ensure);
  },
};
const networkPost: ExtDef = {
  name: 'post',
  recv: isClient,
  suspend: true,
  fn: (client: OkHttpClient, ...args: any[]) => {
    const { url, headers, body, ensure } = bodyArgs(client, args);
    return send(client, new RequestBuilder().url(url).headers(headers).post(body).build(), ensure);
  },
};
const networkPut: ExtDef = {
  name: 'put',
  recv: isClient,
  suspend: true,
  fn: (client: OkHttpClient, ...args: any[]) => {
    const { url, headers, body, ensure } = bodyArgs(client, args);
    return send(client, new RequestBuilder().url(url).headers(headers).put(body).build(), ensure);
  },
};

// Call.await()/awaitSuccess() are members of our Call; legacy extension forms:
const callAwait: ExtDef = { name: 'await', recv: (x) => typeof x?.await === 'function', fn: (c: any) => c.await(), suspend: true };
const callAwaitSuccess: ExtDef = { name: 'awaitSuccess', recv: (x) => typeof x?.awaitSuccess === 'function', fn: (c: any) => c.awaitSuccess(), suspend: true };

// ---------- rate limiting ----------

interface RateRule {
  permits: number;
  periodMs: number;
  intervalMs: number;
  shouldLimit: (u: HttpUrl) => boolean;
  stamps: number[];
  last: number;
  queue: Promise<void>;
}

function durMs(d: any, unit?: any): number {
  if (d === undefined || d === null) return 1000;
  if (typeof d === 'number') return unit?.toMillis ? unit.toMillis(d) : d * 1000;
  if (typeof d.inWholeMilliseconds === 'number') return d.inWholeMilliseconds;
  return Number(d);
}

class RateLimitInterceptor {
  static $name = 'RateLimitInterceptor';
  rules: RateRule[] = [];
  addRule(r: RateRule): void {
    this.rules.push(r);
  }
  async intercept(chain: any): Promise<Response> {
    const req: Request = chain.request();
    const rule = this.rules.find((r) => r.shouldLimit(req.url) === true);
    if (rule) await acquire(rule);
    return chain.proceed(req);
  }
}

function acquire(rule: RateRule): Promise<void> {
  const run = async () => {
    for (;;) {
      const now = Date.now();
      rule.stamps = rule.stamps.filter((t) => now - t < rule.periodMs);
      const waitInterval = rule.last + rule.intervalMs - now;
      const waitPermit = rule.stamps.length >= rule.permits ? rule.stamps[0] + rule.periodMs - now : 0;
      const wait = Math.max(waitInterval, waitPermit, 0);
      if (wait <= 0) break;
      await new Promise((r) => setTimeout(r, wait));
    }
    const t = Date.now();
    rule.stamps.push(t);
    rule.last = t;
  };
  const p = rule.queue.then(run);
  rule.queue = p.catch(() => {});
  return p;
}

function addRateRule(b: OkHttpClientBuilder, rule: RateRule): OkHttpClientBuilder {
  const existing = b.cfg.networkInterceptors.find((i: any) => i instanceof RateLimitInterceptor) as RateLimitInterceptor | undefined;
  if (existing) existing.addRule(rule);
  else {
    const i = new RateLimitInterceptor();
    i.addRule(rule);
    b.addNetworkInterceptor(i);
  }
  return b;
}

const rateLimit: ExtDef = {
  name: 'rateLimit',
  recv: isBuilder,
  params: ['permits', 'period', 'interval', 'shouldLimit'],
  fn: (b: OkHttpClientBuilder, ...raw: any[]) => {
    const args = positional(['permits', 'period', 'interval', 'shouldLimit'], raw, 'rateLimit');
    const [permits, period, interval, shouldLimit] = args;
    // Legacy form: rateLimit(permits, period: Long, unit: TimeUnit)
    const legacyUnit = interval && typeof interval.toMillis === 'function' ? interval : null;
    return addRateRule(b, {
      permits,
      periodMs: legacyUnit ? durMs(period, legacyUnit) : durMs(period),
      intervalMs: legacyUnit ? 0 : interval ? durMs(interval) : 0,
      shouldLimit: typeof shouldLimit === 'function' ? shouldLimit : () => true,
      stamps: [],
      last: 0,
      queue: Promise.resolve(),
    });
  },
};

/** Legacy eu.kanade.tachiyomi.network.interceptor.rateLimitHost(url, permits, period, unit) */
const rateLimitHost: ExtDef = {
  name: 'rateLimitHost',
  recv: isBuilder,
  fn: (b: OkHttpClientBuilder, url: any, permits: number, period: any = 1, unit?: any) => {
    const host = (url instanceof HttpUrl ? url : toHttpUrl(str(url))).host;
    return addRateRule(b, {
      permits,
      periodMs: durMs(period, unit),
      intervalMs: 0,
      shouldLimit: (u) => u.host === host,
      stamps: [],
      last: 0,
      queue: Promise.resolve(),
    });
  },
};

// ---------- cookies ----------

class CookieInterceptor {
  configs: { domain: () => string; cookies: () => any[] }[] = [];
  async intercept(chain: any): Promise<Response> {
    const request: Request = chain.request();
    let match: [string, any[]] | null = null;
    for (const c of this.configs) {
      const d = c.domain();
      if (request.url.host === d || request.url.host.endsWith('.' + d)) {
        match = [d, c.cookies()];
        break;
      }
    }
    if (!match) return chain.proceed(request);
    const cookies = match[1];
    const list = request.header('Cookie')?.split('; ') ?? [];
    const kept = list.filter((e) => !cookies.some((p) => e.startsWith(`${p.first}=`)));
    const merged = [...kept, ...cookies.map((p) => `${p.first}=${p.second}`)].join('; ');
    return chain.proceed(request.newBuilder().header('Cookie', merged).build());
  }
}

const addCookie: ExtDef = {
  name: 'addCookie',
  recv: isBuilder,
  fn: (b: OkHttpClientBuilder, a: any, c?: any) => {
    let domain: () => string;
    let cookies: () => any[];
    if (c === undefined) {
      const src = b.cfg.source;
      domain = () => toHttpUrl(src.baseUrl).host;
      cookies = typeof a === 'function' ? a : Array.isArray(a) ? () => a : () => [a];
    } else {
      domain = a;
      cookies = typeof c === 'function' ? c : Array.isArray(c) ? () => c : () => [c];
    }
    let i = b.cfg.networkInterceptors.find((x: any) => x instanceof CookieInterceptor) as CookieInterceptor | undefined;
    if (!i) {
      i = new CookieInterceptor();
      b.addNetworkInterceptor(i);
    }
    i.configs.push({ domain, cookies });
    return b;
  },
};

// ---------- json ----------

function jsonArg(args: any[]): { json: Json; transform: ((s: string) => string) | null; desc: Desc } {
  // parseAs(json?, transform?) + reified descriptor appended by the translator
  const desc: Desc = args[args.length - 1] && typeof args[args.length - 1].k === 'string' ? args.pop() : T.any;
  let json = jsonInstance;
  let transform: ((s: string) => string) | null = null;
  for (const a of args) {
    if (a instanceof Json) json = a;
    else if (typeof a === 'function') transform = a;
    else if (a instanceof Named) {
      if (a.values.json) json = a.values.json;
      if (a.values.transform) transform = a.values.transform;
    }
  }
  return { json, transform, desc };
}

const parseAs: ExtDef[] = [
  {
    name: 'parseAs',
    recv: isResponse,
    reified: 'desc',
    fn: (r: Response, ...args: any[]) => {
      const { json, transform, desc } = jsonArg(args);
      const text = r.body.string();
      return json.decodeFromString(transform ? transform(text) : text, desc);
    },
  },
  {
    name: 'parseAs',
    recv: isStr,
    reified: 'desc',
    fn: (s: string, ...args: any[]) => {
      const { json, transform, desc } = jsonArg(args);
      return json.decodeFromString(transform ? transform(s) : s, desc);
    },
  },
  {
    name: 'parseAs',
    recv: isEl,
    reified: 'desc',
    fn: (e: any, ...args: any[]) => {
      const { json, desc } = jsonArg(args);
      return json.decodeFromJsonElement(e, desc);
    },
  },
  {
    name: 'parseAs',
    recv: (x) => x instanceof BufferedSource || x instanceof InputStream,
    reified: 'desc',
    fn: (s: any, ...args: any[]) => {
      const { json, desc } = jsonArg(args);
      const text = s instanceof BufferedSource ? s.readUtf8() : new TextDecoder().decode(s.readBytes());
      return json.decodeFromString(text, desc);
    },
  },
];

const toJsonString: ExtDef = {
  name: 'toJsonString',
  recv: () => true,
  reified: 'desc',
  fn: (v: any, ...args: any[]) => jsonArg(args).json.encodeToString(v),
};
const toJsonRequestBody: ExtDef = {
  name: 'toJsonRequestBody',
  recv: () => true,
  reified: 'desc',
  fn: (v: any, ...args: any[]) => toRequestBody(jsonArg(args).json.encodeToString(v), JSON_MEDIA_TYPE),
};
const toJsonElement: ExtDef = {
  name: 'toJsonElement',
  recv: () => true,
  reified: 'desc',
  fn: (v: any, ...args: any[]) => jsonArg(args).json.encodeToJsonElement(v),
};

// kotlinx.serialization.json accessor extensions + keiyoushi shorthands.
const prim = (e: any) => jsonPrimitive(e);
export const jsonExts: ExtDef[] = [
  extProp('jsonObject', isEl, jsonObject),
  extProp('jsonArray', isEl, jsonArray),
  extProp('jsonPrimitive', isEl, jsonPrimitive),
  extProp('jsonNull', isEl, (e) => (e === JsonNull ? e : (() => { throw new IllegalStateException('Element is not JsonNull'); })())),
  extProp('obj', isEl, jsonObject),
  extProp('array', isEl, jsonArray),
  extProp('content', isEl, (e) => prim(e).content),
  extProp('contentOrNull', isEl, (e) => prim(e).contentOrNull),
  extProp('string', isEl, (e) => prim(e).content),
  extProp('stringOrNull', isEl, (e) => prim(e).contentOrNull),
  extProp('int', isEl, (e) => primInt(prim(e))),
  extProp('intOrNull', isEl, (e) => primIntOrNull(prim(e))),
  extProp('long', isEl, (e) => primInt(prim(e))),
  extProp('longOrNull', isEl, (e) => primIntOrNull(prim(e))),
  extProp('double', isEl, (e) => primDouble(prim(e))),
  extProp('doubleOrNull', isEl, (e) => primDoubleOrNull(prim(e))),
  extProp('float', isEl, (e) => primDouble(prim(e))),
  extProp('floatOrNull', isEl, (e) => primDoubleOrNull(prim(e))),
  extProp('boolean', isEl, (e) => primBoolean(prim(e))),
  extProp('booleanOrNull', isEl, (e) => primBooleanOrNull(prim(e))),
  ext('getString', (x) => x instanceof JsonObject, (o, k) => prim(getValue(o, k)).content),
  ext('getStringOrNull', (x) => x instanceof JsonObject, (o, k) => (o.get(k) ? prim(o.get(k)).contentOrNull : null)),
  ext('getInt', (x) => x instanceof JsonObject, (o, k) => primInt(prim(getValue(o, k)))),
  ext('getIntOrNull', (x) => x instanceof JsonObject, (o, k) => (o.get(k) ? primIntOrNull(prim(o.get(k))) : null)),
  ext('getLong', (x) => x instanceof JsonObject, (o, k) => primInt(prim(getValue(o, k)))),
  ext('getLongOrNull', (x) => x instanceof JsonObject, (o, k) => (o.get(k) ? primIntOrNull(prim(o.get(k))) : null)),
  ext('getBoolean', (x) => x instanceof JsonObject, (o, k) => primBoolean(prim(getValue(o, k)))),
  ext('getBooleanOrNull', (x) => x instanceof JsonObject, (o, k) => (o.get(k) ? primBooleanOrNull(prim(o.get(k))) : null)),
  ext('getArray', (x) => x instanceof JsonObject, (o, k) => jsonArray(getValue(o, k))),
  ext('getArrayOrNull', (x) => x instanceof JsonObject, (o, k) => (o.get(k) ? jsonArray(o.get(k)) : null)),
  ext('getObject', (x) => x instanceof JsonObject, (o, k) => jsonObject(getValue(o, k))),
  ext('getObjectOrNull', (x) => x instanceof JsonObject, (o, k) => (o.get(k) ? jsonObject(o.get(k)) : null)),
  // operator fun JsonElement?.get(key|index)
  ext('get', isElOrNull, (e, k) => {
    if (e === null || e === undefined) return null;
    if (typeof k === 'number') return e instanceof JsonArray ? (e[k] ?? null) : jsonArray(e)[k];
    return jsonObject(e).get(k) ?? null;
  }),
];

function getValue(o: JsonObject, k: string): any {
  if (!o.has(k)) throw new NoSuchElementException(`Key ${k} is missing in the map.`);
  return o.get(k);
}

// ---------- jsoup helpers ----------

const asJsoup: ExtDef[] = [
  {
    name: 'asJsoup',
    recv: isResponse,
    fn: (r: Response, parser?: Parser) => {
      const base = r.request.url.toString();
      return parser instanceof Parser ? parser.parseInput(r.body.string(), base) : Jsoup.parse(r.body.string(), base);
    },
  },
  {
    name: 'asJsoup',
    recv: isStr,
    fn: (s: string, baseUrl = '', parser?: Parser) => (parser instanceof Parser ? parser.parseInput(s, baseUrl) : Jsoup.parse(s, baseUrl)),
  },
];

const isElement = (x: any) => x instanceof Element;
export const jsoupExts: ExtDef[] = [
  ext('attrOrNull', isElement, (e: Element, k: string) => {
    const v = e.attr(k);
    return v.trim() === '' ? null : v.trim();
  }),
  ext('selectLast', isElement, (e: Element, q: string) => {
    const s = e.select(q);
    return s.length ? s[s.length - 1] : null;
  }),
  ext('textOrNull', (x) => x instanceof Element || x instanceof Elements, (e: any) => {
    const t = e.text();
    return t === '' ? null : t;
  }),
  ext('ownTextOrNull', isElement, (e: Element) => {
    const t = e.ownText();
    return t === '' ? null : t;
  }),
];

// ---------- collections / preferences ----------

const firstInstance: ExtDef = {
  name: 'firstInstance',
  recv: (x) => Array.isArray(x) || x instanceof Set,
  reified: 'class',
  fn: (xs: any, T: any) => {
    for (const x of xs) if (kIs(x, T)) return x;
    throw new NoSuchElementException('Collection contains no element matching the predicate.');
  },
};
const firstInstanceOrNull: ExtDef = {
  name: 'firstInstanceOrNull',
  recv: (x) => Array.isArray(x) || x instanceof Set,
  reified: 'class',
  fn: (xs: any, T: any) => {
    for (const x of xs) if (kIs(x, T)) return x;
    return null;
  },
};

const getPreferences: ExtDef = {
  name: 'getPreferences',
  recvLambda: true,
  recv: (x) => x !== null && typeof x === 'object' && 'baseUrl' in x,
  fn: (src: any, migration?: (p: any) => void) => {
    const p = getPreferencesFor(src);
    if (typeof migration === 'function') migration(p);
    return p;
  },
};
const getPreferencesLazy: ExtDef = {
  name: 'getPreferencesLazy',
  recvLambda: true,
  recv: (x) => x !== null && typeof x === 'object' && 'baseUrl' in x,
  fn: (src: any, migration?: (p: any) => void) =>
    new Lazy(() => {
      const p = getPreferencesFor(src);
      if (typeof migration === 'function') migration(p);
      return p;
    }),
};

export const keiyoushiModules: Record<string, unknown> = {
  'keiyoushi.network.get': [networkGet],
  'keiyoushi.network.post': [networkPost],
  'keiyoushi.network.put': [networkPut],
  'keiyoushi.network.head': [networkHead],
  'keiyoushi.network.rateLimit': [rateLimit],
  'keiyoushi.network.addCookie': [addCookie],
  'keiyoushi.network.DEFAULT_CACHE_CONTROL': DEFAULT_CACHE_CONTROL,
  'keiyoushi.network.RateLimitInterceptor': RateLimitInterceptor,
  'eu.kanade.tachiyomi.network.interceptor.rateLimit': [rateLimit],
  'eu.kanade.tachiyomi.network.interceptor.rateLimitHost': [rateLimitHost],
  'eu.kanade.tachiyomi.network.await': [callAwait],
  'eu.kanade.tachiyomi.network.awaitSuccess': [callAwaitSuccess],
  'keiyoushi.utils.parseAs': parseAs,
  'keiyoushi.utils.toJsonString': [toJsonString],
  'keiyoushi.utils.toJsonRequestBody': [toJsonRequestBody],
  'keiyoushi.utils.toJsonElement': [toJsonElement],
  'keiyoushi.utils.jsonInstance': jsonInstance,
  'keiyoushi.utils.JSON_MEDIA_TYPE': JSON_MEDIA_TYPE,
  'keiyoushi.utils.asJsoup': asJsoup,
  'keiyoushi.utils.firstInstance': [firstInstance],
  'keiyoushi.utils.firstInstanceOrNull': [firstInstanceOrNull],
  'keiyoushi.utils.getPreferences': [getPreferences],
  'keiyoushi.utils.getPreferencesLazy': [getPreferencesLazy],
  ...Object.fromEntries(jsonExts.filter((e) => e.name !== 'jsonObject' && e.name !== 'jsonArray' && e.name !== 'jsonPrimitive' && e.name !== 'jsonNull' && e.name !== 'content' && e.name !== 'contentOrNull' && e.name !== 'double' && e.name !== 'doubleOrNull' && e.name !== 'float' && e.name !== 'floatOrNull').map((e) => [`keiyoushi.utils.${e.name}`, jsonExts.filter((x) => x.name === e.name)])),
  ...Object.fromEntries(jsoupExts.map((e) => [`keiyoushi.utils.${e.name}`, jsoupExts.filter((x) => x.name === e.name)])),
};

export { elementToJS, NullPointerException };

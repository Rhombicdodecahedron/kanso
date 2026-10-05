// keiyoushi.utils.GraphQL: request builders, response unwrapping and the error interceptor.

import { Exception, IllegalStateException, isStr, SerializationException, str, type ExtDef } from '../kotlin/core';
import { Named, positional } from '../kotlin/named';
import { CacheControl, GET, Headers, OkHttpClient, POST, Request, RequestBuilder, RequestBody, Response, toRequestBody } from '../okhttp';
import { HttpUrl, HttpUrlBuilder, toHttpUrl } from '../okhttp/url';
import { Json, JsonArray, JsonNull, JsonObject, JsonPrimitive, T, type Desc } from '../serialization/json';
import { DEFAULT_CACHE_CONTROL, JSON_MEDIA_TYPE, jsonInstance } from './index';

/** Thrown when a GraphQL response carries a non-empty `errors` array. */
export class GraphQLException extends Exception {
  static $params = ['message'];
  constructor(message: string) {
    super(message);
  }
}

const isEl = (x: any) => x instanceof JsonObject || x instanceof JsonArray || x instanceof JsonPrimitive;

/** Variables may be a JsonElement or any serializable value (the typed-variables overloads). */
function toElement(v: any, json: Json): any {
  if (v === null || v === undefined) return null;
  return isEl(v) ? v : json.encodeToJsonElement(v);
}

function jsonOrDefault(j: any): Json {
  return j instanceof Json ? j : jsonInstance;
}

/** GraphQLRequest(operationName, query, variables, extensions); null (default) fields are omitted. */
function requestObject(query: any, operationName: any, variables: any, extensions: any, json: Json): JsonObject {
  const o = new JsonObject();
  const put = (k: string, v: any) => {
    if (v !== null && v !== undefined && v !== JsonNull) Map.prototype.set.call(o, k, v);
  };
  put('operationName', operationName == null ? null : JsonPrimitive.of(str(operationName)));
  put('query', query == null ? null : JsonPrimitive.of(str(query)));
  put('variables', toElement(variables, json));
  put('extensions', toElement(extensions, json));
  return o;
}

const BODY_PARAMS = ['query', 'operationName', 'variables', 'extensions', 'json'];

export function graphQLBody(...raw: any[]): RequestBody {
  const [query, operationName, variables, extensions, json] = positional(BODY_PARAMS, stripDesc(raw), 'graphQLBody');
  const j = jsonOrDefault(json);
  return toRequestBody(j.encodeToString(requestObject(query, operationName, variables, extensions, j)), JSON_MEDIA_TYPE);
}
(graphQLBody as any).$params = BODY_PARAMS;

function appendParams(b: HttpUrlBuilder, query: any, operationName: any, variables: any, extensions: any, json: Json): HttpUrlBuilder {
  if (operationName != null) b.addQueryParameter('operationName', str(operationName));
  if (query != null) b.addQueryParameter('query', str(query));
  const v = toElement(variables, json);
  if (v !== null) b.addQueryParameter('variables', json.encodeToString(v));
  const e = toElement(extensions, json);
  if (e !== null) b.addQueryParameter('extensions', json.encodeToString(e));
  return b;
}

const appendGraphQLParams: ExtDef = {
  name: 'appendGraphQLParams',
  recv: (x) => x instanceof HttpUrlBuilder,
  params: BODY_PARAMS,
  fn: (b: HttpUrlBuilder, ...raw: any[]) => {
    const [query, operationName, variables, extensions, json] = positional(BODY_PARAMS, stripDesc(raw), 'appendGraphQLParams');
    return appendParams(b, query, operationName, variables, extensions, jsonOrDefault(json));
  },
};

const REQUEST_PARAMS = ['url', 'headers', 'query', 'operationName', 'variables', 'extensions', 'cache', 'json'];

export function graphQLPost(...raw: any[]): Request {
  const [url, headers, query, operationName, variables, extensions, cache, json] = positional(REQUEST_PARAMS, stripDesc(raw), 'graphQLPost');
  const body = graphQLBody(query, operationName, variables, extensions, json ?? undefined);
  return cache instanceof CacheControl ? POST(url, headers, body, cache) : POST(url, headers, body);
}
(graphQLPost as any).$params = REQUEST_PARAMS;

/** Top-level graphQLGet(url, headers, ...): builds a GET [Request]. */
export function graphQLGetRequest(...raw: any[]): Request {
  const [url, headers, query, operationName, variables, extensions, cache, json] = positional(REQUEST_PARAMS, stripDesc(raw), 'graphQLGet');
  const u = appendParams(toUrl(url).newBuilder()!, query, operationName, variables, extensions, jsonOrDefault(json)).build();
  return cache instanceof CacheControl ? GET(u, headers, cache) : GET(u, headers);
}

function toUrl(u: any): HttpUrl {
  return u instanceof HttpUrl ? u : toHttpUrl(str(u));
}

const CLIENT_PARAMS = ['url', 'headers', 'query', 'operationName', 'variables', 'extensions', 'cacheControl', 'ensureSuccess', 'json'];

/**
 * OkHttpClient.graphQLGet(url, headers, ...) and the context(HttpSource) form without headers.
 * Named arguments map onto the with-headers parameter list, so a missing/non-Headers second
 * argument means the source's headers.
 */
async function clientGraphQLGet(client: OkHttpClient, ...raw: any[]): Promise<Response> {
  let args = stripDesc(raw);
  const second = args[1];
  if (args.length > 1 && second !== undefined && second !== null && !(second instanceof Headers) && !(second instanceof Named)) args = [args[0], undefined, ...args.slice(1)];
  const [url, headers, query, operationName, variables, extensions, cacheControl, ensureSuccess, json] = positional(CLIENT_PARAMS, args, 'graphQLGet');
  const j = jsonOrDefault(json);
  const u = appendParams(toUrl(url).newBuilder()!, query, operationName, variables, extensions, j).build();
  const h: Headers = headers instanceof Headers ? headers : sourceHeaders(client);
  const req = new RequestBuilder()
    .url(u)
    .headers(h)
    .cacheControl(cacheControl instanceof CacheControl ? cacheControl : DEFAULT_CACHE_CONTROL)
    .build();
  const call = client.newCall(req);
  return ensureSuccess === false ? call.await() : call.awaitSuccess();
}

function sourceHeaders(client: OkHttpClient): Headers {
  const src = client.cfg.source;
  if (!src) throw new IllegalStateException('graphQLGet without headers needs a source context');
  return src.headers;
}

/** The translator may append a reified descriptor for the typed-variables overloads. */
function stripDesc(args: any[]): any[] {
  const last = args[args.length - 1];
  return last && typeof last === 'object' && typeof last.k === 'string' && !(last instanceof Named) ? args.slice(0, -1) : args;
}

const graphQLGet: ExtDef[] = [
  { name: 'graphQLGet', recv: (x) => x instanceof OkHttpClient, suspend: true, params: CLIENT_PARAMS, fn: clientGraphQLGet },
  // Top-level form (no receiver): called through the implicit `this` receiver.
  { name: 'graphQLGet', recv: (x) => !(x instanceof OkHttpClient), params: REQUEST_PARAMS, fn: (_self: any, ...args: any[]) => graphQLGetRequest(...args) },
];

export function persistedQueryExtension(hash: string, version = 1): JsonObject {
  const inner = new JsonObject();
  Map.prototype.set.call(inner, 'version', JsonPrimitive.of(version));
  Map.prototype.set.call(inner, 'sha256Hash', JsonPrimitive.of(hash));
  const o = new JsonObject();
  Map.prototype.set.call(o, 'persistedQuery', inner);
  return o;
}
(persistedQueryExtension as any).$params = ['hash', 'version'];

// ---------- responses ----------

function graphQLErrors(envelope: any): string[] | null {
  if (!(envelope instanceof JsonObject)) throw new SerializationException(`Expected JsonObject for GraphQLResponse`);
  const errors = envelope.get('errors');
  if (errors === undefined || errors === JsonNull) return null;
  if (!(errors instanceof JsonArray)) throw new SerializationException('Expected JsonArray for GraphQLResponse.errors');
  return errors.map((e: any) => {
    const m = e instanceof JsonObject ? e.get('message') : undefined;
    if (!(m instanceof JsonPrimitive) || m === JsonNull) throw new SerializationException(`Field 'message' is required for type with serial name 'GraphQLError', but it was missing`);
    return m.content;
  });
}

function unwrapGraphQL(text: string, json: Json, desc: Desc): any {
  const envelope = json.parseToJsonElement(text);
  const errors = graphQLErrors(envelope);
  if (errors && errors.length) throw new GraphQLException(errors.join('\n'));
  const data = (envelope as JsonObject).get('data');
  const value = data === undefined || data === JsonNull ? null : json.decodeFromJsonElement(desc, data);
  if (value === null || value === undefined) throw new IllegalStateException("GraphQL response is missing the 'data' field");
  return value;
}

function parseArgs(args: any[]): { json: Json; desc: Desc } {
  const a = [...args];
  const desc: Desc = a.length && a[a.length - 1] && typeof a[a.length - 1].k === 'string' ? a.pop() : T.any;
  let json = jsonInstance;
  for (const x of a) {
    if (x instanceof Json) json = x;
    else if (x instanceof Named && x.values.json instanceof Json) json = x.values.json;
  }
  return { json, desc };
}

const parseGraphQLAs: ExtDef[] = [
  {
    name: 'parseGraphQLAs',
    recv: (x) => x instanceof Response,
    reified: 'desc',
    params: ['json'],
    fn: (r: Response, ...args: any[]) => {
      const { json, desc } = parseArgs(args);
      try {
        return unwrapGraphQL(r.body.string(), json, desc);
      } finally {
        r.close();
      }
    },
  },
  {
    name: 'parseGraphQLAs',
    recv: isStr,
    reified: 'desc',
    params: ['json'],
    fn: (s: string, ...args: any[]) => {
      const { json, desc } = parseArgs(args);
      return unwrapGraphQL(s, json, desc);
    },
  },
];

/** Throws [GraphQLException] for non-2xx responses whose body carries GraphQL errors. */
export class GraphQLErrorInterceptor {
  async intercept(chain: any): Promise<Response> {
    const response: Response = await chain.proceed(chain.request());
    if (response.isSuccessful) return response;
    const body = response.peekBody(Number.MAX_SAFE_INTEGER).string();
    let errors: string[] | null = null;
    try {
      errors = graphQLErrors(jsonInstance.parseToJsonElement(body));
    } catch {
      errors = null;
    }
    if (errors && errors.length) throw new GraphQLException(errors.join('\n'));
    return response;
  }
}

export const graphQLModules: Record<string, unknown> = {
  'keiyoushi.utils.graphQLBody': graphQLBody,
  'keiyoushi.utils.graphQLPost': graphQLPost,
  'keiyoushi.utils.graphQLGet': graphQLGet,
  'keiyoushi.utils.appendGraphQLParams': [appendGraphQLParams],
  'keiyoushi.utils.persistedQueryExtension': persistedQueryExtension,
  'keiyoushi.utils.parseGraphQLAs': parseGraphQLAs,
  'keiyoushi.utils.GraphQLErrorInterceptor': GraphQLErrorInterceptor,
  'keiyoushi.utils.GraphQLException': GraphQLException,
};

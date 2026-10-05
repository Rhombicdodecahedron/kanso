import { describe, expect, it } from 'vitest';
import '../src/runtime';
import { call, IllegalStateException } from '../src/kotlin/core';
import { named } from '../src/kotlin/named';
import { CacheControl, Headers, OkHttpClientBuilder, RequestBuilder, Response, ResponseBody, MediaType, type TransportRequest } from '../src/okhttp';
import { HttpException } from '../src/okhttp';
import { buildJsonObject, T } from '../src/serialization/json';
import { modules } from '../src/modules';

const m = (fqn: string) => modules[fqn] as any;
const graphQLBody = m('keiyoushi.utils.graphQLBody');
const graphQLPost = m('keiyoushi.utils.graphQLPost');
const graphQLGet = m('keiyoushi.utils.graphQLGet') as any[];
const appendGraphQLParams = m('keiyoushi.utils.appendGraphQLParams') as any[];
const persistedQueryExtension = m('keiyoushi.utils.persistedQueryExtension');
const parseGraphQLAs = m('keiyoushi.utils.parseGraphQLAs') as any[];
const GraphQLErrorInterceptor = m('keiyoushi.utils.GraphQLErrorInterceptor');
const GraphQLException = m('keiyoushi.utils.GraphQLException');

class SearchVariables {
  constructor(
    public query: string,
    public offset: number,
    public limit: number,
  ) {}
  static $serial = {
    fields: [
      { name: 'query', json: 'query', type: T.str, optional: false },
      { name: 'offset', json: 'offset', type: T.int, optional: false },
      { name: 'limit', json: 'limit', type: T.int, optional: false },
    ],
  };
}
class Series {
  constructor(
    public id: string,
    public title: string,
  ) {}
  static $serial = {
    fields: [
      { name: 'id', json: 'id', type: T.str, optional: false },
      { name: 'title', json: 'title', type: T.str, optional: false },
    ],
  };
}
class SearchResponse {
  constructor(public searchSeries: Series[]) {}
  static $serial = { fields: [{ name: 'searchSeries', json: 'searchSeries', type: T.list(T.cls(Series)), optional: false }] };
}

const text = (b: any) => new TextDecoder().decode(b.bytes);

/** graphQLBody's $params lets the translator map named arguments to positions. */
function positional(params: string[], values: Record<string, any>): any[] {
  const out = params.map((p) => values[p]);
  while (out.length && out[out.length - 1] === undefined) out.pop();
  return out;
}

describe('graphQLBody / persistedQueryExtension', () => {
  it('omits null fields and keeps GraphQLRequest field order', () => {
    const body = graphQLBody(...positional(graphQLBody.$params, { query: 'query Q { a }', operationName: 'Q' }));
    expect(text(body)).toBe('{"operationName":"Q","query":"query Q { a }"}');
    expect(body.contentType().toString()).toBe('application/json');
  });

  it('serializes typed variables and JsonElement variables', () => {
    const typed = graphQLBody(...positional(graphQLBody.$params, { query: 'q', variables: new SearchVariables('one piece', 24, 24) }));
    expect(JSON.parse(text(typed))).toEqual({ query: 'q', variables: { query: 'one piece', offset: 24, limit: 24 } });
    const el = graphQLBody(named({ operationName: 'Op', variables: buildJsonObject((b) => b.put('id', 5)) }));
    expect(text(el)).toBe('{"operationName":"Op","variables":{"id":5}}');
  });

  it('builds automatic persisted query extensions', () => {
    const body = graphQLBody(named({ operationName: 'Home', extensions: persistedQueryExtension('abc123') }));
    expect(JSON.parse(text(body))).toEqual({ operationName: 'Home', extensions: { persistedQuery: { version: 1, sha256Hash: 'abc123' } } });
    expect(persistedQueryExtension('h', 2).toString()).toBe('{"persistedQuery":{"version":2,"sha256Hash":"h"}}');
  });
});

describe('request builders', () => {
  const headers = Headers.of('Authorization', 'Bearer t');

  it('graphQLPost', () => {
    const req = graphQLPost('https://api.example.com/graphql', headers, 'query { me }', undefined, undefined, undefined, CacheControl.FORCE_NETWORK);
    expect(req.method).toBe('POST');
    expect(req.header('Authorization')).toBe('Bearer t');
    expect(text(req.body)).toBe('{"query":"query { me }"}');
  });

  it('top-level graphQLGet encodes parameters in the URL', () => {
    // called without receiver: dispatched through the implicit `this`
    const self = { baseUrl: 'https://example.com' };
    const req = call(self, 'graphQLGet', graphQLGet, ['https://api.example.com/graphql', headers, named({ operationName: 'Get', variables: new SearchVariables('a&b', 0, 10), extensions: persistedQueryExtension('ff') })]);
    expect(req.method).toBe('GET');
    expect(req.url.queryParameter('operationName')).toBe('Get');
    expect(req.url.queryParameter('variables')).toBe('{"query":"a&b","offset":0,"limit":10}');
    expect(req.url.queryParameter('extensions')).toBe('{"persistedQuery":{"version":1,"sha256Hash":"ff"}}');
    expect(req.url.queryParameter('query')).toBeNull();
  });

  it('HttpUrl.Builder.appendGraphQLParams', () => {
    const b = new RequestBuilder().url('https://x.com/gql').build().url.newBuilder()!;
    call(b, 'appendGraphQLParams', appendGraphQLParams, [named({ query: '{ a }' })]);
    expect(b.build().toString()).toBe('https://x.com/gql?query=%7B%20a%20%7D');
  });
});

// ---- client helpers against a fake transport ----

function client(handler: (r: TransportRequest) => { code: number; body: string }, interceptors: any[] = []) {
  const seen: TransportRequest[] = [];
  const b = new OkHttpClientBuilder();
  b.cfg.transport = {
    async execute(r) {
      seen.push(r);
      const res = handler(r);
      return { url: r.url, code: res.code, message: '', headers: [['Content-Type', 'application/json']], body: new TextEncoder().encode(res.body) };
    },
  };
  b.cfg.source = { headers: Headers.of('Referer', 'https://site.example/') };
  for (const i of interceptors) b.addInterceptor(i);
  return { client: b.build(), seen };
}

describe('OkHttpClient.graphQLGet', () => {
  it('sends explicit headers and named parameters', async () => {
    const { client: c, seen } = client(() => ({ code: 200, body: '{"data":{"searchSeries":[{"id":"1","title":"A"}]}}' }));
    const res: Response = await call(c, 'graphQLGet', graphQLGet, ['https://api.example.com/gql', Headers.of('X-Api', '1'), undefined, 'Search', new SearchVariables('x', 0, 1)]);
    expect(seen[0].headers).toContainEqual(['X-Api', '1']);
    expect(new URL(seen[0].url).searchParams.get('operationName')).toBe('Search');
    const data = call(res, 'parseGraphQLAs', parseGraphQLAs, [T.cls(SearchResponse)]);
    expect(data.searchSeries[0].title).toBe('A');
  });

  it('context(HttpSource) form uses the source headers', async () => {
    const { client: c, seen } = client(() => ({ code: 200, body: '{"data":{}}' }));
    // positional query in the second slot
    await call(c, 'graphQLGet', graphQLGet, ['https://api.example.com/gql', '{ ping }']);
    expect(seen[0].headers).toContainEqual(['Referer', 'https://site.example/']);
    expect(new URL(seen[0].url).searchParams.get('query')).toBe('{ ping }');
    // named form (translator maps names onto the with-headers parameter list)
    await call(c, 'graphQLGet', graphQLGet, ['https://api.example.com/gql', named({ operationName: 'Op' })]);
    expect(seen[1].headers).toContainEqual(['Referer', 'https://site.example/']);
  });

  it('ensureSuccess', async () => {
    const { client: c } = client(() => ({ code: 500, body: 'boom' }));
    await expect(call(c, 'graphQLGet', graphQLGet, ['https://api.example.com/gql', named({ query: '{a}' })])).rejects.toBeInstanceOf(HttpException);
    const res = await call(c, 'graphQLGet', graphQLGet, ['https://api.example.com/gql', named({ query: '{a}', ensureSuccess: false })]);
    expect(res.code).toBe(500);
  });
});

describe('parseGraphQLAs', () => {
  it('unwraps data', () => {
    const r = call('{"data":{"searchSeries":[]},"extensions":{"cost":1}}', 'parseGraphQLAs', parseGraphQLAs, [T.cls(SearchResponse)]);
    expect(r.searchSeries).toEqual([]);
  });

  it('throws GraphQLException with joined messages', () => {
    const body = '{"data":null,"errors":[{"message":"Not found","path":["series"]},{"message":"Unauthorized"}]}';
    expect(() => call(body, 'parseGraphQLAs', parseGraphQLAs, [T.cls(SearchResponse)])).toThrow(new GraphQLException('Not found\nUnauthorized'));
    try {
      call(body, 'parseGraphQLAs', parseGraphQLAs, [T.cls(SearchResponse)]);
    } catch (e: any) {
      expect(e).toBeInstanceOf(GraphQLException);
      expect(e.message).toBe('Not found\nUnauthorized');
    }
  });

  it('empty errors are ignored; missing data is an IllegalStateException', () => {
    expect(() => call('{"errors":[]}', 'parseGraphQLAs', parseGraphQLAs, [T.cls(SearchResponse)])).toThrow(IllegalStateException);
    expect(() => call('{"data":null}', 'parseGraphQLAs', parseGraphQLAs, [T.cls(SearchResponse)])).toThrow("GraphQL response is missing the 'data' field");
  });

  it('works on a Response', () => {
    const req = new RequestBuilder().url('https://api.example.com/gql').build();
    const res = new Response(req, 200, 'OK', new Headers([]), new ResponseBody(new TextEncoder().encode('{"data":{"searchSeries":[{"id":"9","title":"Z"}]}}'), MediaType.parse('application/json')));
    expect(call(res, 'parseGraphQLAs', parseGraphQLAs, [T.cls(SearchResponse)]).searchSeries[0].id).toBe('9');
  });
});

describe('GraphQLErrorInterceptor', () => {
  it('throws for non-2xx responses carrying GraphQL errors', async () => {
    const { client: c } = client(() => ({ code: 400, body: '{"errors":[{"message":"Variable $id is required"}]}' }), [new GraphQLErrorInterceptor()]);
    const req = new RequestBuilder().url('https://api.example.com/gql').build();
    await expect(c.newCall(req).await()).rejects.toThrow('Variable $id is required');
  });

  it('passes through successful responses (even with errors) and error pages without GraphQL errors', async () => {
    const ok = client(() => ({ code: 200, body: '{"errors":[{"message":"partial"}],"data":{}}' }), [new GraphQLErrorInterceptor()]);
    const req = new RequestBuilder().url('https://api.example.com/gql').build();
    expect((await ok.client.newCall(req).await()).code).toBe(200);
    const html = client(() => ({ code: 502, body: '<html>Bad gateway</html>' }), [new GraphQLErrorInterceptor()]);
    expect((await html.client.newCall(req).await()).code).toBe(502);
  });
});

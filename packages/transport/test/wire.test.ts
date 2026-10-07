import { describe, expect, it } from 'vitest';

import { createProxyTransport, decodeRequest, decodeResponse, encodeRequest, encodeResponse, WIRE_CONTENT_TYPE } from '../src';

const req = {
  url: 'https://site.test/a?b=1',
  method: 'POST',
  headers: [
    ['Referer', 'https://site.test/'],
    ['Cookie', 'a=1'],
  ] as [string, string][],
  body: new Uint8Array([1, 2, 255]),
  followRedirects: false,
  timeoutMs: 1234,
};

describe('wire', () => {
  it('round-trips requests, with and without a body', () => {
    expect(decodeRequest(encodeRequest(req))).toEqual(req);
    expect(decodeRequest(encodeRequest({ ...req, method: 'GET', body: null }))).toEqual({ ...req, method: 'GET', body: null });
    expect(decodeRequest(encodeRequest({ ...req, body: new Uint8Array() })).body).toEqual(new Uint8Array());
  });

  it('round-trips responses, keeping repeated headers', () => {
    const res = { url: 'https://site.test/x', code: 302, message: 'Found', headers: [['set-cookie', 'a=1'], ['set-cookie', 'b=2']] as [string, string][], body: new Uint8Array([9, 8, 7]) };
    expect(decodeResponse(encodeResponse(res))).toEqual(res);
  });

  it('rejects truncated frames', () => {
    expect(() => decodeRequest(new Uint8Array([0, 0, 1]))).toThrow('Truncated');
    expect(() => decodeRequest(encodeRequest(req).slice(0, 10))).toThrow('Truncated');
  });
});

describe('proxy transport', () => {
  it('posts the framed request and decodes the framed response', async () => {
    let sent: Uint8Array | null = null;
    const t = createProxyTransport({
      endpoint: '/api/proxy',
      fetch: async (_url, init) => {
        sent = new Uint8Array(init!.body as ArrayBuffer);
        const res = encodeResponse({ url: req.url, code: 200, message: 'OK', headers: [], body: new Uint8Array([42]) });
        return new Response(res as unknown as BodyInit, { headers: { 'Content-Type': WIRE_CONTENT_TYPE } });
      },
    });
    const out = await t.execute(req);
    expect(decodeRequest(sent!)).toEqual(req);
    expect(out.body).toEqual(new Uint8Array([42]));
  });

  it('surfaces proxy errors', async () => {
    const t = createProxyTransport({ endpoint: '/api/proxy', fetch: async () => new Response('Unauthorized', { status: 401 }) });
    await expect(t.execute(req)).rejects.toThrow('Proxy answered HTTP 401: Unauthorized');
  });
});

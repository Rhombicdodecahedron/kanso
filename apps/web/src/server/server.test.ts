import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFetchTransport, createProxyTransport, encodeRequest, WIRE_CONTENT_TYPE } from '@kanso/transport';

import { createAuth } from './auth';
import { createSyncService } from '@kanso/core';
import { createMemorySyncStore } from '@kanso/core/testing';

import { createImageHandler, createProxyHandler, createSessionHandlers, createSyncHandler, encodeImageParams } from './handlers';
import { allowAll, createUrlGuard, isBlockedAddress } from './ssrf';

const TOKEN = 't'.repeat(40);
const auth = createAuth({ token: TOKEN, sessionSecret: 's'.repeat(40) });
const bearer = { Authorization: `Bearer ${TOKEN}` };

let server: Server;
let base = '';
const seen: { url: string; headers: Record<string, string | string[] | undefined> }[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url!, headers: req.headers });
    if (req.url === '/redirect') return void res.writeHead(302, { Location: '/img.png' }).end();
    if (req.url === '/img.png') return void res.writeHead(200, { 'Content-Type': 'image/png' }).end(Buffer.from([137, 80, 78, 71]));
    if (req.url === '/cookie') return void res.writeHead(200, [['Set-Cookie', 'a=1'], ['Set-Cookie', 'b=2']]).end('ok');
    res.writeHead(404).end('nope');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => void server.close());

describe('auth', () => {
  it('rejects short secrets', () => {
    expect(() => createAuth({ token: 'short', sessionSecret: 's'.repeat(40) })).toThrow();
  });

  it('accepts a bearer token or a fresh session cookie, nothing else', () => {
    const cookie = auth.login(TOKEN)!;
    const value = cookie.split(';')[0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(auth.check(new Request('http://x/', { headers: bearer }))).toBe(true);
    expect(auth.check(new Request('http://x/', { headers: { Cookie: value } }))).toBe(true);
    expect(auth.check(new Request('http://x/', { headers: { Authorization: 'Bearer nope' } }))).toBe(false);
    expect(auth.check(new Request('http://x/', { headers: { Cookie: value.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) } }))).toBe(false);
    expect(auth.check(new Request('http://x/'))).toBe(false);
    expect(auth.login('wrong')).toBeNull();
  });

  it('expires sessions and signs them out when the token rotates', () => {
    let now = 1_000;
    const a = createAuth({ token: TOKEN, sessionSecret: 's'.repeat(40), now: () => now });
    const value = a.login(TOKEN)!.split(';')[0];
    const req = () => new Request('http://x/', { headers: { Cookie: value } });
    expect(a.check(req())).toBe(true);
    now += 31 * 86_400_000;
    expect(a.check(req())).toBe(false);
    const rotated = createAuth({ token: 'u'.repeat(40), sessionSecret: 's'.repeat(40) });
    expect(rotated.check(new Request('http://x/', { headers: { Cookie: auth.login(TOKEN)!.split(';')[0] } }))).toBe(false);
  });

  it('session endpoints log in and out', async () => {
    const h = createSessionHandlers(auth);
    const bad = await h.POST(new Request('http://x/', { method: 'POST', body: JSON.stringify({ token: 'x' }) }));
    expect(bad.status).toBe(401);
    const ok = await h.POST(new Request('http://x/', { method: 'POST', body: JSON.stringify({ token: TOKEN }) }));
    const cookie = ok.headers.get('set-cookie')!.split(';')[0];
    expect(await (await h.GET(new Request('http://x/', { headers: { Cookie: cookie } }))).json()).toEqual({ authenticated: true });
    expect((await h.DELETE()).headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('url guard', () => {
  it('blocks private, loopback, link-local and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])
      expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ['1.1.1.1', '93.184.216.34', '2606:4700::1111']) expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it('checks resolved addresses and schemes', async () => {
    const guard = createUrlGuard(async (h) => (h === 'evil.test' ? ['10.0.0.1'] : ['93.184.216.34']));
    await expect(guard.check('https://ok.test/a')).resolves.toBeInstanceOf(URL);
    await expect(guard.check('https://evil.test/a')).rejects.toThrow('Address not allowed');
    await expect(guard.check('http://[::1]/')).rejects.toThrow('Address not allowed');
    await expect(guard.check('file:///etc/passwd')).rejects.toThrow('Scheme');
  });
});

describe('proxy', () => {
  const handler = createProxyHandler({ auth, guard: allowAll, transport: createFetchTransport() });
  const call = (body: Uint8Array, headers: Record<string, string> = bearer) => handler(new Request('http://app/api/proxy', { method: 'POST', headers: { 'Content-Type': WIRE_CONTENT_TYPE, ...headers }, body: body as unknown as BodyInit }));
  const req = (url: string, headers: [string, string][] = []) => ({ url, method: 'GET', headers, body: null, followRedirects: true, timeoutMs: 5000 });

  it('needs auth', async () => {
    expect((await call(encodeRequest(req(`${base}/img.png`)), {})).status).toBe(401);
  });

  it('forwards headers browsers forbid, returns raw redirects and every Set-Cookie', async () => {
    const t = createProxyTransport({ endpoint: 'http://app/api/proxy', fetch: async (_u, init) => call(new Uint8Array(init!.body as ArrayBuffer)) });
    const redirect = await t.execute(req(`${base}/redirect`, [['Referer', 'https://site.test/'], ['User-Agent', 'KansoTest']]));
    expect(redirect.code).toBe(302);
    expect(seen.at(-1)!.headers.referer).toBe('https://site.test/');
    expect(seen.at(-1)!.headers['user-agent']).toBe('KansoTest');
    const cookies = await t.execute(req(`${base}/cookie`));
    expect(cookies.headers.filter(([k]) => k === 'set-cookie').map(([, v]) => v)).toEqual(['a=1', 'b=2']);
  });

  it('refuses blocked targets', async () => {
    const guarded = createProxyHandler({ auth, guard: createUrlGuard(), transport: createFetchTransport() });
    const res = await guarded(new Request('http://app/api/proxy', { method: 'POST', headers: bearer, body: encodeRequest(req(`${base}/img.png`)) as unknown as BodyInit }));
    expect(res.status).toBe(400);
  });
});

describe('image proxy', () => {
  const handler = createImageHandler({ auth, guard: allowAll });
  const url = (p: string, headers?: Record<string, string>) => `http://app/api/img?r=${encodeImageParams({ url: `${base}${p}`, headers })}`;

  it('streams the image with private caching, following redirects', async () => {
    const res = await handler(new Request(url('/redirect', { Referer: 'https://site.test/' }), { headers: bearer }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('private');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([137, 80, 78, 71]);
    expect(seen.at(-1)!.headers.referer).toBe('https://site.test/');
  });

  it('needs auth and maps upstream errors', async () => {
    expect((await handler(new Request(url('/img.png')))).status).toBe(401);
    expect((await handler(new Request(url('/missing'), { headers: bearer }))).status).toBe(404);
    expect((await handler(new Request('http://app/api/img?r=@@', { headers: bearer }))).status).toBe(400);
  });
});

describe('sync endpoint', () => {
  const post = (h: (r: Request) => Promise<Response>, body: unknown, headers: Record<string, string> = bearer) => h(new Request('http://app/api/sync', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  const service = createSyncService(createMemorySyncStore(), { now: () => Date.now() });
  const handler = createSyncHandler({ auth, service });

  it('needs auth, a configured store and a valid body', async () => {
    expect((await post(handler, { deviceId: 'a', cursor: 0, changes: [] }, {})).status).toBe(401);
    expect((await post(createSyncHandler({ auth, service: null }), { deviceId: 'a', cursor: 0, changes: [] })).status).toBe(503);
    expect((await post(handler, 'not json')).status).toBe(400);
    expect((await post(handler, { deviceId: 'a', cursor: 'x', changes: [] })).status).toBe(400);
  });

  it('exchanges changes between devices', async () => {
    const change = { kind: 'library', key: '["s","/m"]', updatedAt: 5, deleted: false, data: { favorite: true } };
    const a = await (await post(handler, { deviceId: 'a', cursor: 0, changes: [change] })).json();
    expect(a.changes).toEqual([]);
    const b = await (await post(handler, { deviceId: 'b', cursor: 0, changes: [] })).json();
    expect(b.changes).toEqual([{ ...change, deviceId: 'a' }]);
    expect(b.cursor).toBeGreaterThan(0);
  });
});

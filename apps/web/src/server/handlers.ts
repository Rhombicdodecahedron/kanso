// Route handler logic, kept free of Next so it can be exercised in-process.

import type { Transport } from '@kanso/source-api/src/okhttp';
import { decodeRequest, encodeResponse, WIRE_CONTENT_TYPE } from '@kanso/transport';

import { type Auth, unauthorized } from './auth';
import { BlockedUrlError, type UrlGuard } from './ssrf';

export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
// Buffered function responses on Vercel top out at 4.5 MB.
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_TIMEOUT_MS = 25_000;
const MAX_IMAGE_REDIRECTS = 5;

export interface ProxyDeps {
  auth: Auth;
  guard: UrlGuard;
  transport: Transport;
}

async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > max) return null;
  const bytes = new Uint8Array(await req.arrayBuffer());
  return bytes.length > max ? null : bytes;
}

const text = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export function createProxyHandler(d: ProxyDeps) {
  return async (req: Request): Promise<Response> => {
    if (!d.auth.check(req)) return unauthorized();
    const bytes = await readCapped(req, MAX_REQUEST_BYTES);
    if (!bytes) return text(413, 'Request too large');
    let tr;
    try {
      tr = decodeRequest(bytes);
      await d.guard.check(tr.url);
    } catch (e) {
      return text(400, e instanceof Error ? e.message : 'Bad request');
    }
    try {
      // OkHttp follows redirects itself, so each hop comes back through the guard.
      const res = await d.transport.execute({ ...tr, followRedirects: false, timeoutMs: Math.min(tr.timeoutMs, MAX_TIMEOUT_MS) });
      if (res.body.length > MAX_RESPONSE_BYTES) return text(502, `Upstream response too large (${res.body.length} bytes)`);
      return new Response(encodeResponse(res) as unknown as BodyInit, { headers: { 'Content-Type': WIRE_CONTENT_TYPE, 'Cache-Control': 'no-store' } });
    } catch (e) {
      return text(502, `Upstream failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}

/** An image request as the browser encodes it into `/api/img?r=`. */
export interface ImageParams {
  url: string;
  headers?: Record<string, string>;
}

export function encodeImageParams(p: ImageParams): string {
  return Buffer.from(JSON.stringify(p)).toString('base64url');
}

export interface ImageDeps {
  auth: Auth;
  guard: UrlGuard;
  fetch?: typeof fetch;
}

export function createImageHandler(d: ImageDeps) {
  const doFetch = d.fetch ?? fetch;
  return async (req: Request): Promise<Response> => {
    if (!d.auth.check(req)) return unauthorized();
    let params: ImageParams;
    try {
      params = JSON.parse(Buffer.from(new URL(req.url).searchParams.get('r') ?? '', 'base64url').toString());
      if (typeof params.url !== 'string') throw new Error();
    } catch {
      return text(400, 'Bad image request');
    }
    try {
      let url = params.url;
      for (let hop = 0; ; hop++) {
        await d.guard.check(url);
        const res = await doFetch(url, { headers: params.headers ?? {}, redirect: 'manual', signal: AbortSignal.timeout(MAX_TIMEOUT_MS) });
        const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        if (next) {
          if (hop >= MAX_IMAGE_REDIRECTS) return text(502, 'Too many redirects');
          url = new URL(next, url).toString();
          continue;
        }
        if (!res.ok || !res.body) return text(502, `Upstream answered HTTP ${res.status}`);
        return new Response(res.body, {
          headers: {
            'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
            // Page images never change; keep them in the browser only.
            'Cache-Control': 'private, max-age=31536000, immutable',
          },
        });
      }
    } catch (e) {
      if (e instanceof BlockedUrlError) return text(400, e.message);
      return text(502, `Upstream failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}

export function createSessionHandlers(auth: Auth) {
  return {
    async POST(req: Request) {
      const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
      const cookie = typeof body?.token === 'string' ? auth.login(body.token) : null;
      if (!cookie) return Response.json({ authenticated: false }, { status: 401 });
      return Response.json({ authenticated: true }, { headers: { 'Set-Cookie': cookie } });
    },
    async GET(req: Request) {
      return Response.json({ authenticated: auth.check(req) }, { headers: { 'Cache-Control': 'no-store' } });
    },
    async DELETE() {
      return Response.json({ authenticated: false }, { headers: { 'Set-Cookie': auth.logoutCookie() } });
    },
  };
}

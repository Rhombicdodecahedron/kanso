// Server-side (Node) transport: plain fetch with manual redirects, so OkHttp's own redirect and
// cookie handling see every hop, and Set-Cookie headers stay readable.

import type { Transport } from '@kanso/source-api/src/okhttp';

export interface FetchTransportOptions {
  fetch?: typeof fetch;
}

// fetch hands back the decoded body, so the encoding and length of the wire body no longer apply.
const DROPPED = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie']);

export function createFetchTransport(opts: FetchTransportOptions = {}): Transport {
  const doFetch = opts.fetch ?? fetch;
  return {
    async execute(req) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
      try {
        const res = await doFetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body && req.method !== 'GET' && req.method !== 'HEAD' ? (req.body as unknown as BodyInit) : undefined,
          redirect: req.followRedirects ? 'follow' : 'manual',
          signal: ctrl.signal,
        });
        const body = new Uint8Array(await res.arrayBuffer());
        const headers: [string, string][] = [];
        res.headers.forEach((v, k) => {
          if (!DROPPED.has(k)) headers.push([k, v]);
        });
        for (const c of res.headers.getSetCookie?.() ?? []) headers.push(['set-cookie', c]);
        return { url: req.followRedirects && res.url ? res.url : req.url, code: res.status, message: res.statusText, headers, body };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export const fetchTransport: Transport = createFetchTransport();

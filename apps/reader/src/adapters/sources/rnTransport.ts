import type { Transport } from '@kanso/source-api/src/okhttp';

export const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** React Native fetch as the runtime's network transport (redirects are followed natively). */
export const rnTransport: Transport = {
  async execute(req) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
    try {
      const headers: Record<string, string> = {};
      for (const [k, v] of req.headers) headers[k] = headers[k] ? `${headers[k]}, ${v}` : v;
      const res = await fetch(req.url, {
        method: req.method,
        headers,
        body: req.body && req.method !== 'GET' && req.method !== 'HEAD' ? bodyFor(req.body) : undefined,
        signal: ctrl.signal,
      });
      const body = new Uint8Array(await res.arrayBuffer());
      const out: [string, string][] = [];
      res.headers.forEach((v, k) => out.push([k, v]));
      return { url: res.url || req.url, code: res.status, message: res.statusText ?? '', headers: out, body };
    } finally {
      clearTimeout(timer);
    }
  },
};

function bodyFor(bytes: Uint8Array): string | ArrayBuffer {
  // Text bodies (forms, JSON) go as strings: RN fetch handles them everywhere.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return bytes.slice().buffer;
  }
}

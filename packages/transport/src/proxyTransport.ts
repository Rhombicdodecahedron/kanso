// Browser transport: every source request goes through the app's own proxy endpoint, which may
// set the headers a browser cannot (Referer, Origin, User-Agent, Cookie) and is not bound by CORS.

import type { Transport } from '@kanso/source-api/src/okhttp';

import { decodeResponse, encodeRequest, WIRE_CONTENT_TYPE } from './wire';

export interface ProxyTransportOptions {
  endpoint: string;
  fetch?: typeof fetch;
}

export class ProxyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createProxyTransport(opts: ProxyTransportOptions): Transport {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return {
    async execute(req) {
      const res = await doFetch(opts.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': WIRE_CONTENT_TYPE },
        body: encodeRequest(req) as unknown as BodyInit,
        credentials: 'same-origin',
      });
      if (!res.ok || res.headers.get('Content-Type') !== WIRE_CONTENT_TYPE) {
        const text = await res.text().catch(() => '');
        throw new ProxyError(res.status, `Proxy answered HTTP ${res.status}${text ? `: ${text}` : ''}`);
      }
      return decodeResponse(new Uint8Array(await res.arrayBuffer()));
    },
  };
}

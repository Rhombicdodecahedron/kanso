// Binary framing for transport requests/responses sent through the web proxy:
// [u32 big-endian meta length][meta JSON][body bytes]. Bodies stay raw bytes (images, gzip-free).

import type { TransportRequest, TransportResponse } from '@kanso/source-api/src/okhttp';

export const WIRE_CONTENT_TYPE = 'application/x-kanso-wire';

function frame(meta: unknown, body: Uint8Array | null): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const out = new Uint8Array(4 + json.length + (body?.length ?? 0));
  new DataView(out.buffer).setUint32(0, json.length);
  out.set(json, 4);
  if (body) out.set(body, 4 + json.length);
  return out;
}

function unframe<T>(bytes: Uint8Array): { meta: T; body: Uint8Array } {
  if (bytes.length < 4) throw new Error('Truncated wire frame');
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (4 + len > bytes.length) throw new Error('Truncated wire frame');
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + len))) as T;
  return { meta, body: bytes.slice(4 + len) };
}

type RequestMeta = Omit<TransportRequest, 'body'> & { hasBody: boolean };

export function encodeRequest(req: TransportRequest): Uint8Array {
  const { body, ...rest } = req;
  return frame({ ...rest, hasBody: body !== null } satisfies RequestMeta, body);
}

export function decodeRequest(bytes: Uint8Array): TransportRequest {
  const { meta, body } = unframe<RequestMeta>(bytes);
  if (typeof meta.url !== 'string' || typeof meta.method !== 'string' || !Array.isArray(meta.headers)) throw new Error('Malformed wire request');
  return {
    url: meta.url,
    method: meta.method,
    headers: meta.headers.map(([k, v]) => [String(k), String(v)]),
    body: meta.hasBody ? body : null,
    followRedirects: !!meta.followRedirects,
    timeoutMs: Number(meta.timeoutMs) || 30_000,
  };
}

export function encodeResponse(res: TransportResponse): Uint8Array {
  const { body, ...rest } = res;
  return frame(rest, body);
}

export function decodeResponse(bytes: Uint8Array): TransportResponse {
  const { meta, body } = unframe<Omit<TransportResponse, 'body'>>(bytes);
  return { ...meta, body };
}

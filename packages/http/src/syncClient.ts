import type { ExchangeRequest, ExchangeResponse, SyncRemote } from '@kanso/core';

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface HttpSyncClientOptions {
  /** The Kanso web app's origin ('' for the web app itself). */
  baseUrl: string;
  /** Extra headers per request: the iPhone app sends its token here. */
  headers?: () => Promise<Record<string, string>> | Record<string, string>;
  fetch?: typeof fetch;
}

/** The sync server over HTTP: POST {baseUrl}/api/sync. */
export class HttpSyncClient implements SyncRemote {
  private readonly doFetch: typeof fetch;
  constructor(private readonly opts: HttpSyncClientOptions) {
    this.doFetch = opts.fetch ?? ((...a) => fetch(...a));
  }

  async exchange(req: ExchangeRequest): Promise<ExchangeResponse> {
    const res = await this.doFetch(`${this.opts.baseUrl.replace(/\/+$/, '')}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.opts.headers?.()) },
      body: JSON.stringify(req),
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SyncHttpError(res.status, res.status === 401 ? 'The sync server did not accept the access token.' : `Sync failed: HTTP ${res.status}${text ? `, ${text}` : ''}`);
    }
    return (await res.json()) as ExchangeResponse;
  }
}

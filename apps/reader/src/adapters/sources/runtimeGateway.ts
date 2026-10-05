// SourceGateway backed by the translated-extension runtime (@kanso/source-api).

import { initHost, SourceRegistry } from '@kanso/source-api/src/host';
import type { PrefStore } from '@kanso/source-api/src/source/preferences';
import { MemoryCookieJar, type Transport } from '@kanso/source-api/src/okhttp';

import type { SqlDriver } from '@/adapters/sqlite/driver';
import type { SourceGateway } from '@/core/application/ports';
import type { FilterState, InstalledExtension, RemoteChapter, RemoteManga, RemotePage, SourceInfo } from '@/core/domain/model';

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

/** Source preferences: synchronous in-memory map, persisted to SQLite in the background. */
class PersistedPrefs implements PrefStore {
  constructor(
    private readonly id: string,
    private readonly data: Map<string, unknown>,
    private readonly db: SqlDriver,
  ) {}
  private save(): void {
    void this.db.run('insert or replace into setting (key, value) values (?, ?)', [`pref:${this.id}`, JSON.stringify(Object.fromEntries(this.data))]);
  }
  get(k: string) {
    return this.data.get(k);
  }
  set(k: string, v: unknown) {
    this.data.set(k, v);
    this.save();
  }
  remove(k: string) {
    this.data.delete(k);
    this.save();
  }
  keys() {
    return [...this.data.keys()];
  }
}

export async function createRuntimeGateway(db: SqlDriver): Promise<SourceGateway> {
  const rows = await db.all<{ key: string; value: string }>("select key, value from setting where key like 'pref:%'");
  const prefData = new Map<string, Map<string, unknown>>(rows.map((r) => [r.key.slice(5), new Map(Object.entries(JSON.parse(r.value)))]));
  initHost({
    transport: rnTransport,
    cookieJar: new MemoryCookieJar(),
    userAgent: USER_AGENT,
    prefs: (id) => {
      let m = prefData.get(id);
      if (!m) prefData.set(id, (m = new Map()));
      return new PersistedPrefs(id, m, db);
    },
    log: (level, tag, msg) => {
      if (level === 'warn' || level === 'error') console.warn(`[${tag}] ${msg}`);
    },
  });
  const reg = new SourceRegistry();
  return {
    async load(ext: InstalledExtension, code: string) {
      reg.load(ext.pkg, code);
    },
    unload: (pkg) => reg.unload(pkg),
    sources: (): SourceInfo[] => reg.sources().map((s) => ({ id: s.id, name: s.name, lang: s.lang, baseUrl: s.baseUrl, index: s.index })),
    has: (id) => reg.has(id),
    supportsLatest: (id) => reg.supportsLatest(id),
    headers: (id) => (reg.has(id) ? reg.headers(id) : {}),
    popular: (id, page) => reg.popular(id, page),
    latest: (id, page) => reg.latest(id, page),
    search: (id, page, q, f) => reg.search(id, page, q, f as any),
    filters: async (id) => (await reg.filters(id)) as FilterState[],
    update: (id, m: RemoteManga, cs: RemoteChapter[], d, c) => reg.update(id, m, cs, d, c),
    pages: (id, c: RemoteChapter) => reg.pages(id, c),
    imageRequest: (id, p: RemotePage) => reg.imageRequest(id, p),
    fetchImage: (id, p: RemotePage) => reg.fetchImage(id, p),
    mangaWebUrl: (id, m) => reg.mangaUrl(id, m),
    preferences: (id) => reg.preferences(id) as any,
    setPreference: (id, k, v) => reg.setPreference(id, k, v),
  };
}

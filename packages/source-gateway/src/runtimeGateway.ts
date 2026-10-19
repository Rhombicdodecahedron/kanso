// SourceGateway backed by the translated-extension runtime (@kanso/source-api). The network
// transport, cookie jar and preference storage are injected, so each app supplies its own.

import { initHost, SourceRegistry } from '@kanso/source-api/src/host';
import type { CookieJar, Transport } from '@kanso/source-api/src/okhttp';
import type { PrefStore } from '@kanso/source-api/src/source/preferences';

import type { FilterState, InstalledExtension, RemoteChapter, RemoteManga, RemotePage, SourceGateway, SourceInfo, SourcePrefsRepository } from '@kanso/core';

export interface RuntimeGatewayOptions {
  transport: Transport;
  cookieJar: CookieJar;
  userAgent: string;
  prefs: SourcePrefsRepository;
  log?: (level: string, tag: string, msg: string) => void;
}

/** Source preferences: synchronous in-memory map, persisted in the background. */
class PersistedPrefs implements PrefStore {
  constructor(
    private readonly id: string,
    private readonly data: Map<string, unknown>,
    private readonly repo: SourcePrefsRepository,
  ) {}
  private save(): void {
    void this.repo.save(this.id, Object.fromEntries(this.data));
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

const defaultLog = (level: string, tag: string, msg: string) => {
  if (level === 'warn' || level === 'error') console.warn(`[${tag}] ${msg}`);
};

export async function createRuntimeGateway(opts: RuntimeGatewayOptions): Promise<SourceGateway> {
  const stored = await opts.prefs.loadAll();
  const prefData = new Map<string, Map<string, unknown>>([...stored].map(([id, v]) => [id, new Map(Object.entries(v))]));
  initHost({
    transport: opts.transport,
    cookieJar: opts.cookieJar,
    userAgent: opts.userAgent,
    prefs: (id) => {
      let m = prefData.get(id);
      if (!m) prefData.set(id, (m = new Map()));
      return new PersistedPrefs(id, m, opts.prefs);
    },
    log: opts.log ?? defaultLog,
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

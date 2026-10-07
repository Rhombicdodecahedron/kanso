// Browser composition root: the same use cases as the iPhone app, on browser adapters.

import { createUseCases, type ContinueReadingSurface, type ImageRequest, type SourceGateway, type UseCases } from '@kanso/core';
import { HttpExtensionFetcher } from '@kanso/http';
import { createRuntimeGateway } from '@kanso/source-gateway';
import { migrate, SqliteSourcePrefsRepository, sqliteRepositories } from '@kanso/sqlite';
import { createProxyTransport, ProxyError } from '@kanso/transport';

import { createImageSrc } from '@/adapters/net/images';
import { PersistentCookieJar } from '@/adapters/net/persistentCookieJar';
import { openWasmDriver } from '@/adapters/sqlite/wasmDriver';
import { IdbBundleStore } from '@/adapters/storage/idbBundleStore';
import { IdbPageStore } from '@/adapters/storage/idbPageStore';
import { webCrypto } from '@/adapters/system/webCrypto';

export const DEFAULT_REPO = 'https://rhombicdodecahedron.github.io/kanso-extensions';

export interface App {
  uc: UseCases;
  sources: SourceGateway;
  widget: ContinueReadingSurface;
  /** URL for an <img>: through the image proxy, or a local blob */
  imageSrc: (req: ImageRequest) => string;
  /** cover URL for a manga of the given source */
  coverSrc: (sourceId: string, url: string | null) => string | null;
  /** false when the browser gave no persistent storage (private window): data goes on reload */
  persistent: boolean;
  /** extensions that failed to load at startup */
  loadErrors: { pkg: string; message: string }[];
  /** the server stopped accepting this browser's session */
  onUnauthorized: (f: () => void) => () => void;
}

export async function createApp(): Promise<App> {
  const { db, persistent } = await openWasmDriver();
  await migrate(db);
  const cookieJar = await PersistentCookieJar.load();
  const unauthorized = new Set<() => void>();
  const proxy = createProxyTransport({ endpoint: '/api/proxy' });
  const sources = await createRuntimeGateway({
    transport: {
      async execute(req) {
        try {
          return await proxy.execute(req);
        } catch (e) {
          if (e instanceof ProxyError && e.status === 401) for (const f of unauthorized) f();
          throw e;
        }
      },
    },
    cookieJar,
    userAgent: navigator.userAgent,
    prefs: new SqliteSourcePrefsRepository(db),
  });
  const imageSrc = createImageSrc(cookieJar);
  const uc = createUseCases({
    ...sqliteRepositories(db),
    fetcher: new HttpExtensionFetcher(),
    crypto: webCrypto,
    bundles: new IdbBundleStore(),
    pages: new IdbPageStore(imageSrc),
    sources,
    clock: { now: () => Date.now() },
  });
  await uc.extensions.ensureDefaultRepo(DEFAULT_REPO).catch(() => {});
  const loadErrors = await uc.extensions.loadInstalled();
  void uc.downloads.resume();
  return {
    uc,
    sources,
    widget: { refresh: async () => {}, seen: async () => {} },
    imageSrc,
    coverSrc: (sourceId, url) => (url ? imageSrc({ url, headers: sources.has(sourceId) ? sources.headers(sourceId) : {} }) : null),
    persistent,
    loadErrors,
    onUnauthorized(f) {
      unauthorized.add(f);
      return () => unauthorized.delete(f);
    },
  };
}

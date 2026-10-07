import { AppState } from 'react-native';

import { MemoryCookieJar } from '@kanso/source-api/src/okhttp';

import { createUseCases, type ContinueReadingSurface, type SourceGateway, type UseCases } from '@kanso/core';
import { HttpExtensionFetcher } from '@kanso/http';
import { createRuntimeGateway } from '@kanso/source-gateway';
import { migrate, SqliteSourcePrefsRepository, sqliteRepositories } from '@kanso/sqlite';

import { rnTransport, USER_AGENT } from '@/adapters/sources/rnTransport';
import { openExpoDriver } from '@/adapters/sqlite/expoDriver';
import { expoCrypto } from '@/adapters/system/expoCrypto';
import { FsBundleStore, FsPageStore } from '@/adapters/system/fileStores';
import { createWidgetSurface } from '@/widgets/surface';

export const DEFAULT_REPO = 'https://rhombicdodecahedron.github.io/kanso-extensions';

export interface App {
  uc: UseCases;
  sources: SourceGateway;
  widget: ContinueReadingSurface;
  /** extensions that failed to load at startup */
  loadErrors: { pkg: string; message: string }[];
}

export async function createApp(): Promise<App> {
  const db = await openExpoDriver('kanso.db');
  await migrate(db);
  const sources = await createRuntimeGateway({
    transport: rnTransport,
    cookieJar: new MemoryCookieJar(),
    userAgent: USER_AGENT,
    prefs: new SqliteSourcePrefsRepository(db),
  });
  const uc = createUseCases({
    ...sqliteRepositories(db),
    fetcher: new HttpExtensionFetcher(),
    crypto: expoCrypto,
    bundles: new FsBundleStore(),
    pages: new FsPageStore(),
    sources,
    clock: { now: () => Date.now() },
  });
  const widget = createWidgetSurface(uc, sources);
  await uc.extensions.ensureDefaultRepo(DEFAULT_REPO).catch(() => {});
  const loadErrors = await uc.extensions.loadInstalled();
  void uc.downloads.resume();
  void widget.refresh();
  // Leaving the app hands every remaining page to the system, which downloads them while suspended.
  AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      uc.downloads.background();
      void widget.refresh();
    } else if (state === 'active') {
      uc.downloads.foreground();
      void uc.downloads.run();
    }
  });
  return { uc, sources, widget, loadErrors };
}

import { AppState } from 'react-native';

import { openExpoDriver } from '@/adapters/sqlite/expoDriver';
import { sqliteRepositories } from '@/adapters/sqlite/repositories';
import { migrate } from '@/adapters/sqlite/schema';
import { createRuntimeGateway } from '@/adapters/sources/runtimeGateway';
import { HttpExtensionFetcher } from '@/adapters/system/fetcher';
import { FsBundleStore, FsPageStore } from '@/adapters/system/fileStores';
import { createUseCases, type UseCases } from '@/core/application';
import { syncWidget } from '@/widgets/sync';
import type { SourceGateway } from '@/core/application/ports';

export const DEFAULT_REPO = 'https://rhombicdodecahedron.github.io/kanso-extensions';

export interface App {
  uc: UseCases;
  sources: SourceGateway;
  /** extensions that failed to load at startup */
  loadErrors: { pkg: string; message: string }[];
}

export async function createApp(): Promise<App> {
  const db = await openExpoDriver('kanso.db');
  await migrate(db);
  const sources = await createRuntimeGateway(db);
  const uc = createUseCases({
    ...sqliteRepositories(db),
    fetcher: new HttpExtensionFetcher(),
    bundles: new FsBundleStore(),
    pages: new FsPageStore(),
    sources,
    clock: { now: () => Date.now() },
  });
  await uc.extensions.ensureDefaultRepo(DEFAULT_REPO).catch(() => {});
  const loadErrors = await uc.extensions.loadInstalled();
  void uc.downloads.resume();
  void syncWidget(uc, sources);
  // Leaving the app hands every remaining page to the system, which downloads them while suspended.
  AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      uc.downloads.background();
      void syncWidget(uc, sources);
    } else if (state === 'active') {
      uc.downloads.foreground();
      void uc.downloads.run();
    }
  });
  return { uc, sources, loadErrors };
}

import { createCatalogUseCases } from './catalog';
import { createDownloadUseCases } from './downloads';
import { createExtensionUseCases } from './extensions';
import { createLibraryUseCases } from './library';
import type { Deps } from './ports';
import { createReaderUseCases } from './reader';

export function createUseCases(d: Deps) {
  return {
    extensions: createExtensionUseCases(d),
    catalog: createCatalogUseCases(d),
    library: createLibraryUseCases(d),
    reader: createReaderUseCases(d),
    downloads: createDownloadUseCases(d),
    settings: {
      get: () => d.settings.get(),
      save: (s: Awaited<ReturnType<Deps['settings']['get']>>) => d.settings.save(s),
    },
  };
}

export type UseCases = ReturnType<typeof createUseCases>;

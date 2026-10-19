import type { BundleStore } from '@kanso/core';

import { idb } from './idb';

export class IdbBundleStore implements BundleStore {
  async write(pkg: string, code: string) {
    await (await idb()).put('bundles', code, pkg);
  }
  async read(pkg: string) {
    return (await (await idb()).get('bundles', pkg)) ?? null;
  }
  async remove(pkg: string) {
    await (await idb()).delete('bundles', pkg);
  }
}

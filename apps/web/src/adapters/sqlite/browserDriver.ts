import type { SqlDriver } from '@kanso/sqlite';

import { idb } from '../storage/idb';
import { openSnapshotDriver, type Sqlite3 } from './snapshotDriver';

export class OtherTabError extends Error {
  constructor() {
    super('Kanso is open in another tab. Close it there to use it here.');
  }
}

const KEY = 'library.sqlite';

/**
 * Opens the browser database. One tab at a time: each tab holds the whole database in memory, so
 * a second one would overwrite the first's changes. A Web Lock keeps it out instead.
 */
export async function openBrowserDriver(): Promise<{ db: SqlDriver; persistent: boolean }> {
  await holdTabLock();
  // sqlite-wasm is served as-is from /sqlite/ (scripts/copy-sqlite-wasm.mjs): bundlers cannot
  // follow the URLs it builds for its own files.
  const url = '/sqlite/index.mjs';
  const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as { default: () => Promise<Sqlite3> };
  const sqlite3 = await mod.default();
  const { db, flush } = await openSnapshotDriver(sqlite3, {
    load: async () => ((await (await idb()).get('kv', KEY)) as Uint8Array | undefined) ?? null,
    save: async (bytes) => void (await (await idb()).put('kv', bytes, KEY)),
  });
  // Save right away when the page is hidden or left, not a moment later.
  addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flush());
  addEventListener('pagehide', () => void flush());
  // Ask the browser not to evict Kanso's data when space runs low (granted to installed apps and
  // sites in regular use).
  const persistent = !!(await navigator.storage?.persist?.().catch(() => false));
  return { db, persistent };
}

function holdTabLock(): Promise<void> {
  if (!navigator.locks) return Promise.resolve();
  return new Promise((resolve, reject) => {
    void navigator.locks.request('kanso-db', { ifAvailable: true }, (lock) => {
      if (!lock) {
        reject(new OtherTabError());
        return;
      }
      resolve();
      // held for the life of the tab
      return new Promise<void>(() => {});
    });
  });
}

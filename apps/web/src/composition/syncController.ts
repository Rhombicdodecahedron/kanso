// When the web app syncs: at start, when the tab comes back into view, and every half minute while
// it is in view. Screens refresh when another device changed something.

import type { SyncUseCases } from '@kanso/core';
import { SyncHttpError } from '@kanso/http';

export type SyncStatus =
  | { kind: 'off'; reason: string }
  | { kind: 'idle'; lastSyncAt: number | null }
  | { kind: 'syncing'; lastSyncAt: number | null }
  | { kind: 'error'; message: string; lastSyncAt: number | null };

const INTERVAL_MS = 30_000;

export interface SyncController {
  status(): SyncStatus;
  syncNow(): Promise<void>;
  onStatus(f: (s: SyncStatus) => void): () => void;
  /** another device changed something here */
  onDataChanged(f: () => void): () => void;
}

export function createSyncController(sync: SyncUseCases): SyncController {
  let status: SyncStatus = { kind: 'idle', lastSyncAt: null };
  const statusListeners = new Set<(s: SyncStatus) => void>();
  const dataListeners = new Set<() => void>();
  const set = (s: SyncStatus) => {
    status = s;
    for (const f of statusListeners) f(s);
  };
  const last = () => (status.kind === 'off' ? null : status.lastSyncAt);

  async function syncNow() {
    if (status.kind === 'off' || !navigator.onLine) return;
    set({ kind: 'syncing', lastSyncAt: last() });
    try {
      const r = await sync.syncNow();
      set({ kind: 'idle', lastSyncAt: (await sync.state()).lastSyncAt });
      if (r.applied) for (const f of dataListeners) f();
    } catch (e) {
      if (e instanceof SyncHttpError && e.status === 503) return set({ kind: 'off', reason: 'Sync is not set up on this server.' });
      set({ kind: 'error', message: e instanceof Error ? e.message : String(e), lastSyncAt: last() });
    }
  }

  void sync.state().then((s) => {
    if (status.kind === 'idle') set({ kind: 'idle', lastSyncAt: s.lastSyncAt });
  });
  void syncNow();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void syncNow());
  addEventListener('online', () => void syncNow());
  setInterval(() => document.visibilityState === 'visible' && void syncNow(), INTERVAL_MS);

  return {
    status: () => status,
    syncNow,
    onStatus(f) {
      statusListeners.add(f);
      return () => statusListeners.delete(f);
    },
    onDataChanged(f) {
      dataListeners.add(f);
      return () => dataListeners.delete(f);
    },
  };
}

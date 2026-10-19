// Sync on the phone: with a server set up in Settings, at start, on coming back to the foreground,
// every minute while open and when leaving the app. Screens and the widget refresh when another
// device changed something.

import { AppState } from 'react-native';

import { createSyncUseCases, type Clock, type Crypto, type SecretStore, type SyncLocalStore, type SyncStateRepository } from '@kanso/core';
import { HttpSyncClient } from '@kanso/http';

export type SyncStatus =
  | { kind: 'off' }
  | { kind: 'idle'; lastSyncAt: number | null }
  | { kind: 'syncing'; lastSyncAt: number | null }
  | { kind: 'error'; message: string; lastSyncAt: number | null };

export interface SyncSetup {
  server: string;
  token: string;
}

export interface SyncController {
  status(): SyncStatus;
  setup(): Promise<SyncSetup | null>;
  /** Checks the server and token with a real sync, then keeps them. */
  connect(s: SyncSetup): Promise<void>;
  disconnect(): Promise<void>;
  syncNow(): Promise<void>;
  onStatus(f: (s: SyncStatus) => void): () => void;
  onDataChanged(f: () => void): () => void;
}

const SERVER = 'syncServer';
const TOKEN = 'syncToken';
const INTERVAL_MS = 60_000;

export function createSyncController(d: { local: SyncLocalStore; state: SyncStateRepository; secrets: SecretStore; crypto: Crypto; clock: Clock }): SyncController {
  let status: SyncStatus = { kind: 'off' };
  const statusListeners = new Set<(s: SyncStatus) => void>();
  const dataListeners = new Set<() => void>();
  const set = (s: SyncStatus) => {
    status = s;
    for (const f of statusListeners) f(s);
  };
  const last = () => (status.kind === 'off' ? null : status.lastSyncAt);

  const syncUseCasesFor = (s: SyncSetup) =>
    createSyncUseCases({ ...d, remote: new HttpSyncClient({ baseUrl: s.server, headers: () => ({ Authorization: `Bearer ${s.token}` }) }) });
  let sync: ReturnType<typeof syncUseCasesFor> | null = null;

  async function setup(): Promise<SyncSetup | null> {
    const [server, token] = await Promise.all([d.secrets.get(SERVER), d.secrets.get(TOKEN)]);
    return server && token ? { server, token } : null;
  }

  async function syncNow() {
    if (!sync) return;
    set({ kind: 'syncing', lastSyncAt: last() });
    try {
      const r = await sync.syncNow();
      set({ kind: 'idle', lastSyncAt: (await d.state.get()).lastSyncAt });
      if (r.applied) for (const f of dataListeners) f();
    } catch (e) {
      set({ kind: 'error', message: e instanceof Error ? e.message : String(e), lastSyncAt: last() });
    }
  }

  void setup().then(async (s) => {
    if (!s) return;
    sync = syncUseCasesFor(s);
    set({ kind: 'idle', lastSyncAt: (await d.state.get()).lastSyncAt });
    void syncNow();
  });
  AppState.addEventListener('change', (state) => {
    if (state === 'active' || state === 'background') void syncNow();
  });
  setInterval(() => AppState.currentState === 'active' && void syncNow(), INTERVAL_MS);

  return {
    status: () => status,
    setup,
    async connect(s) {
      const clean = { server: s.server.trim().replace(/\/+$/, ''), token: s.token.trim() };
      const candidate = syncUseCasesFor(clean);
      set({ kind: 'syncing', lastSyncAt: null });
      try {
        const r = await candidate.syncNow();
        await Promise.all([d.secrets.set(SERVER, clean.server), d.secrets.set(TOKEN, clean.token)]);
        sync = candidate;
        set({ kind: 'idle', lastSyncAt: (await d.state.get()).lastSyncAt });
        if (r.applied) for (const f of dataListeners) f();
      } catch (e) {
        set(sync ? { kind: 'error', message: e instanceof Error ? e.message : String(e), lastSyncAt: null } : { kind: 'off' });
        throw e;
      }
    },
    async disconnect() {
      sync = null;
      await Promise.all([d.secrets.set(SERVER, null), d.secrets.set(TOKEN, null)]);
      set({ kind: 'off' });
    },
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

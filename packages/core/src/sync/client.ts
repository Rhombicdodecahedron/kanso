// Device side of sync: push what changed here, pull what changed elsewhere, keep the newest.

import type { Clock, Crypto } from '../application/ports';
import { wins } from './merge';
import { refId, SYNC_KIND_ORDER, type SyncRecord } from './model';
import type { SyncLocalStore, SyncRemote, SyncStateRepository } from './ports';

const BATCH = 200;
const MAX_ROUNDS = 50;

export interface SyncDeps {
  local: SyncLocalStore;
  remote: SyncRemote;
  state: SyncStateRepository;
  crypto: Crypto;
  clock: Clock;
}

export interface SyncResult {
  pushed: number;
  /** records from other devices that changed something here */
  applied: number;
}

export function createSyncUseCases(d: SyncDeps) {
  let running: Promise<SyncResult> | null = null;

  /** Applies the records that are newer than what this device has. Returns how many. */
  async function apply(records: SyncRecord[]): Promise<number> {
    if (!records.length) return 0;
    const local = await d.local.versions(records);
    // The newest of each record, in dependency order.
    const best = new Map<string, SyncRecord>();
    for (const r of records) {
      const id = refId(r);
      const prev = best.get(id);
      if (!prev || wins(r, prev)) best.set(id, r);
    }
    const winners = [...best.values()].filter((r) => wins(r, local.get(refId(r))));
    winners.sort((a, b) => SYNC_KIND_ORDER.indexOf(a.kind) - SYNC_KIND_ORDER.indexOf(b.kind));
    await d.local.write(winners);
    return winners.length;
  }

  async function run(): Promise<SyncResult> {
    const state = await d.state.get();
    const deviceId = state.deviceId ?? d.crypto.randomId();
    let cursor = state.cursor;
    let pushed = 0;
    let applied = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const changes = await d.local.pending(BATCH, deviceId);
      const res = await d.remote.exchange({ deviceId, cursor, changes });
      applied += await apply(res.changes);
      await d.local.acknowledge(changes);
      pushed += changes.length;
      cursor = res.cursor;
      await d.state.save({ deviceId, cursor, lastSyncAt: state.lastSyncAt });
      if (!res.more && changes.length < BATCH) break;
    }
    await d.state.save({ deviceId, cursor, lastSyncAt: d.clock.now() });
    return { pushed, applied };
  }

  return {
    /** One sync at a time; a call during a running sync waits for that one. */
    syncNow(): Promise<SyncResult> {
      running ??= run().finally(() => (running = null));
      return running;
    },
    state: () => d.state.get(),
  };
}

export type SyncUseCases = ReturnType<typeof createSyncUseCases>;

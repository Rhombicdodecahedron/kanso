// Server side of sync: one exchange per request, atomically.

import type { Clock } from '../application/ports';
import { wins } from './merge';
import { refId, type SyncKind, type SyncRecord } from './model';
import type { ExchangeRequest, ExchangeResponse, SyncStore } from './ports';

const PAGE = 500;
/** A device clock running ahead must not win every future conflict. */
const MAX_FUTURE_MS = 5 * 60_000;
const KINDS: SyncKind[] = ['category', 'library', 'progress', 'history'];
const MAX_CHANGES = 1000;
const MAX_KEY = 4096;

export class InvalidExchangeError extends Error {}

/** Checks the shape of an exchange request coming off the wire. */
export function parseExchangeRequest(body: unknown): ExchangeRequest {
  const b = body as Partial<ExchangeRequest> | null;
  if (!b || typeof b.deviceId !== 'string' || !b.deviceId || b.deviceId.length > 100) throw new InvalidExchangeError('deviceId is required');
  if (typeof b.cursor !== 'number' || !Number.isInteger(b.cursor) || b.cursor < 0) throw new InvalidExchangeError('cursor must be a non-negative integer');
  if (!Array.isArray(b.changes) || b.changes.length > MAX_CHANGES) throw new InvalidExchangeError(`changes must be an array of at most ${MAX_CHANGES}`);
  const changes = b.changes.map((c: Partial<SyncRecord>) => {
    if (!c || !KINDS.includes(c.kind as SyncKind)) throw new InvalidExchangeError('unknown record kind');
    if (typeof c.key !== 'string' || !c.key || c.key.length > MAX_KEY) throw new InvalidExchangeError('bad record key');
    if (typeof c.updatedAt !== 'number' || !Number.isFinite(c.updatedAt)) throw new InvalidExchangeError('bad updatedAt');
    return { kind: c.kind as SyncKind, key: c.key, updatedAt: Math.trunc(c.updatedAt), deviceId: b.deviceId!, deleted: !!c.deleted, data: c.deleted ? null : (c.data ?? null) };
  });
  return { deviceId: b.deviceId, cursor: b.cursor, changes };
}

export function createSyncService(store: SyncStore, clock: Clock) {
  return {
    exchange(req: ExchangeRequest): Promise<ExchangeResponse> {
      const limit = clock.now() + MAX_FUTURE_MS;
      const incoming = req.changes.map((c) => ({ ...c, deviceId: req.deviceId, updatedAt: Math.min(c.updatedAt, limit) }));
      return store.transaction(async (tx) => {
        const current = new Map((await tx.get(incoming)).map((r) => [refId(r), r]));
        const accepted: SyncRecord[] = [];
        // The device keeps a change that lost until it hears the winner: send it back.
        const lost: SyncRecord[] = [];
        for (const c of incoming) {
          const cur = current.get(refId(c));
          if (wins(c, cur)) {
            accepted.push(c);
            current.set(refId(c), c);
          } else if (cur) lost.push(cur);
        }
        await tx.put(accepted);
        const page = await tx.since(req.cursor, PAGE);
        return { cursor: page.cursor, more: page.more, changes: [...page.records.filter((r) => r.deviceId !== req.deviceId), ...lost] };
      });
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;

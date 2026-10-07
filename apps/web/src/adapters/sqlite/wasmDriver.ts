import { createSerialDriver, type SqlDriver, type SqlParam } from '@kanso/sqlite';

export class OtherTabError extends Error {
  constructor() {
    super('Kanso is open in another tab. Close it there to use it here.');
  }
}

/**
 * Opens the browser database. One tab at a time: the OPFS pool belongs to a single worker, so a
 * Web Lock keeps a second tab out instead of letting it fail halfway.
 */
export async function openWasmDriver(): Promise<{ db: SqlDriver; persistent: boolean }> {
  await holdTabLock();
  const worker = new Worker('/sqlite/worker.mjs', { type: 'module' });
  let next = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const opened = new Promise<boolean>((resolve, reject) => pending.set(0, { resolve: (m) => resolve(m.persistent), reject }));
  worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; rows?: unknown[]; error?: string; persistent?: boolean }>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.ok) p.resolve(ev.data);
    else p.reject(new Error(ev.data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Database worker failed'));
    pending.clear();
  };
  const call = (op: 'run' | 'all', sql: string, params: SqlParam[] = []) =>
    new Promise<{ rows?: unknown[] }>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, op, sql, params });
    });
  const persistent = await opened;
  const db = createSerialDriver({
    async run(sql, params) {
      await call('run', sql, params);
    },
    async all<T>(sql: string, params?: SqlParam[]) {
      return ((await call('all', sql, params)).rows ?? []) as T[];
    },
  });
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

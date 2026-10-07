import { refId, type SyncRecord } from '../src/sync/model';
import type { SyncStore, SyncStoreTx } from '../src/sync/ports';

const withoutSeq = ({ seq: _seq, ...r }: SyncRecord & { seq: number }): SyncRecord => r; // eslint-disable-line @typescript-eslint/no-unused-vars

/** A SyncStore in memory: the reference behaviour for adapters, and a server for tests. */
export function createMemorySyncStore(): SyncStore {
  let rows = new Map<string, SyncRecord & { seq: number }>();
  let seq = 0;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    transaction<T>(fn: (tx: SyncStoreTx) => Promise<T>): Promise<T> {
      const run = async () => {
        const draft = new Map(rows);
        let draftSeq = seq;
        const tx: SyncStoreTx = {
          async get(refs) {
            return refs.map((r) => draft.get(refId(r))).filter((r): r is SyncRecord & { seq: number } => !!r).map(withoutSeq);
          },
          async put(records) {
            for (const r of records) draft.set(refId(r), { ...r, seq: ++draftSeq });
          },
          async since(cursor, limit) {
            const all = [...draft.values()].filter((r) => r.seq > cursor).sort((a, b) => a.seq - b.seq);
            const page = all.slice(0, limit);
            return { records: page.map(withoutSeq), cursor: page.length ? page[page.length - 1].seq : cursor, more: all.length > limit };
          },
        };
        const out = await fn(tx);
        rows = draft;
        seq = draftSeq;
        return out;
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}

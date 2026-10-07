// SyncStore on Turso / libSQL: the only place that knows the server's database.

import { createClient, type Client, type InStatement, type Transaction } from '@libsql/client';

import { refId, type SyncKind, type SyncRecord, type SyncStore, type SyncStoreTx } from '@kanso/core';

export interface TursoSyncStoreOptions {
  /** libsql://…turso.io, file:local.db, or :memory: */
  url: string;
  authToken?: string;
}

const SCHEMA: InStatement[] = [
  `create table if not exists sync_record (
    kind text not null,
    key text not null,
    updated_at integer not null,
    device_id text not null,
    deleted integer not null,
    data text,
    seq integer not null,
    primary key (kind, key))`,
  `create index if not exists sync_record_seq on sync_record (seq)`,
  `create table if not exists sync_counter (id integer primary key check (id = 1), seq integer not null)`,
  `insert or ignore into sync_counter (id, seq) values (1, 0)`,
];

interface Row {
  kind: string;
  key: string;
  updated_at: number;
  device_id: string;
  deleted: number;
  data: string | null;
  seq: number;
}

const toRecord = (r: Row): SyncRecord => ({
  kind: r.kind as SyncKind,
  key: r.key,
  updatedAt: Number(r.updated_at),
  deviceId: r.device_id,
  deleted: !!Number(r.deleted),
  data: r.data === null ? null : JSON.parse(r.data),
});

function txAdapter(tx: Transaction): SyncStoreTx {
  return {
    async get(refs) {
      const out: SyncRecord[] = [];
      const seen = new Set<string>();
      for (const r of refs) {
        if (seen.has(refId(r))) continue;
        seen.add(refId(r));
        const rs = await tx.execute({ sql: 'select * from sync_record where kind = ? and key = ?', args: [r.kind, r.key] });
        if (rs.rows[0]) out.push(toRecord(rs.rows[0] as unknown as Row));
      }
      return out;
    },
    async put(records) {
      if (!records.length) return;
      const rs = await tx.execute('select seq from sync_counter where id = 1');
      let seq = Number(rs.rows[0].seq);
      for (const r of records) {
        seq++;
        await tx.execute({
          sql: `insert into sync_record (kind, key, updated_at, device_id, deleted, data, seq) values (?, ?, ?, ?, ?, ?, ?)
                on conflict (kind, key) do update set updated_at = excluded.updated_at, device_id = excluded.device_id,
                deleted = excluded.deleted, data = excluded.data, seq = excluded.seq`,
          args: [r.kind, r.key, r.updatedAt, r.deviceId, r.deleted ? 1 : 0, r.data === null || r.data === undefined ? null : JSON.stringify(r.data), seq],
        });
      }
      await tx.execute({ sql: 'update sync_counter set seq = ? where id = 1', args: [seq] });
    },
    async since(cursor, limit) {
      const rs = await tx.execute({ sql: 'select * from sync_record where seq > ? order by seq limit ?', args: [cursor, limit + 1] });
      const rows = rs.rows as unknown as Row[];
      const page = rows.slice(0, limit);
      return { records: page.map(toRecord), cursor: page.length ? Number(page[page.length - 1].seq) : cursor, more: rows.length > limit };
    },
  };
}

export function createTursoSyncStore(opts: TursoSyncStoreOptions): SyncStore & { close(): void } {
  const client: Client = createClient({ url: opts.url, authToken: opts.authToken });
  let ready: Promise<void> | null = null;
  const ensureSchema = () => (ready ??= client.batch(SCHEMA, 'write').then(() => undefined));
  return {
    async transaction(fn) {
      await ensureSchema();
      const tx = await client.transaction('write');
      try {
        const out = await fn(txAdapter(tx));
        await tx.commit();
        return out;
      } catch (e) {
        await tx.rollback().catch(() => {});
        throw e;
      } finally {
        tx.close();
      }
    },
    close: () => client.close(),
  };
}

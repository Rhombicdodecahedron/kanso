// Every SyncStore adapter must pass this suite: `syncStoreContract('Turso', () => createTurso…())`.

import { describe, expect, it } from 'vitest';

import type { SyncRecord } from '../src/sync/model';
import type { SyncStore } from '../src/sync/ports';

const rec = (key: string, updatedAt: number, extra: Partial<SyncRecord> = {}): SyncRecord => ({ kind: 'library', key, updatedAt, deviceId: 'a', deleted: false, data: { n: updatedAt }, ...extra });

export function syncStoreContract(name: string, open: () => Promise<SyncStore>) {
  describe(`${name} sync store`, () => {
    it('stores records and returns them by kind and key', async () => {
      const s = await open();
      await s.transaction((tx) => tx.put([rec('x', 1), rec('x', 2, { kind: 'history' })]));
      const got = await s.transaction((tx) => tx.get([{ kind: 'library', key: 'x' }, { kind: 'history', key: 'x' }, { kind: 'library', key: 'missing' }]));
      expect(got.sort((a, b) => a.updatedAt - b.updatedAt)).toEqual([rec('x', 1), rec('x', 2, { kind: 'history' })]);
    });

    it('keeps one version per record, with its data, deletion flag and device', async () => {
      const s = await open();
      await s.transaction((tx) => tx.put([rec('x', 1)]));
      await s.transaction((tx) => tx.put([rec('x', 5, { deviceId: 'b', deleted: true, data: null })]));
      expect(await s.transaction((tx) => tx.get([{ kind: 'library', key: 'x' }]))).toEqual([rec('x', 5, { deviceId: 'b', deleted: true, data: null })]);
    });

    it('feeds changes in write order, paged, a rewritten record moving to the end', async () => {
      const s = await open();
      await s.transaction((tx) => tx.put([rec('a', 1), rec('b', 1), rec('c', 1)]));
      await s.transaction((tx) => tx.put([rec('a', 2)]));
      const first = await s.transaction((tx) => tx.since(0, 2));
      expect(first.records.map((r) => r.key)).toEqual(['b', 'c']);
      expect(first.more).toBe(true);
      const rest = await s.transaction((tx) => tx.since(first.cursor, 2));
      expect(rest.records.map((r) => [r.key, r.updatedAt])).toEqual([['a', 2]]);
      expect(rest.more).toBe(false);
      const none = await s.transaction((tx) => tx.since(rest.cursor, 2));
      expect(none).toEqual({ records: [], cursor: rest.cursor, more: false });
    });

    it('rolls back a failed transaction', async () => {
      const s = await open();
      await expect(
        s.transaction(async (tx) => {
          await tx.put([rec('x', 1)]);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await s.transaction((tx) => tx.get([{ kind: 'library', key: 'x' }]))).toEqual([]);
      expect((await s.transaction((tx) => tx.since(0, 10))).records).toEqual([]);
    });

    it('keeps unicode keys and nested data intact', async () => {
      const s = await open();
      const key = JSON.stringify(['src', '/만화/1?a=b', '/ch"1']);
      const data = { title: '간 — “quotes”', genres: ['a', 'b'], nested: { n: 1.5, z: null } };
      await s.transaction((tx) => tx.put([rec(key, 3, { kind: 'progress', data })]));
      expect((await s.transaction((tx) => tx.get([{ kind: 'progress', key }])))[0].data).toEqual(data);
    });
  });
}

import 'fake-indexeddb/auto';

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createSerialDriver, migrate, type SqlDriver, sqliteRepositories, SqliteSourcePrefsRepository } from '@kanso/sqlite';
import { openNodeDriver } from '@kanso/sqlite/testing';

import { resetIdbForTests } from '../storage/idb';
import { IdbBundleStore } from '../storage/idbBundleStore';
import { IdbPageStore } from '../storage/idbPageStore';
import { webCrypto } from '../system/webCrypto';

/** The same engine the browser runs (WebAssembly), in memory. */
async function openWasmMemoryDriver(): Promise<SqlDriver> {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(':memory:');
  return createSerialDriver({
    async run(sql, params) {
      db.exec({ sql, bind: params?.length ? params : undefined });
    },
    async all<T>(sql: string, params?: (string | number | null)[]) {
      return db.exec({ sql, bind: params?.length ? params : undefined, rowMode: 'object', returnValue: 'resultRows' }) as T[];
    },
  });
}

/** A short story through the repositories; the result must not depend on the engine. */
async function story(db: SqlDriver) {
  await migrate(db);
  const r = sqliteRepositories(db);
  const m = await r.mangas.insert({ sourceId: 's', url: '/m', title: 'T', artist: null, author: 'A', description: null, genres: ['x', 'y'], status: 1, thumbnailUrl: null, favorite: true, initialized: true, dateAdded: 5, lastUpdate: 0, memo: { k: 1 }, viewer: 'webtoon' });
  await r.chapters.insertMany([1, 2, 3].map((i) => ({ mangaId: m.id, url: `/c${i}`, name: `Ch ${i}`, scanlator: null, chapterNumber: i, dateUpload: i, dateFetch: 0, sourceOrder: 3 - i, read: false, bookmark: false, lastPageRead: 0, pageOffset: 0, memo: null })));
  const cs = await r.chapters.byManga(m.id);
  await r.chapters.setRead([cs[0].id], true);
  await r.chapters.setProgress(cs[1].id, 4, 0.25);
  await r.history.upsert({ chapterId: cs[1].id, lastRead: 100, timeRead: 7 });
  const cat = await r.categories.create('Fav');
  await r.categories.setForManga(m.id, [cat.id]);
  const prefs = new SqliteSourcePrefsRepository(db);
  await prefs.save('s', { a: 1 });
  return {
    manga: await r.mangas.get(m.id),
    chapters: await r.chapters.byManga(m.id),
    unread: [...(await r.chapters.unreadCounts())],
    history: await r.history.recent(10),
    assignments: [...(await r.categories.assignments())],
    prefs: [...(await prefs.loadAll())],
  };
}

describe('browser SQLite engine', () => {
  it('runs every migration and repository exactly like the native engine', async () => {
    expect(await story(await openWasmMemoryDriver())).toEqual(await story(openNodeDriver()));
  });
});

describe('IndexedDB stores', () => {
  beforeEach(() => {
    indexedDB = new IDBFactory();
    resetIdbForTests();
  });

  it('keeps bundle code', async () => {
    const s = new IdbBundleStore();
    expect(await s.read('p')).toBeNull();
    await s.write('p', 'code');
    expect(await s.read('p')).toBe('code');
    await s.remove('p');
    expect(await s.read('p')).toBeNull();
  });

  it('downloads pages through the image proxy and lists them in order', async () => {
    const asked: string[] = [];
    const store = new IdbPageStore(
      (req) => `/api/img?u=${req.url}`,
      async (url) => {
        asked.push(String(url));
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
      },
    );
    await store.download(7, 1, { url: 'https://s/1.png', headers: {} });
    await store.write(7, 0, new Uint8Array([9]), 'jpg');
    await store.download(8, 0, { url: 'https://s/other.png', headers: {} });
    expect(asked).toEqual(['/api/img?u=https://s/1.png', '/api/img?u=https://s/other.png']);
    expect([...(await store.indexes(7))].sort()).toEqual([0, 1]);
    expect(await store.list(7)).toHaveLength(2);
    await store.remove(7);
    expect(await store.indexes(7)).toEqual(new Set());
    expect(await store.indexes(8)).toEqual(new Set([0]));
  });

  it('refuses failed downloads', async () => {
    const store = new IdbPageStore(
      () => '/x',
      async () => new Response('no', { status: 403 }),
    );
    await expect(store.download(1, 0, { url: 'u', headers: {} })).rejects.toThrow('HTTP 403');
    expect(await store.indexes(1)).toEqual(new Set());
  });
});

describe('web crypto', () => {
  it('hashes like the extension index expects', async () => {
    expect(await webCrypto.sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(webCrypto.randomId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('snapshot driver', () => {
  it('keeps the library across openings and saves once per burst of writes', async () => {
    const { openSnapshotDriver } = await import('../sqlite/snapshotDriver');
    const sqlite3 = (await sqlite3InitModule()) as unknown as import('../sqlite/snapshotDriver').Sqlite3;
    let stored: Uint8Array | null = null;
    let saves = 0;
    const store = { load: async () => stored, save: async (b: Uint8Array) => void ((stored = b), saves++) };

    const first = await openSnapshotDriver(sqlite3, store, { delayMs: 10_000 });
    await migrate(first.db);
    const repos = sqliteRepositories(first.db);
    await repos.categories.create('Kept');
    await repos.categories.create('Also kept');
    expect(saves).toBe(0);
    await first.flush();
    expect(saves).toBe(1);
    await first.flush();
    expect(saves).toBe(1);

    const second = await openSnapshotDriver(sqlite3, store);
    expect((await sqliteRepositories(second.db).categories.list()).map((c) => c.name)).toEqual(['Kept', 'Also kept']);
    // migrations are not re-applied to a restored database
    await migrate(second.db);
    expect(await sqliteRepositories(second.db).categories.list()).toHaveLength(2);
  });
});

import { createMemorySyncStore, syncStoreContract } from '../testing';
import { migrate, sqliteRepositories, SqliteSyncLocalStore, SqliteSyncStateRepository } from '@kanso/sqlite';
import { openNodeDriver } from '@kanso/sqlite/testing';

import { createSyncService, createSyncUseCases, parseExchangeRequest, wins, type SyncRecord, type SyncStore } from '../src';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('last writer wins', () => {
  it('prefers the newer record, then the higher device id', () => {
    expect(wins({ updatedAt: 2, deviceId: 'a' }, { updatedAt: 1, deviceId: 'z' })).toBe(true);
    expect(wins({ updatedAt: 1, deviceId: 'z' }, { updatedAt: 2, deviceId: 'a' })).toBe(false);
    expect(wins({ updatedAt: 1, deviceId: 'b' }, { updatedAt: 1, deviceId: 'a' })).toBe(true);
    expect(wins({ updatedAt: 1, deviceId: 'a' }, { updatedAt: 1, deviceId: 'a' })).toBe(false);
    expect(wins({ updatedAt: 1, deviceId: 'a' }, undefined)).toBe(true);
  });
});

syncStoreContract('in-memory', async () => createMemorySyncStore());

describe('sync server', () => {
  const rec = (key: string, updatedAt: number, deviceId: string): SyncRecord => ({ kind: 'library', key, updatedAt, deviceId, deleted: false, data: { v: updatedAt } });
  const clock = { now: () => 1_000_000 };

  it('keeps the newest version, feeds other devices, and returns the winner to a device that lost', async () => {
    const svc = createSyncService(createMemorySyncStore(), clock);
    const a1 = await svc.exchange({ deviceId: 'A', cursor: 0, changes: [rec('x', 10, 'A')] });
    expect(a1.changes).toEqual([]);
    const b1 = await svc.exchange({ deviceId: 'B', cursor: 0, changes: [rec('x', 5, 'B')] });
    // B's older change lost: B hears A's version (both from the feed and as the winner)
    expect(b1.changes.map((r) => [r.deviceId, r.updatedAt])).toContainEqual(['A', 10]);
    const b2 = await svc.exchange({ deviceId: 'B', cursor: b1.cursor, changes: [rec('x', 20, 'B')] });
    expect(b2.changes).toEqual([]);
    const a2 = await svc.exchange({ deviceId: 'A', cursor: a1.cursor, changes: [] });
    expect(a2.changes.map((r) => [r.deviceId, r.updatedAt])).toEqual([['B', 20]]);
  });

  it('caps timestamps from clocks running ahead', async () => {
    const store = createMemorySyncStore();
    const svc = createSyncService(store, clock);
    await svc.exchange({ deviceId: 'A', cursor: 0, changes: [rec('x', 9e15, 'A')] });
    const [stored] = await store.transaction((tx) => tx.get([{ kind: 'library', key: 'x' }]));
    expect(stored.updatedAt).toBe(1_000_000 + 5 * 60_000);
  });

  it('validates requests and stamps the sender on every change', () => {
    expect(() => parseExchangeRequest(null)).toThrow('deviceId');
    expect(() => parseExchangeRequest({ deviceId: 'A', cursor: -1, changes: [] })).toThrow('cursor');
    expect(() => parseExchangeRequest({ deviceId: 'A', cursor: 0, changes: [{ kind: 'nope', key: 'k', updatedAt: 1 }] })).toThrow('kind');
    const ok = parseExchangeRequest({ deviceId: 'A', cursor: 0, changes: [{ kind: 'history', key: 'k', updatedAt: 1.7, deviceId: 'forged', deleted: true, data: { x: 1 } }] });
    expect(ok.changes).toEqual([{ kind: 'history', key: 'k', updatedAt: 1, deviceId: 'A', deleted: true, data: null }]);
  });
});

// ---------- two devices on real SQLite, through the server ----------

async function device(store: SyncStore, name: string) {
  const db = openNodeDriver();
  await migrate(db);
  const repos = sqliteRepositories(db);
  const service = createSyncService(store, { now: () => Date.now() });
  const sync = createSyncUseCases({
    local: new SqliteSyncLocalStore(db),
    // the wire: JSON both ways, validated like the HTTP route does
    remote: { exchange: async (req) => JSON.parse(JSON.stringify(await service.exchange(parseExchangeRequest(JSON.parse(JSON.stringify(req)))))) },
    state: new SqliteSyncStateRepository(db),
    crypto: { sha256: async (t) => t, randomId: () => name },
    clock: { now: () => Date.now() },
  });
  return { db, repos, sync, local: new SqliteSyncLocalStore(db) };
}

async function seedSeries(repos: ReturnType<typeof sqliteRepositories>, url = '/m/1') {
  const m = await repos.mangas.insert({ sourceId: 'src', url, title: 'Series', artist: null, author: 'A', description: 'D', genres: ['x'], status: 1, thumbnailUrl: 'https://t/1.jpg', favorite: false, initialized: true, dateAdded: 0, lastUpdate: 0, memo: null, viewer: null });
  await repos.chapters.insertMany([1, 2, 3].map((i) => ({ mangaId: m.id, url: `${url}/c${i}`, name: `Chapter ${i}`, scanlator: null, chapterNumber: i, dateUpload: i, dateFetch: 0, sourceOrder: 3 - i, read: false, bookmark: false, lastPageRead: 0, pageOffset: 0, memo: null })));
  return { manga: m, chapters: await repos.chapters.byManga(m.id) };
}

const byUrl = async (repos: ReturnType<typeof sqliteRepositories>, url: string) => {
  const m = await repos.mangas.findBySource('src', url);
  return { manga: m, chapters: m ? await repos.chapters.byManga(m.id) : [] };
};

describe('sync between two devices', () => {
  it('carries the library, categories, progress and history to a device that never saw the series', async () => {
    const server = createMemorySyncStore();
    const phone = await device(server, 'phone');
    const web = await device(server, 'web');
    const { manga, chapters } = await seedSeries(phone.repos);
    const cat = await phone.repos.categories.create('Weekend');
    await phone.repos.mangas.update({ ...manga, favorite: true, dateAdded: 123, viewer: 'webtoon' });
    await phone.repos.categories.setForManga(manga.id, [cat.id]);
    const ch2 = chapters.find((c) => c.name === 'Chapter 2')!;
    await phone.repos.chapters.setRead([chapters.find((c) => c.name === 'Chapter 1')!.id], true);
    await phone.repos.chapters.setProgress(ch2.id, 4, 0.5);
    await phone.repos.history.upsert({ chapterId: ch2.id, lastRead: 999, timeRead: 60 });

    expect((await phone.sync.syncNow()).pushed).toBe(5);
    expect((await web.sync.syncNow()).applied).toBe(5);

    const got = await byUrl(web.repos, '/m/1');
    expect(got.manga).toMatchObject({ favorite: true, dateAdded: 123, viewer: 'webtoon', title: 'Series', initialized: false, thumbnailUrl: 'https://t/1.jpg' });
    expect((await web.repos.categories.list()).map((c) => c.name)).toEqual(['Weekend']);
    expect((await web.repos.categories.assignments()).get(got.manga!.id)).toHaveLength(1);
    expect(got.chapters.map((c) => [c.name, c.read, c.lastPageRead, c.pageOffset])).toEqual([
      ['Chapter 2', false, 4, 0.5],
      ['Chapter 1', true, 0, 0],
    ]);
    const [h] = await web.repos.history.recent(10);
    expect(h).toMatchObject({ lastRead: 999, timeRead: 60, chapterId: got.chapters.find((c) => c.name === 'Chapter 2')!.id });
    // nothing echoes back
    expect(await web.local.pending(100, 'web')).toEqual([]);
    expect((await phone.sync.syncNow()).applied).toBe(0);
  });

  it('settles concurrent edits the same way on both devices, newest first', async () => {
    const server = createMemorySyncStore();
    const phone = await device(server, 'phone');
    const web = await device(server, 'web');
    const { manga } = await seedSeries(phone.repos);
    await phone.repos.mangas.update({ ...manga, favorite: true });
    await phone.sync.syncNow();
    await web.sync.syncNow();
    const webManga = (await web.repos.mangas.findBySource('src', '/m/1'))!;

    // offline on both: the web edit is newer
    await phone.repos.mangas.update({ ...(await phone.repos.mangas.get(manga.id))!, viewer: 'ltr' });
    await sleep(5);
    await web.repos.mangas.update({ ...webManga, viewer: 'vertical' });
    await phone.sync.syncNow();
    await web.sync.syncNow();
    await phone.sync.syncNow();
    expect((await phone.repos.mangas.get(manga.id))!.viewer).toBe('vertical');
    expect((await web.repos.mangas.get(webManga.id))!.viewer).toBe('vertical');
  });

  it('removes, restores and unfavourites across devices', async () => {
    const server = createMemorySyncStore();
    const phone = await device(server, 'phone');
    const web = await device(server, 'web');
    const { manga, chapters } = await seedSeries(phone.repos);
    await phone.repos.mangas.update({ ...manga, favorite: true });
    await phone.repos.history.upsert({ chapterId: chapters[0].id, lastRead: 50, timeRead: 1 });
    await phone.sync.syncNow();
    await web.sync.syncNow();
    expect(await web.repos.history.recent(10)).toHaveLength(1);

    // history removed on the web reaches the phone
    await sleep(2);
    await web.repos.history.clear();
    await web.sync.syncNow();
    await phone.sync.syncNow();
    expect(await phone.repos.history.recent(10)).toEqual([]);

    // undo on the phone (put back as it was) is newer than the removal
    await sleep(2);
    await phone.repos.history.upsert({ chapterId: chapters[0].id, lastRead: 50, timeRead: 1 });
    await phone.sync.syncNow();
    await web.sync.syncNow();
    expect(await web.repos.history.recent(10)).toHaveLength(1);

    // unfavourite on the web
    await sleep(2);
    const w = (await web.repos.mangas.findBySource('src', '/m/1'))!;
    await web.repos.mangas.update({ ...w, favorite: false });
    await web.sync.syncNow();
    await phone.sync.syncNow();
    expect((await phone.repos.mangas.get(manga.id))!.favorite).toBe(false);
  });

  it('propagates category renames and deletions', async () => {
    const server = createMemorySyncStore();
    const phone = await device(server, 'phone');
    const web = await device(server, 'web');
    const a = await phone.repos.categories.create('A');
    await phone.repos.categories.create('B');
    await phone.sync.syncNow();
    await web.sync.syncNow();
    await sleep(2);
    await phone.repos.categories.rename(a.id, 'A2');
    await phone.repos.categories.reorder([(await phone.repos.categories.list())[1].id, a.id]);
    await phone.sync.syncNow();
    await web.sync.syncNow();
    expect((await web.repos.categories.list()).map((c) => c.name)).toEqual(['B', 'A2']);
    await sleep(2);
    await web.repos.categories.remove((await web.repos.categories.list())[0].id);
    await web.sync.syncNow();
    await phone.sync.syncNow();
    expect((await phone.repos.categories.list()).map((c) => c.name)).toEqual(['A2']);
  });

  it('keeps a change made while a sync is running for the next sync', async () => {
    const server = createMemorySyncStore();
    const phone = await device(server, 'phone');
    const { chapters } = await seedSeries(phone.repos);
    await phone.repos.chapters.setProgress(chapters[0].id, 1);
    const pending = await phone.local.pending(10, 'phone');
    await sleep(2);
    await phone.repos.chapters.setProgress(chapters[0].id, 2); // after the push was read
    await phone.local.acknowledge(pending);
    const again = await phone.local.pending(10, 'phone');
    expect(again).toHaveLength(1);
    expect((again[0].data as { lastPageRead: number }).lastPageRead).toBe(2);
  });
});

describe('upgrading a device to the sync schema', () => {
  it('queues what the device already has for its first sync', async () => {
    const db = openNodeDriver();
    await migrate(db, 2);
    const repos = sqliteRepositories(db);
    const { manga, chapters } = await seedSeries(repos);
    await repos.mangas.update({ ...manga, favorite: true, dateAdded: 77 });
    await repos.chapters.setRead([chapters[0].id], true);
    await repos.history.upsert({ chapterId: chapters[0].id, lastRead: 500, timeRead: 9 });
    await db.run("insert into category (name, sort) values ('Old', 0)");
    await migrate(db);
    const pending = await new SqliteSyncLocalStore(db).pending(100, 'phone');
    expect(pending.map((r) => [r.kind, r.updatedAt]).sort()).toEqual([
      ['category', 1],
      ['history', 500],
      ['library', 77],
      ['progress', 500],
    ]);
  });
});

// The device's side of sync on SQLite. Change tracking lives in triggers (see schema.ts); this
// turns tracked rows into records and applies the records that won.

import {
  type CategoryData,
  type ChapterStub,
  type HistoryData,
  type LibraryData,
  type MangaStub,
  type ProgressData,
  refId,
  type SyncLocalStore,
  type SyncRecord,
  type SyncRef,
  type SyncState,
  type SyncStateRepository,
  type SyncVersion,
} from '@kanso/core';

import type { SqlDriver, SqlExecutor } from './driver';

interface MetaRow {
  kind: SyncRecord['kind'];
  key: string;
  updated_at: number;
  device_id: string;
}

interface MangaRow {
  id: number;
  source_id: string;
  url: string;
  title: string;
  artist: string | null;
  author: string | null;
  description: string | null;
  genres: string;
  status: number;
  thumbnail_url: string | null;
  favorite: number;
  initialized: number;
  date_added: number;
  viewer: string | null;
}

interface ChapterRow {
  id: number;
  url: string;
  name: string;
  scanlator: string | null;
  chapter_number: number;
  date_upload: number;
  source_order: number;
  read: number;
  bookmark: number;
  last_page_read: number;
  page_offset: number;
}

const genres = (s: string) => {
  try {
    return JSON.parse(s) as string[];
  } catch {
    return [];
  }
};

const mangaStub = (m: MangaRow): MangaStub => ({
  sourceId: m.source_id,
  url: m.url,
  title: m.title,
  thumbnailUrl: m.thumbnail_url,
  author: m.author,
  artist: m.artist,
  description: m.description,
  genres: genres(m.genres),
  status: m.status,
});

const chapterStub = (c: ChapterRow): ChapterStub => ({ url: c.url, name: c.name, chapterNumber: c.chapter_number, dateUpload: c.date_upload, sourceOrder: c.source_order, scanlator: c.scanlator });

export class SqliteSyncLocalStore implements SyncLocalStore {
  constructor(private db: SqlDriver) {}

  async pending(limit: number, deviceId: string): Promise<SyncRecord[]> {
    const rows = await this.db.all<MetaRow>('select kind, key, updated_at, device_id from sync_meta where dirty = 1 order by updated_at limit ?', [limit]);
    const out: SyncRecord[] = [];
    for (const row of rows) {
      const version = { kind: row.kind, key: row.key, updatedAt: row.updated_at, deviceId: row.device_id || deviceId };
      const body = await this.build(row);
      if (body) out.push({ ...version, ...body });
      // Nothing left to describe it (a series removed since): there is nothing to send.
      else await this.db.run('update sync_meta set dirty = 0 where kind = ? and key = ? and updated_at = ?', [row.kind, row.key, row.updated_at]);
    }
    return out;
  }

  private async build(row: MetaRow): Promise<{ deleted: boolean; data: unknown } | null> {
    switch (row.kind) {
      case 'category': {
        const [c] = await this.db.all<{ name: string; sort: number }>('select name, sort from category where uid = ?', [row.key]);
        return c ? { deleted: false, data: { name: c.name, order: c.sort } satisfies CategoryData } : { deleted: true, data: null };
      }
      case 'library': {
        const [sourceId, url] = JSON.parse(row.key) as [string, string];
        const m = await this.manga(this.db, sourceId, url);
        if (!m) return null;
        const cats = await this.db.all<{ uid: string }>('select c.uid from manga_category mc join category c on c.id = mc.category_id where mc.manga_id = ? order by c.sort', [m.id]);
        const data: LibraryData = { ...mangaStub(m), favorite: !!m.favorite, dateAdded: m.date_added, viewer: m.viewer, categories: cats.map((c) => c.uid) };
        return { deleted: false, data };
      }
      case 'progress':
      case 'history': {
        const [sourceId, mangaUrl, chapterUrl] = JSON.parse(row.key) as [string, string, string];
        const m = await this.manga(this.db, sourceId, mangaUrl);
        const [c] = m ? await this.db.all<ChapterRow>('select * from chapter where manga_id = ? and url = ?', [m.id, chapterUrl]) : [];
        if (row.kind === 'progress') {
          if (!m || !c) return null;
          const data: ProgressData = { manga: mangaStub(m), chapter: chapterStub(c), read: !!c.read, bookmark: !!c.bookmark, lastPageRead: c.last_page_read, pageOffset: c.page_offset ?? 0 };
          return { deleted: false, data };
        }
        const [h] = c ? await this.db.all<{ last_read: number; time_read: number }>('select last_read, time_read from history where chapter_id = ?', [c.id]) : [];
        if (!h || !m || !c) return { deleted: true, data: null };
        const data: HistoryData = { manga: mangaStub(m), chapter: chapterStub(c), lastRead: h.last_read, timeRead: h.time_read };
        return { deleted: false, data };
      }
    }
  }

  async versions(refs: SyncRef[]): Promise<Map<string, SyncVersion>> {
    const out = new Map<string, SyncVersion>();
    for (const r of refs) {
      const [row] = await this.db.all<MetaRow>('select updated_at, device_id from sync_meta where kind = ? and key = ?', [r.kind, r.key]);
      if (row) out.set(refId(r), { updatedAt: row.updated_at, deviceId: row.device_id });
    }
    return out;
  }

  async acknowledge(records: SyncRecord[]): Promise<void> {
    if (!records.length) return;
    await this.db.transaction(async (tx) => {
      for (const r of records) await tx.run('update sync_meta set dirty = 0, device_id = ? where kind = ? and key = ? and updated_at = ? and dirty = 1', [r.deviceId, r.kind, r.key, r.updatedAt]);
    });
  }

  async write(records: SyncRecord[]): Promise<void> {
    if (!records.length) return;
    await this.db.transaction(async (tx) => {
      await tx.run('update sync_applying set on_ = 1');
      for (const r of records) {
        await this.apply(tx, r);
        await tx.run(
          `insert into sync_meta (kind, key, updated_at, device_id, dirty) values (?, ?, ?, ?, 0)
           on conflict (kind, key) do update set updated_at = excluded.updated_at, device_id = excluded.device_id, dirty = 0`,
          [r.kind, r.key, r.updatedAt, r.deviceId],
        );
      }
      await tx.run('update sync_applying set on_ = 0');
    });
  }

  private async apply(tx: SqlExecutor, r: SyncRecord): Promise<void> {
    switch (r.kind) {
      case 'category': {
        if (r.deleted) {
          await tx.run('delete from manga_category where category_id in (select id from category where uid = ?)', [r.key]);
          await tx.run('delete from category where uid = ?', [r.key]);
          return;
        }
        const d = r.data as CategoryData;
        const [found] = await tx.all<{ id: number }>('select id from category where uid = ?', [r.key]);
        if (found) await tx.run('update category set name = ?, sort = ? where id = ?', [d.name, d.order, found.id]);
        else await tx.run('insert into category (name, sort, uid) values (?, ?, ?)', [d.name, d.order, r.key]);
        return;
      }
      case 'library': {
        const d = r.data as LibraryData;
        const id = await this.ensureManga(tx, d);
        await tx.run('update manga set favorite = ?, date_added = ?, viewer = ? where id = ?', [!r.deleted && d.favorite ? 1 : 0, d.dateAdded, d.viewer, id]);
        await tx.run('delete from manga_category where manga_id = ?', [id]);
        for (const uid of d.categories ?? []) await tx.run('insert into manga_category (manga_id, category_id) select ?, id from category where uid = ?', [id, uid]);
        return;
      }
      case 'progress': {
        const d = r.data as ProgressData;
        const chapterId = await this.ensureChapter(tx, await this.ensureManga(tx, d.manga), d.chapter);
        await tx.run('update chapter set read = ?, bookmark = ?, last_page_read = ?, page_offset = ? where id = ?', [d.read ? 1 : 0, d.bookmark ? 1 : 0, d.lastPageRead, d.pageOffset, chapterId]);
        return;
      }
      case 'history': {
        if (r.deleted) {
          const [sourceId, mangaUrl, chapterUrl] = JSON.parse(r.key) as [string, string, string];
          await tx.run('delete from history where chapter_id in (select c.id from chapter c join manga m on m.id = c.manga_id where m.source_id = ? and m.url = ? and c.url = ?)', [sourceId, mangaUrl, chapterUrl]);
          return;
        }
        const d = r.data as HistoryData;
        const chapterId = await this.ensureChapter(tx, await this.ensureManga(tx, d.manga), d.chapter);
        await tx.run('insert or replace into history (chapter_id, last_read, time_read) values (?, ?, ?)', [chapterId, d.lastRead, d.timeRead]);
        return;
      }
    }
  }

  private async manga(db: SqlExecutor, sourceId: string, url: string): Promise<MangaRow | null> {
    const [m] = await db.all<MangaRow>('select * from manga where source_id = ? and url = ?', [sourceId, url]);
    return m ?? null;
  }

  /** The local series for a stub; a series never seen here is created, to be completed by its source. */
  private async ensureManga(tx: SqlExecutor, s: MangaStub): Promise<number> {
    const found = await this.manga(tx, s.sourceId, s.url);
    if (found) return found.id;
    await tx.run(
      `insert into manga (source_id, url, title, artist, author, description, genres, status, thumbnail_url, favorite, initialized, date_added, last_update)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)`,
      [s.sourceId, s.url, s.title, s.artist, s.author, s.description, JSON.stringify(s.genres ?? []), s.status ?? 0, s.thumbnailUrl],
    );
    return (await this.manga(tx, s.sourceId, s.url))!.id;
  }

  /** The local chapter for a stub; a chapter list refresh later matches it by URL and keeps its state. */
  private async ensureChapter(tx: SqlExecutor, mangaId: number, c: ChapterStub): Promise<number> {
    const find = () => tx.all<{ id: number }>('select id from chapter where manga_id = ? and url = ?', [mangaId, c.url]);
    const [found] = await find();
    if (found) return found.id;
    await tx.run(
      `insert into chapter (manga_id, url, name, scanlator, chapter_number, date_upload, date_fetch, source_order, read, bookmark, last_page_read)
       values (?, ?, ?, ?, ?, ?, 0, ?, 0, 0, 0)`,
      [mangaId, c.url, c.name, c.scanlator, c.chapterNumber, c.dateUpload, c.sourceOrder],
    );
    return (await find())[0].id;
  }
}

/** Device id, feed position and last sync time, in the setting table. */
export class SqliteSyncStateRepository implements SyncStateRepository {
  constructor(private db: SqlDriver) {}
  async get(): Promise<SyncState> {
    const [r] = await this.db.all<{ value: string }>("select value from setting where key = 'sync'");
    const s = r ? (JSON.parse(r.value) as Partial<SyncState>) : {};
    return { deviceId: s.deviceId ?? null, cursor: s.cursor ?? 0, lastSyncAt: s.lastSyncAt ?? null };
  }
  save(s: SyncState) {
    return this.db.run("insert or replace into setting (key, value) values ('sync', ?)", [JSON.stringify(s)]);
  }
}

import type {
  CategoryRepository,
  ChapterRepository,
  DownloadRepository,
  ExtensionRepository,
  HistoryRepository,
  MangaRepository,
  RepoRepository,
  SettingsRepository,
} from '@/core/application/ports';
import { type Category, type Chapter, DEFAULT_SETTINGS, type Download, type ExtensionRepo, type HistoryEntry, type InstalledExtension, type Manga, type Settings } from '@/core/domain/model';

import type { SqlDriver, SqlParam } from './driver';

const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
const parse = <T>(s: string | null, def: T): T => {
  if (s === null || s === undefined) return def;
  try {
    return JSON.parse(s) as T;
  } catch {
    return def;
  }
};
const qs = (n: number) => new Array(n).fill('?').join(', ');

export class SqliteRepoRepository implements RepoRepository {
  constructor(private db: SqlDriver) {}
  async list(): Promise<ExtensionRepo[]> {
    const rows = await this.db.all<{ url: string; name: string; added_at: number }>('select * from repo order by added_at');
    return rows.map((r) => ({ url: r.url, name: r.name, addedAt: r.added_at }));
  }
  add(r: ExtensionRepo) {
    return this.db.run('insert or replace into repo (url, name, added_at) values (?, ?, ?)', [r.url, r.name, r.addedAt]);
  }
  remove(url: string) {
    return this.db.run('delete from repo where url = ?', [url]);
  }
}

export class SqliteExtensionRepository implements ExtensionRepository {
  constructor(private db: SqlDriver) {}
  async list(): Promise<InstalledExtension[]> {
    const rows = await this.db.all<{ json: string }>('select json from extension');
    return rows.map((r) => JSON.parse(r.json));
  }
  async get(pkg: string): Promise<InstalledExtension | null> {
    const [r] = await this.db.all<{ json: string }>('select json from extension where pkg = ?', [pkg]);
    return r ? JSON.parse(r.json) : null;
  }
  save(e: InstalledExtension) {
    return this.db.run('insert or replace into extension (pkg, json, installed_at) values (?, ?, ?)', [e.pkg, JSON.stringify(e), e.installedAt]);
  }
  remove(pkg: string) {
    return this.db.run('delete from extension where pkg = ?', [pkg]);
  }
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
  last_update: number;
  memo: string | null;
  viewer: string | null;
}

const toManga = (r: MangaRow): Manga => ({
  id: r.id,
  sourceId: r.source_id,
  url: r.url,
  title: r.title,
  artist: r.artist,
  author: r.author,
  description: r.description,
  genres: parse<string[]>(r.genres, []),
  status: r.status,
  thumbnailUrl: r.thumbnail_url,
  favorite: !!r.favorite,
  initialized: !!r.initialized,
  dateAdded: r.date_added,
  lastUpdate: r.last_update,
  memo: parse(r.memo, null),
  viewer: (r.viewer as Manga['viewer']) ?? null,
});

const mangaParams = (m: Omit<Manga, 'id'>): SqlParam[] => [
  m.sourceId,
  m.url,
  m.title,
  m.artist,
  m.author,
  m.description,
  JSON.stringify(m.genres),
  m.status,
  m.thumbnailUrl,
  m.favorite ? 1 : 0,
  m.initialized ? 1 : 0,
  m.dateAdded,
  m.lastUpdate,
  json(m.memo),
  m.viewer,
];

export class SqliteMangaRepository implements MangaRepository {
  constructor(private db: SqlDriver) {}
  async get(id: number) {
    const [r] = await this.db.all<MangaRow>('select * from manga where id = ?', [id]);
    return r ? toManga(r) : null;
  }
  async findBySource(sourceId: string, url: string) {
    const [r] = await this.db.all<MangaRow>('select * from manga where source_id = ? and url = ?', [sourceId, url]);
    return r ? toManga(r) : null;
  }
  async insert(m: Omit<Manga, 'id'>): Promise<Manga> {
    await this.db.run(
      `insert into manga (source_id, url, title, artist, author, description, genres, status, thumbnail_url, favorite, initialized, date_added, last_update, memo, viewer)
       values (${qs(15)})`,
      mangaParams(m),
    );
    const found = await this.findBySource(m.sourceId, m.url);
    return found!;
  }
  update(m: Manga) {
    return this.db.run(
      `update manga set source_id = ?, url = ?, title = ?, artist = ?, author = ?, description = ?, genres = ?, status = ?, thumbnail_url = ?,
       favorite = ?, initialized = ?, date_added = ?, last_update = ?, memo = ?, viewer = ? where id = ?`,
      [...mangaParams(m), m.id],
    );
  }
  async favorites() {
    const rows = await this.db.all<MangaRow>('select * from manga where favorite = 1 order by title');
    return rows.map(toManga);
  }
  deleteOrphans() {
    return this.db.run(
      `delete from manga where favorite = 0 and id not in (select c.manga_id from chapter c join history h on h.chapter_id = c.id)
       and id not in (select manga_id from download)`,
    );
  }
}

interface ChapterRow {
  id: number;
  manga_id: number;
  url: string;
  name: string;
  scanlator: string | null;
  chapter_number: number;
  date_upload: number;
  date_fetch: number;
  source_order: number;
  read: number;
  bookmark: number;
  last_page_read: number;
  page_offset: number;
  memo: string | null;
}

const toChapter = (r: ChapterRow): Chapter => ({
  id: r.id,
  mangaId: r.manga_id,
  url: r.url,
  name: r.name,
  scanlator: r.scanlator,
  chapterNumber: r.chapter_number,
  dateUpload: r.date_upload,
  dateFetch: r.date_fetch,
  sourceOrder: r.source_order,
  read: !!r.read,
  bookmark: !!r.bookmark,
  lastPageRead: r.last_page_read,
  pageOffset: r.page_offset ?? 0,
  memo: parse(r.memo, null),
});

export class SqliteChapterRepository implements ChapterRepository {
  constructor(private db: SqlDriver) {}
  async byManga(mangaId: number) {
    const rows = await this.db.all<ChapterRow>('select * from chapter where manga_id = ? order by source_order', [mangaId]);
    return rows.map(toChapter);
  }
  async get(id: number) {
    const [r] = await this.db.all<ChapterRow>('select * from chapter where id = ?', [id]);
    return r ? toChapter(r) : null;
  }
  insertMany(cs: Omit<Chapter, 'id'>[]) {
    return this.db.transaction(async (tx) => {
      for (const c of cs) {
        await tx.run(
          `insert into chapter (manga_id, url, name, scanlator, chapter_number, date_upload, date_fetch, source_order, read, bookmark, last_page_read, memo)
           values (${qs(12)})`,
          [c.mangaId, c.url, c.name, c.scanlator, c.chapterNumber, c.dateUpload, c.dateFetch, c.sourceOrder, c.read ? 1 : 0, c.bookmark ? 1 : 0, c.lastPageRead, json(c.memo)],
        );
      }
    });
  }
  updateMany(cs: Chapter[]) {
    return this.db.transaction(async (tx) => {
      for (const c of cs) {
        await tx.run(
          `update chapter set url = ?, name = ?, scanlator = ?, chapter_number = ?, date_upload = ?, date_fetch = ?, source_order = ?, read = ?, bookmark = ?, last_page_read = ?, memo = ? where id = ?`,
          [c.url, c.name, c.scanlator, c.chapterNumber, c.dateUpload, c.dateFetch, c.sourceOrder, c.read ? 1 : 0, c.bookmark ? 1 : 0, c.lastPageRead, json(c.memo), c.id],
        );
      }
    });
  }
  async deleteMany(ids: number[]) {
    if (!ids.length) return;
    await this.db.run(`delete from chapter where id in (${qs(ids.length)})`, ids);
  }
  async setRead(ids: number[], read: boolean) {
    if (!ids.length) return;
    await this.db.run(`update chapter set read = ?${read ? '' : ', last_page_read = 0, page_offset = 0'} where id in (${qs(ids.length)})`, [read ? 1 : 0, ...ids]);
  }
  async setBookmark(ids: number[], b: boolean) {
    if (!ids.length) return;
    await this.db.run(`update chapter set bookmark = ? where id in (${qs(ids.length)})`, [b ? 1 : 0, ...ids]);
  }
  setProgress(id: number, page: number, offset = 0) {
    return this.db.run('update chapter set last_page_read = ?, page_offset = ? where id = ?', [page, offset, id]);
  }
  async unreadCounts() {
    const rows = await this.db.all<{ manga_id: number; n: number }>('select manga_id, count(*) as n from chapter where read = 0 group by manga_id');
    return new Map(rows.map((r) => [r.manga_id, r.n]));
  }
}

export class SqliteCategoryRepository implements CategoryRepository {
  constructor(private db: SqlDriver) {}
  async list(): Promise<Category[]> {
    const rows = await this.db.all<{ id: number; name: string; sort: number }>('select * from category order by sort, id');
    return rows.map((r) => ({ id: r.id, name: r.name, order: r.sort }));
  }
  async create(name: string): Promise<Category> {
    const [{ m }] = await this.db.all<{ m: number | null }>('select max(sort) as m from category');
    const order = (m ?? -1) + 1;
    await this.db.run('insert into category (name, sort) values (?, ?)', [name, order]);
    const [r] = await this.db.all<{ id: number }>('select id from category where sort = ? order by id desc limit 1', [order]);
    return { id: r.id, name, order };
  }
  rename(id: number, name: string) {
    return this.db.run('update category set name = ? where id = ?', [name, id]);
  }
  remove(id: number) {
    return this.db.transaction(async (tx) => {
      await tx.run('delete from manga_category where category_id = ?', [id]);
      await tx.run('delete from category where id = ?', [id]);
    });
  }
  reorder(ids: number[]) {
    return this.db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) await tx.run('update category set sort = ? where id = ?', [i, id]);
    });
  }
  async ofManga(mangaId: number) {
    const rows = await this.db.all<{ category_id: number }>('select category_id from manga_category where manga_id = ?', [mangaId]);
    return rows.map((r) => r.category_id);
  }
  setForManga(mangaId: number, ids: number[]) {
    return this.db.transaction(async (tx) => {
      await tx.run('delete from manga_category where manga_id = ?', [mangaId]);
      for (const id of ids) await tx.run('insert into manga_category (manga_id, category_id) values (?, ?)', [mangaId, id]);
    });
  }
  async assignments() {
    const rows = await this.db.all<{ manga_id: number; category_id: number }>('select * from manga_category');
    const m = new Map<number, number[]>();
    for (const r of rows) m.set(r.manga_id, [...(m.get(r.manga_id) ?? []), r.category_id]);
    return m;
  }
}

export class SqliteHistoryRepository implements HistoryRepository {
  constructor(private db: SqlDriver) {}
  upsert(e: HistoryEntry) {
    return this.db.run('insert or replace into history (chapter_id, last_read, time_read) values (?, ?, ?)', [e.chapterId, e.lastRead, e.timeRead]);
  }
  async recent(limit: number) {
    const rows = await this.db.all<{ chapter_id: number; last_read: number; time_read: number }>('select * from history order by last_read desc limit ?', [limit]);
    return rows.map((r) => ({ chapterId: r.chapter_id, lastRead: r.last_read, timeRead: r.time_read }));
  }
  remove(chapterId: number) {
    return this.db.run('delete from history where chapter_id = ?', [chapterId]);
  }
  clear() {
    return this.db.run('delete from history');
  }
}

export class SqliteDownloadRepository implements DownloadRepository {
  constructor(private db: SqlDriver) {}
  async list(): Promise<Download[]> {
    const rows = await this.db.all<{ chapter_id: number; manga_id: number; state: string; progress: number; total: number; error: string | null; queued_at: number }>(
      'select * from download order by queued_at',
    );
    return rows.map((r) => ({ chapterId: r.chapter_id, mangaId: r.manga_id, state: r.state as Download['state'], progress: r.progress, total: r.total, error: r.error, queuedAt: r.queued_at }));
  }
  upsert(d: Download) {
    return this.db.run('insert or replace into download (chapter_id, manga_id, state, progress, total, error, queued_at) values (?, ?, ?, ?, ?, ?, ?)', [
      d.chapterId,
      d.mangaId,
      d.state,
      d.progress,
      d.total,
      d.error,
      d.queuedAt,
    ]);
  }
  remove(chapterId: number) {
    return this.db.run('delete from download where chapter_id = ?', [chapterId]);
  }
}

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private db: SqlDriver) {}
  async get(): Promise<Settings> {
    const [r] = await this.db.all<{ value: string }>("select value from setting where key = 'settings'");
    return { ...DEFAULT_SETTINGS, ...parse<Partial<Settings>>(r?.value ?? null, {}) };
  }
  save(s: Settings) {
    return this.db.run("insert or replace into setting (key, value) values ('settings', ?)", [JSON.stringify(s)]);
  }
}

export function sqliteRepositories(db: SqlDriver) {
  return {
    repos: new SqliteRepoRepository(db),
    extensions: new SqliteExtensionRepository(db),
    mangas: new SqliteMangaRepository(db),
    chapters: new SqliteChapterRepository(db),
    categories: new SqliteCategoryRepository(db),
    history: new SqliteHistoryRepository(db),
    downloads: new SqliteDownloadRepository(db),
    settings: new SqliteSettingsRepository(db),
  };
}

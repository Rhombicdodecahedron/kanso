import type { SqlDriver } from './driver';

// ---------- sync bookkeeping (version 3) ----------
//
// Every syncable record has a row in sync_meta: its version (updated_at, device_id) and whether it
// changed here since the last sync (dirty). Triggers keep it current, so no write path can forget
// to; while sync itself writes (sync_applying.on_ = 1) they stay quiet, so nothing echoes back.

const NOW = `CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`;
const QUIET = `(select on_ from sync_applying) = 0`;
const UPSERT = `on conflict (kind, key) do update set updated_at = max(excluded.updated_at, sync_meta.updated_at + 1), device_id = '', dirty = 1`;
/** Marks a record changed here, from a SELECT producing its key (needs a WHERE clause). */
const touch = (kind: string, keyExpr: string, from: string) => `insert into sync_meta (kind, key, updated_at, device_id, dirty) select '${kind}', ${keyExpr}, ${NOW}, '', 1 ${from} ${UPSERT};`;
const LIBRARY_KEY = 'json_array(m.source_id, m.url)';
const CHAPTER_KEY = 'json_array(m.source_id, m.url, c.url)';

const SYNC_MIGRATION = [
  `create table sync_meta (
    kind text not null,
    key text not null,
    updated_at integer not null,
    device_id text not null default '',
    dirty integer not null default 1,
    primary key (kind, key))`,
  `create index sync_meta_dirty on sync_meta (dirty, updated_at)`,
  `create table sync_applying (on_ integer not null)`,
  `insert into sync_applying (on_) values (0)`,
  `alter table category add column uid text`,
  `update category set uid = lower(hex(randomblob(16)))`,
  `create unique index category_uid on category (uid)`,

  `create trigger sync_library_manga after update of favorite, viewer on manga
    when ${QUIET} and (old.favorite is not new.favorite or old.viewer is not new.viewer)
    begin ${touch('library', LIBRARY_KEY, 'from manga m where m.id = new.id')} end`,
  `create trigger sync_library_category_add after insert on manga_category when ${QUIET}
    begin ${touch('library', LIBRARY_KEY, 'from manga m where m.id = new.manga_id')} end`,
  `create trigger sync_library_category_remove after delete on manga_category when ${QUIET}
    begin ${touch('library', LIBRARY_KEY, 'from manga m where m.id = old.manga_id')} end`,

  `create trigger sync_progress_update after update of read, bookmark, last_page_read, page_offset on chapter
    when ${QUIET} and (old.read is not new.read or old.bookmark is not new.bookmark or old.last_page_read is not new.last_page_read or old.page_offset is not new.page_offset)
    begin ${touch('progress', CHAPTER_KEY, 'from chapter c join manga m on m.id = c.manga_id where c.id = new.id')} end`,
  `create trigger sync_progress_insert after insert on chapter
    when ${QUIET} and (new.read or new.bookmark or new.last_page_read > 0)
    begin ${touch('progress', CHAPTER_KEY, 'from chapter c join manga m on m.id = c.manga_id where c.id = new.id')} end`,

  `create trigger sync_history_insert after insert on history when ${QUIET}
    begin ${touch('history', CHAPTER_KEY, 'from chapter c join manga m on m.id = c.manga_id where c.id = new.chapter_id')} end`,
  `create trigger sync_history_update after update on history when ${QUIET}
    begin ${touch('history', CHAPTER_KEY, 'from chapter c join manga m on m.id = c.manga_id where c.id = new.chapter_id')} end`,
  `create trigger sync_history_delete after delete on history when ${QUIET}
    begin ${touch('history', CHAPTER_KEY, 'from chapter c join manga m on m.id = c.manga_id where c.id = old.chapter_id')} end`,

  `create trigger sync_category_insert after insert on category when ${QUIET}
    begin
      update category set uid = lower(hex(randomblob(16))) where id = new.id and uid is null;
      ${touch('category', 'c.uid', 'from category c where c.id = new.id')}
    end`,
  `create trigger sync_category_update after update of name, sort on category
    when ${QUIET} and (old.name is not new.name or old.sort is not new.sort)
    begin ${touch('category', 'new.uid', 'where true')} end`,
  `create trigger sync_category_delete after delete on category when ${QUIET}
    begin ${touch('category', 'old.uid', 'where true')} end`,

  // What this device already has goes up with its first sync.
  `insert or ignore into sync_meta (kind, key, updated_at) select 'category', uid, 1 from category where true`,
  `insert or ignore into sync_meta (kind, key, updated_at) select 'library', json_array(source_id, url), max(date_added, 1) from manga where favorite = 1`,
  `insert or ignore into sync_meta (kind, key, updated_at)
    select 'progress', ${CHAPTER_KEY}, coalesce((select h.last_read from history h where h.chapter_id = c.id), 1)
    from chapter c join manga m on m.id = c.manga_id where c.read = 1 or c.bookmark = 1 or c.last_page_read > 0`,
  `insert or ignore into sync_meta (kind, key, updated_at)
    select 'history', ${CHAPTER_KEY}, max(h.last_read, 1) from history h join chapter c on c.id = h.chapter_id join manga m on m.id = c.manga_id where true`,
];

/** One entry per schema version; never edit an entry that has shipped, append a new one. */
const MIGRATIONS: string[][] = [
  [
    `create table repo (url text primary key, name text not null, added_at integer not null)`,
    `create table extension (pkg text primary key, json text not null, installed_at integer not null)`,
    `create table manga (
      id integer primary key autoincrement,
      source_id text not null,
      url text not null,
      title text not null,
      artist text, author text, description text,
      genres text not null default '[]',
      status integer not null default 0,
      thumbnail_url text,
      favorite integer not null default 0,
      initialized integer not null default 0,
      date_added integer not null default 0,
      last_update integer not null default 0,
      memo text,
      viewer text,
      unique (source_id, url))`,
    `create table chapter (
      id integer primary key autoincrement,
      manga_id integer not null references manga (id) on delete cascade,
      url text not null,
      name text not null,
      scanlator text,
      chapter_number real not null default -1,
      date_upload integer not null default 0,
      date_fetch integer not null default 0,
      source_order integer not null default 0,
      read integer not null default 0,
      bookmark integer not null default 0,
      last_page_read integer not null default 0,
      memo text,
      unique (manga_id, url))`,
    `create table category (id integer primary key autoincrement, name text not null, sort integer not null)`,
    `create table manga_category (manga_id integer not null, category_id integer not null, primary key (manga_id, category_id))`,
    `create table history (chapter_id integer primary key, last_read integer not null, time_read integer not null)`,
    `create table download (chapter_id integer primary key, manga_id integer not null, state text not null, progress integer not null, total integer not null, error text, queued_at integer not null)`,
    `create table setting (key text primary key, value text not null)`,
    `create index manga_favorite on manga (favorite)`,
    `create index chapter_manga on chapter (manga_id)`,
    `create index history_last_read on history (last_read)`,
  ],
  [`alter table chapter add column page_offset real not null default 0`],
  SYNC_MIGRATION,
];

/** Brings the database up to `target` (default: the latest version). */
export async function migrate(db: SqlDriver, target = MIGRATIONS.length): Promise<void> {
  const [{ user_version: current }] = await db.all<{ user_version: number }>('PRAGMA user_version');
  for (let version = current; version < target; version++) {
    await db.transaction(async (tx) => {
      for (const statement of MIGRATIONS[version]) await tx.run(statement);
      await tx.run(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

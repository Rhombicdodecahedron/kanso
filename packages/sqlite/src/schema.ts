import type { SqlDriver } from './driver';

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

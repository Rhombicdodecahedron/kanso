import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface KansoIdb extends DBSchema {
  bundles: { key: string; value: string };
  pages: { key: [number, number]; value: { chapterId: number; index: number; blob: Blob }; indexes: { chapter: number } };
  kv: { key: string; value: unknown };
}

let db: Promise<IDBPDatabase<KansoIdb>> | null = null;

/** Blobs and bundle code live in IndexedDB (the SQL database keeps only records). */
export function idb(name = 'kanso'): Promise<IDBPDatabase<KansoIdb>> {
  return (db ??= openDB<KansoIdb>(name, 1, {
    upgrade(d) {
      d.createObjectStore('bundles');
      d.createObjectStore('pages', { keyPath: ['chapterId', 'index'] }).createIndex('chapter', 'chapterId');
      d.createObjectStore('kv');
    },
  }));
}

/** Tests open a fresh database each time. */
export function resetIdbForTests() {
  db = null;
}

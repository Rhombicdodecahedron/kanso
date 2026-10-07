// SQLite (WebAssembly) in memory, saved as a whole-file snapshot. The database only holds records
// (page images live elsewhere), so a snapshot is small and cheap: it is written right after each
// burst of changes. (Browsers abort storage writes started while a page unloads, so waiting for
// the page to be left would lose the last change.)

import { createSerialDriver, type SqlDriver, type SqlParam } from '@kanso/sqlite';

/** The parts of the sqlite-wasm module this driver uses. */
export interface Sqlite3 {
  oo1: { DB: new (name: string) => WasmDb };
  capi: {
    sqlite3_js_db_export(db: unknown): Uint8Array;
    sqlite3_deserialize(db: unknown, schema: string, data: unknown, dbSize: number, bufSize: number, flags: number): number;
    SQLITE_DESERIALIZE_FREEONCLOSE: number;
    SQLITE_DESERIALIZE_RESIZEABLE: number;
  };
  wasm: { allocFromTypedArray(a: Uint8Array): unknown };
}

interface WasmDb {
  pointer: unknown;
  exec(o: { sql: string; bind?: SqlParam[]; rowMode?: 'object'; returnValue?: 'resultRows' }): unknown;
}

export interface SnapshotStore {
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
}

export interface SnapshotDriver {
  db: SqlDriver;
  /** Writes the snapshot now if anything changed. */
  flush(): Promise<void>;
}

export async function openSnapshotDriver(sqlite3: Sqlite3, store: SnapshotStore, opts: { delayMs?: number } = {}): Promise<SnapshotDriver> {
  const wasm = new sqlite3.oo1.DB(':memory:');
  const saved = await store.load();
  if (saved?.length) {
    const { capi } = sqlite3;
    const rc = capi.sqlite3_deserialize(wasm.pointer, 'main', sqlite3.wasm.allocFromTypedArray(saved), saved.length, saved.length, capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE);
    if (rc) throw new Error(`Could not read the saved library (SQLite error ${rc})`);
  }

  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> = Promise.resolve();
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!dirty) return saving;
    dirty = false;
    const bytes = sqlite3.capi.sqlite3_js_db_export(wasm.pointer);
    saving = saving.then(() => store.save(bytes));
    return saving;
  };
  const changed = () => {
    dirty = true;
    if (!timer) timer = setTimeout(() => void flush(), opts.delayMs ?? 100);
  };

  const bind = (params?: SqlParam[]) => (params?.length ? params : undefined);
  const db = createSerialDriver({
    async run(sql, params) {
      wasm.exec({ sql, bind: bind(params) });
      changed();
    },
    async all<T>(sql: string, params?: SqlParam[]) {
      return wasm.exec({ sql, bind: bind(params), rowMode: 'object', returnValue: 'resultRows' }) as T[];
    },
  });
  return { db, flush };
}

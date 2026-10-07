// The database engine, in a dedicated worker: SQLite (WebAssembly) on the origin-private file
// system through the "SAH pool" VFS, which needs no cross-origin isolation headers. Without OPFS
// (private windows, old browsers) it falls back to memory and says so.
//
// Served as-is from /sqlite/ next to the sqlite-wasm build (see scripts/copy-sqlite-wasm.mjs):
// bundlers cannot follow the workers sqlite-wasm creates.

import sqlite3InitModule from './index.mjs';

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'kanso' });
    return { db: new pool.OpfsSAHPoolDb('/kanso.db'), persistent: true };
  } catch (e) {
    console.warn('[sqlite] OPFS unavailable, using memory', e);
    return { db: new sqlite3.oo1.DB(':memory:'), persistent: false };
  }
})();

ready.then(
  ({ persistent }) => postMessage({ id: 0, ok: true, persistent }),
  (e) => postMessage({ id: 0, ok: false, error: String(e?.message ?? e) }),
);

onmessage = async (ev) => {
  const { id, op, sql, params } = ev.data;
  try {
    const { db } = await ready;
    const bind = params?.length ? params : undefined;
    if (op === 'run') {
      db.exec({ sql, bind });
      postMessage({ id, ok: true });
    } else {
      postMessage({ id, ok: true, rows: db.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' }) });
    }
  } catch (e) {
    postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};

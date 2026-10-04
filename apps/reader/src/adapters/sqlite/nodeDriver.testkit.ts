import { DatabaseSync } from 'node:sqlite';

import { createSerialDriver, type SqlDriver } from './driver';

/** An in-memory database on Node's built-in SQLite, so the real SQL runs in Jest. */
export function openNodeDriver(): SqlDriver {
  const db = new DatabaseSync(':memory:');
  return createSerialDriver({
    async run(sql, params = []) {
      db.prepare(sql).run(...params);
    },
    async all<T>(sql: string, params: (string | number | null)[] = []) {
      // Rows come back with a null prototype; copy them into plain objects.
      return db.prepare(sql).all(...params).map((row) => ({ ...row })) as T[];
    },
  });
}

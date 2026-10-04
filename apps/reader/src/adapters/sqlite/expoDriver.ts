import * as SQLite from 'expo-sqlite';

import { createSerialDriver, type SqlDriver, type SqlParam } from './driver';

export async function openExpoDriver(name = 'kanso.db'): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA journal_mode = WAL');
  return createSerialDriver({
    async run(sql, params = []) {
      await db.runAsync(sql, params);
    },
    all<T>(sql: string, params: SqlParam[] = []) {
      return db.getAllAsync<T>(sql, params);
    },
  });
}

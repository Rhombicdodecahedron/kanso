export type SqlParam = string | number | null;

export interface SqlExecutor {
  run(sql: string, params?: SqlParam[]): Promise<void>;
  all<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
}

/** The only thing the repositories know about the database engine. */
export interface SqlDriver extends SqlExecutor {
  /** Runs fn atomically. Statements inside must go through the tx handle. */
  transaction(fn: (tx: SqlExecutor) => Promise<void>): Promise<void>;
}

/**
 * Wraps a raw connection so that statements and transactions run strictly one after another.
 * A single connection is shared by the whole app, so without this a read issued while a
 * transaction is open would see its half-written state.
 */
export function createSerialDriver(raw: SqlExecutor): SqlDriver {
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  }
  return {
    run: (sql, params) => enqueue(() => raw.run(sql, params)),
    all: <T>(sql: string, params?: SqlParam[]) => enqueue(() => raw.all<T>(sql, params)),
    transaction: (fn) =>
      enqueue(async () => {
        await raw.run('BEGIN');
        try {
          await fn(raw);
          await raw.run('COMMIT');
        } catch (e) {
          await raw.run('ROLLBACK');
          throw e;
        }
      }),
  };
}

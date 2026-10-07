import type { SyncRecord, SyncRef, SyncVersion } from './model';

// ---------- device side ----------

/** This device's records and what changed on it since the last sync. */
export interface SyncLocalStore {
  /** Records changed here and not yet acknowledged by the server, oldest first. */
  pending(limit: number, deviceId: string): Promise<SyncRecord[]>;
  /** The version this device holds of each record (absent: never seen). */
  versions(refs: SyncRef[]): Promise<Map<string, SyncVersion>>;
  /** Stores records that won against the local versions. Must not mark them as local changes. */
  write(records: SyncRecord[]): Promise<void>;
  /** The server has these; a record changed again since stays pending. */
  acknowledge(records: SyncRecord[]): Promise<void>;
}

export interface SyncState {
  deviceId: string | null;
  /** position in the server's change feed */
  cursor: number;
  lastSyncAt: number | null;
}

export interface SyncStateRepository {
  get(): Promise<SyncState>;
  save(s: SyncState): Promise<void>;
}

export interface ExchangeRequest {
  deviceId: string;
  cursor: number;
  changes: SyncRecord[];
}

export interface ExchangeResponse {
  cursor: number;
  /** more changes are waiting past `cursor` */
  more: boolean;
  /** other devices' changes since the cursor, and the server's version of any change that lost */
  changes: SyncRecord[];
}

/** The sync server, as seen from a device. */
export interface SyncRemote {
  exchange(req: ExchangeRequest): Promise<ExchangeResponse>;
}

// ---------- server side ----------

export interface SyncStoreTx {
  get(refs: SyncRef[]): Promise<SyncRecord[]>;
  /** Stores records, each getting the next position in the change feed. */
  put(records: SyncRecord[]): Promise<void>;
  /** Records stored after `cursor`, in feed order. `cursor` in the result is the last position read. */
  since(cursor: number, limit: number): Promise<{ records: SyncRecord[]; cursor: number; more: boolean }>;
}

/** Where the server keeps every device's records. Any database can back it. */
export interface SyncStore {
  transaction<T>(fn: (tx: SyncStoreTx) => Promise<T>): Promise<T>;
}

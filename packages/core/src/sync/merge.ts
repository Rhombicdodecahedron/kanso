import type { SyncVersion } from './model';

/**
 * Last writer wins, per record. Equal timestamps (two devices in the same millisecond) are settled
 * by device id, so every device picks the same winner.
 */
export function wins(a: SyncVersion, b: SyncVersion | null | undefined): boolean {
  if (!b) return true;
  return a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.deviceId > b.deviceId);
}

// What syncs between devices, keyed by natural keys (never by local row ids, which differ per device).

export type SyncKind = 'category' | 'library' | 'progress' | 'history';

/** Applied in this order: a library entry needs its categories, progress its series. */
export const SYNC_KIND_ORDER: SyncKind[] = ['category', 'library', 'progress', 'history'];

export interface SyncRef {
  kind: SyncKind;
  /** category: its uid. library: JSON [sourceId, mangaUrl]. progress/history: JSON [sourceId, mangaUrl, chapterUrl]. */
  key: string;
}

export interface SyncVersion {
  updatedAt: number;
  deviceId: string;
}

export interface SyncRecord extends SyncRef, SyncVersion {
  /** a tombstone: the record was removed */
  deleted: boolean;
  data: unknown;
}

/** Enough of a series to show it on a device that has never seen it. */
export interface MangaStub {
  sourceId: string;
  url: string;
  title: string;
  thumbnailUrl: string | null;
  author: string | null;
  artist: string | null;
  description: string | null;
  genres: string[];
  status: number;
}

export interface ChapterStub {
  url: string;
  name: string;
  chapterNumber: number;
  dateUpload: number;
  sourceOrder: number;
  scanlator: string | null;
}

export interface CategoryData {
  name: string;
  order: number;
}

export interface LibraryData extends MangaStub {
  favorite: boolean;
  dateAdded: number;
  viewer: string | null;
  /** category uids */
  categories: string[];
}

export interface ProgressData {
  manga: MangaStub;
  chapter: ChapterStub;
  read: boolean;
  bookmark: boolean;
  lastPageRead: number;
  pageOffset: number;
}

export interface HistoryData {
  manga: MangaStub;
  chapter: ChapterStub;
  lastRead: number;
  timeRead: number;
}

export const refId = (r: SyncRef) => `${r.kind}\u0000${r.key}`;

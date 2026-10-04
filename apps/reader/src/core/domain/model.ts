// Kanso's domain, modelled on Mihon's data model.

export type MangaId = number;
export type ChapterId = number;
export type CategoryId = number;
/** Mihon source id: decimal string of a 63-bit hash (too large for JS numbers). */
export type SourceId = string;

export const MangaStatus = {
  UNKNOWN: 0,
  ONGOING: 1,
  COMPLETED: 2,
  LICENSED: 3,
  PUBLISHING_FINISHED: 4,
  CANCELLED: 5,
  ON_HIATUS: 6,
} as const;

export interface ExtensionRepo {
  url: string;
  name: string;
  addedAt: number;
}

export interface SourceInfo {
  id: SourceId;
  name: string;
  lang: string;
  baseUrl: string;
  /** index of the source inside its extension bundle */
  index: number;
}

export interface AvailableExtension {
  pkg: string;
  name: string;
  file: string;
  lang: string;
  version: string;
  nsfw: boolean;
  sha256: string;
  size: number;
  theme: string | null;
  sources: SourceInfo[];
  repoUrl: string;
}

export interface InstalledExtension extends AvailableExtension {
  installedAt: number;
}

export interface Manga {
  id: MangaId;
  sourceId: SourceId;
  url: string;
  title: string;
  artist: string | null;
  author: string | null;
  description: string | null;
  genres: string[];
  status: number;
  thumbnailUrl: string | null;
  favorite: boolean;
  initialized: boolean;
  dateAdded: number;
  lastUpdate: number;
  /** Komikku-style memo some sources rely on (opaque JSON) */
  memo: unknown;
  /** reader mode override, null = default */
  viewer: ReaderMode | null;
}

export interface Chapter {
  id: ChapterId;
  mangaId: MangaId;
  url: string;
  name: string;
  scanlator: string | null;
  chapterNumber: number;
  dateUpload: number;
  dateFetch: number;
  sourceOrder: number;
  read: boolean;
  bookmark: boolean;
  lastPageRead: number;
  memo: unknown;
}

export interface Category {
  id: CategoryId;
  name: string;
  order: number;
}

export interface HistoryEntry {
  chapterId: ChapterId;
  lastRead: number;
  timeRead: number;
}

export type ReaderMode = 'ltr' | 'rtl' | 'vertical' | 'webtoon';

export type DownloadState = 'queued' | 'downloading' | 'done' | 'error';

export interface Download {
  chapterId: ChapterId;
  mangaId: MangaId;
  state: DownloadState;
  progress: number;
  total: number;
  error: string | null;
  queuedAt: number;
}

export interface Settings {
  readerMode: ReaderMode;
  showNsfw: boolean;
  libraryColumns: number;
  downloadConcurrency: number;
  languages: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  readerMode: 'rtl',
  showNsfw: false,
  libraryColumns: 3,
  downloadConcurrency: 2,
  languages: ['en'],
};

// ---------- values exchanged with sources ----------

/** What a source returns for a manga (Mihon's SManga). */
export interface RemoteManga {
  url: string;
  title: string;
  artist: string | null;
  author: string | null;
  description: string | null;
  genre: string | null;
  status: number;
  thumbnail_url: string | null;
  initialized: boolean;
  memo?: unknown;
}

/** Mihon's SChapter. */
export interface RemoteChapter {
  url: string;
  name: string;
  date_upload: number;
  chapter_number: number;
  scanlator: string | null;
  memo?: unknown;
}

export interface RemotePage {
  index: number;
  url: string;
  imageUrl: string | null;
}

export interface MangasPage {
  mangas: RemoteManga[];
  hasNextPage: boolean;
}

export interface ImageRequest {
  url: string;
  headers: Record<string, string>;
}

/** Filter state as exchanged with the source runtime (shape from source-api snapshotFilters). */
export interface FilterState {
  kind: string;
  name: string;
  state: unknown;
  values?: string[];
  children?: FilterState[];
}

export interface PreferenceItem {
  kind: string;
  key: string;
  title: string | null;
  summary: string | null;
  default: unknown;
  value?: unknown;
  visible: boolean;
  enabled: boolean;
  entries?: string[];
  entryValues?: string[];
}

export function splitGenres(genre: string | null): string[] {
  if (!genre) return [];
  return genre
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
}

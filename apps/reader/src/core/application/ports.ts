import type {
  AvailableExtension,
  Category,
  CategoryId,
  Chapter,
  ChapterId,
  Download,
  ExtensionRepo,
  FilterState,
  HistoryEntry,
  ImageRequest,
  InstalledExtension,
  Manga,
  MangaId,
  MangasPage,
  PreferenceItem,
  RemoteChapter,
  RemoteManga,
  RemotePage,
  Settings,
  SourceId,
  SourceInfo,
} from '../domain/model';

// ---------- persistence ----------

export interface RepoRepository {
  list(): Promise<ExtensionRepo[]>;
  add(r: ExtensionRepo): Promise<void>;
  remove(url: string): Promise<void>;
}

export interface ExtensionRepository {
  list(): Promise<InstalledExtension[]>;
  get(pkg: string): Promise<InstalledExtension | null>;
  save(e: InstalledExtension): Promise<void>;
  remove(pkg: string): Promise<void>;
}

export interface MangaRepository {
  get(id: MangaId): Promise<Manga | null>;
  findBySource(sourceId: SourceId, url: string): Promise<Manga | null>;
  insert(m: Omit<Manga, 'id'>): Promise<Manga>;
  update(m: Manga): Promise<void>;
  favorites(): Promise<Manga[]>;
  /** Non-favorite mangas not referenced by history, for cleanup. */
  deleteOrphans(): Promise<void>;
}

export interface ChapterRepository {
  byManga(mangaId: MangaId): Promise<Chapter[]>;
  get(id: ChapterId): Promise<Chapter | null>;
  insertMany(cs: Omit<Chapter, 'id'>[]): Promise<void>;
  updateMany(cs: Chapter[]): Promise<void>;
  deleteMany(ids: ChapterId[]): Promise<void>;
  setRead(ids: ChapterId[], read: boolean): Promise<void>;
  setBookmark(ids: ChapterId[], bookmark: boolean): Promise<void>;
  setProgress(id: ChapterId, page: number): Promise<void>;
  unreadCounts(): Promise<Map<MangaId, number>>;
}

export interface CategoryRepository {
  list(): Promise<Category[]>;
  create(name: string): Promise<Category>;
  rename(id: CategoryId, name: string): Promise<void>;
  remove(id: CategoryId): Promise<void>;
  reorder(ids: CategoryId[]): Promise<void>;
  ofManga(mangaId: MangaId): Promise<CategoryId[]>;
  setForManga(mangaId: MangaId, ids: CategoryId[]): Promise<void>;
  /** mangaId -> category ids for all favorites */
  assignments(): Promise<Map<MangaId, CategoryId[]>>;
}

export interface HistoryRepository {
  upsert(e: HistoryEntry): Promise<void>;
  recent(limit: number): Promise<HistoryEntry[]>;
  remove(chapterId: ChapterId): Promise<void>;
  clear(): Promise<void>;
}

export interface DownloadRepository {
  list(): Promise<Download[]>;
  upsert(d: Download): Promise<void>;
  remove(chapterId: ChapterId): Promise<void>;
}

export interface SettingsRepository {
  get(): Promise<Settings>;
  save(s: Settings): Promise<void>;
}

// ---------- outside world ----------

/** Talks to extension repositories (static JSON index + bundle files). */
export interface ExtensionFetcher {
  index(repoUrl: string): Promise<Omit<AvailableExtension, 'repoUrl'>[]>;
  bundle(repoUrl: string, file: string): Promise<string>;
  sha256(text: string): Promise<string>;
}

/** Stores installed bundle code on device. */
export interface BundleStore {
  write(pkg: string, code: string): Promise<void>;
  read(pkg: string): Promise<string | null>;
  remove(pkg: string): Promise<void>;
}

/** The translated-source runtime. */
export interface SourceGateway {
  load(ext: InstalledExtension, code: string): Promise<void>;
  unload(pkg: string): void;
  sources(): SourceInfo[];
  has(sourceId: SourceId): boolean;
  supportsLatest(sourceId: SourceId): boolean;
  popular(sourceId: SourceId, page: number): Promise<MangasPage>;
  latest(sourceId: SourceId, page: number): Promise<MangasPage>;
  search(sourceId: SourceId, page: number, query: string, filters: FilterState[] | null): Promise<MangasPage>;
  filters(sourceId: SourceId): Promise<FilterState[]>;
  update(sourceId: SourceId, manga: RemoteManga, chapters: RemoteChapter[], details: boolean, withChapters: boolean): Promise<{ manga: RemoteManga; chapters: RemoteChapter[] }>;
  pages(sourceId: SourceId, chapter: RemoteChapter): Promise<RemotePage[]>;
  imageRequest(sourceId: SourceId, page: RemotePage): Promise<ImageRequest>;
  mangaWebUrl(sourceId: SourceId, manga: RemoteManga): string | null;
  preferences(sourceId: SourceId): PreferenceItem[];
  setPreference(sourceId: SourceId, key: string, value: unknown): boolean;
}

/** Downloaded page files. */
export interface PageStore {
  write(chapterId: ChapterId, index: number, bytes: Uint8Array, ext: string): Promise<void>;
  list(chapterId: ChapterId): Promise<string[]>;
  remove(chapterId: ChapterId): Promise<void>;
  /** Fetch an image (with headers) and return its bytes + extension. */
  fetchImage(req: ImageRequest): Promise<{ bytes: Uint8Array; ext: string }>;
}

export interface Clock {
  now(): number;
}

export interface Deps {
  repos: RepoRepository;
  extensions: ExtensionRepository;
  mangas: MangaRepository;
  chapters: ChapterRepository;
  categories: CategoryRepository;
  history: HistoryRepository;
  downloads: DownloadRepository;
  settings: SettingsRepository;
  fetcher: ExtensionFetcher;
  bundles: BundleStore;
  sources: SourceGateway;
  pages: PageStore;
  clock: Clock;
}

// Host-facing API: load translated bundles and talk to their sources with plain JSON values.

import { loadBundle, baseUrlPreferences, type LoadedBundle } from './runtime';
import { setHost, type SourceHost } from './source';
import { setDefaultTransport } from './okhttp';
import { SManga, SChapter, Page, applyFilterState, snapshotFilters, type FilterSnapshot } from './model';
import { PreferenceScreen, SharedPreferences, applyPreferenceChange, type Preference } from './source/preferences';
import { str } from './kotlin/core';

export interface MangaDTO {
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
export interface ChapterDTO {
  url: string;
  name: string;
  date_upload: number;
  chapter_number: number;
  scanlator: string | null;
  memo?: unknown;
}
export interface PageDTO {
  index: number;
  url: string;
  imageUrl: string | null;
}
export interface SourceMeta {
  id: string;
  name: string;
  lang: string;
  baseUrl: string;
  index: number;
  pkg: string;
}

interface Entry {
  meta: SourceMeta;
  instance: any;
  bundleMeta: LoadedBundle['sources'][number];
}

export function initHost(host: SourceHost): void {
  setDefaultTransport(host.transport);
  setHost(host);
}

const toDTO = (m: SManga): MangaDTO => m.toJSON() as any;
const chapterDTO = (c: SChapter): ChapterDTO => c.toJSON() as any;

export class SourceRegistry {
  private entries = new Map<string, Entry>();
  private byPkg = new Map<string, string[]>();

  /** Evaluate a bundle and instantiate its sources. Returns their metadata. */
  load(pkg: string, code: string): SourceMeta[] {
    this.unload(pkg);
    const bundle = loadBundle(code);
    const metas: SourceMeta[] = [];
    bundle.sources.forEach((s, index) => {
      const instance = s.create();
      const meta: SourceMeta = { id: String(instance.id), name: instance.name, lang: instance.lang, baseUrl: instance.baseUrl, index, pkg };
      this.entries.set(meta.id, { meta, instance, bundleMeta: s });
      metas.push(meta);
    });
    this.byPkg.set(
      pkg,
      metas.map((m) => m.id),
    );
    return metas;
  }

  unload(pkg: string): void {
    for (const id of this.byPkg.get(pkg) ?? []) this.entries.delete(id);
    this.byPkg.delete(pkg);
  }

  sources(): SourceMeta[] {
    return [...this.entries.values()].map((e) => e.meta);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  private src(id: string): any {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Source ${id} is not installed`);
    return e.instance;
  }

  supportsLatest(id: string): boolean {
    return !!this.src(id).supportsLatest;
  }

  async popular(id: string, page: number) {
    const r = await this.src(id).getPopularManga(page);
    return { mangas: r.mangas.map(toDTO), hasNextPage: !!r.hasNextPage };
  }

  async latest(id: string, page: number) {
    const r = await this.src(id).getLatestUpdates(page);
    return { mangas: r.mangas.map(toDTO), hasNextPage: !!r.hasNextPage };
  }

  async filters(id: string): Promise<FilterSnapshot[]> {
    const s = this.src(id);
    if (typeof s.$fetchFilters === 'function') await s.$fetchFilters();
    return snapshotFilters(s.$getFilterList());
  }

  async search(id: string, page: number, query: string, filters: FilterSnapshot[] | null) {
    const s = this.src(id);
    const list = s.$getFilterList();
    if (filters) applyFilterState(list, filters);
    const r = await s.getSearchManga(page, query, list);
    return { mangas: r.mangas.map(toDTO), hasNextPage: !!r.hasNextPage };
  }

  async update(id: string, manga: MangaDTO, chapters: ChapterDTO[], details: boolean, withChapters: boolean) {
    const s = this.src(id);
    const m = SManga.fromJSON(manga);
    const cs = chapters.map((c) => SChapter.fromJSON(c));
    const u = await s.getMangaUpdate(m, cs, details, withChapters);
    const outChapters: SChapter[] = u.chapters;
    for (const c of outChapters) if (typeof s.prepareNewChapter === 'function') s.prepareNewChapter(c, u.manga);
    return { manga: toDTO(u.manga), chapters: outChapters.map(chapterDTO) };
  }

  async pages(id: string, chapter: ChapterDTO): Promise<PageDTO[]> {
    const pages: Page[] = await this.src(id).getPageList(SChapter.fromJSON(chapter));
    return pages.map((p, i) => ({ index: p.index ?? i, url: p.url ?? '', imageUrl: p.imageUrl ?? null }));
  }

  /** Resolve a page to the URL and headers the image must be fetched with. */
  async imageRequest(id: string, page: PageDTO): Promise<{ url: string; headers: Record<string, string> }> {
    const s = this.src(id);
    const p = Page.fromJSON(page);
    if (!p.imageUrl) p.imageUrl = await s.getImageUrl(p);
    const req = s.imageRequest(p);
    const headers: Record<string, string> = {};
    for (const [k, v] of req.headers.pairs) headers[k] = v;
    return { url: req.url.toString(), headers };
  }

  /**
   * Fetch an image through the source's own client so its interceptors run (some sources
   * sign or rewrite image requests). Returns raw bytes and content type.
   */
  async fetchImage(id: string, page: PageDTO): Promise<{ bytes: Uint8Array; contentType: string }> {
    const s = this.src(id);
    const p = Page.fromJSON(page);
    if (!p.imageUrl) p.imageUrl = await s.getImageUrl(p);
    const res = await s.client.newCall(s.imageRequest(p)).awaitSuccess();
    return { bytes: res.body.raw, contentType: res.header('Content-Type') ?? 'image/jpeg' };
  }

  mangaUrl(id: string, manga: MangaDTO): string | null {
    try {
      return this.src(id).getMangaUrl(SManga.fromJSON(manga));
    } catch {
      return null;
    }
  }

  // ---------- preferences ----------

  private screen(id: string): PreferenceScreen {
    const e = this.entries.get(id)!;
    const prefs = SharedPreferences.forSource(id);
    const screen = new PreferenceScreen(undefined, prefs);
    for (const p of baseUrlPreferences(e.bundleMeta)) screen.addPreference(p);
    if (typeof e.instance.setupPreferenceScreen === 'function') e.instance.setupPreferenceScreen(screen);
    return screen;
  }

  preferences(id: string): Record<string, unknown>[] {
    const prefs = SharedPreferences.forSource(id);
    return this.screen(id).prefs.map((p: Preference) => {
      const d = p.$describe();
      const stored = prefs.store.get(p.key);
      return { ...d, value: stored === undefined ? d.default : stored, summary: d.summary === null ? null : str(d.summary) };
    });
  }

  setPreference(id: string, key: string, value: unknown): boolean {
    const p = this.screen(id).findPreference(key);
    if (!p) return false;
    return applyPreferenceChange(p, value);
  }
}

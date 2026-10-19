// Browsing sources and keeping manga/chapter data in sync with them.

import { planChapterSync } from '../domain/chapters';
import { type Chapter, type FilterState, type Manga, type MangaId, type RemoteChapter, type RemoteManga, type SourceId, type SourceInfo, splitGenres } from '../domain/model';
import type { Deps } from './ports';

export interface BrowsePage {
  mangas: Manga[];
  hasNextPage: boolean;
}

export function toRemoteManga(m: Manga): RemoteManga {
  return {
    url: m.url,
    title: m.title,
    artist: m.artist,
    author: m.author,
    description: m.description,
    genre: m.genres.length ? m.genres.join(', ') : null,
    status: m.status,
    thumbnail_url: m.thumbnailUrl,
    initialized: m.initialized,
    memo: m.memo,
  };
}

export function toRemoteChapter(c: Chapter): RemoteChapter {
  return { url: c.url, name: c.name, date_upload: c.dateUpload, chapter_number: c.chapterNumber, scanlator: c.scanlator, memo: c.memo };
}

export function createCatalogUseCases(d: Deps) {
  /** Network manga -> local row (insert if new; refresh thumbnail/title for non-favorites). */
  async function toLocal(sourceId: SourceId, r: RemoteManga): Promise<Manga> {
    const found = await d.mangas.findBySource(sourceId, r.url);
    if (found) {
      if (!found.favorite && ((r.thumbnail_url && r.thumbnail_url !== found.thumbnailUrl) || r.title !== found.title)) {
        const next = { ...found, title: r.title || found.title, thumbnailUrl: r.thumbnail_url ?? found.thumbnailUrl };
        await d.mangas.update(next);
        return next;
      }
      return found;
    }
    return d.mangas.insert({
      sourceId,
      url: r.url,
      title: r.title,
      artist: r.artist,
      author: r.author,
      description: r.description,
      genres: splitGenres(r.genre),
      status: r.status ?? 0,
      thumbnailUrl: r.thumbnail_url,
      favorite: false,
      initialized: r.initialized,
      dateAdded: 0,
      lastUpdate: 0,
      memo: r.memo ?? null,
      viewer: null,
    });
  }

  async function page(sourceId: SourceId, p: Promise<{ mangas: RemoteManga[]; hasNextPage: boolean }>): Promise<BrowsePage> {
    const res = await p;
    const mangas: Manga[] = [];
    const seen = new Set<string>();
    for (const r of res.mangas) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      mangas.push(await toLocal(sourceId, r));
    }
    return { mangas, hasNextPage: res.hasNextPage };
  }

  async function refresh(mangaId: MangaId, opts: { details?: boolean; chapters?: boolean } = {}): Promise<{ manga: Manga; chapters: Chapter[]; newChapters: number }> {
    const manga = await d.mangas.get(mangaId);
    if (!manga) throw new Error('Manga not found');
    const details = opts.details ?? true;
    const withChapters = opts.chapters ?? true;
    const existing = await d.chapters.byManga(mangaId);
    const res = await d.sources.update(manga.sourceId, toRemoteManga(manga), existing.map(toRemoteChapter), details, withChapters);
    const r = res.manga;
    const now = d.clock.now();
    const next: Manga = details
      ? {
          ...manga,
          title: r.title || manga.title,
          artist: r.artist ?? manga.artist,
          author: r.author ?? manga.author,
          description: r.description ?? manga.description,
          genres: r.genre ? splitGenres(r.genre) : manga.genres,
          status: r.status ?? manga.status,
          thumbnailUrl: r.thumbnail_url ?? manga.thumbnailUrl,
          initialized: true,
          memo: r.memo ?? manga.memo,
          url: r.url || manga.url,
        }
      : { ...manga, memo: r.memo ?? manga.memo };
    let newChapters = 0;
    if (withChapters) {
      const plan = planChapterSync(mangaId, next.title, existing, res.chapters, now);
      newChapters = plan.insert.length;
      if (plan.remove.length) await d.chapters.deleteMany(plan.remove);
      if (plan.update.length) await d.chapters.updateMany(plan.update);
      if (plan.insert.length) await d.chapters.insertMany(plan.insert);
      next.lastUpdate = newChapters ? now : manga.lastUpdate;
    }
    await d.mangas.update(next);
    return { manga: next, chapters: await d.chapters.byManga(mangaId), newChapters };
  }

  return {
    sources(langs: string[] | null): SourceInfo[] {
      const all = d.sources.sources();
      return langs ? all.filter((s) => langs.includes(s.lang) || s.lang === 'all') : all;
    },
    supportsLatest: (sourceId: SourceId) => d.sources.supportsLatest(sourceId),
    popular: (sourceId: SourceId, p: number) => page(sourceId, d.sources.popular(sourceId, p)),
    latest: (sourceId: SourceId, p: number) => page(sourceId, d.sources.latest(sourceId, p)),
    search: (sourceId: SourceId, p: number, query: string, filters: FilterState[] | null) => page(sourceId, d.sources.search(sourceId, p, query, filters)),
    filters: (sourceId: SourceId) => d.sources.filters(sourceId),

    async manga(mangaId: MangaId): Promise<{ manga: Manga; chapters: Chapter[] }> {
      const manga = await d.mangas.get(mangaId);
      if (!manga) throw new Error('Manga not found');
      return { manga, chapters: await d.chapters.byManga(mangaId) };
    },

    refresh,

    async setFavorite(mangaId: MangaId, favorite: boolean): Promise<Manga> {
      const m = await d.mangas.get(mangaId);
      if (!m) throw new Error('Manga not found');
      const next = { ...m, favorite, dateAdded: favorite ? d.clock.now() : 0 };
      await d.mangas.update(next);
      if (!favorite) await d.categories.setForManga(mangaId, []);
      return next;
    },

    setRead: (ids: number[], read: boolean) => d.chapters.setRead(ids, read),
    setBookmark: (ids: number[], b: boolean) => d.chapters.setBookmark(ids, b),

    async markPreviousRead(chapterId: number): Promise<void> {
      const c = await d.chapters.get(chapterId);
      if (!c) return;
      const all = await d.chapters.byManga(c.mangaId);
      // "previous" = older in source order (source lists newest first)
      await d.chapters.setRead(
        all.filter((x) => x.sourceOrder > c.sourceOrder).map((x) => x.id),
        true,
      );
    },

    webUrl(manga: Manga): string | null {
      return d.sources.mangaWebUrl(manga.sourceId, toRemoteManga(manga));
    },

    async setViewer(mangaId: MangaId, viewer: Manga['viewer']): Promise<void> {
      const m = await d.mangas.get(mangaId);
      if (m) await d.mangas.update({ ...m, viewer });
    },
  };
}

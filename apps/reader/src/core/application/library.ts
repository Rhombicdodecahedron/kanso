import type { Category, CategoryId, Chapter, HistoryEntry, Manga, MangaId } from '../domain/model';
import type { Deps } from './ports';

export interface LibraryEntry {
  manga: Manga;
  unread: number;
  categoryIds: CategoryId[];
}

export type LibrarySort = 'title' | 'lastRead' | 'lastUpdate' | 'unread' | 'dateAdded';

export interface LibraryView {
  categories: Category[];
  entries: LibraryEntry[];
}

export interface HistoryItem {
  entry: HistoryEntry;
  chapter: Chapter;
  manga: Manga;
}

export function filterAndSort(entries: LibraryEntry[], opts: { categoryId: CategoryId | null; unreadOnly: boolean; query: string; sort: LibrarySort; lastRead: Map<MangaId, number> }): LibraryEntry[] {
  const q = opts.query.trim().toLowerCase();
  const list = entries.filter((e) => {
    if (opts.categoryId === null) {
      if (e.categoryIds.length) return false; // "Default" shows uncategorised
    } else if (opts.categoryId !== -1 && !e.categoryIds.includes(opts.categoryId)) return false;
    if (opts.unreadOnly && e.unread === 0) return false;
    if (q && !e.manga.title.toLowerCase().includes(q) && !(e.manga.author ?? '').toLowerCase().includes(q)) return false;
    return true;
  });
  const cmp: Record<LibrarySort, (a: LibraryEntry, b: LibraryEntry) => number> = {
    title: (a, b) => a.manga.title.localeCompare(b.manga.title),
    lastRead: (a, b) => (opts.lastRead.get(b.manga.id) ?? 0) - (opts.lastRead.get(a.manga.id) ?? 0),
    lastUpdate: (a, b) => b.manga.lastUpdate - a.manga.lastUpdate,
    unread: (a, b) => b.unread - a.unread,
    dateAdded: (a, b) => b.manga.dateAdded - a.manga.dateAdded,
  };
  return [...list].sort((a, b) => cmp[opts.sort](a, b) || a.manga.title.localeCompare(b.manga.title));
}

export function createLibraryUseCases(d: Deps) {
  return {
    async view(): Promise<LibraryView> {
      const [mangas, unread, cats, assignments] = await Promise.all([d.mangas.favorites(), d.chapters.unreadCounts(), d.categories.list(), d.categories.assignments()]);
      return {
        categories: cats,
        entries: mangas.map((m) => ({ manga: m, unread: unread.get(m.id) ?? 0, categoryIds: assignments.get(m.id) ?? [] })),
      };
    },

    async lastReadByManga(): Promise<Map<MangaId, number>> {
      const out = new Map<MangaId, number>();
      for (const h of await d.history.recent(5000)) {
        const c = await d.chapters.get(h.chapterId);
        if (c && (out.get(c.mangaId) ?? 0) < h.lastRead) out.set(c.mangaId, h.lastRead);
      }
      return out;
    },

    categories: () => d.categories.list(),
    createCategory: (name: string) => d.categories.create(name.trim()),
    renameCategory: (id: CategoryId, name: string) => d.categories.rename(id, name.trim()),
    removeCategory: (id: CategoryId) => d.categories.remove(id),
    reorderCategories: (ids: CategoryId[]) => d.categories.reorder(ids),
    categoriesOf: (mangaId: MangaId) => d.categories.ofManga(mangaId),
    setCategories: (mangaId: MangaId, ids: CategoryId[]) => d.categories.setForManga(mangaId, ids),

    async history(limit = 200): Promise<HistoryItem[]> {
      const entries = await d.history.recent(limit);
      const out: HistoryItem[] = [];
      const seenManga = new Set<MangaId>();
      for (const e of entries) {
        const chapter = await d.chapters.get(e.chapterId);
        if (!chapter) continue;
        // Like Mihon: one row per manga, its latest read chapter.
        if (seenManga.has(chapter.mangaId)) continue;
        const manga = await d.mangas.get(chapter.mangaId);
        if (!manga) continue;
        seenManga.add(manga.id);
        out.push({ entry: e, chapter, manga });
      }
      return out;
    },
    removeHistory: (chapterId: number) => d.history.remove(chapterId),
    clearHistory: () => d.history.clear(),
  };
}

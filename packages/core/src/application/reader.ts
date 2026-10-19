import type { Chapter, ChapterId, ImageRequest, Manga, ReaderMode } from '../domain/model';
import { toRemoteChapter } from './catalog';
import type { Deps } from './ports';

/** A page as the reader shows it: a local file, or a remote image request (resolved lazily). */
export type ReaderPage =
  | { kind: 'local'; index: number; uri: string }
  | { kind: 'remote'; index: number; url: string; imageUrl: string | null };

export interface ReaderSession {
  manga: Manga;
  chapter: Chapter;
  pages: ReaderPage[];
  startPage: number;
  /** fraction of the start page already scrolled past (webtoon) */
  startOffset: number;
  prev: Chapter | null;
  next: Chapter | null;
  mode: ReaderMode;
}

export function createReaderUseCases(d: Deps) {
  return {
    async open(chapterId: ChapterId): Promise<ReaderSession> {
      const chapter = await d.chapters.get(chapterId);
      if (!chapter) throw new Error('Chapter not found');
      const manga = await d.mangas.get(chapter.mangaId);
      if (!manga) throw new Error('Manga not found');
      const all = await d.chapters.byManga(manga.id);
      // Source order: index 0 = newest. Reading forward goes to a lower sourceOrder.
      const sorted = [...all].sort((a, b) => b.sourceOrder - a.sourceOrder);
      const i = sorted.findIndex((c) => c.id === chapterId);
      const settings = await d.settings.get();
      const local = await d.pages.list(chapterId);
      let pages: ReaderPage[];
      if (local.length) pages = local.map((uri, index) => ({ kind: 'local', index, uri }));
      else {
        const remote = await d.sources.pages(manga.sourceId, toRemoteChapter(chapter));
        pages = remote.map((p) => ({ kind: 'remote', index: p.index, url: p.url, imageUrl: p.imageUrl }));
      }
      const startPage = chapter.read ? 0 : Math.min(chapter.lastPageRead, Math.max(0, pages.length - 1));
      return {
        manga,
        chapter,
        pages,
        startPage,
        startOffset: chapter.read ? 0 : chapter.pageOffset,
        prev: i > 0 ? sorted[i - 1] : null,
        next: i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null,
        mode: manga.viewer ?? settings.readerMode,
      };
    },

    /** Resolve the image request (URL + headers) for a remote page. */
    async image(manga: Manga, page: Extract<ReaderPage, { kind: 'remote' }>): Promise<ImageRequest> {
      return d.sources.imageRequest(manga.sourceId, { index: page.index, url: page.url, imageUrl: page.imageUrl });
    },

    /** Called on page change. Marks the chapter read on its last page and records history. */
    async progress(chapterId: ChapterId, page: number, total: number, msSpent: number, offset = 0): Promise<void> {
      await d.chapters.setProgress(chapterId, page, offset);
      if (total > 0 && page >= total - 1) await d.chapters.setRead([chapterId], true);
      const now = d.clock.now();
      const prev = (await d.history.recent(5000)).find((h) => h.chapterId === chapterId);
      await d.history.upsert({ chapterId, lastRead: now, timeRead: (prev?.timeRead ?? 0) + Math.max(0, msSpent) });
    },

    /** Exact scroll position inside a page (webtoon), saved when scrolling stops. */
    position: (chapterId: ChapterId, page: number, offset: number) => d.chapters.setProgress(chapterId, page, offset),
  };
}

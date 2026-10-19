// Download queue: chapters are fetched into the PageStore, several pages at a time.
//
// Pages download natively, straight to disk, with the request the reader would use (the source's
// image URL and headers); the source's own client is the fallback. When the app goes to the
// background every remaining page is started at once, so the system keeps downloading them while
// the app is suspended (iOS background transfers). Pages already on disk are never fetched again,
// so an interrupted chapter resumes where it stopped.

import type { ChapterId, Download, Manga, RemotePage } from '../domain/model';
import { toRemoteChapter } from './catalog';
import type { Deps } from './ports';

export type DownloadListener = (d: Download) => void;

/** Pages of one chapter downloading at the same time while the app is in the foreground. */
const PAGE_CONCURRENCY = 6;

export function createDownloadUseCases(deps: Deps) {
  const listeners = new Set<DownloadListener>();
  const cancelled = new Set<ChapterId>();
  const aborts = new Map<ChapterId, AbortController>();
  // In the background: no limits, everything goes to the system at once.
  let unlimited = false;
  const wakers = new Set<() => void>();

  const emit = (dl: Download) => {
    for (const l of listeners) l(dl);
  };

  async function fetchPage(manga: Manga, chapterId: ChapterId, p: RemotePage, signal: AbortSignal): Promise<void> {
    try {
      const req = await deps.sources.imageRequest(manga.sourceId, p);
      await deps.pages.download(chapterId, p.index, req, signal);
    } catch (e) {
      if (signal.aborted) throw e;
      // some sources sign or rewrite image requests in their client
      const img = await deps.sources.fetchImage(manga.sourceId, p);
      await deps.pages.write(chapterId, p.index, img.bytes, extFor(img.contentType));
    }
  }

  async function downloadOne(dl: Download): Promise<void> {
    const chapter = await deps.chapters.get(dl.chapterId);
    const manga = chapter ? await deps.mangas.get(chapter.mangaId) : null;
    if (!chapter || !manga) {
      await deps.downloads.remove(dl.chapterId);
      return;
    }
    const abort = new AbortController();
    aborts.set(dl.chapterId, abort);
    let cur: Download = { ...dl, state: 'downloading', error: null };
    await deps.downloads.upsert(cur);
    emit(cur);
    try {
      const pages = await deps.sources.pages(manga.sourceId, toRemoteChapter(chapter));
      const have = await deps.pages.indexes(chapter.id);
      const todo = pages.filter((p) => !have.has(p.index));
      cur = { ...cur, total: pages.length, progress: pages.length - todo.length };
      emit(cur);
      await pool(todo, () => (unlimited ? Infinity : PAGE_CONCURRENCY), async (p) => {
        if (cancelled.has(dl.chapterId)) throw new Error('cancelled');
        await withRetry(() => fetchPage(manga, chapter.id, p, abort.signal), 3, abort.signal);
        cur = { ...cur, progress: cur.progress + 1 };
        await deps.downloads.upsert(cur);
        emit(cur);
      });
      cur = { ...cur, state: 'done' };
      await deps.downloads.upsert(cur);
      emit(cur);
    } catch (e) {
      if (cancelled.has(dl.chapterId)) {
        cancelled.delete(dl.chapterId);
        await deps.pages.remove(dl.chapterId);
        await deps.downloads.remove(dl.chapterId);
        emit({ ...cur, state: 'error', error: 'cancelled' });
        return;
      }
      cur = { ...cur, state: 'error', error: e instanceof Error ? e.message : String(e) };
      await deps.downloads.upsert(cur);
      emit(cur);
    } finally {
      aborts.delete(dl.chapterId);
    }
  }

  /** Runs `f` over `items`, at most `limit()` at a time; the limit is re-read when woken. */
  function pool<T>(items: T[], limit: () => number, f: (item: T) => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      let next = 0;
      let active = 0;
      let failed = false;
      const pump = () => {
        if (failed) return;
        if (next >= items.length && active === 0) {
          wakers.delete(pump);
          return resolve();
        }
        while (active < limit() && next < items.length) {
          const item = items[next++];
          active++;
          f(item).then(
            () => {
              active--;
              pump();
            },
            (e) => {
              failed = true;
              wakers.delete(pump);
              reject(e);
            },
          );
        }
      };
      wakers.add(pump);
      pump();
    });
  }

  let current: Promise<void> | null = null;
  function run(): Promise<void> {
    if (current) return current;
    current = drain().finally(() => {
      current = null;
    });
    return current;
  }

  async function drain(): Promise<void> {
    for (;;) {
      const queue = (await deps.downloads.list()).filter((x) => x.state === 'queued').sort((a, b) => a.queuedAt - b.queuedAt);
      if (!queue.length) break;
      const { downloadConcurrency } = await deps.settings.get();
      await pool(queue, () => (unlimited ? Infinity : Math.max(1, downloadConcurrency)), downloadOne);
    }
  }

  return {
    list: () => deps.downloads.list(),
    subscribe(l: DownloadListener): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    async enqueue(chapterIds: ChapterId[]): Promise<void> {
      const existing = new Map((await deps.downloads.list()).map((x) => [x.chapterId, x]));
      const now = deps.clock.now();
      for (const [i, id] of chapterIds.entries()) {
        const c = await deps.chapters.get(id);
        if (!c) continue;
        const ex = existing.get(id);
        if (ex && (ex.state === 'done' || ex.state === 'downloading' || ex.state === 'queued')) continue;
        const dl: Download = { chapterId: id, mangaId: c.mangaId, state: 'queued', progress: 0, total: 0, error: null, queuedAt: now + i };
        await deps.downloads.upsert(dl);
        emit(dl);
      }
      void run();
    },
    async cancel(chapterId: ChapterId): Promise<void> {
      cancelled.add(chapterId);
      aborts.get(chapterId)?.abort();
      const dl = (await deps.downloads.list()).find((x) => x.chapterId === chapterId);
      if (dl && dl.state !== 'downloading') {
        cancelled.delete(chapterId);
        await deps.downloads.remove(chapterId);
      }
    },
    async remove(chapterId: ChapterId): Promise<void> {
      await deps.pages.remove(chapterId);
      await deps.downloads.remove(chapterId);
    },
    async retry(chapterId: ChapterId): Promise<void> {
      const dl = (await deps.downloads.list()).find((x) => x.chapterId === chapterId);
      if (dl) await deps.downloads.upsert({ ...dl, state: 'queued', error: null, progress: 0 });
      void run();
    },
    /** Resume queued downloads at app start (interrupted ones go back to the queue). */
    async resume(): Promise<void> {
      for (const dl of await deps.downloads.list()) if (dl.state === 'downloading') await deps.downloads.upsert({ ...dl, state: 'queued' });
      void run();
    },
    run,
    /** The app went to the background: start every remaining page now, the system finishes them. */
    background(): void {
      unlimited = true;
      for (const wake of [...wakers]) wake();
    },
    /** Back in the foreground: new transfers follow the normal limits again. */
    foreground(): void {
      unlimited = false;
    },
  };
}

async function withRetry<T>(f: () => Promise<T>, attempts: number, signal?: AbortSignal): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await f();
    } catch (e) {
      last = e;
      if (signal?.aborted) break;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw last;
}

function extFor(contentType: string): string {
  const t = contentType.toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  if (t.includes('gif')) return 'gif';
  if (t.includes('avif')) return 'avif';
  return 'jpg';
}

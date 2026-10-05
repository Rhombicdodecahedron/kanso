// Download queue: chapters are fetched page by page into the PageStore.

import type { ChapterId, Download } from '../domain/model';
import { toRemoteChapter } from './catalog';
import type { Deps } from './ports';

export type DownloadListener = (d: Download) => void;

export function createDownloadUseCases(deps: Deps) {
  const listeners = new Set<DownloadListener>();
  const cancelled = new Set<ChapterId>();

  const emit = (dl: Download) => {
    for (const l of listeners) l(dl);
  };

  async function downloadOne(dl: Download): Promise<void> {
    const chapter = await deps.chapters.get(dl.chapterId);
    const manga = chapter ? await deps.mangas.get(chapter.mangaId) : null;
    if (!chapter || !manga) {
      await deps.downloads.remove(dl.chapterId);
      return;
    }
    let cur: Download = { ...dl, state: 'downloading', error: null };
    await deps.downloads.upsert(cur);
    emit(cur);
    try {
      const pages = await deps.sources.pages(manga.sourceId, toRemoteChapter(chapter));
      cur = { ...cur, total: pages.length, progress: 0 };
      emit(cur);
      await deps.pages.remove(chapter.id);
      for (const p of pages) {
        if (cancelled.has(dl.chapterId)) throw new Error('cancelled');
        const img = await withRetry(() => deps.sources.fetchImage(manga.sourceId, p), 3);
        await deps.pages.write(chapter.id, p.index, img.bytes, extFor(img.contentType));
        cur = { ...cur, progress: cur.progress + 1 };
        await deps.downloads.upsert(cur);
        emit(cur);
      }
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
    }
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
    try {
      for (;;) {
        const queue = (await deps.downloads.list()).filter((x) => x.state === 'queued').sort((a, b) => a.queuedAt - b.queuedAt);
        if (!queue.length) break;
        const { downloadConcurrency } = await deps.settings.get();
        // Different mangas may download in parallel; pages within a chapter are sequential.
        await Promise.all(queue.slice(0, Math.max(1, downloadConcurrency)).map(downloadOne));
      }
    } finally {
      // drained
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
  };
}

async function withRetry<T>(f: () => Promise<T>, attempts: number): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await f();
    } catch (e) {
      last = e;
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

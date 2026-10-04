// Chapter list sync, following Mihon's SyncChaptersWithSource.

import type { Chapter, ChapterId, MangaId, RemoteChapter } from './model';

export interface ChapterSyncPlan {
  insert: Omit<Chapter, 'id'>[];
  update: Chapter[];
  remove: ChapterId[];
}

/**
 * Compute the changes needed to make the stored chapters match the source's list.
 * - Matching is by URL. Source order = position in the source list.
 * - Read/bookmark/progress survive updates, and carry over to a re-added chapter with the same
 *   number (sites often delete and re-upload a chapter under a new URL).
 * - A chapter number the source leaves unknown (< 0) is recognised from the name.
 */
export function planChapterSync(mangaId: MangaId, mangaTitle: string, existing: Chapter[], remote: RemoteChapter[], now: number): ChapterSyncPlan {
  const byUrl = new Map(existing.map((c) => [c.url, c]));
  const seen = new Set<string>();
  const insert: Omit<Chapter, 'id'>[] = [];
  const update: Chapter[] = [];

  remote.forEach((r, i) => {
    if (seen.has(r.url)) return; // duplicate URL in source list: keep first
    seen.add(r.url);
    const number = r.chapter_number >= 0 ? r.chapter_number : recognizeChapterNumber(mangaTitle, r.name);
    const found = byUrl.get(r.url);
    if (!found) {
      insert.push({
        mangaId,
        url: r.url,
        name: r.name,
        scanlator: r.scanlator ?? null,
        chapterNumber: number,
        dateUpload: r.date_upload > 0 ? r.date_upload : 0,
        // Newer chapters (lower index) get later fetch dates so "date fetched" sorts like the source.
        dateFetch: now - i,
        sourceOrder: i,
        read: false,
        bookmark: false,
        lastPageRead: 0,
        memo: r.memo ?? null,
      });
      return;
    }
    const next: Chapter = {
      ...found,
      name: r.name,
      scanlator: r.scanlator ?? null,
      chapterNumber: number,
      dateUpload: r.date_upload > 0 ? r.date_upload : found.dateUpload,
      sourceOrder: i,
      memo: r.memo ?? found.memo,
    };
    if (
      next.name !== found.name ||
      next.scanlator !== found.scanlator ||
      next.chapterNumber !== found.chapterNumber ||
      next.dateUpload !== found.dateUpload ||
      next.sourceOrder !== found.sourceOrder ||
      JSON.stringify(next.memo) !== JSON.stringify(found.memo)
    ) {
      update.push(next);
    }
  });

  const removed = existing.filter((c) => !seen.has(c.url));
  // Carry reading state from removed chapters to re-added ones with the same number.
  for (const ins of insert) {
    if (ins.chapterNumber < 0) continue;
    const prev = removed.find((c) => c.chapterNumber === ins.chapterNumber && (c.read || c.bookmark || c.lastPageRead > 0));
    if (prev) {
      ins.read = prev.read;
      ins.bookmark = prev.bookmark;
      ins.lastPageRead = prev.lastPageRead;
      ins.dateFetch = prev.dateFetch;
    }
  }
  return { insert, update, remove: removed.map((c) => c.id) };
}

/** Mihon's ChapterRecognition, simplified: find the chapter number in a chapter name. */
export function recognizeChapterNumber(mangaTitle: string, chapterName: string): number {
  let name = chapterName.toLowerCase();
  const title = mangaTitle.toLowerCase();
  if (title && name.includes(title)) name = name.replace(title, ' ');
  name = name.replace(/,/g, '.').replace(/-/g, '.');
  // drop volume / season markers and version suffixes
  name = name.replace(/\b(?:vol(?:ume)?|v|season|s)\s*\.?\s*\d+(?:\.\d+)?/g, ' ');
  name = name.replace(/\b(?:v|ver|version)\s*\.?\s*\d+\b/g, ' ');
  const explicit = /(?:ch(?:apter|ap)?|ep(?:isode)?|chương|capitulo|capítulo|chapitre|kapitel|bab|話|第)\s*\.?\s*(\d+(?:\.\d+)?)/.exec(name);
  if (explicit) return parseFloat(explicit[1]);
  const nums = name.match(/\d+(?:\.\d+)?/g);
  if (nums?.length) return parseFloat(nums[0]);
  return -1;
}

import type { ChapterId, ImageRequest, PageStore } from '@kanso/core';

import { idb } from './idb';

/**
 * Downloaded pages as blobs in IndexedDB. The reader gets blob: URLs; those of a chapter are
 * revoked when the chapter is listed again or removed. Downloads run while the tab is open only.
 */
export class IdbPageStore implements PageStore {
  private urls = new Map<ChapterId, string[]>();

  constructor(
    private readonly src: (req: ImageRequest) => string,
    private readonly doFetch: typeof fetch = (...a) => fetch(...a),
  ) {}

  async write(chapterId: ChapterId, index: number, bytes: Uint8Array, ext: string) {
    const blob = new Blob([bytes as unknown as BlobPart], { type: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg' });
    await (await idb()).put('pages', { chapterId, index, blob });
  }

  async download(chapterId: ChapterId, index: number, req: ImageRequest, signal?: AbortSignal) {
    const res = await this.doFetch(this.src(req), { signal, credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    await (await idb()).put('pages', { chapterId, index, blob });
  }

  async indexes(chapterId: ChapterId) {
    const keys = await (await idb()).getAllKeysFromIndex('pages', 'chapter', chapterId);
    return new Set(keys.map((k) => k[1]));
  }

  async list(chapterId: ChapterId) {
    this.revoke(chapterId);
    const rows = await (await idb()).getAllFromIndex('pages', 'chapter', chapterId);
    const urls = rows.sort((a, b) => a.index - b.index).map((r) => URL.createObjectURL(r.blob));
    this.urls.set(chapterId, urls);
    return urls;
  }

  async remove(chapterId: ChapterId) {
    this.revoke(chapterId);
    const db = await idb();
    const tx = db.transaction('pages', 'readwrite');
    for (const key of await tx.store.index('chapter').getAllKeys(chapterId)) await tx.store.delete(key);
    await tx.done;
  }

  private revoke(chapterId: ChapterId) {
    for (const u of this.urls.get(chapterId) ?? []) URL.revokeObjectURL(u);
    this.urls.delete(chapterId);
  }
}

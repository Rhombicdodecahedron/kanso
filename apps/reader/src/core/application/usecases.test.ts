import { openNodeDriver } from '@/adapters/sqlite/nodeDriver.testkit';
import { sqliteRepositories } from '@/adapters/sqlite/repositories';
import { migrate } from '@/adapters/sqlite/schema';

import type { InstalledExtension, RemoteChapter, RemoteManga, SourceInfo } from '../domain/model';
import { createUseCases } from './index';
import type { BundleStore, Deps, ExtensionFetcher, PageStore, SourceGateway } from './ports';

const SRC: SourceInfo = { id: '123', name: 'Test', lang: 'en', baseUrl: 'https://t.test', index: 0 };

function fakeSource(chapters: RemoteChapter[]) {
  const loaded = new Set<string>();
  const manga = (i: number): RemoteManga => ({ url: `/m/${i}`, title: `Manga ${i}`, artist: null, author: 'A', description: null, genre: 'Action, Drama', status: 1, thumbnail_url: `https://t.test/${i}.jpg`, initialized: false });
  const gw: SourceGateway & { chapters: RemoteChapter[] } = {
    chapters,
    async load(ext) {
      loaded.add(ext.pkg);
    },
    unload: (pkg) => void loaded.delete(pkg),
    sources: () => (loaded.size ? [SRC] : []),
    has: () => loaded.size > 0,
    supportsLatest: () => true,
    headers: () => ({}),
    popular: async () => ({ mangas: [manga(1), manga(2), manga(1)], hasNextPage: true }),
    latest: async () => ({ mangas: [manga(3)], hasNextPage: false }),
    search: async () => ({ mangas: [], hasNextPage: false }),
    filters: async () => [],
    update: async (_s, m) => ({ manga: { ...m, description: 'desc', initialized: true }, chapters: gw.chapters }),
    pages: async () => [0, 1, 2].map((i) => ({ index: i, url: '', imageUrl: `https://t.test/p${i}.jpg` })),
    imageRequest: async (_s, p) => ({ url: p.imageUrl!, headers: { Referer: 'https://t.test/' } }),
    fetchImage: async () => ({ bytes: new Uint8Array([1]), contentType: 'image/png' }),
    mangaWebUrl: (_s, m) => `https://t.test${m.url}`,
    preferences: () => [],
    setPreference: () => true,
  };
  return gw;
}

function setup(chapters: RemoteChapter[]) {
  const db = openNodeDriver();
  const files = new Map<string, string>();
  const pageFiles = new Map<number, string[]>();
  const index = [{ pkg: 'eu.test', name: 'Test', file: 'eu.test.js', lang: 'en', version: '1.6.2', nsfw: false, sha256: 'h:code', size: 4, theme: null, sources: [SRC] }];
  const fetcher: ExtensionFetcher = {
    index: async () => index,
    bundle: async () => 'code',
    sha256: async (t) => `h:${t}`,
  };
  const bundles: BundleStore = {
    write: async (p, c) => void files.set(p, c),
    read: async (p) => files.get(p) ?? null,
    remove: async (p) => void files.delete(p),
  };
  const add = (c: number, i: number) => pageFiles.set(c, [...(pageFiles.get(c) ?? []), `file://${c}/${i}`]);
  // Native downloads: controllable from the tests (failures, delay, how many run at once).
  const native = { fail: false, delay: 0, active: 0, max: 0, requests: [] as { url: string; headers: Record<string, string> }[], aborted: 0 };
  const pages: PageStore = {
    write: async (c, i) => void add(c, i),
    async download(c, i, req, signal) {
      native.requests.push(req);
      native.active++;
      native.max = Math.max(native.max, native.active);
      try {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, native.delay);
          signal?.addEventListener('abort', () => {
            clearTimeout(t);
            native.aborted++;
            reject(new Error('aborted'));
          });
        });
        if (native.fail) throw new Error('HTTP 403');
        add(c, i);
      } finally {
        native.active--;
      }
    },
    indexes: async (c) => new Set((pageFiles.get(c) ?? []).map((f) => Number(f.split('/').pop()))),
    list: async (c) => pageFiles.get(c) ?? [],
    remove: async (c) => void pageFiles.delete(c),
  };
  let t = 1_000_000;
  const sources = fakeSource(chapters);
  const deps: Deps = { ...sqliteRepositories(db), fetcher, bundles, pages, sources, clock: { now: () => ++t } };
  return { db, uc: createUseCases(deps), sources, index, pageFiles, native };
}

const rch = (url: string, name: string): RemoteChapter => ({ url, name, date_upload: 5, chapter_number: -1, scanlator: null });

describe('core loop', () => {
  it('installs an extension, browses, favorites, reads and downloads', async () => {
    const { db, uc, sources, pageFiles } = setup([rch('/c/2', 'Chapter 2'), rch('/c/1', 'Chapter 1')]);
    await migrate(db);

    // extensions
    await uc.extensions.addRepo('https://repo.test/index.min.json');
    let listing = await uc.extensions.list();
    expect(listing.available.map((e) => e.pkg)).toEqual(['eu.test']);
    await uc.extensions.install(listing.available[0]);
    listing = await uc.extensions.list();
    expect(listing.installed.map((e) => e.pkg)).toEqual(['eu.test']);
    expect(uc.catalog.sources(['en']).map((s) => s.id)).toEqual(['123']);

    // browse: duplicates are dropped, rows are reused
    const popular = await uc.catalog.popular('123', 1);
    expect(popular.mangas.map((m) => m.title)).toEqual(['Manga 1', 'Manga 2']);
    const again = await uc.catalog.popular('123', 1);
    expect(again.mangas[0].id).toBe(popular.mangas[0].id);

    // details + chapters
    const id = popular.mangas[0].id;
    const r = await uc.catalog.refresh(id);
    expect(r.manga.description).toBe('desc');
    expect(r.manga.genres).toEqual(['Action', 'Drama']);
    expect(r.chapters.map((c) => [c.name, c.chapterNumber])).toEqual([
      ['Chapter 2', 2],
      ['Chapter 1', 1],
    ]);

    // library + categories
    await uc.catalog.setFavorite(id, true);
    const cat = await uc.library.createCategory('Reading');
    await uc.library.setCategories(id, [cat.id]);
    const view = await uc.library.view();
    expect(view.entries).toEqual([expect.objectContaining({ unread: 2, categoryIds: [cat.id] })]);

    // reader: oldest chapter first, next goes forward
    const ch1 = r.chapters.find((c) => c.name === 'Chapter 1')!;
    const session = await uc.reader.open(ch1.id);
    expect(session.pages).toHaveLength(3);
    expect(session.next?.name).toBe('Chapter 2');
    expect(session.prev).toBeNull();
    await uc.reader.progress(ch1.id, 2, 3, 1000);
    expect((await uc.catalog.manga(id)).chapters.find((c) => c.id === ch1.id)?.read).toBe(true);
    const hist = await uc.library.history();
    expect(hist.map((h) => h.chapter.name)).toEqual(['Chapter 1']);

    // removing a series from history removes all its chapters, not just the one shown
    const ch2 = r.chapters.find((c) => c.name === 'Chapter 2')!;
    await uc.reader.progress(ch2.id, 0, 3, 1000);
    expect((await uc.library.history()).map((h) => h.chapter.name)).toEqual(['Chapter 2']);
    const removed = await uc.library.removeHistory(id);
    expect(await uc.library.history()).toEqual([]);
    await uc.library.restoreHistory(removed);
    expect((await uc.library.history()).map((h) => h.chapter.name)).toEqual(['Chapter 2']);
    await uc.library.restoreHistory(await uc.library.clearHistory());
    expect((await uc.library.history()).map((h) => h.chapter.name)).toEqual(['Chapter 2']);
    await uc.library.removeHistory(id);

    // new chapter appears on refresh
    sources.chapters = [rch('/c/3', 'Chapter 3'), ...sources.chapters];
    const r2 = await uc.catalog.refresh(id);
    expect(r2.newChapters).toBe(1);
    expect((await uc.library.view()).entries[0].unread).toBe(2);

    // downloads: reader then uses local files
    await uc.downloads.enqueue([ch1.id]);
    await uc.downloads.run();
    expect((await uc.downloads.list())[0]).toMatchObject({ state: 'done', progress: 3, total: 3 });
    expect(pageFiles.get(ch1.id)).toHaveLength(3);
    const offline = await uc.reader.open(ch1.id);
    expect(offline.pages.every((p) => p.kind === 'local')).toBe(true);
  });

  describe('downloads', () => {
    // A favorite with one chapter of `n` pages, ready to download.
    async function chapterOf(n: number) {
      const env = setup([rch('/c/1', 'Chapter 1')]);
      env.sources.pages = async () => Array.from({ length: n }, (_, i) => ({ index: i, url: '', imageUrl: `https://t.test/p${i}.jpg` }));
      await migrate(env.db);
      await env.uc.extensions.addRepo('https://repo.test');
      await env.uc.extensions.install((await env.uc.extensions.list()).available[0]);
      const { mangas } = await env.uc.catalog.popular(SRC.id, 1);
      const r = await env.uc.catalog.refresh(mangas[0].id);
      return { ...env, chapterId: r.chapters[0].id };
    }

    it('downloads pages natively with the source headers, several at a time', async () => {
      const { uc, native, pageFiles, chapterId } = await chapterOf(20);
      native.delay = 5;
      await uc.downloads.enqueue([chapterId]);
      await uc.downloads.run();
      expect((await uc.downloads.list())[0]).toMatchObject({ state: 'done', progress: 20, total: 20 });
      expect(pageFiles.get(chapterId)).toHaveLength(20);
      expect(native.requests[0]).toEqual({ url: 'https://t.test/p0.jpg', headers: { Referer: 'https://t.test/' } });
      expect(native.max).toBeGreaterThan(1);
      expect(native.max).toBeLessThanOrEqual(6);
    });

    it("falls back to the source's client when the native download fails", async () => {
      const { uc, native, pageFiles, sources, chapterId } = await chapterOf(3);
      native.fail = true;
      const fetched: number[] = [];
      sources.fetchImage = async (_s, p) => {
        fetched.push(p.index);
        return { bytes: new Uint8Array([1]), contentType: 'image/png' };
      };
      await uc.downloads.enqueue([chapterId]);
      await uc.downloads.run();
      expect((await uc.downloads.list())[0]).toMatchObject({ state: 'done', progress: 3 });
      expect(fetched.sort()).toEqual([0, 1, 2]);
      expect(pageFiles.get(chapterId)).toHaveLength(3);
    });

    it('keeps the pages already on disk when a download resumes', async () => {
      const { uc, native, pageFiles, chapterId } = await chapterOf(5);
      pageFiles.set(chapterId, [`file://${chapterId}/0`, `file://${chapterId}/1`]);
      await uc.downloads.enqueue([chapterId]);
      await uc.downloads.run();
      expect(native.requests.map((r) => r.url)).toEqual(['https://t.test/p2.jpg', 'https://t.test/p3.jpg', 'https://t.test/p4.jpg']);
      expect((await uc.downloads.list())[0]).toMatchObject({ state: 'done', progress: 5, total: 5 });
    });

    it('hands every remaining page to the system when the app goes to the background', async () => {
      const { uc, native, chapterId } = await chapterOf(30);
      native.delay = 20;
      await uc.downloads.enqueue([chapterId]);
      const done = uc.downloads.run();
      await new Promise((r) => setTimeout(r, 5));
      uc.downloads.background();
      await done;
      expect(native.max).toBeGreaterThan(6);
      expect((await uc.downloads.list())[0]).toMatchObject({ state: 'done', progress: 30 });
    });

    it('cancels the transfers of a cancelled chapter', async () => {
      const { uc, native, pageFiles, chapterId } = await chapterOf(10);
      native.delay = 50;
      await uc.downloads.enqueue([chapterId]);
      const done = uc.downloads.run();
      await new Promise((r) => setTimeout(r, 10));
      await uc.downloads.cancel(chapterId);
      await done;
      expect(native.aborted).toBeGreaterThan(0);
      expect(await uc.downloads.list()).toEqual([]);
      expect(pageFiles.get(chapterId)).toBeUndefined();
    });
  });

  it('rejects a bundle whose checksum does not match', async () => {
    const { db, uc, index } = setup([]);
    await migrate(db);
    await uc.extensions.addRepo('https://repo.test');
    index[0].sha256 = 'h:other';
    const listing = await uc.extensions.list();
    await expect(uc.extensions.install(listing.available[0])).rejects.toThrow('Checksum mismatch');
    expect((await uc.extensions.list()).installed).toEqual([]);
  });

  it('flags updates by version', async () => {
    const { db, uc, index } = setup([]);
    await migrate(db);
    await uc.extensions.addRepo('https://repo.test');
    await uc.extensions.install((await uc.extensions.list()).available[0]);
    index[0].version = '1.6.3';
    const listing = await uc.extensions.list();
    expect(listing.installed[0].update?.version).toBe('1.6.3');
    // same version, rebuilt bundle -> also an update
    index[0].version = '1.6.2';
    index[0].sha256 = 'h:rebuilt';
    expect((await uc.extensions.list()).installed[0].update?.sha256).toBe('h:rebuilt');
    void ({} as InstalledExtension);
  });
});

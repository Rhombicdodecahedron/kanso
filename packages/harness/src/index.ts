// Runs a translated bundle against the live site: popular -> details/chapters -> pages -> image.

import { loadBundle, rt } from '@kanso/source-api/src/runtime';
import { setHost } from '@kanso/source-api/src/source';
import { MemoryPrefStore } from '@kanso/source-api/src/source/preferences';
import { MemoryCookieJar, setDefaultTransport, type Transport } from '@kanso/source-api/src/okhttp';

export const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

export const fetchTransport: Transport = {
  async execute(req) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body && req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
        redirect: 'manual',
        signal: ctrl.signal,
      });
      const body = new Uint8Array(await res.arrayBuffer());
      const headers: [string, string][] = [];
      res.headers.forEach((v, k) => {
        if (k === 'set-cookie') return;
        headers.push([k, v]);
      });
      for (const c of res.headers.getSetCookie?.() ?? []) headers.push(['set-cookie', c]);
      return { url: req.url, code: res.status, message: res.statusText, headers, body };
    } finally {
      clearTimeout(timer);
    }
  },
};

const prefs = new Map<string, MemoryPrefStore>();
export function initNodeHost(log = false): void {
  setDefaultTransport(fetchTransport);
  setHost({
    transport: fetchTransport,
    cookieJar: new MemoryCookieJar(),
    userAgent: UA,
    prefs: (id) => {
      let p = prefs.get(id);
      if (!p) prefs.set(id, (p = new MemoryPrefStore()));
      return p;
    },
    log: (level, tag, msg) => {
      if (log || level === 'error') console.log(`[${level}] ${tag}: ${msg}`);
    },
  });
}

export interface StageResult {
  stage: string;
  ok: boolean;
  ms: number;
  detail: string;
}

export async function smokeTest(code: string, opts: { sourceIndex?: number; log?: boolean } = {}): Promise<StageResult[]> {
  initNodeHost(opts.log);
  const out: StageResult[] = [];
  const stage = async <T>(name: string, f: () => Promise<T>, describe: (v: T) => string): Promise<T | null> => {
    const t0 = Date.now();
    try {
      const v = await f();
      out.push({ stage: name, ok: true, ms: Date.now() - t0, detail: describe(v) });
      return v;
    } catch (e: any) {
      out.push({ stage: name, ok: false, ms: Date.now() - t0, detail: `${e?.constructor?.name ?? 'Error'}: ${e?.message ?? e}` });
      if (opts.log) console.log(e?.stack);
      return null;
    }
  };
  const bundle = await stage('load', async () => loadBundle(code), (b) => `${b.sources.length} source(s)`);
  if (!bundle) return out;
  const src = await stage('create', async () => bundle.sources[opts.sourceIndex ?? 0].create(), (s: any) => `${s.name} ${s.lang} ${s.baseUrl}`);
  if (!src) return out;
  const popular = await stage('popular', () => src.getPopularManga(1), (p: any) => `${p.mangas.length} mangas, next=${p.hasNextPage}, first=${p.mangas[0]?.title}`);
  if (!popular?.mangas?.length) return out;
  const manga = popular.mangas[0];
  const update = await stage('details', () => src.getMangaUpdate(manga, [], true, true), (u: any) => `title=${u.manga.title} status=${u.manga.status} chapters=${u.chapters.length}`);
  if (!update?.chapters?.length) return out;
  const chapter = update.chapters[0];
  const pages = await stage('pages', () => src.getPageList(chapter), (p: any[]) => `${p.length} pages, first=${p[0]?.imageUrl ?? p[0]?.url}`);
  if (!pages?.length) return out;
  const page = pages[0];
  await stage(
    'image',
    async () => {
      if (!page.imageUrl) page.imageUrl = await src.getImageUrl(page);
      const req = src.imageRequest(page);
      const res = await src.client.newCall(req).await();
      const ct = res.header('Content-Type') ?? '';
      if (!res.isSuccessful) throw new Error(`HTTP ${res.code}`);
      if (!/^image\//.test(ct) && res.body.raw.length < 1000) throw new Error(`not an image: ${ct}`);
      return `${res.code} ${ct} ${res.body.raw.length} bytes`;
    },
    (s) => s,
  );
  void rt;
  return out;
}

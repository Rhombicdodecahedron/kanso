// Runs a translated bundle against the live site: popular -> details/chapters -> pages -> image.

import { initHost, SourceRegistry } from '@kanso/source-api/src/host';
import { MemoryPrefStore } from '@kanso/source-api/src/source/preferences';
import { MemoryCookieJar, type Transport } from '@kanso/source-api/src/okhttp';

export const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

export const fetchTransport: Transport = {
  async execute(req) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body && req.method !== 'GET' && req.method !== 'HEAD' ? (req.body as unknown as BodyInit) : undefined,
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
  initHost({
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

/** Runs the same host API the app uses: popular -> details/chapters -> pages -> image. */
export async function smokeTest(code: string, opts: { sourceIndex?: number; log?: boolean; pkg?: string } = {}): Promise<StageResult[]> {
  initNodeHost(opts.log);
  const reg = new SourceRegistry();
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
  const metas = await stage('load', async () => reg.load(opts.pkg ?? 'test', code), (m) => `${m.length} source(s)`);
  if (!metas?.length) return out;
  const src = metas[Math.min(opts.sourceIndex ?? 0, metas.length - 1)];
  out.push({ stage: 'create', ok: true, ms: 0, detail: `${src.name} ${src.lang} ${src.baseUrl} id=${src.id}` });
  const popular = await stage('popular', () => reg.popular(src.id, 1), (p) => `${p.mangas.length} mangas, next=${p.hasNextPage}, first=${p.mangas[0]?.title}`);
  if (!popular?.mangas.length) return out;
  if (reg.supportsLatest(src.id)) await stage('latest', () => reg.latest(src.id, 1), (p) => `${p.mangas.length} mangas`);
  const filters = await stage('filters', () => reg.filters(src.id), (f) => `${f.length} filters`);
  const word = (popular.mangas[0].title.split(/\s+/).find((w) => w.length > 3) ?? popular.mangas[0].title).slice(0, 20);
  await stage('search', () => reg.search(src.id, 1, word, filters), (p) => `"${word}": ${p.mangas.length} results`);
  await stage('prefs', async () => reg.preferences(src.id), (p) => `${p.length} preferences`);
  const manga = popular.mangas[0];
  const update = await stage('details', () => reg.update(src.id, manga, [], true, true), (u) => `title=${u.manga.title} status=${u.manga.status} chapters=${u.chapters.length}`);
  if (!update?.chapters.length) return out;
  const pages = await stage('pages', () => reg.pages(src.id, update.chapters[0]), (p) => `${p.length} pages, first=${p[0]?.imageUrl ?? p[0]?.url}`);
  if (!pages?.length) return out;
  await stage(
    'image',
    async () => {
      const img = await reg.fetchImage(src.id, pages[0]);
      if (!/^image\//.test(img.contentType) && img.bytes.length < 1000) throw new Error(`not an image: ${img.contentType}`);
      return `${img.contentType} ${img.bytes.length} bytes`;
    },
    (s) => s,
  );
  return out;
}

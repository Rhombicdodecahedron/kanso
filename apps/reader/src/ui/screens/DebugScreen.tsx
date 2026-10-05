// Dev-only: kanso://debug?repo=<url>&pkg=<pkg> runs install -> popular -> details -> pages -> image
// through the real use cases and logs each stage (used to verify the runtime under Hermes).
// Adding &seed=<n> instead fills the library with the first n popular series and some reading
// history (used to take screenshots).
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';

import { useApp } from '@/composition/AppProvider';
import { devLog } from '@/ui/devlog';
import { Txt } from '@/ui/components/Txt';
import { colors, space } from '@/ui/theme';

export function DebugScreen() {
  const { repo, pkg, seed } = useLocalSearchParams<{ repo?: string; pkg?: string; seed?: string }>();
  const { uc } = useApp();
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (!__DEV__ || !repo || !pkg) return;
    let alive = true;
    const log = (l: string) => {
      devLog(l);
      if (alive) setLines((x) => [...x, l]);
    };
    const step = async <T,>(name: string, f: () => Promise<T>, show: (v: T) => string): Promise<T | null> => {
      const t0 = Date.now();
      try {
        const v = await f();
        log(`PASS ${name} ${Date.now() - t0}ms ${show(v)}`);
        return v;
      } catch (e) {
        log(`FAIL ${name} ${Date.now() - t0}ms ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
        return null;
      }
    };
    void (async () => {
      log(`Function constructor: ${typeof new Function('return 1') === 'function'}`);
      await step('repo', async () => (await uc.extensions.repos()).some((r) => r.url === repo) || (await uc.extensions.addRepo(repo)), () => repo);
      const listing = await step('index', () => uc.extensions.list(), (l) => `${l.available.length} available, ${l.installed.length} installed`);
      if (!listing) return;
      const ext = listing.installed.find((e) => e.pkg === pkg) ?? listing.available.find((e) => e.pkg === pkg);
      if (!ext) return log(`no extension ${pkg}`);
      if (!listing.installed.some((e) => e.pkg === pkg)) await step('install', () => uc.extensions.install(ext), (e) => `${e.name} ${e.version}`);
      const src = uc.catalog.sources(null).find((s) => ext.sources.some((x) => x.id === s.id));
      if (!src) return log('source not loaded');
      const popular = await step('popular', () => uc.catalog.popular(src.id, 1), (p) => `${p.mangas.length} mangas, first=${p.mangas[0]?.title}`);
      if (!popular?.mangas.length) return;
      if (seed) {
        const picked = popular.mangas.slice(0, Number(seed));
        for (const [i, m] of picked.entries()) {
          await step(`seed ${m.title}`, async () => {
            const r = await uc.catalog.refresh(m.id);
            await uc.catalog.setFavorite(m.id, true);
            // reading history for the first few, a few chapters in
            const ordered = [...r.chapters].sort((a, b) => b.sourceOrder - a.sourceOrder);
            if (i < 5 && ordered.length > 3) {
              const done = ordered.slice(0, 2 + i);
              await uc.catalog.setRead(done.map((c) => c.id), true);
              const reading = ordered[done.length];
              await uc.reader.progress(reading.id, 4 + i, 30, 600_000);
            }
            return r.chapters.length;
          }, (n) => `${n} chapters`);
        }
        log('DONE');
        return;
      }
      const details = await step('details', () => uc.catalog.refresh(popular.mangas[0].id), (r) => `${r.manga.title}: ${r.chapters.length} chapters`);
      if (!details?.chapters.length) return;
      // start from a clean chapter so the download path really runs
      await uc.downloads.remove(details.chapters[0].id);
      const session = await step('pages', () => uc.reader.open(details.chapters[0].id), (s) => `${s.pages.length} pages`);
      const first = session?.pages[0];
      if (!session || !first || first.kind !== 'remote') return;
      const req = await step('imageRequest', () => uc.reader.image(session.manga, first), (r) => r.url);
      if (!req) return;
      await step('image', async () => {
        const res = await fetch(req.url, { headers: req.headers });
        const buf = await res.arrayBuffer();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return `${res.headers.get('content-type')} ${buf.byteLength} bytes`;
      }, (s) => s);
      const dl = await step(
        'download',
        async () => {
          const chapterId = session.chapter.id;
          await uc.downloads.enqueue([chapterId]);
          await uc.downloads.run();
          const d = (await uc.downloads.list()).find((x) => x.chapterId === chapterId);
          if (d?.state !== 'done') throw new Error(`state=${d?.state} ${d?.error ?? ''}`);
          return d;
        },
        (d) => `${d.progress}/${d.total} pages`,
      );
      if (dl) await step('offline', () => uc.reader.open(session.chapter.id), (s) => `${s.pages.filter((p) => p.kind === 'local').length}/${s.pages.length} local pages`);
      log('DONE');
    })();
    return () => {
      alive = false;
    };
  }, [repo, pkg, seed, uc]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.sm }}>
      <Stack.Screen options={{ title: 'Debug' }} />
      {lines.map((l, i) => (
        <Txt key={i} size={13} color={l.startsWith('FAIL') ? colors.danger : l.startsWith('PASS') ? colors.success : colors.text}>{l}</Txt>
      ))}
    </ScrollView>
  );
}

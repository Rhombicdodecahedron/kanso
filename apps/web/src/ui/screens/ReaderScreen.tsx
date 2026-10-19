'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ImageRequest, Manga, ReaderMode, ReaderPage, ReaderSession } from '@kanso/core';

import { useApp } from '@/composition/AppProvider';
import { Icon } from '@/ui/components/Icon';
import { Chip, IconButton } from '@/ui/components/Shell';
import { Sheet } from '@/ui/components/Sheet';
import { ErrorState, Loading } from '@/ui/components/States';
import { useQuery } from '@/ui/hooks/useQuery';
import { MODES } from '@/ui/screens/SettingsScreen';

/** Pages of every loaded chapter, each chapter followed by its transition card. */
type Item = { kind: 'page'; seg: number; pos: number; page: ReaderPage } | { kind: 'transition'; seg: number };

/** How many pages before the end of the last loaded chapter the next one starts loading. */
const PRELOAD = 3;

export function ReaderScreen({ chapterId }: { chapterId: number }) {
  // The URL follows the chapter being read, but that must not reload this reader.
  const [opened, setOpened] = useState(chapterId);
  const { uc } = useApp();
  const load = useCallback(() => uc.reader.open(opened), [uc, opened]);
  const { data: session, error, reload } = useQuery(load);
  if (error)
    return (
      <div className="reader reader-state">
        <ErrorState message={error} onRetry={reload} />
        <Link className="btn btn-ghost" href="/history">
          Close
        </Link>
      </div>
    );
  if (!session || session.chapter.id !== opened)
    return (
      <div className="reader reader-state">
        <Loading label="Opening chapter" />
      </div>
    );
  return <Reader key={session.chapter.id} session={session} onOpenChapter={setOpened} />;
}

function Reader({ session, onOpenChapter }: { session: ReaderSession; onOpenChapter: (id: number) => void }) {
  const { uc, widget } = useApp();
  const [mode, setMode] = useState<ReaderMode>(session.mode);
  const [menu, setMenu] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [index, setIndex] = useState(session.startPage);
  const [segments, setSegments] = useState<ReaderSession[]>([session]);
  const [nextError, setNextError] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<Record<number, boolean>>({ [session.chapter.id]: session.chapter.bookmark });
  const openedAt = useRef(0);
  const position = useRef<{ index: number; frac: number } | null>(null);
  const paged = mode !== 'webtoon';

  const { items, starts } = useMemo(() => {
    const items: Item[] = [];
    const starts: number[] = [];
    segments.forEach((s, seg) => {
      starts.push(items.length);
      s.pages.forEach((page, pos) => items.push({ kind: 'page', seg, pos, page }));
      items.push({ kind: 'transition', seg });
    });
    return { items, starts };
  }, [segments]);
  const itemsRef = useRef(items);
  const segmentsRef = useRef(segments);
  useEffect(() => {
    itemsRef.current = items;
    segmentsRef.current = segments;
  }, [items, segments]);

  const at = items[Math.min(index, items.length - 1)];
  const seg = at.seg;
  const current = segments[seg];
  const total = current.pages.length;
  const page = at.kind === 'page' ? at.pos : total - 1;
  const chapterId = current.chapter.id;

  // Save progress whenever the visible page changes.
  useEffect(() => {
    if (at.kind !== 'page') return;
    const now = Date.now();
    const spent = openedAt.current ? now - openedAt.current : 0;
    openedAt.current = now;
    const offset = position.current?.index === index ? position.current.frac : index === session.startPage ? session.startOffset : 0;
    void uc.reader
      .progress(chapterId, page, total, spent, offset)
      .then(() => {
        const shown = at.page;
        return widget.seen({ chapterId, total, page, offset, image: async () => (shown.kind === 'local' ? { uri: shown.uri } : uc.reader.image(current.manga, shown).then((r) => ({ uri: r.url, headers: r.headers }))) });
      })
      .catch(() => {});
  }, [at, index, page, total, chapterId, current.manga, session.startPage, session.startOffset, uc, widget]);

  // Reaching a chapter's end card (or anything after it) finishes that chapter.
  const finished = useRef(new Set<number>());
  useEffect(() => {
    const done = segments
      .slice(0, at.kind === 'transition' ? seg + 1 : seg)
      .map((s) => s.chapter.id)
      .filter((id) => !finished.current.has(id));
    if (!done.length) return;
    done.forEach((id) => finished.current.add(id));
    void uc.catalog.setRead(done, true).catch(() => {});
  }, [at.kind, seg, segments, uc]);

  // Follow the chapter being read: the URL, the tab title and a short notice.
  const [notice, setNotice] = useState<string | null>(null);
  const shownSeg = useRef(0);
  useEffect(() => {
    document.title = `${current.chapter.name} · ${current.manga.title}`;
    if (at.kind !== 'page' || seg === shownSeg.current) return;
    shownSeg.current = seg;
    window.history.replaceState(null, '', `/reader?chapter=${chapterId}`);
    setNotice(current.chapter.name);
  }, [at.kind, seg, chapterId, current.chapter.name, current.manga.title]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  // Load the next chapter when the reader gets near the end of the last loaded one.
  const last = segments[segments.length - 1];
  const nearEnd = index >= starts[segments.length - 1] + last.pages.length - PRELOAD;
  const requested = useRef<number | null>(null);
  const loadingNext = nearEnd && !!last.next && !nextError;
  useEffect(() => {
    const id = last.next?.id;
    if (!loadingNext || !id || requested.current === id) return;
    requested.current = id;
    uc.reader
      .open(id)
      .then((s) => {
        setSegments((all) => (all.some((x) => x.chapter.id === s.chapter.id) ? all : [...all, s]));
        setBookmarks((b) => ({ ...b, [s.chapter.id]: s.chapter.bookmark }));
      })
      .catch((e) => {
        requested.current = null;
        setNextError(e instanceof Error ? e.message : String(e));
      });
  }, [loadingNext, last.next, uc]);

  const toggleBookmark = () => {
    const next = !bookmarks[chapterId];
    setBookmarks((b) => ({ ...b, [chapterId]: next }));
    void uc.catalog.setBookmark([chapterId], next).catch(() => setBookmarks((b) => ({ ...b, [chapterId]: !next })));
  };

  // ---------- webtoon: one scrolling column ----------
  const column = useRef<HTMLDivElement>(null);
  const restore = useRef<{ index: number; frac: number } | null>({ index: session.startPage, frac: session.startOffset });
  const cellOf = (i: number) => column.current?.querySelector<HTMLElement>(`[data-i="${i}"]`) ?? null;

  const scrollToItem = useCallback((i: number, frac = 0) => {
    const el = column.current?.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (el) window.scrollTo({ top: el.offsetTop + frac * el.offsetHeight, behavior: 'instant' });
  }, []);

  // Re-apply the saved position as images above it load, until the reader takes over.
  const onCellLoad = useCallback(() => {
    const r = restore.current;
    if (r && !paged) scrollToItem(r.index, r.frac);
  }, [paged, scrollToItem]);

  useEffect(() => {
    if (paged) return;
    const stop = () => (restore.current = null);
    const opts = { passive: true, once: true } as const;
    window.addEventListener('wheel', stop, opts);
    window.addEventListener('touchstart', stop, opts);
    window.addEventListener('keydown', stop, opts);
    onCellLoad();
    // Current page: the one at the top of the viewport. Its exact spot is saved when scrolling stops.
    let idle: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      const y = window.scrollY + 1;
      const cells = column.current?.querySelectorAll<HTMLElement>('[data-i]') ?? [];
      for (const el of cells) {
        if (y >= el.offsetTop && y < el.offsetTop + el.offsetHeight) {
          const i = Number(el.dataset.i);
          position.current = { index: i, frac: (y - el.offsetTop) / Math.max(1, el.offsetHeight) };
          if (!restore.current) setIndex(i);
          break;
        }
      }
      if (idle) clearTimeout(idle);
      idle = setTimeout(savePosition, 400);
    };
    const savePosition = () => {
      const p = position.current;
      const it = itemsRef.current[p?.index ?? -1];
      if (!p || it?.kind !== 'page' || restore.current) return;
      void uc.reader.position(segmentsRef.current[it.seg].chapter.id, it.pos, p.frac).catch(() => {});
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
      if (idle) clearTimeout(idle);
      savePosition();
    };
  }, [paged, uc, onCellLoad]);

  // ---------- navigation ----------
  const go = useCallback(
    (i: number) => {
      const to = Math.max(0, Math.min(itemsRef.current.length - 1, i));
      restore.current = null;
      if (paged) setIndex(to);
      else scrollToItem(to);
    },
    [paged, scrollToItem],
  );

  const goToChapter = (id: number | undefined) => {
    if (!id) return;
    const loaded = segments.findIndex((s) => s.chapter.id === id);
    if (loaded >= 0) return go(starts[loaded]);
    onOpenChapter(id);
  };

  const step = useCallback((forward: boolean) => go(index + (forward ? 1 : -1)), [go, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') return setMenu((m) => !m);
      if (e.key === 'm') return setMenu((m) => !m);
      if (!paged) return;
      const rtl = mode === 'rtl';
      const forward = e.key === ' ' || e.key === 'PageDown' || e.key === 'ArrowDown' || (e.key === 'ArrowRight' && !rtl) || (e.key === 'ArrowLeft' && rtl);
      const back = e.key === 'PageUp' || e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && !rtl) || (e.key === 'ArrowRight' && rtl);
      if (!forward && !back) return;
      e.preventDefault();
      step(forward && !(e.key === ' ' && e.shiftKey));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paged, mode, step, settingsOpen]);

  // Paged: the outer thirds turn the page, the middle shows the controls.
  const onTap = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return;
    if (!paged) return setMenu((m) => !m);
    const third = window.innerWidth / 3;
    if (e.clientX > third && e.clientX < third * 2) return setMenu((m) => !m);
    step(mode === 'rtl' ? e.clientX < third : e.clientX > third * 2);
  };

  const bookmarked = !!bookmarks[chapterId];
  const chapterButtons = [
    <IconButton key="prev" icon="prevChapter" label="Previous chapter" disabled={!current.prev} onClick={() => goToChapter(current.prev?.id)} />,
    <IconButton key="next" icon="nextChapter" label="Next chapter" disabled={!current.next} onClick={() => goToChapter(current.next?.id)} />,
  ];
  if (mode === 'rtl') chapterButtons.reverse();

  const renderItem = (it: Item, i: number) =>
    it.kind === 'transition' ? (
      <ChapterTransition session={segments[it.seg]} upNext={segments[it.seg + 1] ?? null} loading={it.seg === segments.length - 1 && loadingNext} error={it.seg === segments.length - 1 ? nextError : null} onRetry={() => setNextError(null)} />
    ) : (
      <PageImage manga={segments[it.seg].manga} page={it.page} near={Math.abs(i - index) <= (paged ? 2 : 4)} fit={paged ? 'contain' : 'width'} onLoad={paged ? undefined : onCellLoad} />
    );

  return (
    <div className={`reader ${paged ? 'reader-paged' : 'reader-webtoon'}`} data-mode={mode} onClick={onTap}>
      {paged ? (
        <div className="reader-stage">
          {items.map((it, i) =>
            Math.abs(i - index) <= 2 ? (
              <div key={keyOf(it, segments)} className="reader-slot" hidden={i !== index}>
                {renderItem(it, i)}
              </div>
            ) : null,
          )}
        </div>
      ) : (
        <div className="reader-column" ref={column}>
          {items.map((it, i) => (
            <div key={keyOf(it, segments)} data-i={i} className="reader-cell">
              {renderItem(it, i)}
            </div>
          ))}
        </div>
      )}
      {notice && !menu ? (
        <div className="reader-notice" role="status">
          Now reading {notice}
        </div>
      ) : null}
      {menu ? (
        <>
          <div className="reader-bar reader-top">
            <Link className="icon-btn" href={`/manga?id=${current.manga.id}`} aria-label="Close reader">
              <Icon name="back" />
            </Link>
            <div className="grow truncate">
              <div className="reader-title truncate">{current.manga.title}</div>
              <div className="muted small truncate">{current.chapter.name}</div>
            </div>
            <IconButton icon="bookmark" filled={bookmarked} active={bookmarked} label={bookmarked ? 'Remove bookmark' : 'Bookmark chapter'} onClick={toggleBookmark} />
            <IconButton icon="settings" label="Reading mode" onClick={() => setSettingsOpen(true)} />
          </div>
          <div className="reader-bar reader-bottom">
            {chapterButtons[0]}
            <input
              className="slider"
              type="range"
              min={0}
              max={Math.max(0, total - 1)}
              value={Math.min(page, total - 1)}
              dir={mode === 'rtl' ? 'rtl' : 'ltr'}
              aria-label="Page"
              onChange={(e) => go(starts[seg] + Number(e.target.value))}
            />
            <span className="small muted reader-count">
              {page + 1} / {total}
            </span>
            {chapterButtons[1]}
          </div>
        </>
      ) : null}
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Reading mode">
        <div className="chip-wrap">
          {MODES.map((m) => (
            <Chip
              key={m.mode}
              active={mode === m.mode}
              onClick={() => {
                restore.current = position.current ?? { index, frac: 0 };
                if (m.mode !== 'webtoon') restore.current = null;
                setMode(m.mode);
                void uc.catalog.setViewer(session.manga.id, m.mode);
              }}
            >
              {m.label}
            </Chip>
          ))}
        </div>
        <p className="faint small">Saved for this series. The default for new series is in Settings.</p>
      </Sheet>
    </div>
  );
}

const keyOf = (it: Item, segments: ReaderSession[]) => (it.kind === 'transition' ? `t${segments[it.seg].chapter.id}` : `${segments[it.seg].chapter.id}-${it.page.index}`);

/** Between two chapters: what was finished and what comes next (loaded automatically). */
function ChapterTransition({ session, upNext, loading, error, onRetry }: { session: ReaderSession; upNext: ReaderSession | null; loading: boolean; error: string | null; onRetry: () => void }) {
  const next = upNext?.chapter ?? session.next;
  return (
    <div className="transition">
      <p className="faint small">Finished</p>
      <p className="transition-name">{session.chapter.name}</p>
      <span className="transition-rule" aria-hidden="true" />
      {next ? (
        <>
          <p className="faint small">Next</p>
          <p className="transition-name">{next.name}</p>
          {error ? (
            <>
              <p className="error small">{error}</p>
              <button className="btn btn-secondary btn-small" onClick={onRetry}>
                Try again
              </button>
            </>
          ) : upNext ? (
            <p className="faint small">Keep going</p>
          ) : loading ? (
            <span className="spinner" aria-hidden="true" />
          ) : null}
        </>
      ) : (
        <>
          <p className="muted">You’re all caught up</p>
          <Link className="btn btn-ghost btn-small" href={`/manga?id=${session.manga.id}`}>
            Back to series
          </Link>
        </>
      )}
    </div>
  );
}

/** One page: resolves the image request lazily, through the image proxy; the source's own client is the fallback. */
function PageImage({ manga, page, near, fit, onLoad }: { manga: Manga; page: ReaderPage; near: boolean; fit: 'contain' | 'width'; onLoad?: () => void }) {
  const { uc, sources, imageSrc } = useApp();
  const [req, setReq] = useState<ImageRequest | null>(page.kind === 'local' ? { url: page.uri, headers: {} } : null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (page.kind !== 'remote' || req || !near) return;
    let alive = true;
    uc.reader.image(manga, page).then(
      (r) => alive && setReq(r),
      (e) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [uc, manga, page, req, near, attempt]);

  useEffect(() => () => void (fallback && URL.revokeObjectURL(fallback)), [fallback]);

  const viaSource = async () => {
    if (page.kind !== 'remote') return setError('The downloaded page could not be read.');
    try {
      const img = await sources.fetchImage(manga.sourceId, { index: page.index, url: page.url, imageUrl: page.imageUrl });
      setFallback(URL.createObjectURL(new Blob([img.bytes as unknown as BlobPart], { type: img.contentType })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error)
    return (
      <div className="page page-error">
        <p className="muted">Page {page.index + 1} did not load</p>
        <p className="faint small">{error}</p>
        <button
          className="btn btn-secondary btn-small"
          onClick={() => {
            setError(null);
            setFallback(null);
            setReq(page.kind === 'local' ? req : null);
            setAttempt((a) => a + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  const src = fallback ?? (req ? imageSrc(req) : null);
  if (!src)
    return (
      <div className="page page-wait">
        <span className="spinner" aria-hidden="true" />
      </div>
    );
  return <img className={`page page-${fit}`} src={src} alt={`Page ${page.index + 1}`} decoding="async" onLoad={onLoad} onError={() => (fallback ? setError('The image could not be shown.') : void viaSource())} draggable={false} />;
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Category, Chapter, Download, Manga } from '@kanso/core';

import { useApp } from '@/composition/AppProvider';
import { useFeedback } from '@/ui/components/Feedback';
import { Icon } from '@/ui/components/Icon';
import { IconButton } from '@/ui/components/Shell';
import { Sheet } from '@/ui/components/Sheet';
import { ErrorState, Loading } from '@/ui/components/States';
import { formatDate, statusLabel } from '@/ui/format';
import { useQuery } from '@/ui/hooks/useQuery';

export function MangaScreen({ id }: { id: number }) {
  const { uc, coverSrc } = useApp();
  const { confirm } = useFeedback();
  const router = useRouter();
  // First visit (never fetched): load details and chapters from the source as part of loading.
  const load = useCallback(async () => {
    const local = await uc.catalog.manga(id);
    if (local.manga.initialized && local.chapters.length) return { ...local, fetchError: null as string | null };
    try {
      const r = await uc.catalog.refresh(id);
      return { manga: r.manga, chapters: r.chapters, fetchError: null as string | null };
    } catch (e) {
      return { ...local, fetchError: e instanceof Error ? e.message : String(e) };
    }
  }, [uc, id]);
  const { data, error, reload, setData } = useQuery(load);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [descending, setDescending] = useState(true);
  const downloads = useDownloads(id);

  const chapters = useMemo(() => {
    const list = [...(data?.chapters ?? [])].sort((a, b) => a.sourceOrder - b.sourceOrder);
    return descending ? list : list.reverse();
  }, [data, descending]);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const { manga } = data;
  const source = uc.catalog.sources(null).find((s) => s.id === manga.sourceId);
  const nextToRead = [...data.chapters].sort((a, b) => b.sourceOrder - a.sourceOrder).find((c) => !c.read);
  const started = data.chapters.some((c) => c.read || c.lastPageRead > 0);
  const webUrl = uc.catalog.webUrl(manga);
  const cover = coverSrc(manga.sourceId, manga.thumbnailUrl);
  const fetchError = refreshError ?? data.fetchError;

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const r = await uc.catalog.refresh(id);
      setData({ manga: r.manga, chapters: r.chapters, fetchError: null });
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const toggleFavorite = async () => {
    const m = await uc.catalog.setFavorite(manga.id, !manga.favorite);
    setData({ ...data, manga: m });
    if (m.favorite && (await uc.library.categories()).length) setCatsOpen(true);
  };

  const toggle = (cid: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  const endSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const act = async (f: (ids: number[]) => Promise<unknown>) => {
    await f([...selected]);
    endSelection();
    await reload();
  };
  const unreadToDownload = [...data.chapters].sort((a, b) => b.sourceOrder - a.sourceOrder).filter((c) => !c.read && downloads.get(c.id)?.state !== 'done');

  return (
    <article className="manga">
      <header className="manga-head">
        <div className="manga-cover">{cover ? <img src={cover} alt="" /> : null}</div>
        <div className="manga-meta">
          <h1 className="manga-title">{manga.title}</h1>
          {manga.author ? (
            <p className="muted">
              {manga.author}
              {manga.artist && manga.artist !== manga.author ? `, ${manga.artist}` : ''}
            </p>
          ) : null}
          <p className="faint small">
            {statusLabel(manga.status)} on {source?.name ?? 'a source that is not installed'}
          </p>
          <div className="manga-actions">
            {nextToRead ? (
              <Link className="btn btn-primary" href={`/reader?chapter=${nextToRead.id}`}>
                {started ? 'Resume' : 'Start reading'}
              </Link>
            ) : null}
            <button className={`btn ${manga.favorite ? 'btn-secondary' : nextToRead ? 'btn-ghost' : 'btn-primary'}`} onClick={toggleFavorite}>
              {manga.favorite ? 'In library' : 'Add to library'}
            </button>
            {manga.favorite ? (
              <button className="btn btn-ghost" onClick={() => setCatsOpen(true)}>
                Categories
              </button>
            ) : null}
            {webUrl ? (
              <a className="icon-btn" href={webUrl} target="_blank" rel="noreferrer noopener" aria-label="Open on the source's website" title="Open on the source's website">
                <Icon name="web" />
              </a>
            ) : null}
          </div>
        </div>
      </header>
      {manga.description ? (
        <p className={`manga-desc ${expanded ? '' : 'clamped'}`} onClick={() => setExpanded((e) => !e)}>
          {manga.description}
        </p>
      ) : null}
      {manga.genres.length ? (
        <ul className="tags">
          {manga.genres.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      ) : null}
      {fetchError ? <p className="error small">{fetchError}</p> : null}

      <section className="chapters">
        <div className="chapters-head">
          <h2>{selecting ? `${selected.size} selected` : `${data.chapters.length} ${data.chapters.length === 1 ? 'chapter' : 'chapters'}`}</h2>
          <div className="page-actions">
            {selecting ? (
              <button className="btn btn-ghost btn-small" onClick={endSelection}>
                Done
              </button>
            ) : (
              <>
                {unreadToDownload.length ? (
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={async () => {
                      const n = unreadToDownload.length;
                      if (await confirm({ title: `Download ${n} unread chapter${n > 1 ? 's' : ''}?`, body: 'They are kept in this browser for reading offline. Keep the tab open while they download.', confirm: 'Download' }))
                        void uc.downloads.enqueue(unreadToDownload.map((c) => c.id));
                    }}
                  >
                    Download unread
                  </button>
                ) : null}
                <button className="btn btn-ghost btn-small" onClick={() => setSelecting(true)}>
                  Select
                </button>
                <IconButton icon="refresh" label="Check for new chapters" onClick={refresh} disabled={refreshing} />
                <IconButton icon="sort" label={descending ? 'Newest first' : 'Oldest first'} onClick={() => setDescending((d) => !d)} />
              </>
            )}
          </div>
        </div>
        {refreshing && !data.chapters.length ? (
          <Loading />
        ) : !chapters.length ? (
          <p className="muted state">No chapters</p>
        ) : (
          <ul className="chapter-list">
            {chapters.map((c) => (
              <ChapterRow
                key={c.id}
                chapter={c}
                download={downloads.get(c.id)}
                selecting={selecting}
                selected={selected.has(c.id)}
                onOpen={() => (selecting ? toggle(c.id) : router.push(`/reader?chapter=${c.id}`))}
                onSelect={() => {
                  setSelecting(true);
                  toggle(c.id);
                }}
                onDownload={() => void uc.downloads.enqueue([c.id])}
              />
            ))}
          </ul>
        )}
      </section>

      {selecting && selected.size ? (
        <div className="action-bar">
          {(() => {
            const chosen = data.chapters.filter((c) => selected.has(c.id));
            const allRead = chosen.every((c) => c.read);
            const marked = chosen.every((c) => c.bookmark);
            return (
              <>
                <button className="btn btn-ghost" onClick={() => act((ids) => uc.catalog.setRead(ids, !allRead))}>
                  {allRead ? 'Mark unread' : 'Mark read'}
                </button>
                <button className="btn btn-ghost" onClick={() => act((ids) => uc.catalog.setBookmark(ids, !marked))}>
                  {marked ? 'Remove bookmark' : 'Bookmark'}
                </button>
                {selected.size === 1 ? (
                  <button className="btn btn-ghost" onClick={() => act((ids) => uc.catalog.markPreviousRead(ids[0]))}>
                    Mark earlier read
                  </button>
                ) : null}
                <button className="btn btn-ghost" onClick={() => act((ids) => uc.downloads.enqueue(ids))}>
                  Download
                </button>
                <button
                  className="btn btn-danger-ghost"
                  onClick={async () => {
                    if (await confirm({ title: 'Delete downloaded pages?', body: 'The chapters stay in the list; only the offline copies go.', confirm: 'Delete', danger: true }))
                      void act((ids) => Promise.all(ids.map((i) => uc.downloads.remove(i))));
                  }}
                >
                  Delete download
                </button>
              </>
            );
          })()}
        </div>
      ) : null}
      <CategoriesSheet manga={manga} open={catsOpen} onClose={() => setCatsOpen(false)} />
    </article>
  );
}

function ChapterRow({ chapter, download, selecting, selected, onOpen, onSelect, onDownload }: { chapter: Chapter; download?: Download; selecting: boolean; selected: boolean; onOpen: () => void; onSelect: () => void; onDownload: () => void }) {
  const state = download?.state;
  const meta = [chapter.dateUpload ? formatDate(chapter.dateUpload) : null, chapter.scanlator, !chapter.read && chapter.lastPageRead > 0 ? `Page ${chapter.lastPageRead + 1}` : null, state === 'error' ? `Download failed: ${download?.error}` : null].filter(Boolean);
  return (
    <li className="chapter" data-read={chapter.read} data-selected={selected}>
      <button
        className="chapter-main"
        onClick={onOpen}
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect();
        }}
      >
        {selecting ? <span className="check-box" data-on={selected} aria-hidden="true">{selected ? <Icon name="check" size={14} /> : null}</span> : null}
        <span className="chapter-text">
          <span className="chapter-name">
            {chapter.bookmark ? <Icon name="bookmark" size={14} filled className="accent" /> : null}
            {chapter.name}
          </span>
          {meta.length ? <span className="faint small">{meta.join(', ')}</span> : null}
        </span>
      </button>
      <button className="icon-btn" aria-label={state === 'done' ? 'Downloaded' : state === 'downloading' ? 'Downloading' : state === 'queued' ? 'Waiting to download' : 'Download chapter'} disabled={state === 'done' || state === 'queued' || state === 'downloading'} onClick={onDownload}>
        {state === 'downloading' ? (
          <span className="small muted">{download!.total ? `${download!.progress}/${download!.total}` : '…'}</span>
        ) : (
          <Icon name={state === 'queued' ? 'queued' : state === 'done' ? 'done' : state === 'error' ? 'failed' : 'downloads'} className={state === 'done' ? 'accent' : state === 'error' ? 'danger' : undefined} />
        )}
      </button>
    </li>
  );
}

function useDownloads(mangaId: number): Map<number, Download> {
  const { uc } = useApp();
  const [map, setMap] = useState(new Map<number, Download>());
  useEffect(() => {
    let alive = true;
    void uc.downloads.list().then((l) => alive && setMap(new Map(l.filter((d) => d.mangaId === mangaId).map((d) => [d.chapterId, d]))));
    const off = uc.downloads.subscribe((d) => {
      if (d.mangaId === mangaId) setMap((m) => new Map(m).set(d.chapterId, d));
    });
    return () => {
      alive = false;
      off();
    };
  }, [uc, mangaId]);
  return map;
}

function CategoriesSheet({ manga, open, onClose }: { manga: Manga; open: boolean; onClose: () => void }) {
  const { uc } = useApp();
  const [cats, setCats] = useState<Category[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!open) return;
    void (async () => {
      setCats(await uc.library.categories());
      setChosen(new Set(await uc.library.categoriesOf(manga.id)));
    })();
  }, [open, uc, manga.id]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Categories"
      footer={
        <button
          className="btn btn-primary"
          onClick={async () => {
            await uc.library.setCategories(manga.id, [...chosen]);
            onClose();
          }}
        >
          Save
        </button>
      }
    >
      {!cats.length ? <p className="muted">No categories yet. Create them from the library.</p> : null}
      {cats.map((c) => (
        <label key={c.id} className="check">
          <input
            type="checkbox"
            checked={chosen.has(c.id)}
            onChange={() =>
              setChosen((s) => {
                const next = new Set(s);
                if (next.has(c.id)) next.delete(c.id);
                else next.add(c.id);
                return next;
              })
            }
          />
          <span>{c.name}</span>
        </label>
      ))}
    </Sheet>
  );
}

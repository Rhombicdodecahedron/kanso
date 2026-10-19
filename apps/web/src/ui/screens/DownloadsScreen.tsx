'use client';

import Link from 'next/link';
import { useCallback, useEffect } from 'react';

import type { Chapter, Download, Manga } from '@kanso/core';

import { useApp } from '@/composition/AppProvider';
import { useFeedback } from '@/ui/components/Feedback';
import { PageHeader } from '@/ui/components/Shell';
import { Empty, Loading } from '@/ui/components/States';
import { useQuery } from '@/ui/hooks/useQuery';

interface Item {
  d: Download;
  chapter: Chapter | null;
  manga: Manga | null;
}

export function DownloadsScreen() {
  const { uc } = useApp();
  const { confirm } = useFeedback();
  const load = useCallback(async () => {
    const out: Item[] = [];
    for (const d of await uc.downloads.list()) {
      const m = await uc.catalog.manga(d.mangaId).catch(() => null);
      out.push({ d, manga: m?.manga ?? null, chapter: m?.chapters.find((c) => c.id === d.chapterId) ?? null });
    }
    return out;
  }, [uc]);
  const { data, reload } = useQuery(load);
  useEffect(() => uc.downloads.subscribe(() => void reload()), [uc, reload]);
  if (!data) return <Loading />;
  const rows = [...data.filter((r) => r.d.state !== 'done'), ...data.filter((r) => r.d.state === 'done')];
  const done = data.filter((r) => r.d.state === 'done');

  return (
    <>
      <PageHeader
        title="Downloads"
        actions={
          done.length ? (
            <button
              className="btn btn-ghost btn-small"
              onClick={async () => {
                if (await confirm({ title: `Delete ${done.length} downloaded chapter${done.length > 1 ? 's' : ''}?`, body: 'This frees the space they take in this browser.', confirm: 'Delete all', danger: true })) {
                  await Promise.all(done.map((r) => uc.downloads.remove(r.d.chapterId)));
                  await reload();
                }
              }}
            >
              Delete all
            </button>
          ) : null
        }
      >
        <p className="muted small">Downloads continue while this tab stays open.</p>
      </PageHeader>
      {!rows.length ? (
        <Empty title="No downloads" body="Choose Select on a series page, or Download unread, to read chapters offline." />
      ) : (
        <ul className="list padded">
          {rows.map((r) => (
            <li key={r.d.chapterId} className="list-row">
              <span className="grow">
                <Link className="list-title" href={r.manga ? `/manga?id=${r.manga.id}` : '/downloads'}>
                  {r.manga?.title ?? 'Unknown series'}
                </Link>
                <span className="muted small">{r.chapter?.name ?? `Chapter ${r.d.chapterId}`}</span>
                <span className={`small ${r.d.state === 'error' ? 'error' : 'faint'}`}>
                  {r.d.state === 'downloading' ? `${r.d.progress} of ${r.d.total || '?'} pages` : r.d.state === 'error' ? r.d.error : r.d.state === 'done' ? `${r.d.total} pages` : 'Waiting'}
                </span>
              </span>
              {r.d.state === 'error' ? (
                <button className="btn btn-secondary btn-small" onClick={() => uc.downloads.retry(r.d.chapterId)}>
                  Retry
                </button>
              ) : null}
              {r.d.state === 'done' ? (
                <>
                  <Link className="btn btn-secondary btn-small" href={`/reader?chapter=${r.d.chapterId}`}>
                    Read
                  </Link>
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={async () => {
                      await uc.downloads.remove(r.d.chapterId);
                      await reload();
                    }}
                  >
                    Delete
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-ghost btn-small"
                  onClick={async () => {
                    await uc.downloads.cancel(r.d.chapterId);
                    await reload();
                  }}
                >
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

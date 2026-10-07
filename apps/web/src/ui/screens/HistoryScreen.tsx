'use client';

import Link from 'next/link';
import { useCallback } from 'react';

import type { HistoryEntry } from '@kanso/core';

import { useApp } from '@/composition/AppProvider';
import { useFeedback } from '@/ui/components/Feedback';
import { IconButton, PageHeader } from '@/ui/components/Shell';
import { Empty, ErrorState, Loading } from '@/ui/components/States';
import { formatRelativeTime } from '@/ui/format';
import { useQuery } from '@/ui/hooks/useQuery';

export function HistoryScreen() {
  const { uc, coverSrc } = useApp();
  const { confirm, toast } = useFeedback();
  const load = useCallback(() => uc.library.history(), [uc]);
  const { data, error, reload, act } = useQuery(load);
  // Removing shows what was removed, with a way to put it back.
  const removeWithUndo = (text: string, remove: () => Promise<HistoryEntry[]>) =>
    act(async () => {
      const removed = await remove();
      toast({ text, action: { label: 'Undo', onClick: () => void act(() => uc.library.restoreHistory(removed)) } });
    });

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageHeader
        title="History"
        actions={
          data.length ? (
            <IconButton
              icon="trash"
              label="Clear history"
              onClick={async () => {
                if (await confirm({ title: 'Clear all history?', body: 'Reading progress on each chapter is kept.', confirm: 'Clear history', danger: true })) void removeWithUndo('History cleared', () => uc.library.clearHistory());
              }}
            />
          ) : null
        }
      />
      {!data.length ? (
        <Empty title="Nothing read yet" body="Chapters you open show up here, so you can pick up where you stopped." />
      ) : (
        <ul className="history">
          {data.map((item) => {
            const src = coverSrc(item.manga.sourceId, item.manga.thumbnailUrl);
            const page = !item.chapter.read && item.chapter.lastPageRead > 0 ? `, page ${item.chapter.lastPageRead + 1}` : '';
            return (
              <li key={item.entry.chapterId} className="history-row">
                <Link href={`/manga?id=${item.manga.id}`} className="history-cover" aria-label={item.manga.title}>
                  {src ? <img src={src} alt="" loading="lazy" /> : null}
                </Link>
                <Link href={`/reader?chapter=${item.chapter.id}`} className="history-text">
                  <span className="history-title">{item.manga.title}</span>
                  <span className="muted">
                    {item.chapter.name}
                    {page}
                  </span>
                  <span className="faint small">{formatRelativeTime(item.entry.lastRead)}</span>
                </Link>
                <IconButton icon="close" label={`Remove ${item.manga.title} from history`} onClick={() => removeWithUndo(`Removed ${item.manga.title} from history`, () => uc.library.removeHistory(item.manga.id))} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

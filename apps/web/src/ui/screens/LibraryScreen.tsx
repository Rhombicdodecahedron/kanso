'use client';

import { useCallback, useMemo, useState } from 'react';

import { filterAndSort, type LibrarySort } from '@kanso/core';

import { useApp } from '@/composition/AppProvider';
import { Cover, CoverGrid } from '@/ui/components/Cover';
import { useFeedback } from '@/ui/components/Feedback';
import { Chip, IconButton, PageHeader } from '@/ui/components/Shell';
import { Sheet } from '@/ui/components/Sheet';
import { Empty, ErrorState, Loading } from '@/ui/components/States';
import { useQuery } from '@/ui/hooks/useQuery';

const SORTS: { key: LibrarySort; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'lastRead', label: 'Last read' },
  { key: 'lastUpdate', label: 'Latest chapter' },
  { key: 'unread', label: 'Unread' },
  { key: 'dateAdded', label: 'Date added' },
];

export function LibraryScreen() {
  const { uc, sources, coverSrc } = useApp();
  const { toast } = useFeedback();
  const load = useCallback(async () => ({ view: await uc.library.view(), lastRead: await uc.library.lastReadByManga() }), [uc]);
  const { data, error, reload } = useQuery(load);
  const [category, setCategory] = useState<number | null | -1>(-1);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState<LibrarySort>('title');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  const entries = useMemo(() => (data ? filterAndSort(data.view.entries, { categoryId: category, unreadOnly, query, sort, lastRead: data.lastRead }) : []), [data, category, unreadOnly, query, sort]);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const uncategorised = data.view.entries.some((e) => !e.categoryIds.length);

  const updateLibrary = async () => {
    let n = 0;
    const list = entries.filter((e) => sources.has(e.manga.sourceId));
    for (const [i, e] of list.entries()) {
      setUpdating(`Checking ${i + 1} of ${list.length}`);
      try {
        n += (await uc.catalog.refresh(e.manga.id, { details: false, chapters: true })).newChapters;
      } catch {
        // one broken source must not stop the update
      }
    }
    setUpdating(null);
    await reload();
    toast({ text: n ? `${n} new chapter${n > 1 ? 's' : ''}` : 'No new chapters' });
  };

  return (
    <>
      <PageHeader
        title="Library"
        actions={
          <>
            {updating ? <span className="muted small">{updating}</span> : <IconButton icon="refresh" label="Check for new chapters" onClick={updateLibrary} />}
            <IconButton icon="search" label="Search library" active={searching} onClick={() => setSearching((s) => !s)} />
            <IconButton icon="sliders" label="Sort and filter" onClick={() => setOptionsOpen(true)} />
          </>
        }
      >
        {searching ? <input className="field" placeholder="Search by title or author" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus /> : null}
        <div className="chip-row">
          <Chip active={category === -1} onClick={() => setCategory(-1)}>
            All
          </Chip>
          {uncategorised && data.view.categories.length ? (
            <Chip active={category === null} onClick={() => setCategory(null)}>
              Default
            </Chip>
          ) : null}
          {data.view.categories.map((c) => (
            <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
              {c.name}
            </Chip>
          ))}
          <Chip onClick={() => setCatsOpen(true)}>Edit categories</Chip>
        </div>
      </PageHeader>
      {!data.view.entries.length ? (
        <Empty title="Your library is empty" body="Find series in Browse and add them to your library." action={{ label: 'Browse', href: '/browse' }} />
      ) : !entries.length ? (
        <Empty title="Nothing matches" body="Try another category or clear the search." />
      ) : (
        <CoverGrid>
          {entries.map((e) => (
            <Cover key={e.manga.id} href={`/manga?id=${e.manga.id}`} title={e.manga.title} src={coverSrc(e.manga.sourceId, e.manga.thumbnailUrl)} badge={e.unread} />
          ))}
        </CoverGrid>
      )}
      <Sheet open={optionsOpen} onClose={() => setOptionsOpen(false)} title="Sort and filter">
        <h3 className="group-title">Sort by</h3>
        <div className="chip-wrap">
          {SORTS.map((s) => (
            <Chip key={s.key} active={sort === s.key} onClick={() => setSort(s.key)}>
              {s.label}
            </Chip>
          ))}
        </div>
        <h3 className="group-title">Show</h3>
        <Chip active={unreadOnly} onClick={() => setUnreadOnly((u) => !u)}>
          Unread only
        </Chip>
      </Sheet>
      <CategoryEditor open={catsOpen} onClose={() => setCatsOpen(false)} onChanged={reload} />
    </>
  );
}

function CategoryEditor({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const { uc } = useApp();
  const load = useCallback(() => uc.library.categories(), [uc]);
  const { data, reload } = useQuery(load);
  const [name, setName] = useState('');
  const changed = async () => {
    await reload();
    onChanged();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Categories">
      <ul className="list">
        {(data ?? []).map((c, i, all) => (
          <li key={c.id} className="list-row">
            <span className="grow">{c.name}</span>
            <IconButton
              icon="up"
              label={`Move ${c.name} up`}
              disabled={i === 0}
              onClick={async () => {
                const ids = all.map((x) => x.id);
                [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                await uc.library.reorderCategories(ids);
                await changed();
              }}
            />
            <button
              className="btn btn-small btn-danger-ghost"
              onClick={async () => {
                await uc.library.removeCategory(c.id);
                await changed();
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          await uc.library.createCategory(name);
          setName('');
          await changed();
        }}
      >
        <input className="field" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-secondary" disabled={!name.trim()}>
          Add
        </button>
      </form>
    </Sheet>
  );
}

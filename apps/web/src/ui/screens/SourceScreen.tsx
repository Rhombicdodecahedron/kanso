'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import type { BrowsePage, FilterState, Manga } from '@kanso/core';

import { useApp } from '@/composition/AppProvider';
import { Cover, CoverGrid } from '@/ui/components/Cover';
import { Icon } from '@/ui/components/Icon';
import { Chip, PageHeader } from '@/ui/components/Shell';
import { Sheet } from '@/ui/components/Sheet';
import { Empty, ErrorState, Loading } from '@/ui/components/States';
import { usePaged } from '@/ui/hooks/usePaged';

type Mode = { kind: 'popular' } | { kind: 'latest' } | { kind: 'search'; query: string; filters: FilterState[] | null };

export function SourceScreen({ id }: { id: string }) {
  const { uc, coverSrc } = useApp();
  const source = uc.catalog.sources(null).find((s) => s.id === id);
  const [mode, setMode] = useState<Mode>({ kind: 'popular' });
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState[] | null>(null);

  const fetchPage = async (p: number) => {
    const res: BrowsePage = mode.kind === 'popular' ? await uc.catalog.popular(id, p) : mode.kind === 'latest' ? await uc.catalog.latest(id, p) : await uc.catalog.search(id, p, mode.query, mode.filters);
    return { items: res.mangas, hasNext: res.hasNextPage };
  };
  const list = usePaged<Manga>(JSON.stringify(mode), fetchPage);

  // Load the next page as the end of the grid comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  const loadMore = useRef(list.loadMore);
  useEffect(() => {
    loadMore.current = list.loadMore;
  });
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && loadMore.current(), { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list.items.length]);

  if (!source) return <ErrorState message="This source is not installed. Install its extension from Browse." />;
  const submitSearch = (q = query, f = filters) => setMode({ kind: 'search', query: q, filters: f });

  return (
    <>
      <PageHeader
        title={source.name}
        actions={
          <Link className="icon-btn" href={`/source-settings?id=${id}`} aria-label="Source settings" title="Source settings">
            <Icon name="settings" />
          </Link>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch();
          }}
        >
          <input className="field" type="search" placeholder={`Search ${source.name}`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </form>
        <div className="chip-row">
          <Chip active={mode.kind === 'popular'} onClick={() => setMode({ kind: 'popular' })}>
            Popular
          </Chip>
          {uc.catalog.supportsLatest(id) ? (
            <Chip active={mode.kind === 'latest'} onClick={() => setMode({ kind: 'latest' })}>
              Latest
            </Chip>
          ) : null}
          <Chip active={mode.kind === 'search' && !!filters} onClick={() => setFiltersOpen(true)}>
            {filters ? 'Filters on' : 'Filters'}
          </Chip>
        </div>
      </PageHeader>
      {list.error && !list.items.length ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : !list.items.length && list.loading ? (
        <Loading />
      ) : !list.items.length ? (
        <Empty title="No results" body={mode.kind === 'search' ? 'Try fewer words or other filters.' : undefined} />
      ) : (
        <>
          <CoverGrid>
            {list.items.map((m) => (
              <Cover key={m.id} href={`/manga?id=${m.id}`} title={m.title} src={coverSrc(m.sourceId, m.thumbnailUrl)} inLibrary={m.favorite} />
            ))}
          </CoverGrid>
          <div ref={sentinel} className="list-foot">
            {list.loading ? (
              <Loading />
            ) : list.error ? (
              <button
                className="btn btn-secondary"
                onClick={() => {
                  list.retry();
                  list.loadMore();
                }}
              >
                Load more
              </button>
            ) : null}
          </div>
        </>
      )}
      <FilterSheet
        sourceId={id}
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        onApply={(f) => {
          setFilters(f);
          setFiltersOpen(false);
          submitSearch(query, f);
        }}
      />
    </>
  );
}

function FilterSheet({ sourceId, open, onClose, onApply }: { sourceId: string; open: boolean; onClose: () => void; onApply: (f: FilterState[] | null) => void }) {
  const { uc } = useApp();
  const [state, setState] = useState<FilterState[] | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!open || state) return;
    let alive = true;
    uc.catalog.filters(sourceId).then(
      (f) => alive && setState(f),
      () => alive && setState([]),
    );
    return () => {
      alive = false;
    };
  }, [open, state, uc, sourceId, nonce]);

  const update = (path: number[], value: unknown) =>
    setState((prev) => {
      if (!prev) return prev;
      const next: FilterState[] = structuredClone(prev);
      let list = next;
      let f: FilterState = list[path[0]];
      for (const i of path.slice(1)) {
        list = f.children!;
        f = list[i];
      }
      f.state = value;
      return next;
    });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setState(null);
              setNonce((n) => n + 1);
            }}
          >
            Reset
          </button>
          <button className="btn btn-primary" onClick={() => onApply(state)}>
            Search
          </button>
        </>
      }
    >
      {!state ? <Loading /> : !state.length ? <p className="muted">This source has no filters.</p> : state.map((f, i) => <FilterRow key={i} f={f} path={[i]} onChange={update} />)}
    </Sheet>
  );
}

const TRI_LABEL = ['Any', 'Include', 'Exclude'];

function FilterRow({ f, path, onChange }: { f: FilterState; path: number[]; onChange: (p: number[], v: unknown) => void }) {
  switch (f.kind) {
    case 'header':
      return <h3 className="group-title">{f.name}</h3>;
    case 'separator':
      return <hr className="rule" />;
    case 'text':
      return (
        <label className="pref">
          <span className="muted small">{f.name}</span>
          <input className="field" value={String(f.state ?? '')} onChange={(e) => onChange(path, e.target.value)} />
        </label>
      );
    case 'checkbox':
      return (
        <label className="check">
          <input type="checkbox" checked={!!f.state} onChange={(e) => onChange(path, e.target.checked)} />
          <span>{f.name}</span>
        </label>
      );
    case 'tristate': {
      const s = (f.state as number) ?? 0;
      return (
        <button type="button" className="tri" data-state={s} onClick={() => onChange(path, (s + 1) % 3)} aria-label={`${f.name}: ${TRI_LABEL[s]}`}>
          <span className="tri-box" aria-hidden="true">
            {s === 1 ? '+' : s === 2 ? '−' : ''}
          </span>
          <span>{f.name}</span>
        </button>
      );
    }
    case 'select':
      return (
        <label className="pref">
          <span className="muted small">{f.name}</span>
          <select className="field" value={Number(f.state ?? 0)} onChange={(e) => onChange(path, Number(e.target.value))}>
            {(f.values ?? []).map((v, i) => (
              <option key={i} value={i}>
                {v}
              </option>
            ))}
          </select>
        </label>
      );
    case 'sort': {
      const st = f.state as { index: number; ascending: boolean } | null;
      return (
        <div className="pref">
          <span className="muted small">{f.name}</span>
          <div className="chip-wrap">
            {(f.values ?? []).map((v, i) => (
              <Chip key={i} active={st?.index === i} onClick={() => onChange(path, { index: i, ascending: st?.index === i ? !st.ascending : false })}>
                {st?.index === i ? `${v} ${st.ascending ? '↑' : '↓'}` : v}
              </Chip>
            ))}
          </div>
        </div>
      );
    }
    case 'group':
      return (
        <fieldset className="group">
          <legend className="group-title">{f.name}</legend>
          {(f.children ?? []).map((c, i) => (
            <FilterRow key={i} f={c} path={[...path, i]} onChange={onChange} />
          ))}
        </fieldset>
      );
    default:
      return null;
  }
}

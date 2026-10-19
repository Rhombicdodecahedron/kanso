'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import type { AvailableExtension } from '@kanso/core';

import { useApp } from '@/composition/AppProvider';
import { useFeedback } from '@/ui/components/Feedback';
import { Chip, PageHeader } from '@/ui/components/Shell';
import { Sheet } from '@/ui/components/Sheet';
import { Empty, ErrorState, Loading } from '@/ui/components/States';
import { useQuery } from '@/ui/hooks/useQuery';
import { languageName } from '@/ui/lang';

export function BrowseScreen() {
  const [tab, setTab] = useState<'sources' | 'extensions'>('sources');
  return (
    <>
      <PageHeader title="Browse">
        <div className="chip-row">
          <Chip active={tab === 'sources'} onClick={() => setTab('sources')}>
            Sources
          </Chip>
          <Chip active={tab === 'extensions'} onClick={() => setTab('extensions')}>
            Extensions
          </Chip>
        </div>
      </PageHeader>
      {tab === 'sources' ? <SourcesTab onGoToExtensions={() => setTab('extensions')} /> : <ExtensionsTab />}
    </>
  );
}

function SourcesTab({ onGoToExtensions }: { onGoToExtensions: () => void }) {
  const { uc } = useApp();
  const load = useCallback(async () => ({ sources: uc.catalog.sources(null), langs: (await uc.settings.get()).languages }), [uc]);
  const { data } = useQuery(load);
  const [query, setQuery] = useState('');
  const sections = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const groups = new Map<string, typeof data.sources>();
    for (const s of data.sources) {
      if (q && !s.name.toLowerCase().includes(q)) continue;
      groups.set(s.lang, [...(groups.get(s.lang) ?? []), s]);
    }
    const order = (l: string) => (data.langs.includes(l) ? 0 : l === 'all' ? 1 : 2);
    return [...groups.entries()]
      .sort((a, b) => order(a[0]) - order(b[0]) || languageName(a[0]).localeCompare(languageName(b[0])))
      .map(([lang, list]) => ({ title: languageName(lang), list: list.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [data, query]);
  if (!data) return <Loading />;
  if (!data.sources.length) return <Empty title="No sources yet" body="Install an extension to start browsing its site." action={{ label: 'Get extensions', onClick: onGoToExtensions }} />;
  return (
    <div className="section-list">
      <input className="field" placeholder="Search sources" value={query} onChange={(e) => setQuery(e.target.value)} />
      {sections.map((s) => (
        <section key={s.title}>
          <h2 className="group-title">{s.title}</h2>
          <ul className="list">
            {s.list.map((src) => (
              <li key={src.id}>
                <Link href={`/source?id=${src.id}`} className="list-link">
                  <span className="list-title">{src.name}</span>
                  <span className="faint small">{src.baseUrl.replace(/^https?:\/\//, '')}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ExtensionsTab() {
  const { uc } = useApp();
  const { confirm, toast } = useFeedback();
  const load = useCallback(async () => ({ listing: await uc.extensions.list(), repos: await uc.extensions.repos(), settings: await uc.settings.get() }), [uc]);
  const { data, error, reload } = useQuery(load);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [reposOpen, setReposOpen] = useState(false);

  const run = async (pkg: string, f: () => Promise<unknown>, done: string) => {
    setBusy(pkg);
    try {
      await f();
      await reload();
      toast({ text: done });
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const repos = <ReposSheet open={reposOpen} onClose={() => setReposOpen(false)} onChanged={reload} />;
  if (!data.repos.length)
    return (
      <>
        <Empty title="No extension repositories" body="Add a repository URL to see the extensions it offers." action={{ label: 'Add repository', onClick: () => setReposOpen(true) }} />
        {repos}
      </>
    );
  const { listing, settings } = data;
  const q = query.trim().toLowerCase();
  const visible = (e: AvailableExtension) => (settings.showNsfw || !e.nsfw) && (!q || e.name.toLowerCase().includes(q)) && (settings.languages.includes(e.lang) || e.lang === 'all');
  const updates = listing.installed.filter((e) => e.update);
  const sections = [
    { title: `Updates (${updates.length})`, items: updates.map((e) => ({ ext: e.update!, kind: 'update' as const })) },
    { title: 'Installed', items: listing.installed.filter((e) => !e.update).map((e) => ({ ext: e as AvailableExtension, kind: 'installed' as const })) },
    { title: 'Available', items: listing.available.filter(visible).map((e) => ({ ext: e, kind: 'available' as const })) },
  ].filter((s) => s.items.length);

  return (
    <div className="section-list">
      <input className="field" placeholder="Search extensions" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="row-between">
        <span className="faint small">
          {data.repos.length} {data.repos.length > 1 ? 'repositories' : 'repository'}, showing {settings.languages.map(languageName).join(', ')}
        </span>
        <button className="btn btn-ghost btn-small" onClick={() => setReposOpen(true)}>
          Repositories
        </button>
      </div>
      {listing.errors.map((e) => (
        <p key={e.repoUrl} className="error small">
          {e.repoUrl}: {e.message}
        </p>
      ))}
      {sections.map((s) => (
        <section key={s.title}>
          <h2 className="group-title">{s.title}</h2>
          <ul className="list">
            {s.items.map(({ ext, kind }) => (
              <li key={ext.pkg} className="list-row">
                <span className="grow">
                  <span className="list-title">{ext.name}</span>
                  <span className="faint small">
                    {[languageName(ext.lang), `v${ext.version}`, ext.nsfw ? '18+' : null, ext.theme].filter(Boolean).join(', ')}
                  </span>
                </span>
                {kind === 'update' ? (
                  <button className="btn btn-primary btn-small" disabled={busy === ext.pkg} onClick={() => run(ext.pkg, () => uc.extensions.install(ext), `Updated ${ext.name}`)}>
                    {busy === ext.pkg ? 'Updating' : 'Update'}
                  </button>
                ) : kind === 'installed' ? (
                  <button
                    className="btn btn-ghost btn-small"
                    disabled={busy === ext.pkg}
                    onClick={async () => {
                      if (await confirm({ title: `Uninstall ${ext.name}?`, body: 'Series from it stay in your library but cannot be updated.', confirm: 'Uninstall', danger: true }))
                        void run(ext.pkg, () => uc.extensions.uninstall(ext.pkg), `Uninstalled ${ext.name}`);
                    }}
                  >
                    Uninstall
                  </button>
                ) : (
                  <button className="btn btn-secondary btn-small" disabled={busy === ext.pkg} onClick={() => run(ext.pkg, () => uc.extensions.install(ext), `Installed ${ext.name}`)}>
                    {busy === ext.pkg ? 'Installing' : 'Install'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {repos}
    </div>
  );
}

function ReposSheet({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const { uc } = useApp();
  const load = useCallback(() => uc.extensions.repos(), [uc]);
  const { data, reload } = useQuery(load);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title="Extension repositories">
      <ul className="list">
        {(data ?? []).map((r) => (
          <li key={r.url} className="list-row">
            <span className="grow truncate">{r.name}</span>
            <button
              className="btn btn-small btn-danger-ghost"
              onClick={async () => {
                await uc.extensions.removeRepo(r.url);
                await reload();
                onChanged();
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await uc.extensions.addRepo(url);
            setUrl('');
            await reload();
            onChanged();
          } catch (err) {
            setError(`Could not add it: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input className="field" type="url" placeholder="https://example.com/repo" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn btn-secondary" disabled={busy || !/^https?:\/\/.+/.test(url.trim())}>
          Add
        </button>
      </form>
      {error ? <p className="error small">{error}</p> : null}
    </Sheet>
  );
}

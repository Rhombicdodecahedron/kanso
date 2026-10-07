'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { ReaderMode, Settings } from '@kanso/core';

import { useApp } from '@/composition/AppProvider';
import { Chip, PageHeader } from '@/ui/components/Shell';
import { Loading } from '@/ui/components/States';
import { useQuery } from '@/ui/hooks/useQuery';
import { languageName } from '@/ui/lang';

export const MODES: { mode: ReaderMode; label: string }[] = [
  { mode: 'rtl', label: 'Right to left' },
  { mode: 'ltr', label: 'Left to right' },
  { mode: 'vertical', label: 'Vertical' },
  { mode: 'webtoon', label: 'Webtoon' },
];
const LANGS = ['en', 'all', 'fr', 'es', 'es-419', 'pt-BR', 'de', 'it', 'id', 'ja', 'ko', 'zh', 'zh-Hans', 'zh-Hant', 'ru', 'tr', 'ar', 'th', 'vi', 'pl', 'uk'];

export function SettingsScreen() {
  const { uc, loadErrors, persistent } = useApp();
  const router = useRouter();
  const load = useCallback(() => uc.settings.get(), [uc]);
  const { data, setData } = useQuery(load);
  const storage = useStorageEstimate();
  if (!data) return <Loading />;
  const save = async (patch: Partial<Settings>) => {
    const next = { ...data, ...patch };
    setData(next);
    await uc.settings.save(next);
  };
  return (
    <>
      <PageHeader title="Settings" />
      <div className="settings">
        <Section title="Default reading mode">
          <div className="chip-wrap">
            {MODES.map((m) => (
              <Chip key={m.mode} active={data.readerMode === m.mode} onClick={() => save({ readerMode: m.mode })}>
                {m.label}
              </Chip>
            ))}
          </div>
        </Section>
        <Section title="Extension languages">
          <div className="chip-wrap">
            {LANGS.map((l) => {
              const on = data.languages.includes(l);
              return (
                <Chip key={l} active={on} onClick={() => save({ languages: on ? data.languages.filter((x) => x !== l) : [...data.languages, l] })}>
                  {languageName(l)}
                </Chip>
              );
            })}
          </div>
        </Section>
        <Section title="Content">
          <label className="pref-row">
            <span className="grow">Show 18+ extensions</span>
            <input type="checkbox" role="switch" className="switch" checked={data.showNsfw} onChange={(e) => save({ showNsfw: e.target.checked })} />
          </label>
        </Section>
        <Section title="Offline reading">
          <Link href="/downloads" className="list-link">
            <span className="list-title">Downloads</span>
            <span className="muted small">Chapters saved in this browser{storage ? `, ${storage}` : ''}</span>
          </Link>
          {!persistent ? <p className="error small">This browser gave Kanso no lasting storage (a private window?). Your library is lost when the tab closes.</p> : null}
        </Section>
        <Section title="This browser">
          <button
            className="btn btn-ghost"
            onClick={async () => {
              await fetch('/api/session', { method: 'DELETE' });
              router.replace('/connect');
            }}
          >
            Sign out of this server
          </button>
        </Section>
        {loadErrors.length ? (
          <Section title="Extensions that failed to load">
            {loadErrors.map((e) => (
              <p key={e.pkg} className="error small">
                {e.pkg}: {e.message}
              </p>
            ))}
          </Section>
        ) : null}
        <p className="faint small">Kanso runs extensions translated from the Mihon extension ecosystem (keiyoushi/extensions-source, Apache-2.0). It is not affiliated with Mihon.</p>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2 className="group-title">{title}</h2>
      {children}
    </section>
  );
}

function useStorageEstimate(): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => {
      if (e.usage === undefined) return;
      const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
      setText(`${mb(e.usage)} used${e.quota ? ` of ${mb(e.quota)}` : ''}`);
    });
  }, []);
  return text;
}

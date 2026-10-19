'use client';

import { useState } from 'react';

import type { PreferenceItem } from '@kanso/core';

import { useApp } from '@/composition/AppProvider';
import { useFeedback } from '@/ui/components/Feedback';
import { Chip, PageHeader } from '@/ui/components/Shell';

/** A source's own preferences (switches, lists, text). */
export function SourceSettingsScreen({ id }: { id: string }) {
  const { sources } = useApp();
  const { toast } = useFeedback();
  const [prefs, setPrefs] = useState<PreferenceItem[]>(() => (sources.has(id) ? sources.preferences(id) : []));
  const name = sources.sources().find((s) => s.id === id)?.name ?? 'Source';
  const set = (key: string, value: unknown) => {
    if (!sources.setPreference(id, key, value)) toast({ text: 'The source did not accept this value.' });
    setPrefs(sources.preferences(id));
  };
  return (
    <>
      <PageHeader title={`${name} settings`} />
      <div className="prefs">
        {!prefs.length ? <p className="muted">This source has no settings.</p> : null}
        {prefs
          .filter((p) => p.visible)
          .map((p) => (
            <Pref key={p.key ?? p.title} p={p} onChange={(v) => set(p.key, v)} />
          ))}
        <p className="faint small">Some changes apply after reloading the page.</p>
      </div>
    </>
  );
}

function Pref({ p, onChange }: { p: PreferenceItem; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(String(p.value ?? ''));
  const summary = p.summary?.replace('%s', String(p.value ?? '')) ?? null;
  const title = (
    <span className="grow">
      <span className="list-title">{p.title}</span>
      {summary ? <span className="muted small">{summary}</span> : null}
    </span>
  );
  switch (p.kind) {
    case 'switch':
    case 'checkbox':
      return (
        <label className="pref-row" data-disabled={!p.enabled}>
          {title}
          <input type="checkbox" role="switch" className="switch" disabled={!p.enabled} checked={!!p.value} onChange={(e) => onChange(e.target.checked)} />
        </label>
      );
    case 'list':
      return (
        <div className="pref" data-disabled={!p.enabled}>
          {title}
          <div className="chip-wrap">
            {(p.entries ?? []).map((label, i) => (
              <Chip key={i} active={p.value === p.entryValues?.[i]} onClick={() => p.enabled && onChange(p.entryValues?.[i])}>
                {label}
              </Chip>
            ))}
          </div>
        </div>
      );
    case 'multiselect': {
      const vals = new Set(Array.isArray(p.value) ? (p.value as string[]) : []);
      return (
        <div className="pref">
          {title}
          <div className="chip-wrap">
            {(p.entries ?? []).map((label, i) => {
              const v = p.entryValues?.[i] ?? label;
              return (
                <Chip
                  key={i}
                  active={vals.has(v)}
                  onClick={() => {
                    const next = new Set(vals);
                    if (next.has(v)) next.delete(v);
                    else next.add(v);
                    onChange([...next]);
                  }}
                >
                  {label}
                </Chip>
              );
            })}
          </div>
        </div>
      );
    }
    case 'text':
      return (
        <form
          className="pref"
          onSubmit={(e) => {
            e.preventDefault();
            onChange(text);
          }}
        >
          {title}
          <div className="inline-form">
            <input className="field" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn btn-secondary">Save</button>
          </div>
        </form>
      );
    default:
      return <div className="pref">{title}</div>;
  }
}

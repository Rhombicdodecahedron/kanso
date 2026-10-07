import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import { useApp } from '@/composition/AppProvider';
import type { ReaderMode, Settings } from '@kanso/core';
import { Button, Chip, Row } from '@/ui/components/Buttons';
import { Field } from '@/ui/components/Field';
import { Loading } from '@/ui/components/States';
import { Txt } from '@/ui/components/Txt';
import { formatRelativeTime } from '@/ui/format';
import { useQuery } from '@/ui/hooks/useQuery';
import { languageName } from '@/ui/lang';
import { colors, space } from '@/ui/theme';

const MODES: { mode: ReaderMode; label: string }[] = [
  { mode: 'rtl', label: 'Right to left' },
  { mode: 'ltr', label: 'Left to right' },
  { mode: 'vertical', label: 'Vertical' },
  { mode: 'webtoon', label: 'Webtoon' },
];
const LANGS = ['en', 'all', 'fr', 'es', 'es-419', 'pt-BR', 'de', 'it', 'id', 'ja', 'ko', 'zh', 'zh-Hans', 'zh-Hant', 'ru', 'tr', 'ar', 'th', 'vi', 'pl', 'uk'];

export function SettingsScreen() {
  const { uc } = useApp();
  const load = useCallback(() => uc.settings.get(), [uc]);
  const { data, setData } = useQuery(load);
  if (!data) return <Loading />;
  const save = async (patch: Partial<Settings>) => {
    const next = { ...data, ...patch };
    setData(next);
    await uc.settings.save(next);
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Stack.Screen options={{ title: 'Settings' }} />
      <Section title="Default reading mode">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm }}>
          {MODES.map((m) => (
            <Chip key={m.mode} label={m.label} active={data.readerMode === m.mode} onPress={() => save({ readerMode: m.mode })} />
          ))}
        </View>
      </Section>
      <Section title="Library columns">
        <Row>
          {[2, 3, 4, 5].map((n) => (
            <Chip key={n} label={String(n)} active={data.libraryColumns === n} onPress={() => save({ libraryColumns: n })} />
          ))}
        </Row>
      </Section>
      <Section title="Extension languages">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm }}>
          {LANGS.map((l) => {
            const on = data.languages.includes(l);
            return <Chip key={l} label={languageName(l)} active={on} onPress={() => save({ languages: on ? data.languages.filter((x) => x !== l) : [...data.languages, l] })} />;
          })}
        </View>
      </Section>
      <Section title="Content">
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt>Show 18+ extensions</Txt>
          <Switch value={data.showNsfw} onValueChange={(v) => save({ showNsfw: v })} trackColor={{ true: colors.accent }} />
        </Row>
      </Section>
      <SyncSection />
      <Section title="Downloads">
        <Row>
          {[1, 2, 3, 4].map((n) => (
            <Chip key={n} label={`${n} at a time`} active={data.downloadConcurrency === n} onPress={() => save({ downloadConcurrency: n })} />
          ))}
        </Row>
      </Section>
    </ScrollView>
  );
}

/** Keeps library, progress and history the same as on the Kanso web app. */
function SyncSection() {
  const { sync } = useApp();
  const [status, setStatus] = useState(sync.status());
  const [server, setServer] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => sync.onStatus(setStatus), [sync]);
  useEffect(() => {
    void sync.setup().then((s) => s && setServer(s.server));
  }, [sync]);

  if (status.kind === 'off') {
    return (
      <Section title="Sync">
        <Txt size={13} dim>Keep your library, reading progress and history the same as on your Kanso web app. Enter its address and access token.</Txt>
        <Field placeholder="https://your-kanso.vercel.app" value={server} onChangeText={setServer} keyboardType="url" />
        <Field placeholder="Access token" value={token} onChangeText={setToken} secureTextEntry />
        {error ? <Txt size={13} color={colors.danger}>{error}</Txt> : null}
        <Button
          label="Connect"
          busy={busy}
          disabled={!/^https?:\/\/.+/.test(server.trim()) || !token.trim()}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await sync.connect({ server, token });
              setToken('');
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Section>
    );
  }
  return (
    <Section title="Sync">
      <Txt size={13} dim numberOfLines={1}>Connected to {server.replace(/^https?:\/\//, '')}</Txt>
      <Txt size={13} dim>{status.lastSyncAt ? `Last synced ${formatRelativeTime(status.lastSyncAt)}` : 'Not synced yet'}</Txt>
      {status.kind === 'error' ? <Txt size={13} color={colors.danger}>{status.message}</Txt> : null}
      <Row style={{ gap: space.sm }}>
        <Button label={status.kind === 'syncing' ? 'Syncing' : 'Sync now'} small kind="secondary" busy={status.kind === 'syncing'} onPress={() => void sync.syncNow()} />
        <Button label="Disconnect" small kind="ghost" onPress={() => void sync.disconnect()} />
      </Row>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Txt size={13} weight="700" dim upper>{title}</Txt>
      {children}
    </View>
  );
}

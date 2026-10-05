import { Stack } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import { useApp } from '@/composition/AppProvider';
import type { ReaderMode, Settings } from '@/core/domain/model';
import { Chip, Row } from '@/ui/components/Buttons';
import { Loading } from '@/ui/components/States';
import { Txt } from '@/ui/components/Txt';
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Txt size={13} weight="700" dim upper>{title}</Txt>
      {children}
    </View>
  );
}

import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';

import { useApp } from '@/composition/AppProvider';
import type { PreferenceItem } from '@/core/domain/model';
import { Button, Chip, Row } from '@/ui/components/Buttons';
import { Field } from '@/ui/components/Field';
import { Txt } from '@/ui/components/Txt';
import { colors, space } from '@/ui/theme';

/** Renders a source's ConfigurableSource preferences (switches, lists, text...). */
export function SourceSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sources } = useApp();
  const [prefs, setPrefs] = useState<PreferenceItem[]>(() => (sources.has(id) ? sources.preferences(id) : []));
  const set = (key: string, value: unknown) => {
    const ok = sources.setPreference(id, key, value);
    if (!ok) Alert.alert('Not saved', 'The source rejected this value.');
    setPrefs(sources.preferences(id));
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Stack.Screen options={{ title: 'Source settings' }} />
      {!prefs.length ? <Txt dim>This source has no settings.</Txt> : null}
      {prefs.filter((p) => p.visible).map((p) => (
        <Pref key={p.key ?? p.title} p={p} onChange={(v) => set(p.key, v)} />
      ))}
      <Txt size={12} faint>Some changes only apply after restarting the app.</Txt>
    </ScrollView>
  );
}

function Pref({ p, onChange }: { p: PreferenceItem; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(String(p.value ?? ''));
  const summary = p.summary?.replace('%s', String(p.value ?? '')) ?? null;
  const title = (
    <View style={{ flex: 1 }}>
      <Txt weight="500">{p.title}</Txt>
      {summary ? <Txt size={13} dim>{summary}</Txt> : null}
    </View>
  );
  switch (p.kind) {
    case 'switch':
    case 'checkbox':
      return (
        <Row style={{ gap: space.md, opacity: p.enabled ? 1 : 0.5 }}>
          {title}
          <Switch disabled={!p.enabled} value={!!p.value} onValueChange={onChange} trackColor={{ true: colors.accent }} />
        </Row>
      );
    case 'list':
      return (
        <View style={{ gap: space.sm, opacity: p.enabled ? 1 : 0.5 }}>
          {title}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm }}>
            {(p.entries ?? []).map((label, i) => (
              <Chip key={i} label={label} active={p.value === p.entryValues?.[i]} onPress={() => p.enabled && onChange(p.entryValues?.[i])} />
            ))}
          </View>
        </View>
      );
    case 'multiselect': {
      const vals = new Set(Array.isArray(p.value) ? (p.value as string[]) : []);
      return (
        <View style={{ gap: space.sm }}>
          {title}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm }}>
            {(p.entries ?? []).map((label, i) => {
              const v = p.entryValues?.[i] ?? label;
              return (
                <Chip
                  key={i}
                  label={label}
                  active={vals.has(v)}
                  onPress={() => {
                    const next = new Set(vals);
                    if (next.has(v)) next.delete(v);
                    else next.add(v);
                    onChange([...next]);
                  }}
                />
              );
            })}
          </View>
        </View>
      );
    }
    case 'text':
      return (
        <View style={{ gap: space.sm }}>
          {title}
          <Field value={text} onChangeText={setText} />
          <Button label="Save" small kind="secondary" onPress={() => onChange(text)} style={{ alignSelf: 'flex-start' }} />
        </View>
      );
    default:
      return title;
  }
}

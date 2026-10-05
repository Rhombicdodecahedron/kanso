import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, View } from 'react-native';

import { useApp } from '@/composition/AppProvider';
import type { AvailableExtension } from '@/core/domain/model';
import { Button, Chip, Row } from '@/ui/components/Buttons';
import { Field } from '@/ui/components/Field';
import { Header } from '@/ui/components/Header';
import { Sheet } from '@/ui/components/Sheet';
import { Empty, ErrorState, Loading } from '@/ui/components/States';
import { Txt } from '@/ui/components/Txt';
import { useQuery } from '@/ui/hooks/useQuery';
import { languageName } from '@/ui/lang';
import { colors, space } from '@/ui/theme';

export function BrowseScreen() {
  const [tab, setTab] = useState<'sources' | 'extensions'>('sources');
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Browse">
        <Row style={{ marginTop: space.sm }}>
          <Chip label="Sources" active={tab === 'sources'} onPress={() => setTab('sources')} />
          <Chip label="Extensions" active={tab === 'extensions'} onPress={() => setTab('extensions')} />
        </Row>
      </Header>
      {tab === 'sources' ? <SourcesTab onGoToExtensions={() => setTab('extensions')} /> : <ExtensionsTab />}
    </View>
  );
}

function SourcesTab({ onGoToExtensions }: { onGoToExtensions: () => void }) {
  const { uc } = useApp();
  const load = useCallback(async () => {
    const s = await uc.settings.get();
    return { sources: uc.catalog.sources(null), langs: s.languages };
  }, [uc]);
  const { data } = useQuery(load);
  const [query, setQuery] = useState('');
  const sections = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const groups = new Map<string, typeof data.sources>();
    for (const s of data.sources) {
      if (q && !s.name.toLowerCase().includes(q)) continue;
      const list = groups.get(s.lang) ?? [];
      list.push(s);
      groups.set(s.lang, list);
    }
    const order = (l: string) => (data.langs.includes(l) ? 0 : l === 'all' ? 1 : 2);
    return [...groups.entries()]
      .sort((a, b) => order(a[0]) - order(b[0]) || languageName(a[0]).localeCompare(languageName(b[0])))
      .map(([lang, list]) => ({ title: languageName(lang), data: list.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [data, query]);
  if (!data) return <Loading />;
  if (!data.sources.length) return <Empty title="No sources yet" body="Install extensions to start browsing." action={{ label: 'Get extensions', onPress: onGoToExtensions }} />;
  return (
    <SectionList
      sections={sections}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={<Field placeholder="Search sources" value={query} onChangeText={setQuery} style={{ marginHorizontal: space.lg, marginBottom: space.sm }} />}
      renderSectionHeader={({ section }) => <Txt size={13} weight="700" dim upper style={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs }}>{section.title}</Txt>}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push({ pathname: '/source/[id]', params: { id: item.id } })} style={({ pressed }) => ({ paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: pressed ? colors.surface : undefined })}>
          <Txt size={16} weight="500">{item.name}</Txt>
          <Txt size={12} faint numberOfLines={1}>{item.baseUrl.replace(/^https?:\/\//, '')}</Txt>
        </Pressable>
      )}
      stickySectionHeadersEnabled={false}
    />
  );
}

function ExtensionsTab() {
  const { uc } = useApp();
  const load = useCallback(async () => ({ listing: await uc.extensions.list(), repos: await uc.extensions.repos(), settings: await uc.settings.get() }), [uc]);
  const { data, error, reload } = useQuery(load);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [reposOpen, setReposOpen] = useState(false);

  const run = async (pkg: string, f: () => Promise<unknown>) => {
    setBusy(pkg);
    try {
      await f();
      await reload();
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  if (!data.repos.length) {
    return (
      <>
        <Empty title="No extension repositories" body="Add a repository URL to see available extensions." action={{ label: 'Add repository', onPress: () => setReposOpen(true) }} />
        <ReposSheet visible={reposOpen} onClose={() => setReposOpen(false)} onChanged={reload} />
      </>
    );
  }
  const { listing, settings } = data;
  const q = query.trim().toLowerCase();
  const visible = (e: AvailableExtension) => (settings.showNsfw || !e.nsfw) && (!q || e.name.toLowerCase().includes(q)) && (settings.languages.includes(e.lang) || e.lang === 'all');
  const updates = listing.installed.filter((e) => e.update);
  const sections = [
    ...(updates.length ? [{ title: `Updates (${updates.length})`, data: updates.map((e) => ({ ext: e.update!, installed: true, update: true })) }] : []),
    { title: 'Installed', data: listing.installed.filter((e) => !e.update).map((e) => ({ ext: e as AvailableExtension, installed: true, update: false })) },
    { title: 'Available', data: listing.available.filter(visible).map((e) => ({ ext: e, installed: false, update: false })) },
  ].filter((s) => s.data.length);

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(i) => i.ext.pkg}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: space.lg, gap: space.sm, marginBottom: space.sm }}>
            <Field placeholder="Search extensions" value={query} onChangeText={setQuery} />
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt size={12} faint>{data.repos.length} repo{data.repos.length > 1 ? 's' : ''} · languages: {settings.languages.join(', ')}</Txt>
              <Button label="Repos" kind="ghost" small onPress={() => setReposOpen(true)} />
            </Row>
            {listing.errors.map((e) => (
              <Txt key={e.repoUrl} size={12} color={colors.danger}>{e.repoUrl}: {e.message}</Txt>
            ))}
          </View>
        }
        renderSectionHeader={({ section }) => <Txt size={13} weight="700" dim upper style={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs }}>{section.title}</Txt>}
        renderItem={({ item }) => (
          <Row style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Txt size={16} weight="500">{item.ext.name}</Txt>
              <Txt size={12} faint>
                {languageName(item.ext.lang)} · v{item.ext.version}
                {item.ext.nsfw ? ' · 18+' : ''}
                {item.ext.theme ? ` · ${item.ext.theme}` : ''}
              </Txt>
            </View>
            {item.update ? (
              <Button label="Update" small busy={busy === item.ext.pkg} onPress={() => run(item.ext.pkg, () => uc.extensions.install(item.ext))} />
            ) : item.installed ? (
              <Button
                label="Uninstall"
                kind="ghost"
                small
                busy={busy === item.ext.pkg}
                onPress={() =>
                  Alert.alert(`Uninstall ${item.ext.name}?`, 'Mangas from it stay in your library but cannot be updated.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Uninstall', style: 'destructive', onPress: () => run(item.ext.pkg, () => uc.extensions.uninstall(item.ext.pkg)) },
                  ])
                }
              />
            ) : (
              <Button label="Install" kind="secondary" small busy={busy === item.ext.pkg} onPress={() => run(item.ext.pkg, () => uc.extensions.install(item.ext))} />
            )}
          </Row>
        )}
        stickySectionHeadersEnabled={false}
      />
      <ReposSheet visible={reposOpen} onClose={() => setReposOpen(false)} onChanged={reload} />
    </>
  );
}

function ReposSheet({ visible, onClose, onChanged }: { visible: boolean; onClose: () => void; onChanged: () => void }) {
  const { uc } = useApp();
  const load = useCallback(() => uc.extensions.repos(), [uc]);
  const { data, reload } = useQuery(load);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await uc.extensions.addRepo(url);
      setUrl('');
      await reload();
      onChanged();
    } catch (e) {
      Alert.alert('Could not add repository', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Extension repositories">
      {(data ?? []).map((r) => (
        <Row key={r.url} style={{ paddingVertical: space.sm, gap: space.md }}>
          <Txt style={{ flex: 1 }} numberOfLines={1}>{r.name}</Txt>
          <Button
            label="Remove"
            kind="danger"
            small
            onPress={async () => {
              await uc.extensions.removeRepo(r.url);
              await reload();
              onChanged();
            }}
          />
        </Row>
      ))}
      <Field placeholder="https://example.com/repo" value={url} onChangeText={setUrl} keyboardType="url" style={{ marginTop: space.md }} />
      <Button label="Add repository" busy={busy} disabled={!/^https?:\/\/.+/.test(url.trim())} onPress={add} style={{ marginTop: space.sm }} />
    </Sheet>
  );
}

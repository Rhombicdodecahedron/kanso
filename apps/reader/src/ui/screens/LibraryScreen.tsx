import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { useApp } from '@/composition/AppProvider';
import { filterAndSort, type LibrarySort } from '@/core/application/library';
import { Button, Chip, IconButton, Row } from '@/ui/components/Buttons';
import { Field } from '@/ui/components/Field';
import { Header } from '@/ui/components/Header';
import { MangaCard } from '@/ui/components/MangaCard';
import { Sheet } from '@/ui/components/Sheet';
import { Empty, ErrorState, Loading } from '@/ui/components/States';
import { Txt } from '@/ui/components/Txt';
import { useQuery } from '@/ui/hooks/useQuery';
import { colors, space } from '@/ui/theme';

const SORTS: { key: LibrarySort; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'lastRead', label: 'Last read' },
  { key: 'lastUpdate', label: 'Latest chapter' },
  { key: 'unread', label: 'Unread' },
  { key: 'dateAdded', label: 'Date added' },
];

export function LibraryScreen() {
  const { uc, sources } = useApp();
  const load = useCallback(async () => ({ view: await uc.library.view(), lastRead: await uc.library.lastReadByManga(), settings: await uc.settings.get() }), [uc]);
  const { data, error, reload } = useQuery(load);
  const [category, setCategory] = useState<number | null | -1>(-1);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState<LibrarySort>('title');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const { width } = useWindowDimensions();

  const entries = useMemo(() => (data ? filterAndSort(data.view.entries, { categoryId: category, unreadOnly, query, sort, lastRead: data.lastRead }) : []), [data, category, unreadOnly, query, sort]);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const columns = Math.max(data.settings.libraryColumns, Math.floor(width / 160));
  const uncategorised = data.view.entries.some((e) => !e.categoryIds.length);

  const updateLibrary = async () => {
    let n = 0;
    const list = entries.filter((e) => sources.has(e.manga.sourceId));
    for (const [i, e] of list.entries()) {
      setUpdating(`${i + 1}/${list.length}`);
      try {
        n += (await uc.catalog.refresh(e.manga.id, { details: false, chapters: true })).newChapters;
      } catch {
        // keep going: one broken source should not stop the update
      }
    }
    setUpdating(null);
    await reload();
    Alert.alert('Library updated', n ? `${n} new chapter${n > 1 ? 's' : ''}` : 'No new chapters');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header
        title="Library"
        right={
          <>
            {updating ? <Txt size={13} dim>{updating}</Txt> : <IconButton glyph="⟳" label="Update library" onPress={updateLibrary} />}
            <IconButton glyph="⌕" label="Search" active={searching} onPress={() => setSearching((s) => !s)} />
            <IconButton glyph="☰" label="Display options" onPress={() => setOptionsOpen(true)} />
          </>
        }
      >
        {searching ? <Field placeholder="Search library" value={query} onChangeText={setQuery} autoFocus style={{ marginTop: space.sm }} /> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.sm }}>
          <Chip label="All" active={category === -1} onPress={() => setCategory(-1)} />
          {uncategorised && data.view.categories.length ? <Chip label="Default" active={category === null} onPress={() => setCategory(null)} /> : null}
          {data.view.categories.map((c) => (
            <Chip key={c.id} label={c.name} active={category === c.id} onPress={() => setCategory(c.id)} />
          ))}
          <Chip label="+ Category" onPress={() => setCatsOpen(true)} />
        </ScrollView>
      </Header>
      {!data.view.entries.length ? (
        <Empty title="Your library is empty" body="Find series in Browse and add them to your library." action={{ label: 'Browse', onPress: () => router.navigate('/browse') }} />
      ) : (
        <FlatList
          key={columns}
          data={entries}
          numColumns={columns}
          keyExtractor={(e) => String(e.manga.id)}
          contentContainerStyle={{ paddingHorizontal: space.sm, paddingBottom: space.xl }}
          renderItem={({ item }) => (
            <MangaCard
              title={item.manga.title}
              cover={item.manga.thumbnailUrl}
              headers={sources.has(item.manga.sourceId) ? sources.headers(item.manga.sourceId) : undefined}
              badge={item.unread}
              width={(width - space.sm * 2) / columns}
              onPress={() => router.push({ pathname: '/manga/[id]', params: { id: String(item.manga.id) } })}
            />
          )}
          ListEmptyComponent={<Txt dim center style={{ padding: space.xl }}>Nothing matches</Txt>}
        />
      )}
      <Sheet visible={optionsOpen} onClose={() => setOptionsOpen(false)} title="Display">
        <Txt size={13} dim upper style={{ marginBottom: space.sm }}>Sort</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm }}>
          {SORTS.map((s) => (
            <Chip key={s.key} label={s.label} active={sort === s.key} onPress={() => setSort(s.key)} />
          ))}
        </View>
        <Txt size={13} dim upper style={{ marginTop: space.lg, marginBottom: space.sm }}>Filter</Txt>
        <Chip label="Unread only" active={unreadOnly} onPress={() => setUnreadOnly((u) => !u)} />
      </Sheet>
      <CategoryEditor visible={catsOpen} onClose={() => setCatsOpen(false)} onChanged={reload} />
    </View>
  );
}

function CategoryEditor({ visible, onClose, onChanged }: { visible: boolean; onClose: () => void; onChanged: () => void }) {
  const { uc } = useApp();
  const load = useCallback(() => uc.library.categories(), [uc]);
  const { data, reload } = useQuery(load);
  const [name, setName] = useState('');
  const changed = async () => {
    await reload();
    onChanged();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Categories">
      {(data ?? []).map((c, i, all) => (
        <Row key={c.id} style={{ paddingVertical: 6, gap: space.sm }}>
          <Txt style={{ flex: 1 }}>{c.name}</Txt>
          <Pressable
            disabled={i === 0}
            onPress={async () => {
              const ids = all.map((x) => x.id);
              [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
              await uc.library.reorderCategories(ids);
              await changed();
            }}
          >
            <Txt dim={i === 0}>↑</Txt>
          </Pressable>
          <Button
            label="Delete"
            small
            kind="danger"
            onPress={async () => {
              await uc.library.removeCategory(c.id);
              await changed();
            }}
          />
        </Row>
      ))}
      <Field placeholder="New category" value={name} onChangeText={setName} style={{ marginTop: space.md }} />
      <Button
        label="Add"
        disabled={!name.trim()}
        style={{ marginTop: space.sm }}
        onPress={async () => {
          await uc.library.createCategory(name);
          setName('');
          await changed();
        }}
      />
    </Sheet>
  );
}

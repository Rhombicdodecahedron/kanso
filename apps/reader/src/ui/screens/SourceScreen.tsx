import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, useWindowDimensions, View } from 'react-native';

import { useApp } from '@/composition/AppProvider';
import { usePaged } from '@/ui/hooks/usePaged';
import type { BrowsePage } from '@/core/application/catalog';
import type { FilterState, Manga } from '@/core/domain/model';
import { Button, Chip, IconButton, Row } from '@/ui/components/Buttons';
import { Field } from '@/ui/components/Field';
import { MangaCard } from '@/ui/components/MangaCard';
import { Sheet } from '@/ui/components/Sheet';
import { Empty, ErrorState, Loading } from '@/ui/components/States';
import { Icon, icons } from '@/ui/components/Icon';
import { Txt } from '@/ui/components/Txt';
import { colors, space } from '@/ui/theme';

type Mode = { kind: 'popular' } | { kind: 'latest' } | { kind: 'search'; query: string; filters: FilterState[] | null };

export function SourceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { uc, sources } = useApp();
  const source = uc.catalog.sources(null).find((s) => s.id === id);
  const [mode, setMode] = useState<Mode>({ kind: 'popular' });
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState[] | null>(null);
  const { width } = useWindowDimensions();
  const columns = Math.max(3, Math.floor(width / 140));
  const headers = source ? sources.headers(source.id) : {};

  const fetchPage = async (p: number) => {
    const res: BrowsePage = mode.kind === 'popular' ? await uc.catalog.popular(id, p) : mode.kind === 'latest' ? await uc.catalog.latest(id, p) : await uc.catalog.search(id, p, mode.query, mode.filters);
    return { items: res.mangas, hasNext: res.hasNextPage };
  };
  const list = usePaged<Manga>(JSON.stringify(mode), fetchPage);
  const items = list.items;
  const loading = list.loading;
  const error = list.error;

  if (!source) return <ErrorState message="This source is not installed." />;

  const submitSearch = (q = query, f = filters) => setMode({ kind: 'search', query: q, filters: f });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: source.name,
          headerRight: () => (
            <Row>
              <IconButton icon={icons.settings} label="Source settings" onPress={() => router.push({ pathname: '/source-settings/[id]', params: { id } })} />
            </Row>
          ),
        }}
      />
      <View style={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm }}>
        <Field placeholder={`Search ${source.name}`} value={query} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => submitSearch()} />
        <Row>
          <Chip label="Popular" active={mode.kind === 'popular'} onPress={() => setMode({ kind: 'popular' })} />
          {uc.catalog.supportsLatest(id) ? <Chip label="Latest" active={mode.kind === 'latest'} onPress={() => setMode({ kind: 'latest' })} /> : null}
          <Chip label={filters ? 'Filters •' : 'Filters'} active={mode.kind === 'search' && !!filters} onPress={() => setFiltersOpen(true)} />
        </Row>
      </View>
      {error && !items.length ? (
        <ErrorState message={error} onRetry={list.retry} />
      ) : !items.length && loading ? (
        <Loading />
      ) : !items.length ? (
        <Empty title="No results" />
      ) : (
        <FlatList
          key={columns}
          data={items}
          numColumns={columns}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ paddingHorizontal: space.sm, paddingBottom: space.xl }}
          renderItem={({ item }) => (
            <MangaCard
              title={item.title}
              cover={item.thumbnailUrl}
              headers={headers}
              inLibrary={item.favorite}
              width={(width - space.sm * 2) / columns}
              onPress={() => router.push({ pathname: '/manga/[id]', params: { id: String(item.id) } })}
            />
          )}
          onEndReachedThreshold={1.5}
          onEndReached={list.loadMore}
          ListFooterComponent={
            loading ? (
              <ActivityIndicator color={colors.accent} style={{ margin: space.lg }} />
            ) : error ? (
              <Button label="Retry" kind="secondary" onPress={() => { list.retry(); list.loadMore(); }} style={{ margin: space.lg }} />
            ) : null
          }
        />
      )}
      <FilterSheet
        sourceId={id}
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        onApply={(f) => {
          setFilters(f);
          setFiltersOpen(false);
          submitSearch(query, f);
        }}
      />
    </View>
  );
}

function FilterSheet({ sourceId, visible, onClose, onApply }: { sourceId: string; visible: boolean; onClose: () => void; onApply: (f: FilterState[] | null) => void }) {
  const { uc } = useApp();
  const [state, setState] = useState<FilterState[] | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!visible || state) return;
    let alive = true;
    uc.catalog.filters(sourceId).then(
      (f) => alive && setState(f),
      () => alive && setState([]),
    );
    return () => {
      alive = false;
    };
  }, [visible, state, uc, sourceId, nonce]);
  const loading = !state;
  const reset = () => {
    setState(null);
    setNonce((n) => n + 1);
  };

  const update = (path: number[], value: unknown) => {
    setState((prev) => {
      if (!prev) return prev;
      const next: FilterState[] = JSON.parse(JSON.stringify(prev));
      let list = next;
      let f: FilterState = list[path[0]];
      for (const i of path.slice(1)) {
        list = f.children!;
        f = list[i];
      }
      f.state = value;
      return next;
    });
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Filters">
      {loading || !state ? (
        <Loading />
      ) : !state.length ? (
        <Txt dim>This source has no filters.</Txt>
      ) : (
        state.map((f, i) => <FilterRow key={i} f={f} path={[i]} onChange={update} />)
      )}
      <Row style={{ gap: space.sm, marginTop: space.lg }}>
        <Button label="Reset" kind="ghost" onPress={reset} style={{ flex: 1 }} />
        <Button label="Search" onPress={() => onApply(state)} style={{ flex: 1 }} />
      </Row>
    </Sheet>
  );
}

const TRI = [icons.neutral, icons.include, icons.exclude];

function FilterRow({ f, path, onChange }: { f: FilterState; path: number[]; onChange: (p: number[], v: unknown) => void }) {
  switch (f.kind) {
    case 'header':
      return <Txt size={13} weight="700" dim upper style={{ marginTop: space.md }}>{f.name}</Txt>;
    case 'separator':
      return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space.sm }} />;
    case 'text':
      return (
        <View style={{ marginVertical: space.xs }}>
          <Txt size={13} dim>{f.name}</Txt>
          <Field value={String(f.state ?? '')} onChangeText={(t) => onChange(path, t)} style={{ marginTop: 4 }} />
        </View>
      );
    case 'checkbox':
      return (
        <Pressable onPress={() => onChange(path, !f.state)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: space.sm }}>
          <Icon name={f.state ? icons.checked : icons.unchecked} color={f.state ? colors.accent : colors.textDim} />
          <Txt>{f.name}</Txt>
        </Pressable>
      );
    case 'tristate':
      return (
        <Pressable onPress={() => onChange(path, (((f.state as number) ?? 0) + 1) % 3)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: space.sm }}>
          <Icon name={TRI[(f.state as number) ?? 0]} color={f.state === 1 ? colors.success : f.state === 2 ? colors.danger : colors.textDim} />
          <Txt>{f.name}</Txt>
        </Pressable>
      );
    case 'select':
      return (
        <View style={{ marginVertical: space.xs }}>
          <Txt size={13} dim>{f.name}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, rowGap: space.xs }}>
            {(f.values ?? []).map((v, i) => (
              <Chip key={i} label={v} active={f.state === i} onPress={() => onChange(path, i)} />
            ))}
          </View>
        </View>
      );
    case 'sort': {
      const st = f.state as { index: number; ascending: boolean } | null;
      return (
        <View style={{ marginVertical: space.xs }}>
          <Txt size={13} dim>{f.name}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, rowGap: space.xs }}>
            {(f.values ?? []).map((v, i) => (
              <Chip key={i} label={st?.index === i ? `${v} ${st.ascending ? '↑' : '↓'}` : v} active={st?.index === i} onPress={() => onChange(path, { index: i, ascending: st?.index === i ? !st.ascending : false })} />
            ))}
          </View>
        </View>
      );
    }
    case 'group':
      return (
        <View style={{ marginVertical: space.xs }}>
          <Txt size={13} weight="700" dim upper style={{ marginTop: space.sm }}>{f.name}</Txt>
          {(f.children ?? []).map((c, i) => (
            <FilterRow key={i} f={c} path={[...path, i]} onChange={onChange} />
          ))}
        </View>
      );
    default:
      return null;
  }
}

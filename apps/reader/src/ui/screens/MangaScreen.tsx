import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Linking, Pressable, RefreshControl, View } from 'react-native';

import { useApp } from '@/composition/AppProvider';
import type { Category, Chapter, Download, Manga } from '@/core/domain/model';
import { Button, IconButton, Row } from '@/ui/components/Buttons';
import { Sheet } from '@/ui/components/Sheet';
import { ErrorState, Loading } from '@/ui/components/States';
import { Txt } from '@/ui/components/Txt';
import { useQuery } from '@/ui/hooks/useQuery';
import { formatDate, statusLabel } from '@/ui/format';
import { colors, radius, space } from '@/ui/theme';

export function MangaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const mangaId = Number(id);
  const { uc, sources } = useApp();
  // First visit (never fetched): load details and chapters from the source as part of loading.
  const load = useCallback(async () => {
    const local = await uc.catalog.manga(mangaId);
    if (local.manga.initialized && local.chapters.length) return { ...local, fetchError: null as string | null };
    try {
      const r = await uc.catalog.refresh(mangaId);
      return { manga: r.manga, chapters: r.chapters, fetchError: null as string | null };
    } catch (e) {
      return { ...local, fetchError: e instanceof Error ? e.message : String(e) };
    }
  }, [uc, mangaId]);
  const { data, error, reload, setData } = useQuery(load);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [descending, setDescending] = useState(true);
  const downloads = useDownloads(mangaId);

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const r = await uc.catalog.refresh(mangaId);
      setData({ manga: r.manga, chapters: r.chapters, fetchError: null });
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const chapters = useMemo(() => {
    const list = [...(data?.chapters ?? [])].sort((a, b) => a.sourceOrder - b.sourceOrder);
    return descending ? list : list.reverse();
  }, [data, descending]);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const { manga } = data;
  const headers = sources.headers(manga.sourceId);
  const source = uc.catalog.sources(null).find((s) => s.id === manga.sourceId);
  const nextToRead = [...data.chapters].sort((a, b) => b.sourceOrder - a.sourceOrder).find((c) => !c.read);
  const selecting = selected.size > 0;

  const toggleFavorite = async () => {
    const m = await uc.catalog.setFavorite(manga.id, !manga.favorite);
    setData({ ...data, manga: m });
    if (m.favorite && (await uc.library.categories()).length) setCatsOpen(true);
  };

  const act = async (f: (ids: number[]) => Promise<void>) => {
    await f([...selected]);
    setSelected(new Set());
    await reload();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: selecting ? `${selected.size} selected` : '',
          headerRight: () =>
            selecting ? (
              <IconButton glyph="✕" label="Clear selection" onPress={() => setSelected(new Set())} />
            ) : (
              <Row>
                <IconButton glyph="⇅" label={descending ? 'Sort chapters: newest first' : 'Sort chapters: oldest first'} onPress={() => setDescending((d) => !d)} />
                <IconButton
                  glyph="↗"
                  label="Open in browser"
                  onPress={() => {
                    const url = uc.catalog.webUrl(manga);
                    if (url) void Linking.openURL(url);
                  }}
                />
              </Row>
            ),
        }}
      />
      <FlatList
        data={chapters}
        keyExtractor={(c) => String(c.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
        ListHeaderComponent={
          <View style={{ padding: space.lg, gap: space.md }}>
            <Row style={{ gap: space.lg, alignItems: 'flex-start' }}>
              <View style={{ width: 110, aspectRatio: 2 / 3, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceHigh }}>
                {manga.thumbnailUrl ? <Image source={{ uri: manga.thumbnailUrl, headers }} style={{ flex: 1 }} contentFit="cover" /> : null}
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Txt size={20} weight="700" selectable>{manga.title}</Txt>
                {manga.author ? <Txt dim>{manga.author}{manga.artist && manga.artist !== manga.author ? ` · ${manga.artist}` : ''}</Txt> : null}
                <Txt size={13} faint>{statusLabel(manga.status)} · {source?.name ?? 'Source not installed'}</Txt>
              </View>
            </Row>
            <Row style={{ gap: space.sm }}>
              <Button label={manga.favorite ? 'In library' : 'Add to library'} kind={manga.favorite ? 'secondary' : 'primary'} onPress={toggleFavorite} style={{ flex: 1 }} />
              {manga.favorite ? <Button label="Categories" kind="ghost" onPress={() => setCatsOpen(true)} /> : null}
            </Row>
            {manga.description ? (
              <Pressable onPress={() => setExpanded((e) => !e)}>
                <Txt dim numberOfLines={expanded ? undefined : 4} selectable={expanded}>{manga.description}</Txt>
              </Pressable>
            ) : null}
            {manga.genres.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {manga.genres.map((g) => (
                  <View key={g} style={{ backgroundColor: colors.surfaceHigh, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Txt size={12}>{g}</Txt>
                  </View>
                ))}
              </View>
            ) : null}
            {refreshError ?? data.fetchError ? <Txt size={13} color={colors.danger}>{refreshError ?? data.fetchError}</Txt> : null}
            <Row style={{ justifyContent: 'space-between', marginTop: space.sm }}>
              <Txt weight="700">{data.chapters.length} chapters</Txt>
              <Row style={{ gap: space.sm }}>
                {data.chapters.some((c) => !c.read && downloads.get(c.id)?.state !== 'done') ? (
                  <Button
                    label="Download unread"
                    small
                    kind="ghost"
                    onPress={() => {
                      const ids = [...data.chapters].sort((a, b) => b.sourceOrder - a.sourceOrder).filter((c) => !c.read && downloads.get(c.id)?.state !== 'done').map((c) => c.id);
                      Alert.alert(`Download ${ids.length} chapter${ids.length > 1 ? 's' : ''}?`, undefined, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Download', onPress: () => void uc.downloads.enqueue(ids) },
                      ]);
                    }}
                  />
                ) : null}
                {nextToRead ? <Button label={data.chapters.some((c) => c.read || c.lastPageRead > 0) ? 'Resume' : 'Start reading'} small onPress={() => router.push({ pathname: '/reader/[chapterId]', params: { chapterId: String(nextToRead.id) } })} /> : null}
              </Row>
            </Row>
          </View>
        }
        renderItem={({ item }) => (
          <ChapterRow
            chapter={item}
            download={downloads.get(item.id)}
            selected={selected.has(item.id)}
            onPress={() => {
              if (selecting) toggle(selected, setSelected, item.id);
              else router.push({ pathname: '/reader/[chapterId]', params: { chapterId: String(item.id) } });
            }}
            onLongPress={() => toggle(selected, setSelected, item.id)}
            onDownload={() => void uc.downloads.enqueue([item.id])}
          />
        )}
        ListEmptyComponent={refreshing ? <Loading /> : <Txt dim center style={{ padding: space.xl }}>No chapters</Txt>}
        contentContainerStyle={{ paddingBottom: selecting ? 120 : space.xl }}
      />
      {selecting ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.md, paddingBottom: space.xl, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Button label="Read" small kind="secondary" onPress={() => act((ids) => uc.catalog.setRead(ids, true))} />
          <Button label="Unread" small kind="secondary" onPress={() => act((ids) => uc.catalog.setRead(ids, false))} />
          <Button label="Bookmark" small kind="secondary" onPress={() => act((ids) => uc.catalog.setBookmark(ids, !data.chapters.find((c) => c.id === [...selected][0])?.bookmark))} />
          <Button label="Download" small kind="secondary" onPress={() => act((ids) => uc.downloads.enqueue(ids))} />
          {selected.size === 1 ? <Button label="Mark previous read" small kind="secondary" onPress={() => act((ids) => uc.catalog.markPreviousRead(ids[0]))} /> : null}
          <Button
            label="Delete downloads"
            small
            kind="danger"
            onPress={() =>
              Alert.alert('Delete downloaded chapters?', undefined, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => act(async (ids) => void (await Promise.all(ids.map((i) => uc.downloads.remove(i))))) },
              ])
            }
          />
        </View>
      ) : null}
      <CategoriesSheet manga={manga} visible={catsOpen} onClose={() => setCatsOpen(false)} />
    </View>
  );
}

function toggle(set: Set<number>, setSet: (s: Set<number>) => void, id: number) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setSet(next);
}

function ChapterRow({ chapter, download, selected, onPress, onLongPress, onDownload }: { chapter: Chapter; download?: Download; selected: boolean; onPress: () => void; onLongPress: () => void; onDownload: () => void }) {
  const state = download?.state;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.md, backgroundColor: selected ? colors.surfaceHigh : pressed ? colors.surface : undefined })}>
      <View style={{ flex: 1 }}>
        <Txt weight="500" color={chapter.read ? colors.textFaint : chapter.bookmark ? colors.accent : colors.text} numberOfLines={1}>
          {chapter.bookmark ? '★ ' : ''}
          {chapter.name}
        </Txt>
        <Txt size={12} faint numberOfLines={1}>
          {[chapter.dateUpload ? formatDate(chapter.dateUpload) : null, chapter.scanlator, !chapter.read && chapter.lastPageRead > 0 ? `Page ${chapter.lastPageRead + 1}` : null, state === 'error' ? `Download failed: ${download?.error}` : null]
            .filter(Boolean)
            .join(' · ')}
        </Txt>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={state === 'done' ? 'Downloaded' : 'Download chapter'}
        disabled={state === 'done' || state === 'queued' || state === 'downloading'}
        onPress={onDownload}
        hitSlop={8}
        style={{ width: 44, alignItems: 'center' }}
      >
        {state === 'downloading' ? (
          <Txt size={12} dim>{download!.total ? `${download!.progress}/${download!.total}` : '…'}</Txt>
        ) : state === 'queued' ? (
          <Txt size={16} dim>⋯</Txt>
        ) : state === 'done' ? (
          <Txt size={18} color={colors.accent}>✓</Txt>
        ) : (
          <Txt size={18} color={state === 'error' ? colors.danger : colors.textDim}>↓</Txt>
        )}
      </Pressable>
    </Pressable>
  );
}

function useDownloads(mangaId: number): Map<number, Download> {
  const { uc } = useApp();
  const [map, setMap] = useState(new Map<number, Download>());
  useEffect(() => {
    let alive = true;
    void uc.downloads.list().then((l) => alive && setMap(new Map(l.filter((d) => d.mangaId === mangaId).map((d) => [d.chapterId, d]))));
    const off = uc.downloads.subscribe((d) => {
      if (d.mangaId !== mangaId) return;
      setMap((m) => new Map(m).set(d.chapterId, d));
    });
    return () => {
      alive = false;
      off();
    };
  }, [uc, mangaId]);
  return map;
}

function CategoriesSheet({ manga, visible, onClose }: { manga: Manga; visible: boolean; onClose: () => void }) {
  const { uc } = useApp();
  const [cats, setCats] = useState<Category[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!visible) return;
    void (async () => {
      setCats(await uc.library.categories());
      setChosen(new Set(await uc.library.categoriesOf(manga.id)));
    })();
  }, [visible, uc, manga.id]);
  return (
    <Sheet visible={visible} onClose={onClose} title="Categories">
      {!cats.length ? <Txt dim>No categories yet. Create them from the library.</Txt> : null}
      {cats.map((c) => (
        <Pressable key={c.id} onPress={() => toggle(chosen, setChosen, c.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 10 }}>
          <Txt size={18} color={chosen.has(c.id) ? colors.accent : colors.textDim}>{chosen.has(c.id) ? '☑' : '☐'}</Txt>
          <Txt>{c.name}</Txt>
        </Pressable>
      ))}
      <Button
        label="Save"
        onPress={async () => {
          await uc.library.setCategories(manga.id, [...chosen]);
          onClose();
        }}
        style={{ marginTop: space.md }}
      />
    </Sheet>
  );
}

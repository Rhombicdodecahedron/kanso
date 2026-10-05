import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, useWindowDimensions, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '@/composition/AppProvider';
import { useQuery } from '@/ui/hooks/useQuery';
import type { ReaderPage, ReaderSession } from '@/core/application/reader';
import type { ImageRequest, Manga, ReaderMode } from '@/core/domain/model';
import { Button, Chip, Row } from '@/ui/components/Buttons';
import { Sheet } from '@/ui/components/Sheet';
import { ErrorState, Loading } from '@/ui/components/States';
import { Txt } from '@/ui/components/Txt';
import { colors, space } from '@/ui/theme';

type Item = { kind: 'page'; page: ReaderPage } | { kind: 'end' };

const MODES: { mode: ReaderMode; label: string }[] = [
  { mode: 'rtl', label: 'Right to left' },
  { mode: 'ltr', label: 'Left to right' },
  { mode: 'vertical', label: 'Vertical' },
  { mode: 'webtoon', label: 'Webtoon' },
];

export function ReaderScreen() {
  const { chapterId } = useLocalSearchParams<{ chapterId: string }>();
  const { uc } = useApp();
  const load = useCallback(() => uc.reader.open(Number(chapterId)), [uc, chapterId]);
  const { data: session, error, reload: open } = useQuery(load);

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <ErrorState message={error} onRetry={open} />
        <Button label="Close" kind="ghost" onPress={() => router.back()} style={{ margin: space.xl }} />
      </View>
    );
  }
  if (!session) return <View style={{ flex: 1, backgroundColor: '#000' }}><Loading /></View>;
  return <Reader key={session.chapter.id} session={session} />;
}

function Reader({ session }: { session: ReaderSession }) {
  const [mode, setMode] = useState<ReaderMode>(session.mode);
  const { uc } = useApp();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [index, setIndex] = useState(session.startPage);
  const list = useRef<FlatList<Item>>(null);
  const openedAt = useRef(0);
  const total = session.pages.length;
  const items: Item[] = useMemo(() => [...session.pages.map((page) => ({ kind: 'page' as const, page })), { kind: 'end' as const }], [session.pages]);
  const paged = mode !== 'webtoon';
  const horizontal = mode === 'rtl' || mode === 'ltr';

  // Save progress whenever the visible page changes.
  useEffect(() => {
    if (index >= total) return;
    const now = Date.now();
    const spent = openedAt.current ? now - openedAt.current : 0;
    openedAt.current = now;
    void uc.reader.progress(session.chapter.id, index, total, spent).catch(() => {});
  }, [index, total, session.chapter.id, uc]);

  const goToChapter = (id: number | undefined) => {
    if (id) router.replace({ pathname: '/reader/[chapterId]', params: { chapterId: String(id) } });
  };

  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<Item>[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.index !== undefined && first.index !== null) setIndex(first.index);
  }, []);

  const scrollTo = (i: number) => {
    const target = Math.max(0, Math.min(items.length - 1, i));
    list.current?.scrollToIndex({ index: target, animated: paged });
  };

  // Paged tap zones: outer thirds turn the page, the middle toggles the menu.
  const onTap = (x: number) => {
    if (!paged) return setMenu((m) => !m);
    const third = width / 3;
    if (x > third && x < third * 2) return setMenu((m) => !m);
    const forward = mode === 'rtl' ? x < third : x > third * 2;
    scrollTo(index + (forward ? 1 : -1));
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar hidden={!menu} style="light" />
      <FlatList
        ref={list}
        key={mode}
        data={items}
        horizontal={horizontal}
        inverted={mode === 'rtl'}
        pagingEnabled={paged}
        initialScrollIndex={Math.min(session.startPage, items.length - 1)}
        getItemLayout={paged ? (_, i) => ({ length: horizontal ? width : height, offset: (horizontal ? width : height) * i, index: i }) : undefined}
        onScrollToIndexFailed={(info) => setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: false }), 100)}
        keyExtractor={(it, i) => (it.kind === 'end' ? 'end' : `p${i}`)}
        windowSize={paged ? 5 : 9}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: paged ? 60 : 1 }}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index: i }) =>
          item.kind === 'end' ? (
            <ChapterEnd width={width} height={paged ? height : height * 0.6} session={session} onNext={() => goToChapter(session.next?.id)} />
          ) : (
            <Pressable onPress={(e) => onTap(e.nativeEvent.locationX)} delayLongPress={400}>
              <PageView manga={session.manga} page={item.page} width={width} height={height} paged={paged} near={Math.abs(i - index) <= 3} />
            </Pressable>
          )
        }
      />
      {menu ? (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + space.xs, paddingHorizontal: space.md, paddingBottom: space.sm, backgroundColor: 'rgba(14,14,16,0.92)' }}>
            <Row style={{ gap: space.md }}>
              <Pressable onPress={() => router.back()} hitSlop={12}>
                <Txt size={22}>‹</Txt>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Txt weight="600" numberOfLines={1}>{session.manga.title}</Txt>
                <Txt size={12} dim numberOfLines={1}>{session.chapter.name}</Txt>
              </View>
              <Pressable onPress={() => setSettingsOpen(true)} hitSlop={12}>
                <Txt size={20}>⚙︎</Txt>
              </Pressable>
            </Row>
          </View>
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: insets.bottom + space.sm, paddingHorizontal: space.md, paddingTop: space.sm, backgroundColor: 'rgba(14,14,16,0.92)', gap: space.sm }}>
            <PageSlider index={Math.min(index, total - 1)} total={total} rtl={mode === 'rtl'} onChange={scrollTo} />
            <Row style={{ justifyContent: 'space-between' }}>
              <Button label="‹ Previous" small kind="ghost" disabled={!session.prev} onPress={() => goToChapter(session.prev?.id)} />
              <Txt size={13} dim>{Math.min(index + 1, total)} / {total}</Txt>
              <Button label="Next ›" small kind="ghost" disabled={!session.next} onPress={() => goToChapter(session.next?.id)} />
            </Row>
          </View>
        </>
      ) : null}
      <Sheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} title="Reading mode">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm }}>
          {MODES.map((m) => (
            <Chip
              key={m.mode}
              label={m.label}
              active={mode === m.mode}
              onPress={() => {
                setMode(m.mode);
                void uc.catalog.setViewer(session.manga.id, m.mode);
              }}
            />
          ))}
        </View>
        <Txt size={12} faint style={{ marginTop: space.md }}>Saved for this series. The default for new series is in Settings.</Txt>
      </Sheet>
    </View>
  );
}

function ChapterEnd({ width, height, session, onNext }: { width: number; height: number; session: ReaderSession; onNext: () => void }) {
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md }}>
      <Txt dim>Finished</Txt>
      <Txt weight="600" center>{session.chapter.name}</Txt>
      {session.next ? (
        <>
          <Txt dim style={{ marginTop: space.lg }}>Next</Txt>
          <Txt weight="600" center>{session.next.name}</Txt>
          <Button label="Read next chapter" onPress={onNext} style={{ marginTop: space.md }} />
        </>
      ) : (
        <Txt dim style={{ marginTop: space.lg }}>No next chapter</Txt>
      )}
    </View>
  );
}

function PageSlider({ index, total, rtl, onChange }: { index: number; total: number; rtl: boolean; onChange: (i: number) => void }) {
  const [w, setW] = useState(1);
  const frac = total > 1 ? index / (total - 1) : 0;
  const pick = (x: number) => {
    const f = Math.max(0, Math.min(1, x / w));
    onChange(Math.round((rtl ? 1 - f : f) * (total - 1)));
  };
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
      onResponderMove={(e) => pick(e.nativeEvent.locationX)}
      style={{ height: 28, justifyContent: 'center' }}
    >
      <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.border }} />
      <View style={{ position: 'absolute', left: (rtl ? 1 - frac : frac) * (w - 16), width: 16, height: 16, borderRadius: 8, backgroundColor: colors.accent }} />
    </View>
  );
}

/** One page: resolves the image request lazily (remote pages need the source's headers). */
const PageView = memo(function PageView({ manga, page, width, height, paged, near }: { manga: Manga; page: ReaderPage; width: number; height: number; paged: boolean; near: boolean }) {
  const { uc } = useApp();
  const [req, setReq] = useState<ImageRequest | null>(page.kind === 'local' ? { url: page.uri, headers: {} } : null);
  const [error, setError] = useState<string | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (page.kind !== 'remote' || req || !near) return;
    let alive = true;
    uc.reader
      .image(manga, page)
      .then((r) => {
        if (!alive) return;
        setReq(r);
        void Image.prefetch(r.url, { headers: r.headers });
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [uc, manga, page, req, near, attempt]);

  const boxHeight = paged ? height : ratio ? width / ratio : height * 0.8;
  const content = error ? (
    <View style={{ alignItems: 'center', gap: space.sm }}>
      <Txt dim center>Page {page.index + 1} failed to load</Txt>
      <Txt size={12} faint center numberOfLines={3}>{error}</Txt>
      <Button
        label="Retry"
        small
        kind="secondary"
        onPress={() => {
          setError(null);
          setReq(null);
          setAttempt((a) => a + 1);
        }}
      />
    </View>
  ) : req ? (
    <Image
      source={{ uri: req.url, headers: req.headers }}
      style={{ width, height: boxHeight }}
      contentFit={paged ? 'contain' : 'fill'}
      recyclingKey={req.url}
      onLoad={(e) => setRatio(e.source.width / Math.max(1, e.source.height))}
      onError={(e) => setError(e.error)}
    />
  ) : (
    <ActivityIndicator color={colors.textDim} />
  );

  if (!paged) return <View style={{ width, height: boxHeight, alignItems: 'center', justifyContent: 'center' }}>{content}</View>;
  return (
    <ScrollView style={{ width, height }} contentContainerStyle={{ width, height, alignItems: 'center', justifyContent: 'center' }} maximumZoomScale={3} minimumZoomScale={1} centerContent showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
      {content}
    </ScrollView>
  );
});

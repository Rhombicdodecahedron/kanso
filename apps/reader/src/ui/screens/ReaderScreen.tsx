import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, useWindowDimensions, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle, type ViewToken } from 'react-native';
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

/** Webtoon: where each page cell sits in the list content (FlatList keeps this private). */
const CellLayoutContext = createContext<((index: number, y: number, height: number) => void) | null>(null);

function MeasuredCell({ index, style, onLayout, children }: { index: number; style?: StyleProp<ViewStyle>; onLayout?: (e: LayoutChangeEvent) => void; children?: ReactNode }) {
  const report = useContext(CellLayoutContext);
  return (
    <View
      style={style}
      onLayout={(e) => {
        onLayout?.(e);
        report?.(index, e.nativeEvent.layout.y, e.nativeEvent.layout.height);
      }}
    >
      {children}
    </View>
  );
}

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
  const position = useRef<{ index: number; frac: number } | null>(null);
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
    // keep the in-page offset (webtoon) when the page itself has not changed
    const offset = position.current?.index === index ? position.current.frac : index === session.startPage ? session.startOffset : 0;
    void uc.reader.progress(session.chapter.id, index, total, spent, offset).catch(() => {});
  }, [index, total, session.chapter.id, session.startPage, session.startOffset, uc]);

  const goToChapter = (id: number | undefined) => {
    if (id) router.replace({ pathname: '/reader/[chapterId]', params: { chapterId: String(id) } });
  };

  // Page the list must show once laid out. Webtoon pages have unknown heights, so FlatList cannot
  // jump there directly: until it gets there, visibility changes must not overwrite the progress.
  const target = useRef<number | null>(session.startPage > 0 ? session.startPage : null);
  const attempts = useRef(0);

  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<Item>[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.index === undefined || first.index === null) return;
    if (target.current !== null) {
      if (!viewableItems.some((v) => v.index === target.current)) return;
      target.current = null;
    }
    setIndex(first.index);
  }, []);

  const scrollToTarget = useCallback(() => {
    if (target.current === null) return;
    list.current?.scrollToIndex({ index: target.current, animated: false });
  }, []);

  // Webtoon: position after the first layout (paged modes use initialScrollIndex + getItemLayout).
  useEffect(() => {
    if (paged || target.current === null) return;
    const t = setTimeout(scrollToTarget, 50);
    return () => clearTimeout(t);
  }, [paged, mode, scrollToTarget]);

  // Not measured yet: jump near it with the average page height, then retry once it has rendered.
  const onScrollToIndexFailed = (info: { index: number; averageItemLength: number }) => {
    if (attempts.current++ > 20) {
      target.current = null;
      return;
    }
    list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    setTimeout(() => target.current !== null && list.current?.scrollToIndex({ index: info.index, animated: false }), 80);
  };

  // Webtoon: exact position inside the page (fraction of its height), saved when scrolling stops
  // and restored on open. Page heights change as images load, so restoring re-applies on each layout
  // of the start page until the reader touches the screen.
  const cells = useRef(new Map<number, { y: number; h: number }>());
  const restore = useRef<{ index: number; frac: number } | null>(session.startOffset > 0 ? { index: session.startPage, frac: session.startOffset } : null);

  const onCellLayout = useCallback((i: number, y: number, h: number) => {
    cells.current.set(i, { y, h });
    const r = restore.current;
    if (!r || r.index !== i) return;
    target.current = null;
    list.current?.scrollToOffset({ offset: y + r.frac * h, animated: false });
  }, []);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (paged) return;
    const y = e.nativeEvent.contentOffset.y;
    for (const [i, c] of cells.current) {
      if (i < total && y >= c.y && y < c.y + c.h) {
        position.current = { index: i, frac: c.h ? (y - c.y) / c.h : 0 };
        return;
      }
    }
  };

  const savePosition = useCallback(() => {
    const p = position.current;
    if (!p || restore.current || target.current !== null) return;
    void uc.reader.position(session.chapter.id, p.index, p.frac).catch(() => {});
  }, [uc, session.chapter.id]);

  // Leaving the reader mid-scroll still keeps the exact spot.
  useEffect(() => () => savePosition(), [savePosition]);

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
      <CellLayoutContext.Provider value={onCellLayout}>
      <FlatList
        ref={list}
        key={mode}
        data={items}
        horizontal={horizontal}
        inverted={mode === 'rtl'}
        pagingEnabled={paged}
        initialScrollIndex={paged ? Math.min(index, items.length - 1) : undefined}
        getItemLayout={paged ? (_, i) => ({ length: horizontal ? width : height, offset: (horizontal ? width : height) * i, index: i }) : undefined}
        onScroll={onScroll}
        scrollEventThrottle={100}
        onScrollEndDrag={savePosition}
        onMomentumScrollEnd={savePosition}
        CellRendererComponent={paged ? undefined : MeasuredCell}
        onScrollToIndexFailed={onScrollToIndexFailed}
        onScrollBeginDrag={() => {
          // the reader took over: stop forcing the start page
          target.current = null;
          restore.current = null;
        }}
        maintainVisibleContentPosition={paged ? undefined : { minIndexForVisible: 0 }}
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
      </CellLayoutContext.Provider>
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
                target.current = index > 0 ? index : null;
                restore.current = null;
                attempts.current = 0;
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
    // Zoom container only: no bounce, so unzoomed drags reach the page list instead of springing back.
    <ScrollView style={{ width, height }} contentContainerStyle={{ width, height, alignItems: 'center', justifyContent: 'center' }} maximumZoomScale={3} minimumZoomScale={1} bounces={false} centerContent showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
      {content}
    </ScrollView>
  );
});

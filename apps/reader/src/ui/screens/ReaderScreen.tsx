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
import { Button, Chip, IconButton, Row } from '@/ui/components/Buttons';
import { Icon, icons } from '@/ui/components/Icon';
import { Sheet } from '@/ui/components/Sheet';
import { ErrorState, Loading } from '@/ui/components/States';
import { Txt } from '@/ui/components/Txt';
import { colors, space } from '@/ui/theme';
import { syncWidget } from '@/widgets/sync';

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

/** Pages of every loaded chapter, each chapter followed by its transition card. */
type Item = { kind: 'page'; seg: number; pos: number; page: ReaderPage } | { kind: 'transition'; seg: number };

const MODES: { mode: ReaderMode; label: string }[] = [
  { mode: 'rtl', label: 'Right to left' },
  { mode: 'ltr', label: 'Left to right' },
  { mode: 'vertical', label: 'Vertical' },
  { mode: 'webtoon', label: 'Webtoon' },
];

/** How many pages before the end of the last loaded chapter the next one starts loading. */
const PRELOAD = 3;

export function ReaderScreen() {
  const { chapterId } = useLocalSearchParams<{ chapterId: string }>();
  // The route follows the chapter being read (so a remount reopens it), but that must not reload this reader.
  const [opened] = useState(chapterId);
  const { uc } = useApp();
  const load = useCallback(() => uc.reader.open(Number(opened)), [uc, opened]);
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
  const { uc, sources } = useApp();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [index, setIndex] = useState(session.startPage);
  // Chapters read in one continuous list: the next one is appended when the end gets close.
  const [segments, setSegments] = useState<ReaderSession[]>([session]);
  const [nextError, setNextError] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<Record<number, boolean>>({ [session.chapter.id]: session.chapter.bookmark });
  const list = useRef<FlatList<Item>>(null);
  const openedAt = useRef(0);
  const position = useRef<{ index: number; frac: number } | null>(null);
  const paged = mode !== 'webtoon';
  const horizontal = mode === 'rtl' || mode === 'ltr';

  const { items, starts } = useMemo(() => {
    const items: Item[] = [];
    const starts: number[] = [];
    segments.forEach((s, seg) => {
      starts.push(items.length);
      s.pages.forEach((page, pos) => items.push({ kind: 'page', seg, pos, page }));
      items.push({ kind: 'transition', seg });
    });
    return { items, starts };
  }, [segments]);
  // Latest list for scroll callbacks.
  const itemsRef = useRef(items);
  const segmentsRef = useRef(segments);
  useEffect(() => {
    itemsRef.current = items;
    segmentsRef.current = segments;
  }, [items, segments]);

  const at = items[Math.min(index, items.length - 1)];
  const seg = at.seg;
  const current = segments[seg];
  const total = current.pages.length;
  const page = at.kind === 'page' ? at.pos : total - 1;
  const chapterId = current.chapter.id;

  // Save progress whenever the visible page changes.
  useEffect(() => {
    if (at.kind !== 'page') return;
    const now = Date.now();
    const spent = openedAt.current ? now - openedAt.current : 0;
    openedAt.current = now;
    // keep the in-page offset (webtoon) when the page itself has not changed
    const offset = position.current?.index === index ? position.current.frac : index === session.startPage ? session.startOffset : 0;
    void uc.reader
      .progress(chapterId, page, total, spent, offset)
      .then(() => {
        const shown = at.page;
        return syncWidget(uc, sources, {
          chapterId,
          total,
          page,
          offset,
          image: async () => (shown.kind === 'local' ? { uri: shown.uri } : uc.reader.image(current.manga, shown).then((r) => ({ uri: r.url, headers: r.headers }))),
        });
      })
      .catch(() => {});
  }, [at, index, page, total, chapterId, current.manga, session.startPage, session.startOffset, uc, sources]);

  // Reaching a chapter's end card (or anything after it) finishes that chapter, even if its last
  // page scrolled by too fast to be reported as the current one.
  const finished = useRef(new Set<number>());
  useEffect(() => {
    const done = segments.slice(0, at.kind === 'transition' ? seg + 1 : seg).map((s) => s.chapter.id).filter((id) => !finished.current.has(id));
    if (!done.length) return;
    done.forEach((id) => finished.current.add(id));
    void uc.catalog.setRead(done, true).catch(() => {});
  }, [at.kind, seg, segments, uc]);

  // Follow the chapter being read: the route (a remount reopens it) and a short "now reading" notice.
  const [notice, setNotice] = useState<string | null>(null);
  const shownSeg = useRef(0);
  useEffect(() => {
    if (at.kind !== 'page' || seg === shownSeg.current) return;
    shownSeg.current = seg;
    router.setParams({ chapterId: String(chapterId) });
    setNotice(current.chapter.name);
  }, [at.kind, seg, chapterId, current.chapter.name]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  // Load the next chapter when the reader gets near the end of the last loaded one.
  const last = segments[segments.length - 1];
  const nearEnd = index >= starts[segments.length - 1] + last.pages.length - PRELOAD;
  const requested = useRef<number | null>(null);
  const loadingNext = nearEnd && !!last.next && !nextError;
  useEffect(() => {
    const id = last.next?.id;
    if (!loadingNext || !id || requested.current === id) return;
    requested.current = id;
    uc.reader
      .open(id)
      .then((s) => {
        setSegments((all) => (all.some((x) => x.chapter.id === s.chapter.id) ? all : [...all, s]));
        setBookmarks((b) => ({ ...b, [s.chapter.id]: s.chapter.bookmark }));
      })
      .catch((e) => {
        requested.current = null;
        setNextError(e instanceof Error ? e.message : String(e));
      });
  }, [loadingNext, last.next, uc]);

  const toggleBookmark = () => {
    const next = !bookmarks[chapterId];
    setBookmarks((b) => ({ ...b, [chapterId]: next }));
    void uc.catalog.setBookmark([chapterId], next).catch(() => setBookmarks((b) => ({ ...b, [chapterId]: !next })));
  };

  // Page the list must show once laid out. Webtoon pages have unknown heights, so FlatList cannot
  // jump there directly: until it gets there, visibility changes must not overwrite the progress.
  const target = useRef<number | null>(session.startPage > 0 ? session.startPage : null);
  const attempts = useRef(0);

  const goToChapter = (id: number | undefined) => {
    if (!id) return;
    const loaded = segments.findIndex((s) => s.chapter.id === id);
    if (loaded >= 0) {
      // webtoon pages may not be measured yet: keep retrying until it gets there
      target.current = starts[loaded];
      attempts.current = 0;
      return scrollTo(starts[loaded]);
    }
    router.replace({ pathname: '/reader/[chapterId]', params: { chapterId: String(id) } });
  };

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
      if (itemsRef.current[i]?.kind === 'page' && y >= c.y && y < c.y + c.h) {
        position.current = { index: i, frac: c.h ? (y - c.y) / c.h : 0 };
        return;
      }
    }
  };

  const savePosition = useCallback(() => {
    const p = position.current;
    const it = itemsRef.current[p?.index ?? -1];
    if (!p || it?.kind !== 'page' || restore.current || target.current !== null) return;
    void uc.reader.position(segmentsRef.current[it.seg].chapter.id, it.pos, p.frac).catch(() => {});
  }, [uc]);

  // Leaving the reader mid-scroll still keeps the exact spot.
  useEffect(() => () => savePosition(), [savePosition]);

  const scrollTo = (i: number) => {
    const to = Math.max(0, Math.min(items.length - 1, i));
    list.current?.scrollToIndex({ index: to, animated: paged });
  };

  // Paged tap zones: outer thirds turn the page, the middle toggles the menu.
  const onTap = (x: number) => {
    if (!paged) return setMenu((m) => !m);
    const third = width / 3;
    if (x > third && x < third * 2) return setMenu((m) => !m);
    const forward = mode === 'rtl' ? x < third : x > third * 2;
    scrollTo(index + (forward ? 1 : -1));
  };

  const bar = 'rgba(14,14,16,0.92)';
  const bookmarked = !!bookmarks[chapterId];
  // In right-to-left the previous chapter is on the right, like the pages.
  const chapterButtons = [
    <IconButton key="prev" icon={icons.prevChapter} label="Previous chapter" disabled={!current.prev} onPress={() => goToChapter(current.prev?.id)} />,
    <IconButton key="next" icon={icons.nextChapter} label="Next chapter" disabled={!current.next} onPress={() => goToChapter(current.next?.id)} />,
  ];
  if (mode === 'rtl') chapterButtons.reverse();

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
        keyExtractor={(it) => (it.kind === 'transition' ? `t${segments[it.seg].chapter.id}` : `${segments[it.seg].chapter.id}-${it.page.index}`)}
        windowSize={paged ? 5 : 9}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: paged ? 60 : 1 }}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index: i }) =>
          item.kind === 'transition' ? (
            <Pressable onPress={(e) => onTap(e.nativeEvent.locationX)}>
            <ChapterTransition
              width={width}
              height={paged ? height : height * 0.5}
              session={segments[item.seg]}
              upNext={segments[item.seg + 1] ?? null}
              loading={item.seg === segments.length - 1 && loadingNext}
              error={item.seg === segments.length - 1 ? nextError : null}
              onRetry={() => setNextError(null)}
            />
            </Pressable>
          ) : (
            <Pressable onPress={(e) => onTap(e.nativeEvent.locationX)} delayLongPress={400}>
              <PageView manga={segments[item.seg].manga} page={item.page} width={width} height={height} paged={paged} near={Math.abs(i - index) <= 3} />
            </Pressable>
          )
        }
      />
      </CellLayoutContext.Provider>
      {notice && !menu ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + space.sm, left: 0, right: 0, alignItems: 'center' }}>
          <Row style={{ gap: space.sm, backgroundColor: bar, borderRadius: 999, paddingHorizontal: space.lg, paddingVertical: space.sm, maxWidth: width - space.xl * 2 }}>
            <Icon name={icons.nextChapter} size={14} color={colors.accent} />
            <Txt size={13} weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>Now reading · {notice}</Txt>
          </Row>
        </View>
      ) : null}
      {menu ? (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + space.xs, paddingHorizontal: space.sm, paddingBottom: space.xs, backgroundColor: bar }}>
            <Row style={{ gap: space.xs }}>
              <IconButton icon={icons.back} label="Close reader" onPress={() => router.back()} />
              <View style={{ flex: 1 }}>
                <Txt weight="600" numberOfLines={1}>{current.manga.title}</Txt>
                <Txt size={12} dim numberOfLines={1}>{current.chapter.name}</Txt>
              </View>
              <IconButton icon={bookmarked ? icons.bookmarked : icons.bookmark} active={bookmarked} label={bookmarked ? 'Remove bookmark' : 'Bookmark chapter'} onPress={toggleBookmark} />
              <IconButton icon={icons.settings} label="Reading mode" onPress={() => setSettingsOpen(true)} />
            </Row>
          </View>
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: insets.bottom + space.xs, paddingHorizontal: space.sm, paddingTop: space.sm, backgroundColor: bar, gap: space.xs }}>
            <Txt size={13} dim center>{page + 1} / {total}</Txt>
            <Row style={{ gap: space.xs }}>
              {chapterButtons[0]}
              <View style={{ flex: 1 }}>
                <PageSlider index={Math.min(page, total - 1)} total={total} rtl={mode === 'rtl'} onChange={(p) => scrollTo(starts[seg] + p)} />
              </View>
              {chapterButtons[1]}
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

/** Between two chapters: what was finished and what comes next (loaded automatically). */
function ChapterTransition({ width, height, session, upNext, loading, error, onRetry }: { width: number; height: number; session: ReaderSession; upNext: ReaderSession | null; loading: boolean; error: string | null; onRetry: () => void }) {
  const next = upNext?.chapter ?? session.next;
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl, gap: space.xs }}>
      <Txt size={12} dim upper>Finished</Txt>
      <Txt weight="600" center numberOfLines={2}>{session.chapter.name}</Txt>
      <View style={{ width: 48, height: 2, borderRadius: 1, backgroundColor: colors.accent, marginVertical: space.lg }} />
      {next ? (
        <>
          <Txt size={12} dim upper>Next</Txt>
          <Txt weight="600" center numberOfLines={2}>{next.name}</Txt>
          {error ? (
            <View style={{ alignItems: 'center', gap: space.sm, marginTop: space.md }}>
              <Txt size={12} color={colors.danger} center numberOfLines={3}>{error}</Txt>
              <Button label="Retry" small kind="secondary" onPress={onRetry} />
            </View>
          ) : upNext ? (
            <Txt size={12} faint style={{ marginTop: space.sm }}>Keep scrolling</Txt>
          ) : loading ? (
            <ActivityIndicator color={colors.textDim} style={{ marginTop: space.md }} />
          ) : null}
        </>
      ) : (
        <>
          <Txt dim>You’re all caught up</Txt>
          <Button label="Back to series" small kind="ghost" onPress={() => router.back()} style={{ marginTop: space.md }} />
        </>
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

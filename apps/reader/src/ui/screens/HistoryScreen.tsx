import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';

import { useApp } from '@/composition/AppProvider';
import { IconButton } from '@/ui/components/Buttons';
import { Header } from '@/ui/components/Header';
import { Empty, ErrorState, Loading } from '@/ui/components/States';
import { Txt } from '@/ui/components/Txt';
import { formatRelativeTime } from '@/ui/format';
import { useQuery } from '@/ui/hooks/useQuery';
import { colors, radius, space } from '@/ui/theme';

export function HistoryScreen() {
  const { uc, sources } = useApp();
  const load = useCallback(() => uc.library.history(), [uc]);
  const { data, error, reload, act } = useQuery(load);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header
        title="History"
        right={
          data.length ? (
            <IconButton
              glyph="⌫"
              label="Clear history"
              onPress={() =>
                Alert.alert('Clear all history?', undefined, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Clear', style: 'destructive', onPress: () => act(() => uc.library.clearHistory()) },
                ])
              }
            />
          ) : null
        }
      />
      <FlatList
        data={data}
        keyExtractor={(h) => String(h.entry.chapterId)}
        ListEmptyComponent={<Empty title="Nothing read yet" />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/reader/[chapterId]', params: { chapterId: String(item.chapter.id) } })}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: pressed ? colors.surface : undefined })}
          >
            <Pressable onPress={() => router.push({ pathname: '/manga/[id]', params: { id: String(item.manga.id) } })}>
              <View style={{ width: 52, aspectRatio: 2 / 3, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceHigh }}>
                {item.manga.thumbnailUrl ? <Image source={{ uri: item.manga.thumbnailUrl, headers: sources.has(item.manga.sourceId) ? sources.headers(item.manga.sourceId) : undefined }} style={{ flex: 1 }} contentFit="cover" /> : null}
              </View>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Txt weight="600" numberOfLines={1}>{item.manga.title}</Txt>
              <Txt size={13} dim numberOfLines={1}>{item.chapter.name}{!item.chapter.read && item.chapter.lastPageRead > 0 ? ` · page ${item.chapter.lastPageRead + 1}` : ''}</Txt>
              <Txt size={12} faint>{formatRelativeTime(item.entry.lastRead)}</Txt>
            </View>
            <IconButton glyph="✕" label="Remove from history" onPress={() => act(() => uc.library.removeHistory(item.chapter.id))} />
          </Pressable>
        )}
      />
    </View>
  );
}

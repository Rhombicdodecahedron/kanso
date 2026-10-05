import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';

import { useApp } from '@/composition/AppProvider';
import type { HistoryEntry } from '@/core/domain/model';
import { IconButton } from '@/ui/components/Buttons';
import { Header } from '@/ui/components/Header';
import { Empty, ErrorState, Loading } from '@/ui/components/States';
import { icons } from '@/ui/components/Icon';
import { Snackbar, useSnackbar } from '@/ui/components/Snackbar';
import { Txt } from '@/ui/components/Txt';
import { formatRelativeTime } from '@/ui/format';
import { useQuery } from '@/ui/hooks/useQuery';
import { colors, radius, space } from '@/ui/theme';
import { syncWidget } from '@/widgets/sync';

export function HistoryScreen() {
  const { uc, sources } = useApp();
  const load = useCallback(() => uc.library.history(), [uc]);
  const { data, error, reload, act } = useQuery(load);
  const snackbar = useSnackbar();
  // Removing shows what was removed, with a way to put it back.
  const removeWithUndo = (text: string, remove: () => Promise<HistoryEntry[]>) =>
    act(async () => {
      const removed = await remove();
      void syncWidget(uc, sources);
      snackbar.show({ text, action: { label: 'Undo', onPress: () => void act(async () => {
            await uc.library.restoreHistory(removed);
            void syncWidget(uc, sources);
          }) } });
    });
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header
        title="History"
        right={
          data.length ? (
            <IconButton
              icon={icons.clearAll}
              label="Clear history"
              onPress={() =>
                Alert.alert('Clear all history?', undefined, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Clear', style: 'destructive', onPress: () => removeWithUndo('History cleared', () => uc.library.clearHistory()) },
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
            <IconButton icon={icons.close} size={18} color={colors.textDim} label="Remove from history" onPress={() => removeWithUndo(`Removed ${item.manga.title} from history`, () => uc.library.removeHistory(item.manga.id))} />
          </Pressable>
        )}
      />
      <Snackbar message={snackbar.message} onHide={snackbar.hide} />
    </View>
  );
}

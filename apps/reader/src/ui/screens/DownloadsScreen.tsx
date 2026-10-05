import { Stack } from 'expo-router';
import { useCallback, useEffect } from 'react';

import { useQuery } from '@/ui/hooks/useQuery';
import { FlatList, View } from 'react-native';

import { useApp } from '@/composition/AppProvider';
import type { Chapter, Download, Manga } from '@/core/domain/model';
import { Button, Row } from '@/ui/components/Buttons';
import { Empty } from '@/ui/components/States';
import { Txt } from '@/ui/components/Txt';
import { colors, space } from '@/ui/theme';

interface Row_ {
  d: Download;
  chapter: Chapter | null;
  manga: Manga | null;
}

export function DownloadsScreen() {
  const { uc } = useApp();
  const load = useCallback(async () => {
    const list = await uc.downloads.list();
    const out: Row_[] = [];
    for (const d of list) {
      const m = await uc.catalog.manga(d.mangaId).catch(() => null);
      out.push({ d, manga: m?.manga ?? null, chapter: m?.chapters.find((c) => c.id === d.chapterId) ?? null });
    }
    return out;
  }, [uc]);
  const { data, reload } = useQuery(load);
  useEffect(() => uc.downloads.subscribe(() => void reload()), [uc, reload]);
  const rows = data ?? [];
  const refresh = reload;

  const active = rows.filter((r) => r.d.state !== 'done');
  const done = rows.filter((r) => r.d.state === 'done');
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Downloads' }} />
      <FlatList
        data={[...active, ...done]}
        keyExtractor={(r) => String(r.d.chapterId)}
        ListEmptyComponent={<Empty title="No downloads" body="Long-press chapters on a series page to download them." />}
        renderItem={({ item: r }) => (
          <Row style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Txt weight="600" numberOfLines={1}>{r.manga?.title ?? 'Unknown'}</Txt>
              <Txt size={13} dim numberOfLines={1}>{r.chapter?.name ?? `Chapter ${r.d.chapterId}`}</Txt>
              <Txt size={12} color={r.d.state === 'error' ? colors.danger : colors.textFaint} numberOfLines={2}>
                {r.d.state === 'downloading' ? `${r.d.progress}/${r.d.total || '?'} pages` : r.d.state === 'error' ? r.d.error : r.d.state === 'done' ? `${r.d.total} pages` : 'Queued'}
              </Txt>
            </View>
            {r.d.state === 'error' ? <Button label="Retry" small kind="secondary" onPress={() => uc.downloads.retry(r.d.chapterId)} /> : null}
            {r.d.state === 'done' ? (
              <Button label="Delete" small kind="ghost" onPress={async () => { await uc.downloads.remove(r.d.chapterId); await refresh(); }} />
            ) : (
              <Button label="Cancel" small kind="ghost" onPress={async () => { await uc.downloads.cancel(r.d.chapterId); await refresh(); }} />
            )}
          </Row>
        )}
      />
    </View>
  );
}

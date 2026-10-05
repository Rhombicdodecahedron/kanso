import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { useApp } from '@/composition/AppProvider';
import { Header } from '@/ui/components/Header';
import { Txt } from '@/ui/components/Txt';
import { colors, space } from '@/ui/theme';

export function MoreScreen() {
  const { loadErrors } = useApp();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="More" />
      <ScrollView>
        <Item title="Downloads" body="Queue and downloaded chapters" onPress={() => router.push('/downloads')} />
        <Item title="Settings" body="Reader, library, languages, content" onPress={() => router.push('/settings')} />
        {loadErrors.length ? (
          <View style={{ padding: space.lg, gap: space.xs }}>
            <Txt weight="700" color={colors.danger}>Extensions that failed to load</Txt>
            {loadErrors.map((e) => (
              <Txt key={e.pkg} size={12} dim>{e.pkg}: {e.message}</Txt>
            ))}
          </View>
        ) : null}
        <Txt size={12} faint style={{ padding: space.lg }}>
          Kanso runs extensions translated from the Mihon extension ecosystem (keiyoushi/extensions-source, Apache-2.0). It is not affiliated with Mihon.
        </Txt>
      </ScrollView>
    </View>
  );
}

function Item({ title, body, onPress }: { title: string; body: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: pressed ? colors.surface : undefined })}>
      <Txt size={16} weight="500">{title}</Txt>
      <Txt size={13} dim>{body}</Txt>
    </Pressable>
  );
}

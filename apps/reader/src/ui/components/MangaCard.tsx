import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { colors, radius, space } from '../theme';
import { Txt } from './Txt';

export interface CardProps {
  title: string;
  cover: string | null;
  headers?: Record<string, string>;
  badge?: number;
  inLibrary?: boolean;
  width: number;
  onPress: () => void;
  onLongPress?: () => void;
}

/** Cover-first grid card, Mihon's "compact grid". */
export function MangaCard({ title, cover, headers, badge, inLibrary, width, onPress, onLongPress }: CardProps) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => ({ width, padding: space.xs, opacity: pressed ? 0.8 : 1 })}>
      <View style={{ aspectRatio: 2 / 3, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceHigh }}>
        {cover ? (
          <Image source={{ uri: cover, headers }} style={{ flex: 1, opacity: inLibrary ? 0.45 : 1 }} contentFit="cover" transition={150} recyclingKey={cover} />
        ) : null}
        {badge ? (
          <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: colors.accent, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Txt size={12} weight="700" color="#1A1306">{badge}</Txt>
          </View>
        ) : null}
        {inLibrary ? (
          <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: colors.surfaceHigh, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Txt size={11} weight="700">In library</Txt>
          </View>
        ) : null}
      </View>
      <Txt size={13} weight="500" numberOfLines={2} style={{ marginTop: 6, lineHeight: 17 }}>{title}</Txt>
    </Pressable>
  );
}

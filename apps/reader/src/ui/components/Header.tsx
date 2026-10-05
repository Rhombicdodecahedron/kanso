import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, space } from '../theme';
import { Txt } from './Txt';

/** Large-title header used by tab screens. */
export function Header({ title, right, children }: { title: string; right?: ReactNode; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 }}>
        <Txt size={28} weight="700">{title}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>{right}</View>
      </View>
      {children}
    </View>
  );
}

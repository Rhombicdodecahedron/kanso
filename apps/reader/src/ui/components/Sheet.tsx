import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space } from '../theme';
import { Txt } from './Txt';

export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} />
      <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '80%', paddingBottom: insets.bottom + space.md }}>
        <View style={{ alignItems: 'center', paddingVertical: space.sm }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
        </View>
        {title ? <Txt size={17} weight="700" style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>{title}</Txt> : null}
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

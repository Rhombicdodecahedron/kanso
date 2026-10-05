import { Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';

import { colors } from '@/ui/theme';

type Names = Extract<SymbolViewProps['name'], object>;
type Glyph = { ios: NonNullable<Names['ios']>; iosActive: NonNullable<Names['ios']>; android: NonNullable<Names['android']> };

/** SF Symbols on iOS (filled when selected, like the system apps), Material Symbols on Android. */
const icon = ({ ios, iosActive, android }: Glyph) =>
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <SymbolView name={{ ios: focused ? iosActive : ios, android }} tintColor={color} size={24} weight="medium" />;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Library', tabBarIcon: icon({ ios: 'books.vertical', iosActive: 'books.vertical.fill', android: 'collections_bookmark' }) }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: icon({ ios: 'clock', iosActive: 'clock.fill', android: 'history' }) }} />
      <Tabs.Screen name="browse" options={{ title: 'Browse', tabBarIcon: icon({ ios: 'safari', iosActive: 'safari.fill', android: 'explore' }) }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon({ ios: 'ellipsis.circle', iosActive: 'ellipsis.circle.fill', android: 'more_horiz' }) }} />
    </Tabs>
  );
}

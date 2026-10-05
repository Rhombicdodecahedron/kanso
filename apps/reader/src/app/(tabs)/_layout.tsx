import { Tabs } from 'expo-router';

import { Txt } from '@/ui/components/Txt';
import { colors } from '@/ui/theme';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: string | import("react-native").ColorValue }) {
    return <Txt size={20} color={String(color)}>{glyph}</Txt>;
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
      <Tabs.Screen name="index" options={{ title: 'Library', tabBarIcon: icon('▤') }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: icon('◷') }} />
      <Tabs.Screen name="browse" options={{ title: 'Browse', tabBarIcon: icon('◎') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('⋯') }} />
    </Tabs>
  );
}

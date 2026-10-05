import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { Txt } from '@/ui/components/Txt';
import { colors } from '@/ui/theme';

import { createApp, type App } from './container';

const AppContext = createContext<App | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [app, setApp] = useState<App | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createApp().then(setApp, (e) => setError(String(e?.message ?? e)));
  }, []);

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Txt style={{ textAlign: 'center' }}>Could not open the library.{'\n'}{error}</Txt>
      </View>
    );
  }
  if (!app) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return <AppContext.Provider value={app}>{children}</AppContext.Provider>;
}

export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApp must be used inside AppProvider.');
  return app;
}

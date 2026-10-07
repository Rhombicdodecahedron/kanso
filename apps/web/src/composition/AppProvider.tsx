'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useRouter } from 'next/navigation';

import { OtherTabError } from '@/adapters/sqlite/browserDriver';
import { BootScreen } from '@/ui/components/BootScreen';

import type { App } from './container';

export const AppContext = createContext<App | null>(null);

// One app per tab, kept across client-side navigations.
let booting: Promise<App> | null = null;

export function AppProvider({ children }: { children: ReactNode }) {
  const [app, setApp] = useState<App | null>(null);
  const [error, setError] = useState<{ message: string; otherTab: boolean } | null>(null);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    void (async () => {
      // Offline (no answer at all), the library still opens: downloads are readable without the server.
      const session = await fetch('/api/session', { cache: 'no-store' }).then((r) => r.json() as Promise<{ authenticated: boolean }>).catch(() => null);
      if (session && !session.authenticated) {
        router.replace('/connect');
        return;
      }
      booting ??= import('./container').then((m) => m.createApp());
      booting.then(
        (a) => alive && setApp(a),
        (e) => {
          booting = null;
          if (alive) setError({ message: e instanceof Error ? e.message : String(e), otherTab: e instanceof OtherTabError });
        },
      );
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  useEffect(() => app?.onUnauthorized(() => router.replace('/connect')), [app, router]);

  // The app shell is kept for offline use (production builds only: dev assets change constantly).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  if (error) return <BootScreen error={error.message} retry={!error.otherTab} />;
  if (!app) return <BootScreen />;
  return <AppContext.Provider value={app}>{children}</AppContext.Provider>;
}

export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApp must be used inside AppProvider.');
  return app;
}

'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useRouter } from 'next/navigation';

import { OtherTabError } from '@/adapters/sqlite/wasmDriver';
import { BootScreen } from '@/ui/components/BootScreen';

import type { App } from './container';

const AppContext = createContext<App | null>(null);

// One app per tab, kept across client-side navigations.
let booting: Promise<App> | null = null;

export function AppProvider({ children }: { children: ReactNode }) {
  const [app, setApp] = useState<App | null>(null);
  const [error, setError] = useState<{ message: string; otherTab: boolean } | null>(null);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const session = await fetch('/api/session', { cache: 'no-store' }).then((r) => r.json() as Promise<{ authenticated: boolean }>).catch(() => ({ authenticated: false }));
      if (!session.authenticated) {
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

  if (error) return <BootScreen error={error.message} retry={!error.otherTab} />;
  if (!app) return <BootScreen />;
  return <AppContext.Provider value={app}>{children}</AppContext.Provider>;
}

export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApp must be used inside AppProvider.');
  return app;
}

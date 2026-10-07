import { useFocusEffect } from 'expo-router';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { AppContext } from '@/composition/AppProvider';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Loads on mount, every time the tab regains focus, when the app returns to the foreground (the
 * day may have changed while it was in the background) and when sync brings changes from another
 * device. `reload` refreshes on demand.
 * `load` must be stable (wrap it in useCallback), as a new function triggers a new load.
 */
export function useQuery<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const app = useContext(AppContext);

  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const result = await load();
      // A slower, older request must not overwrite a newer one.
      if (ticket !== latest.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (ticket === latest.current) setError(message(e));
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reload();
    });
    const offSync = app?.sync.onDataChanged(() => void reload());
    return () => {
      subscription.remove();
      offSync?.();
    };
  }, [reload, app]);

  /**
   * Runs a user action, then refreshes the screen to show its result. A failure means what was on
   * screen was out of date (for example a second tap on something already removed), so refreshing
   * is also the answer to the error.
   */
  const act = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
      } catch {
        // shown state was stale: the reload below fixes it
      }
      await reload();
    },
    [reload],
  );

  return { data, error, reload, setData, act };
}

import { useCallback, useEffect, useRef, useState } from 'react';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Loads on mount and whenever the tab becomes visible again (another device may have changed
 * things meanwhile). `load` must be stable (wrap it in useCallback).
 */
export function useQuery<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading is the point of this hook
    void reload();
    const onVisible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  /** Runs a user action, then refreshes (a failure means what was shown was stale). */
  const act = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch {
        // the reload below shows the real state
      }
      await reload();
    },
    [reload],
  );

  return { data, error, reload, setData, act };
}

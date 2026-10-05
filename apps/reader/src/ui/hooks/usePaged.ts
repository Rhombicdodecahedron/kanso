import { useEffect, useRef, useState } from 'react';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface PagedState<T> {
  key: string;
  items: T[];
  page: number;
  hasNext: boolean;
  error: string | null;
  busy: boolean;
}

/**
 * Infinite list keyed by `key`: a new key starts again at page 1. State only changes in async
 * callbacks, so the first page of a new key shows as loading without a synchronous setState.
 */
export function usePaged<T extends { id: number }>(key: string, fetch: (page: number) => Promise<{ items: T[]; hasNext: boolean }>) {
  const [st, setSt] = useState<PagedState<T>>({ key: '', items: [], page: 0, hasNext: true, error: null, busy: false });
  const [nonce, setNonce] = useState(0);
  const fetchRef = useRef(fetch);
  useEffect(() => {
    fetchRef.current = fetch;
  });

  useEffect(() => {
    let alive = true;
    fetchRef.current(1).then(
      (r) => alive && setSt({ key, items: r.items, page: 1, hasNext: r.hasNext && r.items.length > 0, error: null, busy: false }),
      (e) => alive && setSt({ key, items: [], page: 0, hasNext: true, error: message(e), busy: false }),
    );
    return () => {
      alive = false;
    };
  }, [key, nonce]);

  const current: PagedState<T> = st.key === key ? st : { key, items: [], page: 0, hasNext: true, error: null, busy: true };

  const loadMore = () => {
    if (current.busy || !current.hasNext || current.error) return;
    setSt((s) => ({ ...s, busy: true }));
    fetchRef.current(current.page + 1).then(
      (r) =>
        setSt((s) => {
          if (s.key !== key) return s;
          const seen = new Set(s.items.map((x) => x.id));
          return { ...s, items: [...s.items, ...r.items.filter((x) => !seen.has(x.id))], page: s.page + 1, hasNext: r.hasNext && r.items.length > 0, busy: false };
        }),
      (e) => setSt((s) => ({ ...s, busy: false, error: message(e) })),
    );
  };

  const retry = () => {
    if (current.page === 0) setNonce((n) => n + 1);
    else {
      setSt((s) => ({ ...s, error: null }));
    }
  };

  return { ...current, loading: current.busy, loadMore, retry };
}

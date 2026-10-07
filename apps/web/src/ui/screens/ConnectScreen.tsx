'use client';

import { useEffect, useState, type FormEvent } from 'react';

import styles from './ConnectScreen.module.css';

/** Trades the shared token for a session cookie; the proxy and sync APIs need one. */
export function ConnectScreen() {
  const [state, setState] = useState<'checking' | 'out' | 'in'>('checking');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((r: { authenticated: boolean }) => setState(r.authenticated ? 'in' : 'out'))
      .catch(() => setState('out'));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token.trim() }) });
    if (res.ok) {
      setToken('');
      setState('in');
    } else setError(res.status === 401 ? 'That token is not right.' : `The server answered HTTP ${res.status}.`);
  }

  async function signOut() {
    await fetch('/api/session', { method: 'DELETE' });
    setState('out');
  }

  return (
    <main className={styles.wrap}>
      <h1 className={styles.title}>Kanso</h1>
      {state === 'checking' ? null : state === 'in' ? (
        <section className={styles.card}>
          <p className={styles.ok}>Connected to this server.</p>
          <button className={styles.secondary} onClick={signOut}>
            Sign out
          </button>
        </section>
      ) : (
        <form className={styles.card} onSubmit={submit}>
          <label htmlFor="token" className={styles.label}>
            Access token
          </label>
          <p className={styles.hint}>The KANSO_TOKEN set on this deployment. You only enter it once per browser.</p>
          <input id="token" className={styles.input} type="password" autoComplete="current-password" value={token} onChange={(e) => setToken(e.target.value)} />
          {error ? <p className={styles.error}>{error}</p> : null}
          <button className={styles.primary} disabled={!token.trim()}>
            Connect
          </button>
        </form>
      )}
    </main>
  );
}

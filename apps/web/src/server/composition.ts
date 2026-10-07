// Server composition root: picks the adapters behind each route. Built lazily so `next build`
// does not need the secrets.
import 'server-only';

import { fetchTransport } from '@kanso/transport';

import { createAuth, type Auth } from './auth';
import { createImageHandler, createProxyHandler, createSessionHandlers } from './handlers';
import { createUrlGuard } from './ssrf';

let auth: Auth | null = null;
function getAuth(): Auth {
  return (auth ??= createAuth({ token: process.env.KANSO_TOKEN ?? '', sessionSecret: process.env.KANSO_SESSION_SECRET ?? '' }));
}

const guard = createUrlGuard();
const lazy = <A extends unknown[], R>(make: () => (...a: A) => R) => {
  let h: ((...a: A) => R) | null = null;
  return (...a: A) => (h ??= make())(...a);
};

export const proxy = lazy(() => createProxyHandler({ auth: getAuth(), guard, transport: fetchTransport }));
export const image = lazy(() => createImageHandler({ auth: getAuth(), guard }));
export const session = {
  POST: lazy(() => createSessionHandlers(getAuth()).POST),
  GET: lazy(() => createSessionHandlers(getAuth()).GET),
  DELETE: lazy(() => createSessionHandlers(getAuth()).DELETE),
};

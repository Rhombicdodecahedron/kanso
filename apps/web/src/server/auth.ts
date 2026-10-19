// Single-user auth: the shared KANSO_TOKEN, typed once in Settings, buys a signed session cookie.
// Native clients (the iPhone app) send the token as a Bearer header instead.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'kanso_session';
const SESSION_DAYS = 30;

export interface AuthConfig {
  token: string;
  sessionSecret: string;
  now?: () => number;
}

export interface Auth {
  /** True when the request carries a valid session cookie or Bearer token. */
  check(req: Request): boolean;
  /** Set-Cookie value for a new session, or null when the token is wrong. */
  login(token: string): string | null;
  logoutCookie(): string;
}

const digest = (s: string) => createHash('sha256').update(s).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function createAuth(cfg: AuthConfig): Auth {
  if (cfg.token.length < 32) throw new Error('KANSO_TOKEN must be at least 32 characters');
  if (cfg.sessionSecret.length < 32) throw new Error('KANSO_SESSION_SECRET must be at least 32 characters');
  const now = cfg.now ?? Date.now;
  // Keyed on the token too: rotating KANSO_TOKEN signs every existing session out.
  const key = createHmac('sha256', cfg.sessionSecret).update(cfg.token).digest();
  const sign = (exp: number) => createHmac('sha256', key).update(`session:${exp}`).digest('base64url');
  const cookie = (value: string, maxAge: number) => `${SESSION_COOKIE}=${value}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

  return {
    check(req) {
      const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (bearer) return same(bearer, cfg.token);
      const value = readCookie(req, SESSION_COOKIE);
      const m = value?.match(/^(\d+)\.([\w-]+)$/);
      if (!m) return false;
      const exp = Number(m[1]);
      return exp > now() && same(m[2], sign(exp));
    },
    login(token) {
      if (!same(token, cfg.token)) return null;
      const maxAge = SESSION_DAYS * 86_400;
      const exp = now() + maxAge * 1000;
      return cookie(`${exp}.${sign(exp)}`, maxAge);
    },
    logoutCookie: () => cookie('', 0),
  };
}

export const unauthorized = () => new Response('Unauthorized', { status: 401 });

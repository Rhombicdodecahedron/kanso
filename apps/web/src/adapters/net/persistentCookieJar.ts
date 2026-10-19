import { Cookie, type HttpUrl, MemoryCookieJar } from '@kanso/source-api/src/okhttp';

import { idb } from '../storage/idb';

type Stored = [string, string, string, string, number, boolean, boolean, boolean];
const KEY = 'cookies';

/** Source cookies (sessions, consent, age gates) kept across visits. */
export class PersistentCookieJar extends MemoryCookieJar {
  private timer: ReturnType<typeof setTimeout> | null = null;

  static async load(): Promise<PersistentCookieJar> {
    const jar = new PersistentCookieJar();
    const stored = ((await (await idb()).get('kv', KEY)) as Stored[] | undefined) ?? [];
    const now = Date.now();
    jar.cookies = stored.filter((s) => s[4] > now).map((s) => new Cookie(...s));
    return jar;
  }

  override saveFromResponse(url: HttpUrl, cookies: Cookie[]): void {
    super.saveFromResponse(url, cookies);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 500);
  }

  private async flush() {
    const rows: Stored[] = this.cookies.map((c) => [c.name, c.value, c.domain, c.path, c.expiresAt, c.secure, c.httpOnly, c.hostOnly]);
    await (await idb()).put('kv', rows, KEY);
  }
}

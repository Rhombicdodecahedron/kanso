// Android / DI shims used by extensions. Anything that needs real Android (WebView, Bitmap)
// is intentionally absent so the translator reports those extensions as unsupported.

import { IllegalArgumentException, str } from '../kotlin/core';
import { Json } from '../serialization/json';
import { NetworkHelper, network } from '../source';
import { appContext, Context } from '../source/preferences';
import { host } from '../source';

export const Log = {
  d: (tag: any, msg: any) => logAt('debug', tag, msg),
  i: (tag: any, msg: any) => logAt('info', tag, msg),
  w: (tag: any, msg: any) => logAt('warn', tag, msg),
  e: (tag: any, msg: any, _t?: any) => logAt('error', tag, msg),
  v: (tag: any, msg: any) => logAt('debug', tag, msg),
};
function logAt(level: 'debug' | 'info' | 'warn' | 'error', tag: any, msg: any): number {
  try {
    host().log(level, str(tag), str(msg));
  } catch {
    console.log(`[${level}] ${str(tag)}: ${str(msg)}`);
  }
  return 0;
}

export const Toast = {
  LENGTH_SHORT: 0,
  LENGTH_LONG: 1,
  makeText: (_ctx: any, text: any, _len: number) => ({
    show: () => logAt('info', 'Toast', text),
  }),
};

export const Build = {
  VERSION: { SDK_INT: 34, RELEASE: '14' },
  VERSION_CODES: { O: 26, P: 28, Q: 29, R: 30, S: 31, TIRAMISU: 33, UPSIDE_DOWN_CAKE: 34 },
  MODEL: 'Kanso',
  MANUFACTURER: 'Kanso',
};

export const InputType = {
  TYPE_CLASS_TEXT: 1,
  TYPE_CLASS_NUMBER: 2,
  TYPE_TEXT_VARIATION_URI: 16,
  TYPE_TEXT_VARIATION_PASSWORD: 128,
  TYPE_NUMBER_FLAG_DECIMAL: 8192,
};

export const SystemClock = {
  elapsedRealtime: () => Math.round(globalThis.performance?.now?.() ?? Date.now()),
  uptimeMillis: () => Math.round(globalThis.performance?.now?.() ?? Date.now()),
};

export class Application extends Context {}

/** eu.kanade.tachiyomi.AppInfo */
export const AppInfo = {
  getVersionCode: () => 130,
  getVersionName: () => '0.17.0',
  getSupportedImageMimeTypes: () => ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'],
  isDebug: () => false,
};

/** uy.kohesive.injekt: `Injekt.get<T>()` / `injectLazy<T>()` with the reified class appended. */
export const Injekt = {
  get: (T: any) => resolveInjected(T),
  getInstance: (T: any) => resolveInjected(T),
};
export function injectLazy(T: any): { value: any } {
  let v: any;
  let done = false;
  return {
    get value() {
      if (!done) {
        v = resolveInjected(T);
        done = true;
      }
      return v;
    },
  };
}
function resolveInjected(T: any): any {
  if (T === NetworkHelper) return network;
  if (T === Json) return new Json();
  if (T === Application || T === Context) return appContext;
  throw new IllegalArgumentException(`No injectable instance for ${T?.name ?? T}`);
}

/** android.net.Uri - a thin wrapper over our URL parser. */
export class Uri {
  constructor(private readonly s: string) {}
  static parse(s: string): Uri {
    return new Uri(s);
  }
  static encode(s: string): string {
    return encodeURIComponent(s);
  }
  static decode(s: string): string {
    return decodeURIComponent(s);
  }
  get host(): string | null {
    return /^[a-z]+:\/\/([^/:?#]+)/i.exec(this.s)?.[1] ?? null;
  }
  get path(): string | null {
    return /^[a-z]+:\/\/[^/?#]*([^?#]*)/i.exec(this.s)?.[1] ?? null;
  }
  get pathSegments(): string[] {
    return (this.path ?? '').split('/').filter(Boolean);
  }
  get lastPathSegment(): string | null {
    const p = this.pathSegments;
    return p.length ? p[p.length - 1] : null;
  }
  get scheme(): string | null {
    return /^([a-z][a-z0-9+.-]*):/i.exec(this.s)?.[1] ?? null;
  }
  getQueryParameter(k: string): string | null {
    const q = this.s.split('?')[1]?.split('#')[0] ?? '';
    for (const part of q.split('&')) {
      const [a, b = ''] = part.split('=');
      if (decodeURIComponent(a) === k) return decodeURIComponent(b.replace(/\+/g, ' '));
    }
    return null;
  }
  toString(): string {
    return this.s;
  }
}

export { appContext, Context };

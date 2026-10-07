import type { ImageRequest } from '@kanso/core';
import { HttpUrl, type CookieJar } from '@kanso/source-api/src/okhttp';

/**
 * Image requests go through the app's image proxy, which can send the Referer, User-Agent and
 * cookies the source expects. The browser keeps the proxied images in its private cache.
 */
export function createImageSrc(jar: CookieJar) {
  return (req: ImageRequest): string => {
    if (/^(blob|data):/.test(req.url)) return req.url;
    const headers = { ...req.headers };
    const url = HttpUrl.parse(req.url);
    const cookies = url ? jar.loadForRequest(url) : [];
    if (cookies.length && !Object.keys(headers).some((k) => k.toLowerCase() === 'cookie')) headers.Cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    return `/api/img?r=${base64url(JSON.stringify({ url: req.url, headers }))}`;
  };
}

function base64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

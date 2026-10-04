import { describe, expect, it } from 'vitest';
import { HttpUrl, resolveUrl } from '../src/okhttp/url';

describe('HttpUrl', () => {
  it('builds with OkHttp encoding', () => {
    const u = HttpUrl.get('https://Example.com/a b/').newBuilder()!
      .addPathSegment('c/d')
      .addQueryParameter('q', 'one two+three&four')
      .addEncodedQueryParameter('e', 'x%20y')
      .build();
    expect(u.toString()).toBe('https://example.com/a%20b/c%2Fd?q=one%20two%2Bthree%26four&e=x%20y');
    expect(u.queryParameter('q')).toBe('one two+three&four');
    expect(u.pathSegments).toEqual(['a b', 'c/d']);
  });
  it('addPathSegments splits and resolves', () => {
    expect(HttpUrl.get('https://x.com').newBuilder()!.addPathSegments('a/b/../c').build().toString()).toBe('https://x.com/a/c');
  });
  it('resolves references', () => {
    expect(resolveUrl('https://x.com/a/b?q=1', '../c')).toBe('https://x.com/c');
    expect(resolveUrl('https://x.com/a/b', '//cdn.y.com/i.png')).toBe('https://cdn.y.com/i.png');
    expect(resolveUrl('https://x.com/a/b', '?p=2')).toBe('https://x.com/a/b?p=2');
    expect(resolveUrl('https://x.com/a/b', '/z')).toBe('https://x.com/z');
    expect(HttpUrl.get('https://x.com/manga/').resolve('?p=1')!.toString()).toBe('https://x.com/manga/?p=1');
  });
  it('rejects non-http', () => {
    expect(HttpUrl.parse('ftp://x.com')).toBeNull();
    expect(HttpUrl.parse('not a url')).toBeNull();
  });
});

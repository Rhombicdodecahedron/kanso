import { describe, expect, it } from 'vitest';
import '../src/runtime';
import { call, IllegalArgumentException, IllegalStateException } from '../src/kotlin/core';
import { Jsoup } from '../src/jsoup';
import { Headers, RequestBuilder, Response, ResponseBody, MediaType } from '../src/okhttp';
import { JsonObject, T, type Desc } from '../src/serialization/json';
import { JDate } from '../src/java/legacy';
import { modules } from '../src/modules';

const extractNextJs = modules['keiyoushi.utils.extractNextJs'] as any[];
const extractNextJsRsc = modules['keiyoushi.utils.extractNextJsRsc'] as any[];
const ReactFlightDate = modules['keiyoushi.utils.reactFlight.ReactFlightDate'] as Desc;
const ReactFlightBigInt = modules['keiyoushi.utils.reactFlight.ReactFlightBigInt'] as Desc;
const ReactFlightNumber = modules['keiyoushi.utils.reactFlight.ReactFlightNumber'] as Desc;

// ---- DTOs shaped like translator output ----
class Chapter {
  constructor(
    public number: number,
    public title: string | null = null,
  ) {}
  static $serial = {
    fields: [
      { name: 'number', json: 'number', type: T.int, optional: false },
      { name: 'title', json: 'title', type: T.nullable(T.str), optional: true },
    ],
  };
}
class Manga {
  constructor(
    public id: number,
    public title: string,
    public cover: string | null,
  ) {}
  static $serial = {
    fields: [
      { name: 'id', json: 'id', type: T.int, optional: false },
      { name: 'title', json: 'title', alt: ['name'], type: T.str, optional: false },
      { name: 'cover', json: 'cover', type: T.nullable(T.str), optional: false },
    ],
  };
}
class Page {
  constructor(
    public manga: Manga,
    public chapters: Map<string, Chapter>,
    public tags: string[],
    public updatedAt: JDate,
    public views: bigint,
    public rating: number,
    public desc: string,
    public price: string,
    public extra: string | null = null,
  ) {}
  static $serial = {
    fields: [
      { name: 'manga', json: 'manga', type: T.cls(Manga), optional: false },
      { name: 'chapters', json: 'chapters', type: T.map(T.str, T.cls(Chapter)), optional: false },
      { name: 'tags', json: 'tags', type: T.list(T.str), optional: false },
      { name: 'updatedAt', json: 'updatedAt', type: ReactFlightDate, optional: false },
      { name: 'views', json: 'views', type: ReactFlightBigInt, optional: false },
      { name: 'rating', json: 'rating', type: ReactFlightNumber, optional: false },
      { name: 'desc', json: 'desc', type: T.str, optional: false },
      { name: 'price', json: 'price', type: T.str, optional: false },
      { name: 'extra', json: 'extra', type: T.nullable(T.str), optional: true },
    ],
  };
}
class AllOptional {
  constructor(public a: string | null = null) {}
  static $serial = { fields: [{ name: 'a', json: 'a', type: T.nullable(T.str), optional: true }] };
}

// ---- a realistic RSC flight body ----
const longText = 'Résumé — a story with emoji 😀 and\nnewlines, "quotes" and 7:fake rows';
const tLen = new TextEncoder().encode(longText).length.toString(16);
const rsc =
  '0:["$","$L1",null,{"children":["$","div",null,{"className":"page","children":"$L2"}]}]\n' +
  '1:I["(app-pages-browser)/./app/manga/[slug]/page.tsx",["app/manga/[slug]/page","static/chunks/app/manga/page-7f3a.js"],"default"]\n' +
  '2:["$","$L3",null,{"manga":"$4","chapters":"$Q5","tags":"$W6","updatedAt":"$D2024-03-01T12:34:56.789Z","views":"$n12345678901234567890","rating":"$Infinity","desc":"$7","price":"$$5","extra":"$undefined"}]\n' +
  '4:{"id":42,"title":"One Piece","cover":"$undefined"}\n' +
  '5:[["c1",{"number":1,"title":"Romance Dawn"}],["c2",{"number":2}]]\n' +
  '6:["action","adventure"]\n' +
  `7:T${tLen},${longText}` +
  '8:["$","li",null,{"chapterList":[{"number":10},{"number":11,"title":"$9:title"}]}]\n' +
  '9:{"title":"From a path ref"}\n';

function html(body: string): string {
  const pushes = [
    '<script>(self.__next_f=self.__next_f||[]).push([0])</script>',
    `<script>self.__next_f.push([1,${JSON.stringify(body)}])</script>`,
    '<script src="/_next/static/chunks/main.js"></script>',
  ];
  return `<!DOCTYPE html><html><head><title>x</title></head><body><div id="root"></div>${pushes.join('\n')}</body></html>`;
}

function response(body: string, contentType: string): Response {
  const req = new RequestBuilder().url('https://example.com/manga/one-piece').build();
  return new Response(req, 200, 'OK', new Headers([['Content-Type', contentType]]), new ResponseBody(new TextEncoder().encode(body), MediaType.parse(contentType)));
}

function checkPage(p: Page) {
  expect(p).toBeInstanceOf(Page);
  expect(p.manga.id).toBe(42);
  expect(p.manga.title).toBe('One Piece');
  expect(p.manga.cover).toBeNull();
  expect([...p.chapters.keys()]).toEqual(['c1', 'c2']);
  expect(p.chapters.get('c1')!.title).toBe('Romance Dawn');
  expect(p.tags).toEqual(['action', 'adventure']);
  expect(p.updatedAt.getTime()).toBe(Date.UTC(2024, 2, 1, 12, 34, 56, 789));
  expect(p.views).toBe(12345678901234567890n);
  expect(p.rating).toBe(Infinity);
  expect(p.desc).toBe(longText);
  expect(p.price).toBe('$5');
  expect(p.extra).toBeNull();
}

describe('extractNextJs (App Router)', () => {
  const doc = Jsoup.parse(html(rsc), 'https://example.com/');

  it('infers the predicate from the type and resolves flight references', () => {
    checkPage(call(doc, 'extractNextJs', extractNextJs, [T.cls(Page)]));
  });

  it('accepts an explicit predicate', () => {
    const m = call(doc, 'extractNextJs', extractNextJs, [(e: any) => e instanceof JsonObject && e.has('slug') === false && e.get('id')?.content === '42', T.cls(Manga)]);
    expect(m.title).toBe('One Piece');
  });

  it('infers list predicates (List<T>) and walks `$id:path` references', () => {
    const list = call(doc, 'extractNextJs', extractNextJs, [T.list(T.cls(Chapter))]);
    // `$Q5` became an object, so the first array of chapter objects is row 8's chapterList,
    // whose second item resolved "$9:title"
    expect(list.map((c: Chapter) => c.number)).toEqual([10, 11]);
    expect(list[1].title).toBe('From a path ref');
  });

  it('returns null when nothing matches', () => {
    expect(call(doc, 'extractNextJs', extractNextJs, [() => false, T.cls(Manga)])).toBeNull();
  });

  it('refuses to infer a predicate when every field is optional', () => {
    expect(() => call(doc, 'extractNextJs', extractNextJs, [T.cls(AllOptional)])).toThrow(IllegalArgumentException);
  });

  it('uses an explicit deserializer over the reified descriptor', () => {
    const m = call(doc, 'extractNextJs', extractNextJs, [(e: any) => e instanceof JsonObject && e.has('cover'), T.cls(Manga), T.any]);
    expect(m).toBeInstanceOf(Manga);
  });
});

describe('extractNextJs (Pages Router)', () => {
  const nextData = {
    props: { pageProps: { manga: { id: 7, name: 'Berserk', cover: 'https://cdn/x.jpg' }, chapters: [{ number: 1 }] }, __N_SSG: true },
    page: '/manga/[slug]',
    query: { slug: 'berserk' },
    buildId: 'abc123',
  };
  const doc = Jsoup.parse(`<html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`, 'https://example.com/');

  it('reads pageProps (with @JsonNames alternatives)', () => {
    const m = call(doc, 'extractNextJs', extractNextJs, [T.cls(Manga)]);
    expect(m.title).toBe('Berserk');
    expect(m.cover).toBe('https://cdn/x.jpg');
  });

  it('falls back to the root object', () => {
    const r = call(doc, 'extractNextJs', extractNextJs, [(e: any) => e instanceof JsonObject && e.has('buildId'), T.object]);
    expect(r.get('buildId').content).toBe('abc123');
  });
});

describe('extractNextJsRsc', () => {
  it('parses raw text/x-component bodies', () => {
    checkPage(call(rsc, 'extractNextJsRsc', extractNextJsRsc, [T.cls(Page)]));
  });

  it('guards against reference cycles', () => {
    const body = '0:{"self":"$0","name":"loop","id":1,"title":"t","cover":null}\n';
    const r = call(body, 'extractNextJsRsc', extractNextJsRsc, [(e: any) => e instanceof JsonObject && e.has('name'), T.object]);
    expect(r.get('name').content).toBe('loop');
    expect(r.get('self').get('self').content).toBe('$0');
  });

  it('resolves React element props through "props" segments', () => {
    const body = '0:["$","div",null,{"manga":{"id":3,"title":"Path","cover":null}}]\n1:{"ref":"$0:props:manga"}\n';
    const r = call(body, 'extractNextJsRsc', extractNextJsRsc, [(e: any) => e instanceof JsonObject && e.has('ref'), T.object]);
    expect(r.get('ref').get('title').content).toBe('Path');
  });

  it('decodes ReactFlightNumber markers', () => {
    const body = '0:{"id":1,"a":"$NaN","b":"$-0","c":"$-Infinity","d":2.5}\n';
    const r = call(body, 'extractNextJsRsc', extractNextJsRsc, [(e: any) => e instanceof JsonObject, T.map(T.str, ReactFlightNumber)]);
    expect(Number.isNaN(r.get('a'))).toBe(true);
    expect(Object.is(r.get('b'), -0)).toBe(true);
    expect(r.get('c')).toBe(-Infinity);
    expect(r.get('d')).toBe(2.5);
  });
});

describe('Response.extractNextJs', () => {
  it('dispatches on Content-Type', () => {
    checkPage(call(response(rsc, 'text/x-component'), 'extractNextJs', extractNextJs, [T.cls(Page)]));
    checkPage(call(response(html(rsc), 'text/html; charset=utf-8'), 'extractNextJs', extractNextJs, [T.cls(Page)]));
  });

  it('rejects other content types', () => {
    expect(() => call(response('{}', 'application/json'), 'extractNextJs', extractNextJs, [T.cls(Page)])).toThrow(IllegalStateException);
  });
});

import { describe, expect, it } from 'vitest';
import '../src/runtime';
import { call, defEnum, IOException } from '../src/kotlin/core';
import { named } from '../src/kotlin/named';
import { Headers, RequestBuilder, Response, ResponseBody, MediaType, Buffer as OkBuffer } from '../src/okhttp';
import { MissingFieldException, T } from '../src/serialization/json';
import { decodeProtoBytes, encodeProtoBytes, ProtoBuf } from '../src/serialization/protobuf';
import { modules } from '../src/modules';

const m = (fqn: string) => modules[fqn] as any;
const hex = (b: Int8Array | Uint8Array) => Array.from(b, (x) => (x & 0xff).toString(16).padStart(2, '0')).join(' ');
const bytes = (...xs: (number | string)[]) => Uint8Array.from(xs.flatMap((x) => (typeof x === 'string' ? [...new TextEncoder().encode(x)] : [x])));

// ---- DTOs as the translator emits them (proto = @ProtoNumber) ----
class Status {
  constructor() {}
}
defEnum(Status, [
  ['ONGOING', []],
  ['HIATUS', []],
  ['COMPLETED', []],
]);
(Status as any).$enum = true;

class Chapter {
  constructor(
    public id: number,
    public title: string,
  ) {}
  // no @ProtoNumber: element index + 1
  static $serial = {
    fields: [
      { name: 'id', json: 'id', type: T.int, optional: false },
      { name: 'title', json: 'title', type: T.str, optional: false },
    ],
  };
}

class Title {
  constructor(
    public id: number,
    public name: string,
    public tags: string[],
    public chapters: Chapter[],
    public views: number,
    public rating: number | null,
    public status: any,
    public thumbnail: string | null = 'unset',
    public pages: number[],
    public delta: number,
    public score = 9.5,
    public blob: Int8Array | null = null,
    public cache: string = 'skip-me',
  ) {}
  static $serial = {
    fields: [
      { name: 'id', json: 'id', type: T.int, optional: false, proto: 1 },
      { name: 'name', json: 'name', type: T.str, optional: false, proto: 2 },
      { name: 'tags', json: 'tags', type: T.list(T.str), optional: false, proto: 4 },
      { name: 'chapters', json: 'chapters', type: T.list(T.cls(Chapter)), optional: false, proto: 5 },
      { name: 'views', json: 'views', type: T.long, optional: false, proto: 6 },
      { name: 'rating', json: 'rating', type: T.nullable(T.float), optional: false, proto: 7 },
      { name: 'status', json: 'status', type: { k: 'enum', cls: Status } as any, optional: false, proto: 8 },
      { name: 'thumbnail', json: 'thumbnail', type: T.nullable(T.str), optional: true, proto: 9 },
      { name: 'pages', json: 'pages', type: T.list(T.int), optional: false, proto: 10 },
      { name: 'delta', json: 'delta', type: T.int, optional: false, proto: 11, protoType: 'SIGNED' as const },
      { name: 'score', json: 'score', type: T.double, optional: true, proto: 12 },
      { name: 'blob', json: 'blob', type: T.nullable(T.bytes), optional: true, proto: 13 },
      { name: 'cache', json: '\u0000cache', type: T.any, optional: true }, // @Transient
    ],
  };
}

// Hand-encoded per https://protobuf.dev/programming-guides/encoding/
const TITLE_BYTES = bytes(
  0x08, 0x96, 0x01, // 1: varint 150
  0x12, 0x06, 'Naruto', // 2: "Naruto"
  0x18, 0x07, // 3: unknown varint, skipped
  0x22, 0x01, 'a', // 4: tags += "a"
  0x2a, 0x08, 0x08, 0x01, 0x12, 0x04, 'Ch 1', // 5: Chapter{1: 1, 2: "Ch 1"}
  0x22, 0x01, 'b', // 4: tags += "b" (repeated field split around others)
  0x30, 0x80, 0x80, 0x80, 0x80, 0x80, 0x20, // 6: 2^40
  0x3d, 0x00, 0x00, 0xc0, 0x3f, // 7: float 1.5 (I32)
  0x40, 0x02, // 8: enum ordinal 2
  0x52, 0x04, 0x01, 0xac, 0x02, 0x05, // 10: packed [1, 300, 5]
  0x58, 0x05, // 11: sint32 zigzag(5) = -3
  0x6a, 0x02, 0xff, 0x00, // 13: bytes
  0x7a, 0x03, 0x01, 0x02, 0x03, // 15: unknown length-delimited, skipped
);

describe('ProtoBuf decoding', () => {
  it('decodes a hand-encoded message', () => {
    const t: Title = decodeProtoBytes(TITLE_BYTES, T.cls(Title));
    expect(t).toBeInstanceOf(Title);
    expect(t.id).toBe(150);
    expect(t.name).toBe('Naruto');
    expect(t.tags).toEqual(['a', 'b']);
    expect(t.chapters).toHaveLength(1);
    expect(t.chapters[0]).toBeInstanceOf(Chapter);
    expect(t.chapters[0].title).toBe('Ch 1');
    expect(t.views).toBe(2 ** 40);
    expect(t.rating).toBe(1.5);
    expect(t.status).toBe((Status as any).COMPLETED);
    expect(t.thumbnail).toBeNull(); // absent nullable -> null, even with a default
    expect(t.pages).toEqual([1, 300, 5]);
    expect(t.delta).toBe(-3);
    expect(t.score).toBe(9.5); // absent optional -> default
    expect(Array.from(t.blob!)).toEqual([-1, 0]);
    expect(t.cache).toBe('skip-me');
  });

  it('absent lists decode as empty; unpacked repeated scalars are accepted', () => {
    const t: Title = decodeProtoBytes(bytes(0x08, 0x01, 0x12, 0x00, 0x30, 0x00, 0x40, 0x00, 0x50, 0x07, 0x50, 0x08, 0x58, 0x00), T.cls(Title));
    expect(t.tags).toEqual([]);
    expect(t.chapters).toEqual([]);
    expect(t.pages).toEqual([7, 8]);
    expect(t.rating).toBeNull();
  });

  it('negative int32 uses 10-byte varints', () => {
    const t: Chapter = decodeProtoBytes(bytes(0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0x12, 0x00), T.cls(Chapter));
    expect(t.id).toBe(-1);
  });

  it('missing required fields and wrong wire types throw', () => {
    expect(() => decodeProtoBytes(bytes(0x08, 0x01), T.cls(Chapter))).toThrow(MissingFieldException);
    expect(() => decodeProtoBytes(bytes(0x0a, 0x01, 0x00, 0x12, 0x00), T.cls(Chapter))).toThrow(IOException);
    expect(() => decodeProtoBytes(bytes(0x12, 0x05, 'ab'), T.cls(Chapter))).toThrow(IOException);
  });
});

// ---- bookwalker-style request DTOs (encoding) ----
class LimitOffset {
  constructor(
    public limit: number,
    public offset = 0,
  ) {}
  static $serial = {
    fields: [
      { name: 'limit', json: 'limit', type: T.int, optional: false, proto: 1 },
      { name: 'offset', json: 'offset', type: T.int, optional: true, proto: 2 },
    ],
  };
}
class Sort {
  constructor(
    public sortMode: number,
    public reverse: number | null = null,
  ) {}
  static $serial = {
    fields: [
      { name: 'sortMode', json: 'sortMode', type: T.int, optional: false, proto: 1 },
      { name: 'reverse', json: 'reverse', type: T.nullable(T.int), optional: true, proto: 2 },
    ],
  };
}
class SeriesFormat {}
defEnum(SeriesFormat, [
  ['NOVEL', []],
  ['MANGA', []],
]);
(SeriesFormat as any).$enum = true;
class TagInclusionMode {
  constructor(public value: number) {}
  static $serial = { inline: true, fields: [{ name: 'value', json: 'value', type: T.int, optional: false }] };
}
class TagFilter {
  constructor(
    public id: string,
    public mode: TagInclusionMode,
  ) {}
  static $serial = {
    fields: [
      { name: 'id', json: 'id', type: T.str, optional: false, proto: 1 },
      { name: 'mode', json: 'mode', type: T.cls(TagInclusionMode), optional: false, proto: 3, encodeDefault: true },
    ],
  };
}
class Filter {
  constructor(
    public type: string,
    public include: TagFilter[],
  ) {}
  static $serial = {
    fields: [
      { name: 'type', json: 'type', type: T.str, optional: false, proto: 1 },
      { name: 'include', json: 'include', type: T.list(T.cls(TagFilter)), optional: false, proto: 3 },
    ],
  };
}
class SearchPageType {
  static $serial: any;
}
class NamedPage extends SearchPageType {
  constructor(public name: string) {
    super();
  }
  static $serial = { fields: [{ name: 'name', json: 'name', type: T.str, optional: false, proto: 2 }] };
}
class LocalPage extends SearchPageType {
  constructor(public type: number) {
    super();
  }
  static $serial = { fields: [{ name: 'type', json: 'type', type: T.int, optional: false, proto: 3 }] };
}
SearchPageType.$serial = { fields: [], subclasses: () => ({ Named: NamedPage, Local: LocalPage }) };
class SearchPageTypeDto {
  constructor(public domain: SearchPageType) {}
  static $serial = { fields: [{ name: 'domain', json: 'domain', type: T.cls(SearchPageType), optional: false, oneOf: true }] };
}
class SearchRequest {
  constructor(
    public limitOffset: LimitOffset,
    public query: string | null = null,
    public sort: Sort,
    public formats: any[],
    public filters: Filter[],
    public searchDomain: SearchPageTypeDto,
  ) {}
  static $serial = {
    fields: [
      { name: 'limitOffset', json: 'limitOffset', type: T.cls(LimitOffset), optional: false, proto: 1 },
      { name: 'query', json: 'query', type: T.nullable(T.str), optional: true, proto: 2 },
      { name: 'sort', json: 'sort', type: T.cls(Sort), optional: false, proto: 3 },
      { name: 'formats', json: 'formats', type: T.list({ k: 'enum', cls: SeriesFormat } as any), optional: false, proto: 4 },
      { name: 'filters', json: 'filters', type: T.list(T.cls(Filter)), optional: false, proto: 5 },
      { name: 'searchDomain', json: 'searchDomain', type: T.cls(SearchPageTypeDto), optional: false, proto: 6 },
    ],
  };
}

const request = () =>
  new SearchRequest(new LimitOffset(24), null, new Sort(4), [(SeriesFormat as any).MANGA], [new Filter('genre', [new TagFilter('12', new TagInclusionMode(2))])], new SearchPageTypeDto(new NamedPage('x')));

const REQUEST_HEX = hex(
  bytes(
    0x0a, 0x02, 0x08, 0x18, // 1: LimitOffset{limit 24} (offset holds its default: omitted)
    0x1a, 0x02, 0x08, 0x04, // 3: Sort{4} (reverse null)
    0x20, 0x01, // 4: formats += MANGA (unpacked)
    0x2a, 0x0f, 0x0a, 0x05, 'genre', 0x1a, 0x06, 0x0a, 0x02, '12', 0x18, 0x02, // 5: Filter{"genre", [TagFilter{"12", 2}]}
    0x32, 0x03, 0x12, 0x01, 'x', // 6: oneOf variant Named flattened as field 2
  ),
);

describe('ProtoBuf encoding', () => {
  it('encodes like keiyoushi ProtobufSinkEncoder', () => {
    expect(hex(encodeProtoBytes(request(), T.cls(SearchRequest)))).toBe(REQUEST_HEX);
  });

  it('encodeDefaults writes fields that hold their default', () => {
    const out = hex(encodeProtoBytes(new LimitOffset(24), T.cls(LimitOffset), true));
    expect(out).toBe('08 18 10 00');
  });

  it('round-trips oneOf and value classes', () => {
    const back: SearchRequest = decodeProtoBytes(encodeProtoBytes(request(), T.cls(SearchRequest)), T.cls(SearchRequest));
    expect(back.searchDomain.domain).toBeInstanceOf(NamedPage);
    expect((back.searchDomain.domain as NamedPage).name).toBe('x');
    expect(back.filters[0].include[0].mode).toBeInstanceOf(TagInclusionMode);
    expect(back.filters[0].include[0].mode.value).toBe(2);
    expect(back.limitOffset.offset).toBe(0);
    expect(back.formats).toEqual([(SeriesFormat as any).MANGA]);
    const local: SearchPageTypeDto = decodeProtoBytes(bytes(0x18, 0x04), T.cls(SearchPageTypeDto));
    expect((local.domain as LocalPage).type).toBe(4);
  });

  it('packed, sint64, fixed and negative values', () => {
    class Nums {
      constructor(
        public packed: number[],
        public s64: number,
        public f32: number,
        public neg: number,
        public d: number,
      ) {}
      static $serial = {
        fields: [
          { name: 'packed', json: 'packed', type: T.list(T.int), optional: false, packed: true },
          { name: 's64', json: 's64', type: T.long, optional: false, protoType: 'SIGNED' as const },
          { name: 'f32', json: 'f32', type: T.int, optional: false, protoType: 'FIXED' as const },
          { name: 'neg', json: 'neg', type: T.int, optional: false },
          { name: 'd', json: 'd', type: T.double, optional: false },
        ],
      };
    }
    const enc = encodeProtoBytes(new Nums([3, 270, 86942], -2, 1, -1, 0.5), T.cls(Nums));
    // the packed example from the protobuf docs: 0a 06 03 8e 02 9e a7 05
    expect(hex(enc)).toBe('0a 06 03 8e 02 9e a7 05 10 03 1d 01 00 00 00 20 ff ff ff ff ff ff ff ff ff 01 29 00 00 00 00 00 00 e0 3f');
    const back: Nums = decodeProtoBytes(enc, T.cls(Nums));
    expect([back.packed, back.s64, back.f32, back.neg, back.d]).toEqual([[3, 270, 86942], -2, 1, -1, 0.5]);
  });
});

describe('keiyoushi.utils Protobuf helpers', () => {
  const parseAsProto = m('keiyoushi.utils.parseAsProto');
  const toRequestBodyProto = m('keiyoushi.utils.toRequestBodyProto');
  const decodeProtoBase64 = m('keiyoushi.utils.decodeProtoBase64');
  const encodeProtoBase64 = m('keiyoushi.utils.encodeProtoBase64');
  const decodeProto = m('keiyoushi.utils.decodeProto');
  const encodeProto = m('keiyoushi.utils.encodeProto');
  const encodeToByteArray = m('kotlinx.serialization.encodeToByteArray');
  const protoInstance = m('keiyoushi.utils.protoInstance');

  const res = (body: Uint8Array) => new Response(new RequestBuilder().url('https://api.example.com/v1/title').build(), 200, 'OK', new Headers([['Content-Type', 'application/x-protobuf']]), new ResponseBody(body, MediaType.parse('application/x-protobuf')));

  it('Response.parseAsProto<T>()', () => {
    expect(call(res(TITLE_BYTES), 'parseAsProto', parseAsProto, [T.cls(Title)]).name).toBe('Naruto');
    expect(call(res(TITLE_BYTES).body, 'parseAsProto', parseAsProto, [T.cls(Title)]).id).toBe(150);
  });

  it('Response.parseAsProto(transform)', () => {
    const framed = new Uint8Array([0, 0, 0, 0, 0, ...TITLE_BYTES]); // gRPC-web style 5-byte frame header
    const r = call(res(framed), 'parseAsProto', parseAsProto, [(src: any) => (src.readByteArray(5), src), T.cls(Title)]);
    expect(r.views).toBe(2 ** 40);
  });

  it('toRequestBodyProto()', () => {
    const body = call(request(), 'toRequestBodyProto', toRequestBodyProto, [T.cls(SearchRequest)]);
    expect(body.contentType().toString()).toBe('application/protobuf');
    expect(body.contentLength()).toBe(-1);
    expect(hex(body.bytes)).toBe(REQUEST_HEX);
    const withDefaults = call(new LimitOffset(1), 'toRequestBodyProto', toRequestBodyProto, [undefined, true, T.cls(LimitOffset)]);
    expect(hex(withDefaults.bytes)).toBe('08 01 10 00');
    const typed = call(new LimitOffset(1), 'toRequestBodyProto', toRequestBodyProto, [named({ mediaType: MediaType.get('application/x-protobuf') }), T.cls(LimitOffset)]);
    expect(typed.contentType().toString()).toBe('application/x-protobuf');
  });

  it('root lists round-trip through Base64 (peppercarrot preferences)', () => {
    const langs = [new Chapter(1, 'en'), new Chapter(2, 'fr')];
    const b64 = call(langs, 'encodeProtoBase64', encodeProtoBase64, [T.list(T.cls(Chapter))]);
    const back = call(b64, 'decodeProtoBase64', decodeProtoBase64, [T.list(T.cls(Chapter))]);
    expect(back.map((c: Chapter) => c.title)).toEqual(['en', 'fr']);
    // protoInstance.encodeToByteArray(langs) (kotlinx extension; the member handles it too)
    const viaExt = call(protoInstance, 'encodeToByteArray', encodeToByteArray, [langs, T.list(T.cls(Chapter))]);
    expect(protoInstance.decodeFromByteArray(T.list(T.cls(Chapter)), viaExt)[1].title).toBe('fr');
  });

  it('ByteArray.decodeProto / T.encodeProto / BufferedSink.encodeProto', () => {
    const enc = call(new Chapter(5, 'five'), 'encodeProto', encodeProto, [T.cls(Chapter)]);
    expect(enc).toBeInstanceOf(Int8Array);
    expect(call(enc, 'decodeProto', decodeProto, [T.cls(Chapter)]).title).toBe('five');
    const sink = new OkBuffer();
    call(sink, 'encodeProto', encodeProto, [new LimitOffset(3), true, T.cls(LimitOffset)]);
    expect(hex(sink.readByteArray())).toBe('08 03 10 00');
  });

  it('ProtoBuf { encodeDefaults = true }', () => {
    const p: ProtoBuf = (ProtoBuf as any).$invoke((cfg: any) => {
      cfg.encodeDefaults = true;
    });
    expect(hex(p.encodeToByteArray(T.cls(LimitOffset), new LimitOffset(7)))).toBe('08 07 10 00');
    expect(hex(ProtoBuf.Default.encodeToByteArray(T.cls(LimitOffset), new LimitOffset(7)))).toBe('08 07');
  });
});

import {
  ANY,
  compare,
  contains as kContains,
  eq,
  type ExtDef,
  hash,
  IllegalArgumentException,
  IndexOutOfBoundsException,
  is as kIs,
  isArr,
  isBool,
  isMap,
  isNum,
  isSet,
  isStr,
  mapGet,
  mapHas,
  mapSet,
  NoSuchElementException,
  NonLocalReturn,
  NONNULL,
  NumberFormatException,
  plus,
  minus,
  setHas,
  str,
  UnsupportedOperationException,
} from './core';
import { ext, extProp, hof } from './hof';
import { Regex } from './regex';
import { Comparator, IntRange, MapEntry, Pair, Result, StringBuilder, toComparator, Triple } from './types';

// ---------- receiver predicates ----------

const STR = isStr;
const CHAR = (x: any) => typeof x === 'string';
const NUM = isNum;
const LIST = isArr;
const SET = isSet;
const MAP = isMap;
const RANGE = (x: any) => x instanceof IntRange;
const BYTES = (x: any) => x instanceof Int8Array || x instanceof Uint8Array || x instanceof Int32Array;
const ITER = (x: any) => isArr(x) || isSet(x) || x instanceof IntRange || BYTES(x) || x instanceof MapEntriesView;
const ITER_OR_MAP = (x: any) => ITER(x) || isMap(x);
const NULLABLE = (_x: any) => true;
const SB = (x: any) => x instanceof StringBuilder;
const CHARSEQ = (x: any) => isStr(x) || x instanceof StringBuilder;

/** Map#entries / Map iteration produce MapEntry objects. */
export class MapEntriesView {
  constructor(readonly map: Map<any, any>) {}
  *[Symbol.iterator](): Iterator<MapEntry<any, any>> {
    for (const [k, v] of this.map) yield new MapEntry(k, v);
  }
  get size(): number {
    return this.map.size;
  }
}

/** Iterate a Kotlin collection, map, range or string as JS values. */
export function items(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x instanceof Map) return [...x].map(([k, v]) => new MapEntry(k, v));
  if (typeof x === 'string') return [...x];
  if (x instanceof StringBuilder) return [...x.toString()];
  if (x === null || x === undefined) throw new NoSuchElementException('Iterating null');
  if (typeof x[Symbol.iterator] === 'function') return [...x];
  if (typeof x.iterator === 'function') {
    const it = x.iterator();
    const out: any[] = [];
    while (it.hasNext()) out.push(it.next());
    return out;
  }
  throw new UnsupportedOperationException(`Not iterable: ${x?.constructor?.name}`);
}

/** `for (x in y)` */
export function iter(x: any): Iterable<any> {
  if (Array.isArray(x) || typeof x === 'string') return x;
  if (x instanceof Map) return new MapEntriesView(x);
  if (x instanceof StringBuilder) return x.toString();
  return items(x);
}

function sel(x: any, i: number, f?: (v: any) => any): any {
  return f ? f(x) : x;
}
function bool(v: any): boolean {
  return v === true;
}
function mkList(x: any): any[] {
  return [...items(x)];
}

// ---------- collection builders ----------

export const builders = {
  listOf: (...xs: any[]) => xs,
  mutableListOf: (...xs: any[]) => xs,
  arrayListOf: (...xs: any[]) => xs,
  emptyList: () => [],
  emptyArray: () => [],
  arrayOf: (...xs: any[]) => xs,
  arrayOfNulls: (n: number) => new Array(n).fill(null),
  intArrayOf: (...xs: number[]) => xs,
  longArrayOf: (...xs: number[]) => xs,
  doubleArrayOf: (...xs: number[]) => xs,
  floatArrayOf: (...xs: number[]) => xs,
  booleanArrayOf: (...xs: boolean[]) => xs,
  charArrayOf: (...xs: string[]) => xs,
  byteArrayOf: (...xs: number[]) => Int8Array.from(xs),
  listOfNotNull: (...xs: any[]) => xs.filter((x) => x !== null && x !== undefined),
  setOf: (...xs: any[]) => new Set(xs),
  mutableSetOf: (...xs: any[]) => new Set(xs),
  hashSetOf: (...xs: any[]) => new Set(xs),
  linkedSetOf: (...xs: any[]) => new Set(xs),
  setOfNotNull: (...xs: any[]) => new Set(xs.filter((x) => x != null)),
  emptySet: () => new Set(),
  mapOf: (...ps: Pair<any, any>[]) => pairsToMap(ps),
  mutableMapOf: (...ps: Pair<any, any>[]) => pairsToMap(ps),
  hashMapOf: (...ps: Pair<any, any>[]) => pairsToMap(ps),
  linkedMapOf: (...ps: Pair<any, any>[]) => pairsToMap(ps),
  sortedMapOf: (...ps: Pair<any, any>[]) => new Map([...pairsToMap(ps)].sort((a, b) => compare(a[0], b[0]))),
  emptyMap: () => new Map(),
  ArrayList: (x?: any) => (x === undefined || typeof x === 'number' ? [] : mkList(x)),
  LinkedList: (x?: any) => (x === undefined ? [] : mkList(x)),
  ArrayDeque: (x?: any) => (x === undefined || typeof x === 'number' ? [] : mkList(x)),
  HashMap: (x?: any) => (x instanceof Map ? new Map(x) : new Map()),
  LinkedHashMap: (x?: any) => (x instanceof Map ? new Map(x) : new Map()),
  TreeMap: (x?: any) => (x instanceof Map ? new Map([...x].sort((a, b) => compare(a[0], b[0]))) : new Map()),
  HashSet: (x?: any) => (x === undefined || typeof x === 'number' ? new Set() : new Set(items(x))),
  LinkedHashSet: (x?: any) => (x === undefined || typeof x === 'number' ? new Set() : new Set(items(x))),
  TreeSet: (x?: any) => (x === undefined ? new Set() : new Set(items(x).sort(compare))),
  Array: (n: number, init?: (i: number) => any) => Array.from({ length: n }, (_, i) => (init ? init(i) : null)),
  List: (n: number, init: (i: number) => any) => Array.from({ length: n }, (_, i) => init(i)),
  MutableList: (n: number, init: (i: number) => any) => Array.from({ length: n }, (_, i) => init(i)),
  IntArray: (n: number, init?: (i: number) => number) => Array.from({ length: n }, (_, i) => (init ? init(i) : 0)),
  LongArray: (n: number, init?: (i: number) => number) => Array.from({ length: n }, (_, i) => (init ? init(i) : 0)),
  DoubleArray: (n: number, init?: (i: number) => number) => Array.from({ length: n }, (_, i) => (init ? init(i) : 0)),
  FloatArray: (n: number, init?: (i: number) => number) => Array.from({ length: n }, (_, i) => (init ? init(i) : 0)),
  BooleanArray: (n: number, init?: (i: number) => boolean) => Array.from({ length: n }, (_, i) => (init ? init(i) : false)),
  CharArray: (n: number, init?: (i: number) => string) => Array.from({ length: n }, (_, i) => (init ? init(i) : '\0')),
  ByteArray: (n: number, init?: (i: number) => number) => {
    const a = new Int8Array(n);
    if (init) for (let i = 0; i < n; i++) a[i] = init(i);
    return a;
  },
  Pair: (a: any, b: any) => new Pair(a, b),
  Triple: (a: any, b: any, c: any) => new Triple(a, b, c),
  StringBuilder: (x?: any) => new StringBuilder(x),
  Regex: (p: string, o?: any) => new Regex(p, o),
  IntRange: (a: number, b: number) => new IntRange(a, b),
};

function pairsToMap(ps: Pair<any, any>[]): Map<any, any> {
  const m = new Map();
  for (const p of ps) mapSet(m, p.first, p.second);
  return m;
}

// buildList etc. take receiver lambdas (receiver passed as first arg).
export const buildersHof: Record<string, (...a: any[]) => Generator<any, any, any>> = {
  buildList: function* (a: any, b?: any) {
    const f = typeof a === 'function' ? a : b;
    const l: any[] = [];
    yield f(l);
    return l;
  },
  buildSet: function* (a: any, b?: any) {
    const f = typeof a === 'function' ? a : b;
    const s = new Set();
    yield f(s);
    return s;
  },
  buildMap: function* (a: any, b?: any) {
    const f = typeof a === 'function' ? a : b;
    const m = new Map();
    yield f(m);
    return m;
  },
  buildString: function* (a: any, b?: any) {
    const f = typeof a === 'function' ? a : b;
    const sb = new StringBuilder();
    yield f(sb);
    return sb.toString();
  },
  with: function* (r: any, f: any) {
    return yield f(r);
  },
  run: function* (f: any) {
    return yield f();
  },
  repeat: function* (n: number, f: any) {
    for (let i = 0; i < n; i++) yield f(i);
  },
  runCatching: function* (f: any) {
    try {
      return Result.success(yield f());
    } catch (e) {
      if (e instanceof NonLocalReturn || (e as any)?.constructor?.name === 'NonLocalJump') throw e;
      return Result.failure(e);
    }
  },
  synchronized: function* (_lock: any, f: any) {
    return yield f();
  },
};

// ---------- extension functions ----------

const defs: ExtDef[] = [];
const add = (...d: ExtDef[]) => defs.push(...d);

// Scope functions. Receiver lambdas receive the receiver as first argument.
add(
  hof('let', NULLABLE, function* (x, f) {
    return yield f(x);
  }),
  hof('also', NULLABLE, function* (x, f) {
    yield f(x);
    return x;
  }),
  hof('apply', NULLABLE, function* (x, f) {
    yield f(x);
    return x;
  }, true),
  hof('run', NULLABLE, function* (x, f) {
    return yield f(x);
  }, true),
  hof('takeIf', NULLABLE, function* (x, f) {
    return bool(yield f(x)) ? x : null;
  }),
  hof('takeUnless', NULLABLE, function* (x, f) {
    return bool(yield f(x)) ? null : x;
  }),
  hof('use', NULLABLE, function* (x, f) {
    try {
      return yield f(x);
    } finally {
      if (x && typeof x.close === 'function') x.close();
    }
  }),
  hof('runCatching', NULLABLE, function* (x, f) {
    try {
      return Result.success(yield f(x));
    } catch (e) {
      if (e instanceof NonLocalReturn || (e as any)?.constructor?.name === 'NonLocalJump') throw e;
      return Result.failure(e);
    }
  }, true),
  ext('to', NULLABLE, (a, b) => new Pair(a, b)),
  ext('toString', NULLABLE, (x, radix?: number) => (typeof x === 'number' && radix ? x.toString(radix) : str(x))),
  ext('hashCode', NULLABLE, (x) => hash(x)),
  ext('equals', NULLABLE, (a, b, ignoreCase?: boolean) =>
    ignoreCase && typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : eq(a, b),
  ),
  ext('compareTo', NULLABLE, (a, b) => compare(a, b)),
  ext('isNullOrEmpty', NULLABLE, (x) => x === null || x === undefined || size(x) === 0),
  ext('isNullOrBlank', NULLABLE, (x) => x === null || x === undefined || str(x).trim() === ''),
  ext('orEmpty', NULLABLE, orEmpty),
  ext('plus', NULLABLE, (a, b) => plus(a, b)),
  ext('minus', NULLABLE, (a, b) => minus(a, b)),
  ext('contains', NULLABLE, (a, b, ignoreCase?: boolean) => strContains(a, b, ignoreCase)),
);

function orEmpty(x: any): any {
  if (x !== null && x !== undefined) return x;
  return '';
}

function size(x: any): number {
  if (typeof x === 'string' || Array.isArray(x) || ArrayBuffer.isView(x)) return (x as any).length;
  if (x instanceof Map || x instanceof Set) return x.size;
  if (x instanceof StringBuilder) return x.length;
  if (x && typeof x.size === 'number') return x.size;
  if (x && typeof x.size === 'function') return x.size();
  return items(x).length;
}

function strContains(a: any, b: any, ignoreCase?: boolean): boolean {
  if (typeof a === 'string' || a instanceof StringBuilder) {
    const s = str(a);
    if (b instanceof Regex) return b.containsMatchIn(s);
    return ignoreCase ? s.toLowerCase().includes(str(b).toLowerCase()) : s.includes(str(b));
  }
  return kContains(a, b);
}

// --- size-like properties ---
add(
  extProp('size', (x) => ITER_OR_MAP(x) || BYTES(x), size),
  extProp('length', CHARSEQ, (x) => (typeof x === 'string' ? x.length : x.length)),
  extProp('indices', (x) => ITER(x) || STR(x), (x) => new IntRange(0, size(x) - 1)),
  extProp('lastIndex', (x) => ITER(x) || CHARSEQ(x), (x) => size(x) - 1),
  extProp('keys', MAP, (m: Map<any, any>) => new Set(m.keys())),
  extProp('values', MAP, (m: Map<any, any>) => [...m.values()]),
  extProp('entries', MAP, (m: Map<any, any>) => [...m].map(([k, v]) => new MapEntry(k, v))),
  extProp('key', (x) => x instanceof MapEntry, (e) => e.key),
  extProp('value', (x) => x instanceof MapEntry, (e) => e.value),
);

// --- generic collection ops (lists, sets, ranges, map entries, byte arrays) ---
add(
  hof('map', ITER_OR_MAP, function* (x, f) {
    const out: any[] = [];
    for (const v of items(x)) out.push(yield f(v));
    return out;
  }),
  hof('map', STR, function* (x, f) {
    const out: any[] = [];
    for (const v of x) out.push(yield f(v));
    return out;
  }),
  hof('mapNotNull', (x) => ITER_OR_MAP(x) || STR(x), function* (x, f) {
    const out: any[] = [];
    for (const v of items(x)) {
      const r = yield f(v);
      if (r !== null && r !== undefined) out.push(r);
    }
    return out;
  }),
  hof('mapIndexed', (x) => ITER(x) || STR(x), function* (x, f) {
    const out: any[] = [];
    const xs = items(x);
    for (let i = 0; i < xs.length; i++) out.push(yield f(i, xs[i]));
    return out;
  }),
  hof('mapIndexedNotNull', ITER, function* (x, f) {
    const out: any[] = [];
    const xs = items(x);
    for (let i = 0; i < xs.length; i++) {
      const r = yield f(i, xs[i]);
      if (r != null) out.push(r);
    }
    return out;
  }),
  hof('mapTo', ITER_OR_MAP, function* (x, dest, f) {
    for (const v of items(x)) collAdd(dest, yield f(v));
    return dest;
  }),
  hof('mapNotNullTo', ITER_OR_MAP, function* (x, dest, f) {
    for (const v of items(x)) {
      const r = yield f(v);
      if (r != null) collAdd(dest, r);
    }
    return dest;
  }),
  hof('flatMap', ITER_OR_MAP, function* (x, f) {
    const out: any[] = [];
    for (const v of items(x)) out.push(...items(yield f(v)));
    return out;
  }),
  hof('flatMapIndexed', ITER, function* (x, f) {
    const out: any[] = [];
    const xs = items(x);
    for (let i = 0; i < xs.length; i++) out.push(...items(yield f(i, xs[i])));
    return out;
  }),
  ext('flatten', ITER, (x) => items(x).flatMap((v) => items(v))),
  hof('filter', (x) => LIST(x) || SET(x) || RANGE(x) || BYTES(x), function* (x, f) {
    const out: any[] = [];
    for (const v of items(x)) if (bool(yield f(v))) out.push(v);
    return out;
  }),
  hof('filter', MAP, function* (m: Map<any, any>, f) {
    const out = new Map();
    for (const [k, v] of m) if (bool(yield f(new MapEntry(k, v)))) out.set(k, v);
    return out;
  }),
  hof('filter', STR, function* (s: string, f) {
    let out = '';
    for (const c of s) if (bool(yield f(c))) out += c;
    return out;
  }),
  hof('filterNot', (x) => LIST(x) || SET(x) || RANGE(x), function* (x, f) {
    const out: any[] = [];
    for (const v of items(x)) if (!bool(yield f(v))) out.push(v);
    return out;
  }),
  hof('filterNot', MAP, function* (m: Map<any, any>, f) {
    const out = new Map();
    for (const [k, v] of m) if (!bool(yield f(new MapEntry(k, v)))) out.set(k, v);
    return out;
  }),
  hof('filterNot', STR, function* (s: string, f) {
    let out = '';
    for (const c of s) if (!bool(yield f(c))) out += c;
    return out;
  }),
  hof('filterIndexed', ITER, function* (x, f) {
    const out: any[] = [];
    const xs = items(x);
    for (let i = 0; i < xs.length; i++) if (bool(yield f(i, xs[i]))) out.push(xs[i]);
    return out;
  }),
  hof('filterTo', ITER, function* (x, dest, f) {
    for (const v of items(x)) if (bool(yield f(v))) collAdd(dest, v);
    return dest;
  }),
  ext('filterNotNull', ITER, (x) => items(x).filter((v) => v !== null && v !== undefined)),
  ext('filterIsInstance', ITER, (x, T) => items(x).filter((v) => kIs(v, T))),
  ext('requireNoNulls', ITER, (x) => {
    if (items(x).some((v) => v == null)) throw new IllegalArgumentException('null element found');
    return x;
  }),
  hof('filterKeys', MAP, function* (m: Map<any, any>, f) {
    const out = new Map();
    for (const [k, v] of m) if (bool(yield f(k))) out.set(k, v);
    return out;
  }),
  hof('filterValues', MAP, function* (m: Map<any, any>, f) {
    const out = new Map();
    for (const [k, v] of m) if (bool(yield f(v))) out.set(k, v);
    return out;
  }),
  hof('forEach', (x) => ITER_OR_MAP(x) || STR(x), function* (x, f) {
    for (const v of items(x)) yield f(v);
  }),
  hof('forEachIndexed', (x) => ITER(x) || STR(x), function* (x, f) {
    const xs = items(x);
    for (let i = 0; i < xs.length; i++) yield f(i, xs[i]);
  }),
  hof('onEach', ITER_OR_MAP, function* (x, f) {
    for (const v of items(x)) yield f(v);
    return x;
  }),
  hof('onEachIndexed', ITER, function* (x, f) {
    const xs = items(x);
    for (let i = 0; i < xs.length; i++) yield f(i, xs[i]);
    return x;
  }),
  hof('first', (x) => ITER(x) || STR(x), function* (x, f?) {
    const xs = items(x);
    if (!f) {
      if (!xs.length) throw new NoSuchElementException('List is empty.');
      return xs[0];
    }
    for (const v of xs) if (bool(yield f(v))) return v;
    throw new NoSuchElementException('Collection contains no element matching the predicate.');
  }),
  hof('firstOrNull', (x) => ITER(x) || STR(x), function* (x, f?) {
    const xs = items(x);
    if (!f) return xs.length ? xs[0] : null;
    for (const v of xs) if (bool(yield f(v))) return v;
    return null;
  }),
  hof('last', (x) => ITER(x) || STR(x), function* (x, f?) {
    const xs = items(x);
    if (!f) {
      if (!xs.length) throw new NoSuchElementException('List is empty.');
      return xs[xs.length - 1];
    }
    for (let i = xs.length - 1; i >= 0; i--) if (bool(yield f(xs[i]))) return xs[i];
    throw new NoSuchElementException('Collection contains no element matching the predicate.');
  }),
  hof('lastOrNull', (x) => ITER(x) || STR(x), function* (x, f?) {
    const xs = items(x);
    if (!f) return xs.length ? xs[xs.length - 1] : null;
    for (let i = xs.length - 1; i >= 0; i--) if (bool(yield f(xs[i]))) return xs[i];
    return null;
  }),
  hof('single', ITER, function* (x, f?) {
    const xs = f ? yield* filterGen(items(x), f) : items(x);
    if (xs.length !== 1) throw new IllegalArgumentException(xs.length ? 'Collection has more than one element.' : 'Collection is empty.');
    return xs[0];
  }),
  hof('singleOrNull', ITER, function* (x, f?) {
    const xs = f ? yield* filterGen(items(x), f) : items(x);
    return xs.length === 1 ? xs[0] : null;
  }),
  hof('find', (x) => ITER(x) || STR(x), function* (x, f) {
    for (const v of items(x)) if (bool(yield f(v))) return v;
    return null;
  }),
  hof('findLast', ITER, function* (x, f) {
    const xs = items(x);
    for (let i = xs.length - 1; i >= 0; i--) if (bool(yield f(xs[i]))) return xs[i];
    return null;
  }),
  hof('firstNotNullOf', ITER, function* (x, f) {
    for (const v of items(x)) {
      const r = yield f(v);
      if (r != null) return r;
    }
    throw new NoSuchElementException('No element of the collection was transformed to a non-null value.');
  }),
  hof('firstNotNullOfOrNull', ITER, function* (x, f) {
    for (const v of items(x)) {
      const r = yield f(v);
      if (r != null) return r;
    }
    return null;
  }),
  hof('any', (x) => ITER_OR_MAP(x) || STR(x), function* (x, f?) {
    const xs = items(x);
    if (!f) return xs.length > 0;
    for (const v of xs) if (bool(yield f(v))) return true;
    return false;
  }),
  hof('all', (x) => ITER_OR_MAP(x) || STR(x), function* (x, f) {
    for (const v of items(x)) if (!bool(yield f(v))) return false;
    return true;
  }),
  hof('none', (x) => ITER_OR_MAP(x) || STR(x), function* (x, f?) {
    const xs = items(x);
    if (!f) return xs.length === 0;
    for (const v of xs) if (bool(yield f(v))) return false;
    return true;
  }),
  hof('count', (x) => ITER_OR_MAP(x) || STR(x), function* (x, f?) {
    const xs = items(x);
    if (!f) return xs.length;
    let n = 0;
    for (const v of xs) if (bool(yield f(v))) n++;
    return n;
  }),
  hof('sumOf', ITER_OR_MAP, function* (x, f) {
    let s = 0;
    for (const v of items(x)) s += yield f(v);
    return s;
  }),
  ext('sum', ITER, (x) => items(x).reduce((a: number, b: number) => a + b, 0)),
  ext('average', ITER, (x) => {
    const xs = items(x);
    return xs.length ? xs.reduce((a: number, b: number) => a + b, 0) / xs.length : NaN;
  }),
  hof('maxOf', ITER, function* (x, f) {
    const xs = items(x);
    if (!xs.length) throw new NoSuchElementException();
    let best = yield f(xs[0]);
    for (let i = 1; i < xs.length; i++) {
      const v = yield f(xs[i]);
      if (compare(v, best) > 0) best = v;
    }
    return best;
  }),
  hof('maxOfOrNull', ITER, function* (x, f) {
    const xs = items(x);
    if (!xs.length) return null;
    let best = yield f(xs[0]);
    for (let i = 1; i < xs.length; i++) {
      const v = yield f(xs[i]);
      if (compare(v, best) > 0) best = v;
    }
    return best;
  }),
  hof('minOf', ITER, function* (x, f) {
    const xs = items(x);
    if (!xs.length) throw new NoSuchElementException();
    let best = yield f(xs[0]);
    for (let i = 1; i < xs.length; i++) {
      const v = yield f(xs[i]);
      if (compare(v, best) < 0) best = v;
    }
    return best;
  }),
  hof('minOfOrNull', ITER, function* (x, f) {
    const xs = items(x);
    if (!xs.length) return null;
    let best = yield f(xs[0]);
    for (let i = 1; i < xs.length; i++) {
      const v = yield f(xs[i]);
      if (compare(v, best) < 0) best = v;
    }
    return best;
  }),
  ext('max', ITER, (x) => extreme(items(x), 1, true)),
  ext('min', ITER, (x) => extreme(items(x), -1, true)),
  ext('maxOrNull', ITER, (x) => extreme(items(x), 1, false)),
  ext('minOrNull', ITER, (x) => extreme(items(x), -1, false)),
  hof('maxBy', ITER_OR_MAP, function* (x, f) {
    return yield* byExtreme(items(x), f, 1, true);
  }),
  hof('minBy', ITER_OR_MAP, function* (x, f) {
    return yield* byExtreme(items(x), f, -1, true);
  }),
  hof('maxByOrNull', ITER_OR_MAP, function* (x, f) {
    return yield* byExtreme(items(x), f, 1, false);
  }),
  hof('minByOrNull', ITER_OR_MAP, function* (x, f) {
    return yield* byExtreme(items(x), f, -1, false);
  }),
  ext('maxWithOrNull', ITER, (x, c) => {
    const xs = items(x);
    const cmp = toComparator(c);
    return xs.length ? xs.reduce((a, b) => (cmp(b, a) > 0 ? b : a)) : null;
  }),
  ext('sorted', ITER, (x) => mkList(x).sort(compare)),
  ext('sortedDescending', ITER, (x) => mkList(x).sort((a, b) => compare(b, a))),
  hof('sortedBy', ITER, function* (x, f) {
    return yield* sortByGen(items(x), f, 1);
  }),
  hof('sortedByDescending', ITER, function* (x, f) {
    return yield* sortByGen(items(x), f, -1);
  }),
  ext('sortedWith', ITER, (x, c) => mkList(x).sort(toComparator(c))),
  hof('sortBy', LIST, function* (x: any[], f) {
    const sorted = yield* sortByGen(x, f, 1);
    x.splice(0, x.length, ...sorted);
  }),
  hof('sortByDescending', LIST, function* (x: any[], f) {
    const sorted = yield* sortByGen(x, f, -1);
    x.splice(0, x.length, ...sorted);
  }),
  ext('sort', LIST, (x: any[]) => void x.sort(compare)),
  ext('sortDescending', LIST, (x: any[]) => void x.sort((a, b) => compare(b, a))),
  ext('sortWith', LIST, (x: any[], c) => void x.sort(toComparator(c))),
  ext('reversed', (x) => ITER(x) && !STR(x), (x) => mkList(x).reverse()),
  ext('reversed', STR, (x: string) => [...x].reverse().join('')),
  ext('asReversed', LIST, (x: any[]) => [...x].reverse()),
  ext('reverse', LIST, (x: any[]) => void x.reverse()),
  ext('distinct', ITER, (x) => distinctBy(items(x), (v) => v)),
  hof('distinctBy', ITER, function* (x, f) {
    const keys: any[] = [];
    const out: any[] = [];
    for (const v of items(x)) {
      const k = yield f(v);
      if (!keys.some((kk) => eq(kk, k))) {
        keys.push(k);
        out.push(v);
      }
    }
    return out;
  }),
  hof('groupBy', ITER, function* (x, f, g?) {
    const m = new Map();
    for (const v of items(x)) {
      const k = yield f(v);
      const val = g ? yield g(v) : v;
      const list = mapGet(m, k);
      if (list) list.push(val);
      else mapSet(m, k, [val]);
    }
    return m;
  }),
  hof('associate', ITER, function* (x, f) {
    const m = new Map();
    for (const v of items(x)) {
      const p = yield f(v);
      mapSet(m, p.first, p.second);
    }
    return m;
  }),
  hof('associateBy', ITER, function* (x, f, g?) {
    const m = new Map();
    for (const v of items(x)) mapSet(m, yield f(v), g ? yield g(v) : v);
    return m;
  }),
  hof('associateWith', ITER, function* (x, f) {
    const m = new Map();
    for (const v of items(x)) mapSet(m, v, yield f(v));
    return m;
  }),
  hof('associateTo', ITER, function* (x, dest, f) {
    for (const v of items(x)) {
      const p = yield f(v);
      mapSet(dest, p.first, p.second);
    }
    return dest;
  }),
  hof('partition', ITER, function* (x, f) {
    const a: any[] = [];
    const b: any[] = [];
    for (const v of items(x)) (bool(yield f(v)) ? a : b).push(v);
    return new Pair(a, b);
  }),
  hof('chunked', (x) => ITER(x) || STR(x), function* (x, n: number, f?) {
    const xs = items(x);
    const out: any[] = [];
    for (let i = 0; i < xs.length; i += n) {
      const chunk = typeof x === 'string' ? xs.slice(i, i + n).join('') : xs.slice(i, i + n);
      out.push(f ? yield f(chunk) : chunk);
    }
    return out;
  }),
  ext('windowed', ITER, (x, size: number, stepN = 1, partial = false) => {
    const xs = items(x);
    const out: any[] = [];
    for (let i = 0; i < xs.length; i += stepN) {
      const w = xs.slice(i, i + size);
      if (w.length < size && !partial) break;
      out.push(w);
    }
    return out;
  }),
  hof('zip', ITER, function* (x, other, f?) {
    const a = items(x);
    const b = items(other);
    const out: any[] = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) out.push(f ? yield f(a[i], b[i]) : new Pair(a[i], b[i]));
    return out;
  }),
  hof('zipWithNext', ITER, function* (x, f?) {
    const a = items(x);
    const out: any[] = [];
    for (let i = 0; i < a.length - 1; i++) out.push(f ? yield f(a[i], a[i + 1]) : new Pair(a[i], a[i + 1]));
    return out;
  }),
  ext('unzip', ITER, (x) => {
    const xs = items(x);
    return new Pair(
      xs.map((p) => p.first),
      xs.map((p) => p.second),
    );
  }),
  ext('take', (x) => ITER(x) && !STR(x), (x, n: number) => items(x).slice(0, n)),
  ext('takeLast', (x) => ITER(x) && !STR(x), (x, n: number) => (n === 0 ? [] : items(x).slice(-n))),
  ext('drop', (x) => ITER(x) && !STR(x), (x, n: number) => items(x).slice(n)),
  ext('dropLast', (x) => ITER(x) && !STR(x), (x, n: number) => items(x).slice(0, Math.max(0, size(x) - n))),
  hof('takeWhile', (x) => ITER(x) || STR(x), function* (x, f) {
    const out: any[] = [];
    for (const v of items(x)) {
      if (!bool(yield f(v))) break;
      out.push(v);
    }
    return typeof x === 'string' ? out.join('') : out;
  }),
  hof('takeLastWhile', (x) => ITER(x) || STR(x), function* (x, f) {
    const xs = items(x);
    let i = xs.length;
    while (i > 0 && bool(yield f(xs[i - 1]))) i--;
    const out = xs.slice(i);
    return typeof x === 'string' ? out.join('') : out;
  }),
  hof('dropWhile', (x) => ITER(x) || STR(x), function* (x, f) {
    const xs = items(x);
    let i = 0;
    while (i < xs.length && bool(yield f(xs[i]))) i++;
    const out = xs.slice(i);
    return typeof x === 'string' ? out.join('') : out;
  }),
  hof('dropLastWhile', (x) => ITER(x) || STR(x), function* (x, f) {
    const xs = items(x);
    let i = xs.length;
    while (i > 0 && bool(yield f(xs[i - 1]))) i--;
    const out = xs.slice(0, i);
    return typeof x === 'string' ? out.join('') : out;
  }),
  hof('joinToString', (x) => ITER_OR_MAP(x), function* (x, ...args: any[]) {
    return yield* joinGen(items(x), args);
  }),
  hof('joinTo', ITER, function* (x, sb, ...args: any[]) {
    const s = yield* joinGen(items(x), args);
    sb.append(s);
    return sb;
  }),
  ext('toList', (x) => ITER(x) || STR(x) || (x && x.constructor?.name === 'Destructured'), (x) => (x?.toList && !ITER(x) && !STR(x) ? x.toList() : mkList(x))),
  ext('toList', MAP, (m: Map<any, any>) => [...m].map(([k, v]) => new Pair(k, v))),
  ext('toMutableList', (x) => ITER(x) || STR(x), mkList),
  ext('toTypedArray', ITER, mkList),
  ext('toIntArray', ITER, mkList),
  ext('toLongArray', ITER, mkList),
  ext('toCharArray', STR, (s: string) => [...s]),
  ext('toByteArray', LIST, (x: number[]) => Int8Array.from(x)),
  ext('toSet', (x) => ITER(x) || STR(x), (x) => new Set(items(x))),
  ext('toMutableSet', ITER, (x) => new Set(items(x))),
  ext('toHashSet', ITER, (x) => new Set(items(x))),
  ext('toSortedSet', ITER, (x) => new Set(mkList(x).sort(compare))),
  ext('toCollection', ITER, (x, dest) => {
    for (const v of items(x)) collAdd(dest, v);
    return dest;
  }),
  ext('toMap', ITER, (x) => {
    const m = new Map();
    for (const p of items(x)) mapSet(m, p.first ?? p.key, p.second ?? p.value);
    return m;
  }),
  ext('toMap', MAP, (m: Map<any, any>) => new Map(m)),
  ext('toMutableMap', MAP, (m: Map<any, any>) => new Map(m)),
  ext('toSortedMap', MAP, (m: Map<any, any>, c?: any) => new Map([...m].sort((a, b) => (c ? toComparator(c) : compare)(a[0], b[0])))),
  ext('asSequence', (x) => ITER_OR_MAP(x) || STR(x), mkList),
  ext('asIterable', ITER, mkList),
  ext('asList', ITER, mkList),
  ext('iterator', (x) => ITER_OR_MAP(x), (x) => new ListIterator(items(x))),
  ext('withIndex', ITER, (x) => items(x).map((v, i) => new IndexedValue(i, v))),
  ext('indexOf', (x) => ITER(x) && !STR(x), (x, v) => items(x).findIndex((y) => eq(y, v))),
  ext('lastIndexOf', (x) => ITER(x) && !STR(x), (x, v) => {
    const xs = items(x);
    for (let i = xs.length - 1; i >= 0; i--) if (eq(xs[i], v)) return i;
    return -1;
  }),
  hof('indexOfFirst', (x) => ITER(x) || STR(x), function* (x, f) {
    const xs = items(x);
    for (let i = 0; i < xs.length; i++) if (bool(yield f(xs[i]))) return i;
    return -1;
  }),
  hof('indexOfLast', (x) => ITER(x) || STR(x), function* (x, f) {
    const xs = items(x);
    for (let i = xs.length - 1; i >= 0; i--) if (bool(yield f(xs[i]))) return i;
    return -1;
  }),
  ext('contains', ITER, (x, v) => kContains(x instanceof IntRange ? x : items(x), v)),
  ext('containsAll', ITER, (x, vs) => items(vs).every((v) => kContains(items(x), v))),
  ext('isEmpty', (x) => ITER_OR_MAP(x) || CHARSEQ(x), (x) => size(x) === 0),
  ext('isNotEmpty', (x) => ITER_OR_MAP(x) || CHARSEQ(x), (x) => size(x) > 0),
  ext('orEmpty', ITER_OR_MAP, (x) => x),
  hof('ifEmpty', (x) => ITER_OR_MAP(x) || STR(x), function* (x, f) {
    return size(x) === 0 ? yield f() : x;
  }),
  ext('getOrNull', (x) => LIST(x) || STR(x) || BYTES(x), (x, i: number) => (i >= 0 && i < size(x) ? (typeof x === 'string' ? x.charAt(i) : x[i]) : null)),
  hof('getOrElse', (x) => LIST(x) || STR(x), function* (x, i: number, f) {
    return i >= 0 && i < size(x) ? (typeof x === 'string' ? x.charAt(i) : x[i]) : yield f(i);
  }),
  ext('elementAt', ITER, (x, i: number) => {
    const xs = items(x);
    if (i < 0 || i >= xs.length) throw new IndexOutOfBoundsException(`index ${i}`);
    return xs[i];
  }),
  ext('elementAtOrNull', ITER, (x, i: number) => items(x)[i] ?? null),
  hof('fold', (x) => ITER(x) || STR(x), function* (x, init, f) {
    let acc = init;
    for (const v of items(x)) acc = yield f(acc, v);
    return acc;
  }),
  hof('foldIndexed', ITER, function* (x, init, f) {
    let acc = init;
    const xs = items(x);
    for (let i = 0; i < xs.length; i++) acc = yield f(i, acc, xs[i]);
    return acc;
  }),
  hof('reduce', ITER, function* (x, f) {
    const xs = items(x);
    if (!xs.length) throw new UnsupportedOperationException("Empty collection can't be reduced.");
    let acc = xs[0];
    for (let i = 1; i < xs.length; i++) acc = yield f(acc, xs[i]);
    return acc;
  }),
  hof('reduceOrNull', ITER, function* (x, f) {
    const xs = items(x);
    if (!xs.length) return null;
    let acc = xs[0];
    for (let i = 1; i < xs.length; i++) acc = yield f(acc, xs[i]);
    return acc;
  }),
  hof('scan', ITER, function* (x, init, f) {
    let acc = init;
    const out = [acc];
    for (const v of items(x)) out.push((acc = yield f(acc, v)));
    return out;
  }),
  ext('subList', LIST, (x: any[], a: number, b: number) => x.slice(a, b)),
  ext('slice', (x) => LIST(x) || STR(x), (x, r: any) => {
    if (r instanceof IntRange) {
      const out = r.toList().map((i: number) => (typeof x === 'string' ? x.charAt(i) : x[i]));
      return typeof x === 'string' ? out.join('') : out;
    }
    return items(r).map((i: number) => x[i]);
  }),
  ext('shuffled', ITER, (x) => {
    const a = mkList(x);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }),
  ext('random', (x) => ITER(x) || STR(x), (x) => {
    const xs = items(x);
    if (!xs.length) throw new NoSuchElementException('Collection is empty.');
    return xs[Math.floor(Math.random() * xs.length)];
  }),
  ext('randomOrNull', ITER, (x) => {
    const xs = items(x);
    return xs.length ? xs[Math.floor(Math.random() * xs.length)] : null;
  }),
  ext('union', ITER, (a, b) => new Set([...items(a), ...items(b)])),
  ext('intersect', ITER, (a, b) => new Set(items(a).filter((v) => kContains(items(b), v)))),
  ext('subtract', ITER, (a, b) => new Set(items(a).filter((v) => !kContains(items(b), v)))),
  ext('plusElement', ITER, (a, b) => [...items(a), b]),
  ext('contentEquals', (x) => ITER(x) || x == null, (a, b) => eq(a == null ? a : mkList(a), b == null ? b : mkList(b))),
  ext('contentToString', ITER, (x) => '[' + items(x).map(str).join(', ') + ']'),
  ext('copyOf', (x) => LIST(x) || BYTES(x), (x, n?: number) => (BYTES(x) ? copyBytes(x, n) : n === undefined ? [...x] : [...x.slice(0, n), ...new Array(Math.max(0, n - x.length)).fill(null)])),
  ext('copyOfRange', (x) => LIST(x) || BYTES(x), (x, a: number, b: number) => x.slice(a, b)),
  ext('fill', LIST, (x: any[], v: any) => void x.fill(v)),
  ext('binarySearch', LIST, (x: any[], v: any) => {
    let lo = 0;
    let hi = x.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const c = compare(x[mid], v);
      if (c < 0) lo = mid + 1;
      else if (c > 0) hi = mid - 1;
      else return mid;
    }
    return -(lo + 1);
  }),
  ext('component1', (x) => LIST(x) || x instanceof MapEntry, (x) => (x instanceof MapEntry ? x.key : x[0])),
  ext('component2', (x) => LIST(x) || x instanceof MapEntry, (x) => (x instanceof MapEntry ? x.value : x[1])),
  ext('component3', LIST, (x) => x[2]),
  ext('component4', LIST, (x) => x[3]),
  ext('component5', LIST, (x) => x[4]),
);

// --- mutable list / set ops ---
add(
  ext('get', LIST, (x: any[], i: number) => {
    if (i < 0 || i >= x.length) throw new IndexOutOfBoundsException(`Index ${i} out of bounds for length ${x.length}`);
    return x[i];
  }),
  ext('get', BYTES, (x: any, i: number) => x[i]),
  ext('set', LIST, (x: any[], i: number, v: any) => {
    const old = x[i];
    x[i] = v;
    return old;
  }),
  ext('set', BYTES, (x: any, i: number, v: number) => void (x[i] = v)),
  ext('add', LIST, (x: any[], a: any, b?: any) => {
    if (b === undefined) {
      x.push(a);
      return true;
    }
    x.splice(a, 0, b);
  }),
  ext('add', SET, (x: Set<any>, v: any) => {
    if (setHas(x, v)) return false;
    x.add(v);
    return true;
  }),
  ext('addAll', LIST, (x: any[], a: any, b?: any) => {
    if (b === undefined) {
      const vs = items(a);
      x.push(...vs);
      return vs.length > 0;
    }
    x.splice(a, 0, ...items(b));
    return true;
  }),
  ext('addAll', SET, (x: Set<any>, vs: any) => {
    let changed = false;
    for (const v of items(vs)) if (!setHas(x, v)) {
      x.add(v);
      changed = true;
    }
    return changed;
  }),
  ext('addFirst', LIST, (x: any[], v: any) => void x.unshift(v)),
  ext('addLast', LIST, (x: any[], v: any) => void x.push(v)),
  ext('removeFirst', LIST, (x: any[]) => {
    if (!x.length) throw new NoSuchElementException('List is empty.');
    return x.shift();
  }),
  ext('removeLast', LIST, (x: any[]) => {
    if (!x.length) throw new NoSuchElementException('List is empty.');
    return x.pop();
  }),
  ext('removeFirstOrNull', LIST, (x: any[]) => (x.length ? x.shift() : null)),
  ext('removeLastOrNull', LIST, (x: any[]) => (x.length ? x.pop() : null)),
  ext('remove', LIST, (x: any[], v: any) => {
    const i = x.findIndex((y) => eq(y, v));
    if (i < 0) return false;
    x.splice(i, 1);
    return true;
  }),
  ext('remove', SET, (x: Set<any>, v: any) => {
    if (x.delete(v)) return true;
    for (const y of x) if (eq(y, v)) return x.delete(y);
    return false;
  }),
  ext('removeAt', LIST, (x: any[], i: number) => x.splice(i, 1)[0]),
  hof('removeAll', (x) => LIST(x) || SET(x), function* (x, arg) {
    const pred = typeof arg === 'function';
    const xs = items(x);
    const keep: any[] = [];
    for (const v of xs) {
      const rm = pred ? bool(yield arg(v)) : kContains(items(arg), v);
      if (!rm) keep.push(v);
    }
    replaceContents(x, keep);
    return keep.length !== xs.length;
  }),
  hof('removeIf', (x) => LIST(x) || SET(x), function* (x, f) {
    const xs = items(x);
    const keep: any[] = [];
    for (const v of xs) if (!bool(yield f(v))) keep.push(v);
    replaceContents(x, keep);
    return keep.length !== xs.length;
  }),
  hof('retainAll', (x) => LIST(x) || SET(x), function* (x, arg) {
    const pred = typeof arg === 'function';
    const xs = items(x);
    const keep: any[] = [];
    for (const v of xs) if (pred ? bool(yield arg(v)) : kContains(items(arg), v)) keep.push(v);
    replaceContents(x, keep);
    return keep.length !== xs.length;
  }),
  ext('clear', (x) => LIST(x) || SET(x) || MAP(x), (x) => {
    if (Array.isArray(x)) x.length = 0;
    else x.clear();
  }),
);

function replaceContents(x: any, keep: any[]): void {
  if (Array.isArray(x)) x.splice(0, x.length, ...keep);
  else {
    x.clear();
    for (const v of keep) x.add(v);
  }
}

function collAdd(dest: any, v: any): void {
  if (Array.isArray(dest)) dest.push(v);
  else if (dest instanceof Set) dest.add(v);
  else dest.add(v);
}

function copyBytes(x: any, n?: number): any {
  const out = new (x.constructor as any)(n ?? x.length);
  out.set(x.subarray(0, Math.min(x.length, n ?? x.length)));
  return out;
}

// --- maps ---
add(
  ext('get', MAP, (m: Map<any, any>, k: any) => mapGet(m, k)),
  ext('getValue', MAP, (m: Map<any, any>, k: any) => {
    if (!mapHas(m, k)) throw new NoSuchElementException(`Key ${str(k)} is missing in the map.`);
    return mapGet(m, k);
  }),
  ext('getOrDefault', MAP, (m: Map<any, any>, k: any, d: any) => (mapHas(m, k) ? mapGet(m, k) : d)),
  hof('getOrElse', MAP, function* (m: Map<any, any>, k: any, f) {
    const v = mapGet(m, k);
    return v != null ? v : yield f();
  }),
  hof('getOrPut', MAP, function* (m: Map<any, any>, k: any, f) {
    const v = mapGet(m, k);
    if (v != null) return v;
    const nv = yield f();
    mapSet(m, k, nv);
    return nv;
  }),
  ext('put', MAP, (m: Map<any, any>, k: any, v: any) => {
    const old = mapGet(m, k);
    mapSet(m, k, v);
    return old;
  }),
  ext('set', MAP, (m: Map<any, any>, k: any, v: any) => void mapSet(m, k, v)),
  ext('putIfAbsent', MAP, (m: Map<any, any>, k: any, v: any) => {
    const old = mapGet(m, k);
    if (old == null) mapSet(m, k, v);
    return old;
  }),
  ext('putAll', MAP, (m: Map<any, any>, other: any) => {
    if (other instanceof Map) for (const [k, v] of other) mapSet(m, k, v);
    else for (const p of items(other)) mapSet(m, p.first, p.second);
  }),
  ext('remove', MAP, (m: Map<any, any>, k: any) => {
    const old = mapGet(m, k);
    m.delete(k);
    return old;
  }),
  ext('containsKey', MAP, (m: Map<any, any>, k: any) => mapHas(m, k)),
  ext('containsValue', MAP, (m: Map<any, any>, v: any) => [...m.values()].some((x) => eq(x, v))),
  ext('contains', MAP, (m: Map<any, any>, k: any) => mapHas(m, k)),
  hof('mapValues', MAP, function* (m: Map<any, any>, f) {
    const out = new Map();
    for (const [k, v] of m) out.set(k, yield f(new MapEntry(k, v)));
    return out;
  }),
  hof('mapKeys', MAP, function* (m: Map<any, any>, f) {
    const out = new Map();
    for (const [k, v] of m) out.set(yield f(new MapEntry(k, v)), v);
    return out;
  }),
  hof('forEach', MAP, function* (m: Map<any, any>, f) {
    // Kotlin's Map.forEach { (k, v) -> } and BiConsumer form { k, v -> } both work.
    for (const [k, v] of m) yield f.length >= 2 ? f(k, v) : f(new MapEntry(k, v));
  }),
);

// --- strings & chars ---

function toIntStrict(s: string, radix = 10): number {
  const t = s;
  const re = radix === 16 ? /^[+-]?[0-9a-fA-F]+$/ : radix === 2 ? /^[+-]?[01]+$/ : radix === 8 ? /^[+-]?[0-7]+$/ : /^[+-]?\d+$/;
  if (radix === 10 || radix === 16 || radix === 2 || radix === 8 ? !re.test(t) : Number.isNaN(parseInt(t, radix))) {
    throw new NumberFormatException(`For input string: "${s}"`);
  }
  return parseInt(t, radix);
}
function toIntOrNull(s: string, radix = 10): number | null {
  try {
    return toIntStrict(s, radix);
  } catch {
    return null;
  }
}
function toDoubleStrict(s: string): number {
  const t = s.trim();
  if (!/^[+-]?(NaN|Infinity|((\d+\.?\d*|\.\d+)([eE][+-]?\d+)?))[fFdD]?$/.test(t)) {
    throw new NumberFormatException(`For input string: "${s}"`);
  }
  return parseFloat(t.replace(/[fFdD]$/, ''));
}
function toDoubleOrNull(s: string): number | null {
  try {
    return toDoubleStrict(s);
  } catch {
    return null;
  }
}

function substringAfter(s: string, d: string, missing?: string): string {
  const i = s.indexOf(d);
  return i < 0 ? (missing ?? s) : s.slice(i + d.length);
}
function substringBefore(s: string, d: string, missing?: string): string {
  const i = s.indexOf(d);
  return i < 0 ? (missing ?? s) : s.slice(0, i);
}
function substringAfterLast(s: string, d: string, missing?: string): string {
  const i = s.lastIndexOf(d);
  return i < 0 ? (missing ?? s) : s.slice(i + d.length);
}
function substringBeforeLast(s: string, d: string, missing?: string): string {
  const i = s.lastIndexOf(d);
  return i < 0 ? (missing ?? s) : s.slice(0, i);
}

function trimChars(s: string, chars: any, start: boolean, end: boolean): string {
  let pred: (c: string) => boolean;
  if (chars.length === 0) pred = isWhitespace;
  else if (typeof chars[0] === 'function') pred = (c) => chars[0](c) === true;
  else {
    const set = chars.flatMap((c: any) => (Array.isArray(c) ? c : typeof c === 'string' && c.length > 1 ? [...c] : [c]));
    pred = (c) => set.includes(c);
  }
  let a = 0;
  let b = s.length;
  if (start) while (a < b && pred(s[a])) a++;
  if (end) while (b > a && pred(s[b - 1])) b--;
  return s.slice(a, b);
}

const isWhitespace = (c: string) => /\s/.test(c) || c === ' ' || c === ' ' || c === ' ';

function split(s: string, ...args: any[]): string[] {
  let ignoreCase = false;
  let limit = 0;
  const delims: any[] = [];
  for (const a of args) {
    if (typeof a === 'boolean') ignoreCase = a;
    else if (typeof a === 'number') limit = a;
    else if (a && typeof a === 'object' && !Array.isArray(a) && !(a instanceof Regex) && ('ignoreCase' in a || 'limit' in a)) {
      ignoreCase = a.ignoreCase ?? false;
      limit = a.limit ?? 0;
    } else if (Array.isArray(a)) delims.push(...a);
    else delims.push(a);
  }
  if (delims.length === 1 && delims[0] instanceof Regex) return delims[0].split(s, limit);
  if (delims.length === 1 && delims[0] instanceof RegExp) return s.split(delims[0]);
  const strs = delims.map((d) => str(d));
  const out: string[] = [];
  let pos = 0;
  const hay = ignoreCase ? s.toLowerCase() : s;
  const needles = ignoreCase ? strs.map((d) => d.toLowerCase()) : strs;
  while (limit <= 0 || out.length < limit - 1) {
    let best = -1;
    let bestLen = 0;
    for (const d of needles) {
      const i = hay.indexOf(d, pos);
      if (i >= 0 && (best < 0 || i < best)) {
        best = i;
        bestLen = d.length;
      }
    }
    if (best < 0 || bestLen === 0) break;
    out.push(s.slice(pos, best));
    pos = best + bestLen;
  }
  out.push(s.slice(pos));
  return out;
}

function replace(s: string, a: any, b: any, ignoreCase?: boolean): string {
  if (a instanceof Regex) return a.replace(s, b);
  const from = str(a);
  const to = typeof b === 'function' ? b : str(b);
  if (from === '') {
    // Kotlin inserts the replacement between every char.
    return to + [...s].join(to) + (s.length ? to : '');
  }
  if (!ignoreCase) return s.split(from).join(to as string);
  return s.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), () => to as string);
}

function capitalizeFirst(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function trimIndent(s: string): string {
  const lines = s.split('\n');
  const nonBlank = lines.filter((l) => l.trim().length);
  const indent = Math.min(...nonBlank.map((l) => l.length - l.trimStart().length));
  const out = lines.map((l) => (l.trim().length ? l.slice(indent) : ''));
  if (out.length && out[0].trim() === '') out.shift();
  if (out.length && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n');
}

function trimMargin(s: string, prefix = '|'): string {
  const lines = s.split('\n');
  const out = lines.map((l) => {
    const t = l.trimStart();
    return t.startsWith(prefix) ? t.slice(prefix.length) : l;
  });
  if (out.length && out[0].trim() === '') out.shift();
  if (out.length && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n');
}

add(
  ext('substringAfter', CHAR, substringAfter),
  ext('substringBefore', CHAR, substringBefore),
  ext('substringAfterLast', CHAR, substringAfterLast),
  ext('substringBeforeLast', CHAR, substringBeforeLast),
  ext('substring', CHARSEQ, (s: any, a: any, b?: number) => {
    const t = str(s);
    if (a instanceof IntRange) return t.substring(a.first, a.last + 1);
    if (a < 0 || a > t.length || (b !== undefined && (b > t.length || b < a))) {
      throw new IndexOutOfBoundsException(`begin ${a}, end ${b ?? t.length}, length ${t.length}`);
    }
    return t.substring(a, b);
  }),
  ext('subSequence', CHARSEQ, (s: any, a: number, b: number) => str(s).substring(a, b)),
  ext('removePrefix', CHAR, (s: string, p: string) => (s.startsWith(str(p)) ? s.slice(str(p).length) : s)),
  ext('removeSuffix', CHAR, (s: string, p: string) => (s.endsWith(str(p)) && str(p).length ? s.slice(0, s.length - str(p).length) : s)),
  ext('removeSurrounding', CHAR, (s: string, a: string, b?: string) => {
    const end = b ?? a;
    return s.length >= a.length + end.length && s.startsWith(a) && s.endsWith(end) ? s.slice(a.length, s.length - end.length) : s;
  }),
  ext('removeRange', CHAR, (s: string, a: any, b?: number) => (a instanceof IntRange ? s.slice(0, a.first) + s.slice(a.last + 1) : s.slice(0, a) + s.slice(b))),
  ext('trim', CHARSEQ, (s: any, ...chars: any[]) => trimChars(str(s), chars, true, true)),
  ext('trimStart', CHAR, (s: string, ...chars: any[]) => trimChars(s, chars, true, false)),
  ext('trimEnd', CHAR, (s: string, ...chars: any[]) => trimChars(s, chars, false, true)),
  ext('trimIndent', CHAR, trimIndent),
  ext('trimMargin', CHAR, trimMargin),
  ext('prependIndent', CHAR, (s: string, ind = '    ') => s.split('\n').map((l) => ind + l).join('\n')),
  ext('split', CHARSEQ, (s: any, ...args: any[]) => split(str(s), ...args)),
  ext('lines', CHAR, (s: string) => s.split(/\r\n|\r|\n/)),
  ext('lineSequence', CHAR, (s: string) => s.split(/\r\n|\r|\n/)),
  ext('replace', CHAR, replace),
  ext('replaceFirst', CHAR, (s: string, a: any, b: string, ignoreCase?: boolean) => {
    if (a instanceof Regex) return a.replaceFirst(s, b);
    const i = ignoreCase ? s.toLowerCase().indexOf(str(a).toLowerCase()) : s.indexOf(str(a));
    return i < 0 ? s : s.slice(0, i) + str(b) + s.slice(i + str(a).length);
  }),
  ext('replaceRange', CHAR, (s: string, a: any, b: any, c?: string) =>
    a instanceof IntRange ? s.slice(0, a.first) + str(b) + s.slice(a.last + 1) : s.slice(0, a) + str(c) + s.slice(b),
  ),
  hof('replaceFirstChar', CHAR, function* (s: string, f) {
    return s.length ? str(yield f(s[0])) + s.slice(1) : s;
  }),
  ext('startsWith', CHAR, (s: string, p: any, a?: any) => {
    if (typeof a === 'number') return s.startsWith(str(p), a);
    return a === true ? s.toLowerCase().startsWith(str(p).toLowerCase()) : s.startsWith(str(p));
  }),
  ext('endsWith', CHAR, (s: string, p: any, ignoreCase?: boolean) => (ignoreCase ? s.toLowerCase().endsWith(str(p).toLowerCase()) : s.endsWith(str(p)))),
  ext('contains', CHARSEQ, strContains),
  ext('indexOf', CHAR, (s: string, p: any, a?: any, ignoreCase?: boolean) => {
    const from = typeof a === 'number' ? a : 0;
    const ic = typeof a === 'boolean' ? a : ignoreCase;
    return ic ? s.toLowerCase().indexOf(str(p).toLowerCase(), from) : s.indexOf(str(p), from);
  }),
  ext('lastIndexOf', CHAR, (s: string, p: any, from?: number) => (from === undefined ? s.lastIndexOf(str(p)) : s.lastIndexOf(str(p), from))),
  ext('indexOfAny', CHAR, (s: string, chars: any) => {
    const cs = items(chars).map(str);
    for (let i = 0; i < s.length; i++) if (cs.some((c) => s.startsWith(c, i))) return i;
    return -1;
  }),
  ext('isEmpty', CHARSEQ, (s: any) => str(s).length === 0),
  ext('isNotEmpty', CHARSEQ, (s: any) => str(s).length > 0),
  ext('isBlank', CHARSEQ, (s: any) => [...str(s)].every(isWhitespace)),
  ext('isNotBlank', CHARSEQ, (s: any) => ![...str(s)].every(isWhitespace)),
  hof('ifBlank', CHAR, function* (s: string, f) {
    return [...s].every(isWhitespace) ? yield f() : s;
  }),
  ext('uppercase', CHAR, (s: string) => s.toUpperCase()),
  ext('lowercase', CHAR, (s: string) => s.toLowerCase()),
  ext('toUpperCase', CHAR, (s: string) => s.toUpperCase()),
  ext('toLowerCase', CHAR, (s: string) => s.toLowerCase()),
  ext('uppercaseChar', CHAR, (s: string) => s.toUpperCase()),
  ext('lowercaseChar', CHAR, (s: string) => s.toLowerCase()),
  ext('titlecase', CHAR, (s: string) => s.toUpperCase()),
  ext('capitalize', CHAR, capitalizeFirst),
  ext('decapitalize', CHAR, (s: string) => (s.length ? s[0].toLowerCase() + s.slice(1) : s)),
  ext('toInt', CHAR, (s: string, radix?: number) => toIntStrict(s, radix)),
  ext('toLong', CHAR, (s: string, radix?: number) => toIntStrict(s, radix)),
  ext('toShort', CHAR, (s: string) => toIntStrict(s)),
  ext('toByte', CHAR, (s: string) => toIntStrict(s)),
  ext('toIntOrNull', CHAR, (s: string, radix?: number) => toIntOrNull(s, radix)),
  ext('toLongOrNull', CHAR, (s: string, radix?: number) => toIntOrNull(s, radix)),
  ext('toDouble', CHAR, toDoubleStrict),
  ext('toFloat', CHAR, toDoubleStrict),
  ext('toDoubleOrNull', CHAR, toDoubleOrNull),
  ext('toFloatOrNull', CHAR, toDoubleOrNull),
  ext('toBigDecimal', CHAR, toDoubleStrict),
  ext('toBigDecimalOrNull', CHAR, toDoubleOrNull),
  ext('toBoolean', CHAR, (s: string) => s.toLowerCase() === 'true'),
  ext('toBooleanStrict', CHAR, (s: string) => {
    if (s === 'true') return true;
    if (s === 'false') return false;
    throw new IllegalArgumentException(`The string doesn't represent a boolean value: ${s}`);
  }),
  ext('toBooleanStrictOrNull', CHAR, (s: string) => (s === 'true' ? true : s === 'false' ? false : null)),
  ext('toRegex', CHAR, (s: string, o?: any) => new Regex(s, o)),
  ext('toPattern', CHAR, (s: string) => new Regex(s).toPattern()),
  ext('padStart', CHAR, (s: string, n: number, c = ' ') => s.padStart(n, c)),
  ext('padEnd', CHAR, (s: string, n: number, c = ' ') => s.padEnd(n, c)),
  ext('repeat', CHAR, (s: string, n: number) => s.repeat(n)),
  ext('take', CHAR, (s: string, n: number) => s.slice(0, n)),
  ext('takeLast', CHAR, (s: string, n: number) => (n === 0 ? '' : s.slice(-n))),
  ext('drop', CHAR, (s: string, n: number) => s.slice(n)),
  ext('dropLast', CHAR, (s: string, n: number) => s.slice(0, Math.max(0, s.length - n))),
  ext('get', CHAR, (s: string, i: number) => {
    if (i < 0 || i >= s.length) throw new IndexOutOfBoundsException(`index: ${i}, length: ${s.length}`);
    return s.charAt(i);
  }),
  ext('matches', CHAR, (s: string, r: any) => (r instanceof Regex ? r : new Regex(str(r))).matches(s)),
  ext('format', CHAR, (s: string, ...args: any[]) => format(s, args)),
  ext('encodeToByteArray', CHAR, (s: string) => utf8Encode(s)),
  ext('toByteArray', CHAR, (s: string, charset?: any) => encodeCharset(s, charset)),
  ext('commonPrefixWith', CHAR, (a: string, b: string) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return a.slice(0, i);
  }),
  ext('equals', CHAR, (a: string, b: any, ignoreCase?: boolean) => (ignoreCase ? typeof b === 'string' && a.toLowerCase() === b.toLowerCase() : a === b)),
  ext('compareTo', CHAR, (a: string, b: string, ignoreCase?: boolean) => {
    const x = ignoreCase ? a.toLowerCase() : a;
    const y = ignoreCase ? b.toLowerCase() : b;
    return x < y ? -1 : x > y ? 1 : 0;
  }),
  ext('regionMatches', CHAR, (a: string, ai: number, b: string, bi: number, len: number, ignoreCase = false) => {
    const x = a.substr(ai, len);
    const y = b.substr(bi, len);
    return ignoreCase ? x.toLowerCase() === y.toLowerCase() : x === y;
  }),
  ext('toCharArray', CHAR, (s: string) => [...s]),
  ext('codePointAt', CHAR, (s: string, i: number) => s.codePointAt(i)),
  ext('intern', CHAR, (s: string) => s),
  ext('normalize', CHAR, (s: string, form?: any) => s.normalize(form?.name ?? 'NFC')),
  // Char-specific
  extProp('code', CHAR, (c: string) => c.charCodeAt(0)),
  ext('toInt', NUM, (n: number) => Math.trunc(n) | 0),
  ext('isDigit', CHAR, (c: string) => /\p{Nd}/u.test(c)),
  ext('isLetter', CHAR, (c: string) => /\p{L}/u.test(c)),
  ext('isLetterOrDigit', CHAR, (c: string) => /[\p{L}\p{Nd}]/u.test(c)),
  ext('isWhitespace', CHAR, (c: string) => isWhitespace(c)),
  ext('isUpperCase', CHAR, (c: string) => /\p{Lu}/u.test(c)),
  ext('isLowerCase', CHAR, (c: string) => /\p{Ll}/u.test(c)),
  ext('isSurrogate', CHAR, (c: string) => /[\uD800-\uDFFF]/.test(c)),
  ext('digitToInt', CHAR, (c: string, radix = 10) => {
    const v = parseInt(c, radix);
    if (Number.isNaN(v)) throw new IllegalArgumentException(`Char ${c} is not a digit`);
    return v;
  }),
  ext('digitToIntOrNull', CHAR, (c: string, radix = 10) => {
    const v = parseInt(c, radix);
    return Number.isNaN(v) ? null : v;
  }),
);

// --- numbers ---
add(
  ext('toInt', NUM, (n: number) => (Number.isFinite(n) ? Math.trunc(n) : Number.isNaN(n) ? 0 : n > 0 ? 2147483647 : -2147483648)),
  ext('toLong', NUM, (n: number) => (Number.isFinite(n) ? Math.trunc(n) : 0)),
  ext('toShort', NUM, (n: number) => (Math.trunc(n) << 16) >> 16),
  ext('toByte', NUM, (n: number) => (Math.trunc(n) << 24) >> 24),
  ext('toDouble', NUM, (n: number) => n),
  ext('toFloat', NUM, (n: number) => n),
  ext('toBigDecimal', NUM, (n: number) => n),
  ext('toChar', NUM, (n: number) => String.fromCharCode(n)),
  ext('toUInt', NUM, (n: number) => n >>> 0),
  ext('toULong', NUM, (n: number) => n),
  ext('toUByte', NUM, (n: number) => n & 0xff),
  ext('toString', NUM, (n: number, radix?: number) => (radix ? n.toString(radix) : str(n))),
  ext('roundToInt', NUM, (n: number) => kRound(n)),
  ext('roundToLong', NUM, (n: number) => kRound(n)),
  ext('coerceIn', NUM, (n: number, a: any, b?: number) => (a instanceof IntRange ? a.coerce(n) : Math.min(Math.max(n, a), b as number))),
  ext('coerceAtLeast', NUM, (n: number, a: number) => Math.max(n, a)),
  ext('coerceAtMost', NUM, (n: number, a: number) => Math.min(n, a)),
  extProp('absoluteValue', NUM, (n: number) => Math.abs(n)),
  extProp('sign', NUM, (n: number) => Math.sign(n)),
  ext('pow', NUM, (n: number, e: number) => Math.pow(n, e)),
  ext('isNaN', NUM, (n: number) => Number.isNaN(n)),
  ext('isInfinite', NUM, (n: number) => !Number.isFinite(n) && !Number.isNaN(n)),
  ext('isFinite', NUM, (n: number) => Number.isFinite(n)),
  ext('inc', NUM, (n: number) => n + 1),
  ext('dec', NUM, (n: number) => n - 1),
  ext('floorDiv', NUM, (a: number, b: number) => Math.floor(a / b)),
  ext('mod', NUM, (a: number, b: number) => ((a % b) + b) % b),
  ext('rem', NUM, (a: number, b: number) => a % b),
  ext('and', (x) => NUM(x) || isBool(x), (a: any, b: any) => (typeof a === 'boolean' ? a && b : a & b)),
  ext('or', (x) => NUM(x) || isBool(x), (a: any, b: any) => (typeof a === 'boolean' ? a || b : a | b)),
  ext('xor', (x) => NUM(x) || isBool(x), (a: any, b: any) => (typeof a === 'boolean' ? a !== b : a ^ b)),
  ext('inv', NUM, (a: number) => ~a),
  ext('shl', NUM, (a: number, b: number) => a << b),
  ext('shr', NUM, (a: number, b: number) => a >> b),
  ext('ushr', NUM, (a: number, b: number) => a >>> b),
  ext('not', isBool, (a: boolean) => !a),
  ext('countOneBits', NUM, (n: number) => {
    let c = 0;
    let v = n >>> 0;
    while (v) {
      c += v & 1;
      v >>>= 1;
    }
    return c;
  }),
  ext('format', NUM, (n: number, ...args: any[]) => format(str(n), args)),
);

function kRound(n: number): number {
  if (Number.isNaN(n)) throw new IllegalArgumentException('Cannot round NaN value.');
  return Math.round(n);
}

// --- StringBuilder (members live on the class; these cover extension-only names) ---
add(
  ext('isEmpty', SB, (s: StringBuilder) => s.isEmpty()),
  ext('isNotEmpty', SB, (s: StringBuilder) => s.isNotEmpty()),
  ext('appendLine', SB, (s: StringBuilder, x?: any) => s.appendLine(x)),
);

// --- functions ---
add(ext('invoke', (x) => typeof x === 'function', (f: any, ...args: any[]) => f(...args)));

class ListIterator {
  private i = 0;
  constructor(private readonly xs: any[]) {}
  hasNext(): boolean {
    return this.i < this.xs.length;
  }
  next(): any {
    if (this.i >= this.xs.length) throw new NoSuchElementException();
    return this.xs[this.i++];
  }
}

export class IndexedValue {
  constructor(
    readonly index: number,
    readonly value: any,
  ) {}
  component1(): number {
    return this.index;
  }
  component2(): any {
    return this.value;
  }
}

function* filterGen(xs: any[], f: any): Generator<any, any[], any> {
  const out: any[] = [];
  for (const v of xs) if (bool(yield f(v))) out.push(v);
  return out;
}

function* byExtreme(xs: any[], f: any, dir: number, throwEmpty: boolean): Generator<any, any, any> {
  if (!xs.length) {
    if (throwEmpty) throw new NoSuchElementException();
    return null;
  }
  let best = xs[0];
  let bestKey = yield f(best);
  for (let i = 1; i < xs.length; i++) {
    const k = yield f(xs[i]);
    if (compare(k, bestKey) * dir > 0) {
      best = xs[i];
      bestKey = k;
    }
  }
  return best;
}

function extreme(xs: any[], dir: number, throwEmpty: boolean): any {
  if (!xs.length) {
    if (throwEmpty) throw new NoSuchElementException();
    return null;
  }
  return xs.reduce((a, b) => (compare(b, a) * dir > 0 ? b : a));
}

function* sortByGen(xs: any[], f: any, dir: number): Generator<any, any[], any> {
  const keyed: any[] = [];
  for (let i = 0; i < xs.length; i++) keyed.push({ v: xs[i], k: yield f(xs[i]), i });
  keyed.sort((a, b) => compare(a.k, b.k) * dir || a.i - b.i);
  return keyed.map((e) => e.v);
}

function distinctBy(xs: any[], f: (v: any) => any): any[] {
  const keys: any[] = [];
  const out: any[] = [];
  for (const v of xs) {
    const k = f(v);
    if (!keys.some((kk) => eq(kk, k))) {
      keys.push(k);
      out.push(v);
    }
  }
  return out;
}

function* joinGen(xs: any[], args: any[]): Generator<any, string, any> {
  // joinToString(separator, prefix, postfix, limit, truncated, transform) or named object
  let o: any = {};
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof Regex) && '$named' in args[0]) o = args[0];
  else {
    const fnIdx = args.findIndex((a) => typeof a === 'function');
    if (fnIdx >= 0) o.transform = args[fnIdx];
    const rest = fnIdx >= 0 ? args.slice(0, fnIdx) : args;
    [o.separator, o.prefix, o.postfix, o.limit, o.truncated] = rest;
  }
  const sep = o.separator ?? ', ';
  const limit = o.limit ?? -1;
  const parts: string[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (limit >= 0 && i >= limit) {
      parts.push(o.truncated ?? '...');
      break;
    }
    parts.push(o.transform ? str(yield o.transform(xs[i])) : str(xs[i]));
  }
  return (o.prefix ?? '') + parts.join(str(sep)) + (o.postfix ?? '');
}

export function utf8Encode(s: string): Int8Array {
  const u = new TextEncoder().encode(s);
  return new Int8Array(u.buffer, u.byteOffset, u.byteLength);
}

export function encodeCharset(s: string, charset?: any): Int8Array {
  const name = String(charset?.name ?? charset ?? 'UTF-8').toUpperCase();
  if (name === 'ISO-8859-1' || name === 'US-ASCII' || name === 'LATIN1') {
    return Int8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
  }
  return utf8Encode(s);
}

/** java String.format subset: %s %d %f %.Nf %x %02d %, %n %% */
export function format(fmt: string, args: any[]): string {
  let ai = 0;
  return fmt.replace(/%(\d+\$)?([-#+ 0,(]*)(\d+)?(\.\d+)?([sSdfxXoceEgbn%])/g, (_m, pos, flags: string, width, prec, conv) => {
    if (conv === '%') return '%';
    if (conv === 'n') return '\n';
    const v = pos ? args[parseInt(pos) - 1] : args[ai++];
    let out: string;
    switch (conv) {
      case 'd':
        out = String(Math.trunc(Number(v)));
        if (flags.includes(',')) out = out.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        if (flags.includes('+') && Number(v) >= 0) out = '+' + out;
        break;
      case 'f':
      case 'e':
      case 'E':
      case 'g':
        out = conv === 'f' ? Number(v).toFixed(prec ? parseInt(prec.slice(1)) : 6) : Number(v).toExponential(prec ? parseInt(prec.slice(1)) : 6);
        if (flags.includes(',')) {
          const [i, d] = out.split('.');
          out = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d !== undefined ? '.' + d : '');
        }
        if (conv === 'E') out = out.toUpperCase();
        break;
      case 'x':
        out = (Number(v) >>> 0).toString(16);
        break;
      case 'X':
        out = (Number(v) >>> 0).toString(16).toUpperCase();
        break;
      case 'o':
        out = (Number(v) >>> 0).toString(8);
        break;
      case 'c':
        out = typeof v === 'number' ? String.fromCharCode(v) : str(v);
        break;
      case 'b':
        out = String(v !== null && v !== false);
        break;
      case 'S':
        out = str(v).toUpperCase();
        break;
      default:
        out = str(v);
        if (prec) out = out.slice(0, parseInt(prec.slice(1)));
    }
    if (width) {
      const w = parseInt(width);
      if (flags.includes('-')) out = out.padEnd(w);
      else if (flags.includes('0') && conv !== 's') {
        const neg = out.startsWith('-');
        out = (neg ? '-' : '') + (neg ? out.slice(1) : out).padStart(w - (neg ? 1 : 0), '0');
      } else out = out.padStart(w);
    }
    return out;
  });
}

// ---------- registry ----------

export const stdlibExts: Record<string, ExtDef[]> = Object.create(null);
for (const d of defs) (stdlibExts[d.name] ??= []).push(d);

export function extsNamed(name: string): ExtDef[] {
  return stdlibExts[name] ?? [];
}

export { ANY, NONNULL, Comparator };

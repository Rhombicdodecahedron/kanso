// eu.kanade.tachiyomi.source.model.* - the Mihon extension data model.

import { eq, str } from '../kotlin/core';
import { JsonObject, toElement, elementToJS } from '../serialization/json';

export const UpdateStrategy = {
  ALWAYS_UPDATE: { name: 'ALWAYS_UPDATE', ordinal: 0, toString: () => 'ALWAYS_UPDATE' },
  ONLY_FETCH_ONCE: { name: 'ONLY_FETCH_ONCE', ordinal: 1, toString: () => 'ONLY_FETCH_ONCE' },
};

export class SManga {
  static UNKNOWN = 0;
  static ONGOING = 1;
  static COMPLETED = 2;
  static LICENSED = 3;
  static PUBLISHING_FINISHED = 4;
  static CANCELLED = 5;
  static ON_HIATUS = 6;

  url: string = null as any;
  title: string = null as any;
  artist: string | null = null;
  author: string | null = null;
  description: string | null = null;
  genre: string | null = null;
  status = 0;
  thumbnail_url: string | null = null;
  update_strategy: any = UpdateStrategy.ALWAYS_UPDATE;
  initialized = false;
  /** Komikku-style per-manga memo (a JsonObject) that some sources use to keep ids/paths. */
  memo: any = new JsonObject();

  static create(): SManga {
    return new SManga();
  }

  getGenres(): string[] | null {
    if (!this.genre) return null;
    return this.genre
      .split(', ')
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
  }

  copyFrom(other: SManga): void {
    if (other.author != null) this.author = other.author;
    if (other.artist != null) this.artist = other.artist;
    if (other.description != null) this.description = other.description;
    if (other.genre != null) this.genre = other.genre;
    if (other.thumbnail_url != null) this.thumbnail_url = other.thumbnail_url;
    this.status = other.status;
    this.update_strategy = other.update_strategy;
    if (!this.initialized) this.initialized = other.initialized;
  }

  copy(): SManga {
    return Object.assign(new SManga(), this);
  }

  toJSON(): Record<string, unknown> {
    return {
      url: this.url,
      title: this.title,
      artist: this.artist,
      author: this.author,
      description: this.description,
      genre: this.genre,
      status: this.status,
      thumbnail_url: this.thumbnail_url,
      update_strategy: this.update_strategy?.name ?? 'ALWAYS_UPDATE',
      initialized: this.initialized,
      memo: elementToJS(this.memo),
    };
  }

  static fromJSON(o: any): SManga {
    const m = new SManga();
    if (o.memo) m.memo = toElement(o.memo);
    for (const k of ['url', 'title', 'artist', 'author', 'description', 'genre', 'thumbnail_url']) {
      if (o[k] !== undefined) (m as any)[k] = o[k];
    }
    m.status = o.status ?? 0;
    m.initialized = !!o.initialized;
    m.update_strategy = o.update_strategy === 'ONLY_FETCH_ONCE' ? UpdateStrategy.ONLY_FETCH_ONCE : UpdateStrategy.ALWAYS_UPDATE;
    return m;
  }

  toString(): string {
    return `SManga(${this.url}, ${this.title})`;
  }
}

export class SChapter {
  url: string = null as any;
  name: string = null as any;
  date_upload = 0;
  chapter_number = -1;
  scanlator: string | null = null;
  memo: any = new JsonObject();

  static create(): SChapter {
    return new SChapter();
  }

  copyFrom(other: SChapter): void {
    this.name = other.name;
    this.url = other.url;
    this.date_upload = other.date_upload;
    this.chapter_number = other.chapter_number;
    this.scanlator = other.scanlator;
  }

  toJSON(): Record<string, unknown> {
    return {
      url: this.url,
      name: this.name,
      date_upload: this.date_upload,
      chapter_number: this.chapter_number,
      scanlator: this.scanlator,
      memo: elementToJS(this.memo),
    };
  }

  static fromJSON(o: any): SChapter {
    const c = new SChapter();
    if (o.memo) c.memo = toElement(o.memo);
    c.url = o.url;
    c.name = o.name;
    c.date_upload = o.date_upload ?? 0;
    c.chapter_number = o.chapter_number ?? -1;
    c.scanlator = o.scanlator ?? null;
    return c;
  }

  toString(): string {
    return `SChapter(${this.url}, ${this.name})`;
  }
}

export class Page {
  index: number;
  url: string;
  imageUrl: string | null;
  uri: unknown;
  constructor(index: number, url = '', imageUrl: string | null = null, uri: unknown = null) {
    this.index = index;
    this.url = url ?? '';
    this.imageUrl = imageUrl;
    this.uri = uri;
  }
  get number(): number {
    return this.index + 1;
  }
  toJSON(): Record<string, unknown> {
    return { index: this.index, url: this.url, imageUrl: this.imageUrl };
  }
  static fromJSON(o: any): Page {
    return new Page(o.index, o.url ?? '', o.imageUrl ?? null);
  }
  toString(): string {
    return `Page(${this.index}, ${this.url}, ${this.imageUrl})`;
  }
}

export class MangasPage {
  constructor(
    readonly mangas: SManga[],
    readonly hasNextPage: boolean,
  ) {}
  component1(): SManga[] {
    return this.mangas;
  }
  component2(): boolean {
    return this.hasNextPage;
  }
  copy(o: { mangas?: SManga[]; hasNextPage?: boolean } = {}): MangasPage {
    return new MangasPage(o.mangas ?? this.mangas, o.hasNextPage ?? this.hasNextPage);
  }
  equals(o: any): boolean {
    return o instanceof MangasPage && eq(this.mangas, o.mangas) && this.hasNextPage === o.hasNextPage;
  }
  toString(): string {
    return `MangasPage(${str(this.mangas.length)} mangas, hasNextPage=${this.hasNextPage})`;
  }
}

export class SMangaUpdate {
  constructor(
    readonly manga: SManga,
    readonly chapters: SChapter[],
  ) {}
  component1(): SManga {
    return this.manga;
  }
  component2(): SChapter[] {
    return this.chapters;
  }
}

// ---------- filters ----------

export class Filter<T = any> {
  constructor(
    readonly name: string,
    public state: T,
  ) {}
  equals(o: any): boolean {
    return this === o || (o instanceof Filter && o.constructor === this.constructor && o.name === this.name && eq(o.state, this.state));
  }
  hashCode(): number {
    return 0;
  }
  /** Kind tag for the host app's filter UI. */
  get $kind(): string {
    return 'unknown';
  }

  static Header: typeof FilterHeader;
  static Separator: typeof FilterSeparator;
  static Select: typeof FilterSelect;
  static Text: typeof FilterText;
  static CheckBox: typeof FilterCheckBox;
  static TriState: typeof FilterTriState;
  static Group: typeof FilterGroup;
  static Sort: typeof FilterSort;
}

class FilterHeader extends Filter<number> {
  constructor(name: string) {
    super(name, 0);
  }
  get $kind(): string {
    return 'header';
  }
}

class FilterSeparator extends Filter<number> {
  constructor(name = '') {
    super(name, 0);
  }
  get $kind(): string {
    return 'separator';
  }
}

class FilterSelect<V = any> extends Filter<number> {
  readonly values: V[];
  constructor(name: string, values: V[], state = 0) {
    super(name, state);
    this.values = values;
  }
  get $kind(): string {
    return 'select';
  }
}

class FilterText extends Filter<string> {
  constructor(name: string, state = '') {
    super(name, state);
  }
  get $kind(): string {
    return 'text';
  }
}

class FilterCheckBox extends Filter<boolean> {
  constructor(name: string, state = false) {
    super(name, state);
  }
  get $kind(): string {
    return 'checkbox';
  }
}

class FilterTriState extends Filter<number> {
  static STATE_IGNORE = 0;
  static STATE_INCLUDE = 1;
  static STATE_EXCLUDE = 2;
  constructor(name: string, state = 0) {
    super(name, state);
  }
  isIgnored(): boolean {
    return this.state === 0;
  }
  isIncluded(): boolean {
    return this.state === 1;
  }
  isExcluded(): boolean {
    return this.state === 2;
  }
  get $kind(): string {
    return 'tristate';
  }
}

class FilterGroup<V = any> extends Filter<V[]> {
  constructor(name: string, state: V[]) {
    super(name, state);
  }
  get $kind(): string {
    return 'group';
  }
}

class SortSelection {
  constructor(
    readonly index: number,
    readonly ascending: boolean,
  ) {}
  component1(): number {
    return this.index;
  }
  component2(): boolean {
    return this.ascending;
  }
  equals(o: any): boolean {
    return o instanceof SortSelection && o.index === this.index && o.ascending === this.ascending;
  }
}

class FilterSort extends Filter<SortSelection | null> {
  static Selection = SortSelection;
  readonly values: string[];
  constructor(name: string, values: string[], state: SortSelection | null = null) {
    super(name, state);
    this.values = values;
  }
  get $kind(): string {
    return 'sort';
  }
}

Filter.Header = FilterHeader;
Filter.Separator = FilterSeparator;
Filter.Select = FilterSelect;
Filter.Text = FilterText;
Filter.CheckBox = FilterCheckBox;
Filter.TriState = FilterTriState;
Filter.Group = FilterGroup;
Filter.Sort = FilterSort;

/** FilterList is a List<Filter<*>>; represented as a real array so stdlib ops apply. */
export function FilterList(...args: any[]): Filter[] {
  if (args.length === 1 && Array.isArray(args[0])) return [...args[0]];
  return args;
}
FilterList.$is = (x: unknown) => Array.isArray(x);

// ---------- serialisation of filter state for the host app ----------

export interface FilterSnapshot {
  kind: string;
  name: string;
  state: unknown;
  values?: string[];
  children?: FilterSnapshot[];
}

export function snapshotFilters(filters: Filter[]): FilterSnapshot[] {
  return filters.map(snapshotFilter);
}

function snapshotFilter(f: Filter): FilterSnapshot {
  const snap: FilterSnapshot = { kind: f.$kind, name: f.name, state: f.state };
  if (f instanceof FilterSelect) snap.values = f.values.map((v) => str(v));
  if (f instanceof FilterSort) {
    snap.values = f.values.map((v) => str(v));
    snap.state = f.state ? { index: f.state.index, ascending: f.state.ascending } : null;
  }
  if (f instanceof FilterGroup) {
    snap.children = (f.state as any[]).map((c) => (c instanceof Filter ? snapshotFilter(c) : { kind: 'unknown', name: str(c), state: null }));
    snap.state = null;
  }
  return snap;
}

/** Apply UI state back onto the source's live filter objects (same shape as snapshot). */
export function applyFilterState(filters: Filter[], states: FilterSnapshot[]): void {
  filters.forEach((f, i) => {
    const s = states[i];
    if (!s) return;
    if (f instanceof FilterGroup) {
      (f.state as any[]).forEach((c, j) => {
        if (c instanceof Filter && s.children?.[j]) applyFilterState([c], [s.children[j]]);
      });
    } else if (f instanceof FilterSort) {
      const st = s.state as { index: number; ascending: boolean } | null;
      f.state = st ? new SortSelection(st.index, st.ascending) : null;
    } else if (!(f instanceof FilterHeader) && !(f instanceof FilterSeparator)) {
      (f as any).state = s.state;
    }
  });
}

// Parameter names for constructor calls that use Kotlin named arguments.
(Page as any).$params = ['index', 'url', 'imageUrl', 'uri'];
(MangasPage as any).$params = ['mangas', 'hasNextPage'];
(SMangaUpdate as any).$params = ['manga', 'chapters'];
(FilterHeader as any).$params = ['name'];
(FilterSeparator as any).$params = ['name'];
(FilterSelect as any).$params = ['name', 'values', 'state'];
(FilterText as any).$params = ['name', 'state'];
(FilterCheckBox as any).$params = ['name', 'state'];
(FilterTriState as any).$params = ['name', 'state'];
(FilterGroup as any).$params = ['name', 'state'];
(FilterSort as any).$params = ['name', 'values', 'state'];
(SortSelection as any).$params = ['index', 'ascending'];

// java.util.Locale plus the localized date symbols (month/day names, AM/PM, eras) used by
// SimpleDateFormat and DateTimeFormatter. Symbols come from Intl.DateTimeFormat; English is the
// hard-coded fallback when Intl is missing or fails.

import { stringHash } from '../kotlin/core';
import { weekRulesFor, type WeekRules } from './util';

const HAS_INTL = typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function';

export class Locale {
  readonly language: string;
  readonly country: string;
  readonly variant: string;
  readonly script: string;

  constructor(language: string, country: string = '', variant: string = '', script: string = '') {
    const lang = (language ?? '').toLowerCase();
    this.language = lang === 'iw' ? 'he' : lang === 'in' ? 'id' : lang === 'ji' ? 'yi' : lang;
    this.country = (country ?? '').toUpperCase();
    this.variant = variant ?? '';
    this.script = script ? script[0].toUpperCase() + script.slice(1).toLowerCase() : '';
  }

  getLanguage(): string {
    return this.language;
  }
  getCountry(): string {
    return this.country;
  }
  getVariant(): string {
    return this.variant;
  }
  getScript(): string {
    return this.script;
  }

  toLanguageTag(): string {
    const parts = [this.language || 'und'];
    if (this.script) parts.push(this.script);
    if (this.country) parts.push(this.country);
    if (this.variant) parts.push(this.variant);
    return parts.join('-');
  }

  toString(): string {
    let s = this.language;
    if (this.country || this.variant || this.script) s += '_' + this.country;
    if (this.variant) s += '_' + this.variant;
    if (this.script) s += (this.variant ? '_' : '_') + '#' + this.script;
    return s;
  }

  equals(o: any): boolean {
    return o instanceof Locale && o.language === this.language && o.country === this.country && o.variant === this.variant && o.script === this.script;
  }

  hashCode(): number {
    return stringHash(this.toString());
  }

  /** Tag suitable for Intl (Locale.ROOT behaves like English, as on Android). */
  get $intlTag(): string {
    if (!this.language) return 'en-US';
    return this.toLanguageTag();
  }

  getDisplayLanguage(inLocale?: Locale): string {
    return displayName('language', this.language, inLocale ?? Locale.getDefault());
  }
  get displayLanguage(): string {
    return this.getDisplayLanguage();
  }
  getDisplayCountry(inLocale?: Locale): string {
    return this.country ? displayName('region', this.country, inLocale ?? Locale.getDefault()) : '';
  }
  get displayCountry(): string {
    return this.getDisplayCountry();
  }
  getDisplayName(inLocale?: Locale): string {
    const lang = this.language ? this.getDisplayLanguage(inLocale) : '';
    const extra = [this.script ? displayName('script', this.script, inLocale ?? Locale.getDefault()) : '', this.getDisplayCountry(inLocale), this.variant].filter(Boolean);
    if (!lang) return extra.join(', ');
    return extra.length ? `${lang} (${extra.join(', ')})` : lang;
  }
  get displayName(): string {
    return this.getDisplayName();
  }

  // ----- statics -----

  static ROOT = new Locale('');
  static ENGLISH = new Locale('en');
  static FRENCH = new Locale('fr');
  static GERMAN = new Locale('de');
  static ITALIAN = new Locale('it');
  static JAPANESE = new Locale('ja');
  static KOREAN = new Locale('ko');
  static CHINESE = new Locale('zh');
  static SIMPLIFIED_CHINESE = new Locale('zh', 'CN');
  static TRADITIONAL_CHINESE = new Locale('zh', 'TW');
  static FRANCE = new Locale('fr', 'FR');
  static GERMANY = new Locale('de', 'DE');
  static ITALY = new Locale('it', 'IT');
  static JAPAN = new Locale('ja', 'JP');
  static KOREA = new Locale('ko', 'KR');
  static CHINA = new Locale('zh', 'CN');
  static PRC = new Locale('zh', 'CN');
  static TAIWAN = new Locale('zh', 'TW');
  static UK = new Locale('en', 'GB');
  static US = new Locale('en', 'US');
  static CANADA = new Locale('en', 'CA');
  static CANADA_FRENCH = new Locale('fr', 'CA');

  private static $default: Locale | null = null;

  static getDefault(_category?: unknown): Locale {
    if (!Locale.$default) {
      let tag = 'en-US';
      if (HAS_INTL) {
        try {
          tag = new Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
        } catch {
          tag = 'en-US';
        }
      }
      Locale.$default = Locale.forLanguageTag(tag.replace(/-u-.*$/, ''));
    }
    return Locale.$default;
  }

  static setDefault(a: any, b?: any): void {
    Locale.$default = b instanceof Locale ? b : a instanceof Locale ? a : null;
  }

  static forLanguageTag(tag: string): Locale {
    const subtags = String(tag ?? '').split('-');
    let i = 0;
    let lang = '';
    let script = '';
    let country = '';
    const variants: string[] = [];
    const first = subtags[0] ?? '';
    if (/^[A-Za-z]{2,8}$/.test(first)) {
      lang = first.toLowerCase() === 'und' ? '' : first;
      i = 1;
    } else {
      return Locale.ROOT;
    }
    // extlang subtags are skipped
    while (i < subtags.length && /^[A-Za-z]{3}$/.test(subtags[i]) && i < 4) i++;
    if (i < subtags.length && /^[A-Za-z]{4}$/.test(subtags[i])) script = subtags[i++];
    if (i < subtags.length && /^([A-Za-z]{2}|\d{3})$/.test(subtags[i])) country = subtags[i++];
    while (i < subtags.length && /^([A-Za-z0-9]{5,8}|\d[A-Za-z0-9]{3})$/.test(subtags[i])) variants.push(subtags[i++]);
    return new Locale(lang, country, variants.join('_'), script);
  }

  static getAvailableLocales(): Locale[] {
    return [Locale.ENGLISH, Locale.US, Locale.UK, Locale.FRENCH, Locale.GERMAN, Locale.ITALIAN, Locale.JAPANESE, Locale.KOREAN, Locale.CHINESE];
  }
}

function displayName(type: 'language' | 'region' | 'script', code: string, inLocale: Locale): string {
  const DN = HAS_INTL ? (Intl as any).DisplayNames : undefined;
  if (typeof DN === 'function') {
    try {
      const n = new DN([inLocale.$intlTag], { type, fallback: 'code' }).of(code);
      if (n) return n;
    } catch {
      /* fall through */
    }
  }
  return code;
}

// ---------- date symbols ----------

export interface DateSymbols {
  /** Format-context month names, index 0 = January. */
  monthsFull: string[];
  monthsShort: string[];
  monthsNarrow: string[];
  /** Stand-alone month names (DateTimeFormatter 'L'). */
  monthsFullStandalone: string[];
  monthsShortStandalone: string[];
  /** Index 0 = Monday ... 6 = Sunday (ISO order). */
  daysFull: string[];
  daysShort: string[];
  daysNarrow: string[];
  ampm: [string, string];
  /** Index 0 = BC, 1 = AD. */
  erasShort: [string, string];
  erasFull: [string, string];
  erasNarrow: [string, string];
  weekRules: WeekRules;
  tag: string;
}

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const EN_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const ENGLISH_SYMBOLS: DateSymbols = {
  monthsFull: EN_MONTHS,
  monthsShort: EN_MONTHS.map((m) => m.slice(0, 3)),
  monthsNarrow: EN_MONTHS.map((m) => m[0]),
  monthsFullStandalone: EN_MONTHS,
  monthsShortStandalone: EN_MONTHS.map((m) => m.slice(0, 3)),
  daysFull: EN_DAYS,
  daysShort: EN_DAYS.map((d) => d.slice(0, 3)),
  daysNarrow: EN_DAYS.map((d) => d[0]),
  ampm: ['AM', 'PM'],
  erasShort: ['BC', 'AD'],
  erasFull: ['Before Christ', 'Anno Domini'],
  erasNarrow: ['B', 'A'],
  weekRules: { firstDayOfWeek: 1, minimalDays: 1 },
  tag: 'en-US',
};

const symbolCache = new Map<string, DateSymbols>();

function utcDate(y: number, m: number, d: number, h = 12): Date {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m, d);
  dt.setUTCHours(h, 0, 0, 0);
  return dt;
}

function partOf(tag: string, opts: Intl.DateTimeFormatOptions, date: Date, type: string): string | null {
  const f = new Intl.DateTimeFormat(tag, { ...opts, timeZone: 'UTC', calendar: 'gregory', numberingSystem: 'latn' } as any);
  if (typeof f.formatToParts !== 'function') return type === 'whole' ? f.format(date) : null;
  if (type === 'whole') return f.format(date);
  const p = f.formatToParts(date).find((x) => x.type === type);
  return p ? p.value : null;
}

function buildSymbols(tag: string, rules: WeekRules): DateSymbols {
  const months = (style: 'long' | 'short' | 'narrow', standalone: boolean) =>
    Array.from({ length: 12 }, (_, i) => {
      const d = utcDate(2021, i, 15);
      const alone = partOf(tag, { month: style }, d, 'whole')!;
      if (standalone) return alone;
      const fmt = partOf(tag, { month: style, day: 'numeric' }, d, 'month');
      // Some locales (ja, zh) format the month as a bare number plus a literal; use the
      // stand-alone form ("1月") there, which is what the JDK's CLDR data prints.
      return !fmt || /^\d+$/.test(fmt) ? alone : fmt;
    });
  const days = (style: 'long' | 'short' | 'narrow') =>
    Array.from({ length: 7 }, (_, i) => partOf(tag, { weekday: style }, utcDate(2021, 0, 4 + i), 'whole')!);
  const ampm = [1, 13].map((h) => partOf(tag, { hour: 'numeric', hour12: true }, utcDate(2021, 0, 1, h), 'dayPeriod') ?? (h < 12 ? 'AM' : 'PM')) as [string, string];
  const era = (style: 'short' | 'long' | 'narrow') =>
    [utcDate(-1, 0, 1), utcDate(2021, 0, 1)].map((d) => partOf(tag, { era: style, year: 'numeric' }, d, 'era') ?? '') as [string, string];
  const out: DateSymbols = {
    monthsFull: months('long', false),
    monthsShort: months('short', false),
    monthsNarrow: months('narrow', true),
    monthsFullStandalone: months('long', true),
    monthsShortStandalone: months('short', true),
    daysFull: days('long'),
    daysShort: days('short'),
    daysNarrow: days('narrow'),
    ampm,
    erasShort: era('short'),
    erasFull: era('long'),
    erasNarrow: era('narrow'),
    weekRules: rules,
    tag,
  };
  if (out.erasShort.some((e) => !e)) out.erasShort = ENGLISH_SYMBOLS.erasShort;
  if (out.erasFull.some((e) => !e)) out.erasFull = ENGLISH_SYMBOLS.erasFull;
  if (out.erasNarrow.some((e) => !e)) out.erasNarrow = ENGLISH_SYMBOLS.erasNarrow;
  return out;
}

export function symbolsFor(locale: Locale | null | undefined): DateSymbols {
  const loc = locale ?? Locale.getDefault();
  const tag = loc.$intlTag;
  let s = symbolCache.get(tag);
  if (s) return s;
  const rules = weekRulesFor(loc.language, loc.country);
  if (!HAS_INTL || !loc.language || loc.language === 'en') {
    // English data is fixed (and identical to the JDK's); avoids Intl differences between hosts.
    s = { ...ENGLISH_SYMBOLS, weekRules: rules, tag };
    if (loc.language === 'en' && HAS_INTL) {
      try {
        // en-GB and friends use "Sept"; take short month names from Intl for regional English.
        if (loc.country && loc.country !== 'US') s = buildSymbols(tag, rules);
      } catch {
        /* keep fallback */
      }
    }
  } else {
    try {
      s = buildSymbols(tag, rules);
    } catch {
      s = { ...ENGLISH_SYMBOLS, weekRules: rules, tag };
    }
  }
  symbolCache.set(tag, s);
  return s;
}

/** Index of the longest name in `names` matching `text` at `pos` (or -1), and its length. */
export function matchName(text: string, pos: number, names: readonly string[], ignoreCase: boolean): [number, number] {
  let best = -1;
  let bestLen = 0;
  const lowerText = ignoreCase ? text.slice(pos).toLowerCase() : '';
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (!n || n.length <= bestLen) continue;
    const ok = ignoreCase ? lowerText.startsWith(n.toLowerCase()) : text.startsWith(n, pos);
    if (ok) {
      best = i;
      bestLen = n.length;
    }
  }
  return [best, bestLen];
}

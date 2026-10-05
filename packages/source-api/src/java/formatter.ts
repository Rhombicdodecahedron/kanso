// java.time.format.DateTimeFormatter and DateTimeFormatterBuilder: a port of the JDK's
// printer-parser chain (adjacent value parsing, optional sections, SMART/STRICT resolution).

import { DateTimeException, DateTimeParseException, IllegalArgumentException, IllegalStateException, NullPointerException } from '../kotlin/core';
import { ChronoField as F, FormatStyle, ResolverStyle, SignStyle, TextStyle, textBase, textNames, UnsupportedTemporalTypeException } from './fields';
import { Locale, matchName, symbolsFor } from './locale';
import { TemporalBase } from './base';
import { Instant, isoYear, LocalDate, LocalDateTime, LocalTime, ZonedDateTime, ZoneId, ZoneOffset, ZoneRegion } from './temporal';
import { epochDayOf, floorDiv, floorMod, isoFromCalendarDow, isDigit, localizedDow, monthLength, pad, weekBasedYear, weekOfMonth, weekOfWeekBasedYear } from './util';
import { canonicalZone, longZoneName, shortZoneName, ZONE_ABBREVIATIONS } from './zone';

// ---------- elements ----------

type El =
  | { k: 'lit'; s: string }
  | { k: 'num'; f: F; min: number; max: number; sign: SignStyle; sub: number; fixedW: boolean; base?: number }
  | { k: 'frac'; f: F; min: number; max: number; dp: boolean; sub: number; fixedW: boolean }
  | { k: 'text'; f: F; style: TextStyle; map?: Map<number, string> }
  | { k: 'offset'; pat: number; noOff: string }
  | { k: 'locOffset'; full: boolean }
  | { k: 'zoneId'; regionOnly: boolean }
  | { k: 'zoneText'; full: boolean }
  | { k: 'instant'; digits: number }
  | { k: 'group'; els: El[]; optional: boolean }
  | { k: 'set'; ci?: boolean; strict?: boolean }
  | { k: 'default'; f: F; v: number }
  | { k: 'week'; letter: string; count: number };

const OFFSET_PATTERNS = ['+HH', '+HHmm', '+HH:mm', '+HHMM', '+HH:MM', '+HHMMss', '+HH:MM:ss', '+HHMMSS', '+HH:MM:SS', '+HHmmss', '+HH:mm:ss', '+H', '+Hmm', '+H:mm', '+HMM', '+H:MM', '+HMMss', '+H:MM:ss', '+HMMSS', '+H:MM:SS', '+Hmmss', '+H:mm:ss'];

function offsetPatternIndex(p: string): number {
  const i = OFFSET_PATTERNS.indexOf(p);
  if (i < 0) throw new IllegalArgumentException(`Invalid zone offset pattern: ${p}`);
  return i;
}

const POW10 = [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000, 10000000000];

// ---------- builder ----------

interface Level {
  els: El[];
  active: number;
  optional: boolean;
}

export class DateTimeFormatterBuilder {
  private levels: Level[] = [{ els: [], active: -1, optional: false }];

  private get cur(): Level {
    return this.levels[this.levels.length - 1];
  }

  private appendInternal(el: El): number {
    const l = this.cur;
    l.els.push(el);
    l.active = -1;
    return l.els.length - 1;
  }

  /** JDK appendValue(NumberPrinterParser) with adjacent value parsing. */
  private appendValueEl(el: Extract<El, { k: 'num' | 'frac' }>): this {
    const l = this.cur;
    if (l.active >= 0) {
      const base = l.els[l.active] as Extract<El, { k: 'num' | 'frac' }>;
      const fixed = el.min === el.max && (el.k === 'frac' || el.sign === SignStyle.NOT_NEGATIVE);
      if (fixed) {
        base.sub = Math.max(base.sub, 0) + el.max;
        const idx = l.active;
        el.fixedW = true;
        this.appendInternal(el);
        l.active = idx;
      } else {
        base.fixedW = true;
        l.active = this.appendInternal(el);
      }
    } else {
      l.active = this.appendInternal(el);
    }
    return this;
  }

  parseCaseSensitive(): this {
    this.appendInternal({ k: 'set', ci: false });
    return this;
  }
  parseCaseInsensitive(): this {
    this.appendInternal({ k: 'set', ci: true });
    return this;
  }
  parseStrict(): this {
    this.appendInternal({ k: 'set', strict: true });
    return this;
  }
  parseLenient(): this {
    this.appendInternal({ k: 'set', strict: false });
    return this;
  }
  parseDefaulting(field: F, value: number): this {
    if (!(field instanceof F)) throw new NullPointerException('field');
    this.appendInternal({ k: 'default', f: field, v: value });
    return this;
  }

  appendValue(field: F, a?: number, b?: number, sign?: SignStyle): this {
    if (a === undefined) return this.appendValueEl({ k: 'num', f: field, min: 1, max: 19, sign: SignStyle.NORMAL, sub: 0, fixedW: false });
    if (b === undefined) {
      if (a < 1 || a > 19) throw new IllegalArgumentException(`The width must be from 1 to 19 inclusive but was ${a}`);
      return this.appendValueEl({ k: 'num', f: field, min: a, max: a, sign: SignStyle.NOT_NEGATIVE, sub: 0, fixedW: false });
    }
    if (a === b && sign === SignStyle.NOT_NEGATIVE) return this.appendValue(field, a);
    if (a < 1 || a > 19 || b < 1 || b > 19 || b < a) throw new IllegalArgumentException(`Invalid widths: ${a}, ${b}`);
    return this.appendValueEl({ k: 'num', f: field, min: a, max: b, sign: sign ?? SignStyle.NORMAL, sub: 0, fixedW: false });
  }

  appendValueReduced(field: F, width: number, maxWidth: number, baseValue: any): this {
    const base = typeof baseValue === 'number' ? baseValue : (baseValue as LocalDate).get(field);
    return this.appendValueEl({ k: 'num', f: field, min: width, max: maxWidth, sign: SignStyle.NOT_NEGATIVE, sub: 0, fixedW: false, base });
  }

  appendFraction(field: F, min: number, max: number, decimalPoint: boolean): this {
    if (min === max && !decimalPoint) return this.appendValueEl({ k: 'frac', f: field, min, max, dp: false, sub: 0, fixedW: false });
    this.appendInternal({ k: 'frac', f: field, min, max, dp: decimalPoint, sub: 0, fixedW: false });
    return this;
  }

  appendText(field: F, styleOrMap?: TextStyle | Map<number, string> | Record<string, string>): this {
    if (styleOrMap instanceof Map) {
      const m = new Map<number, string>();
      for (const [k, v] of styleOrMap) m.set(Number(k), v);
      this.appendInternal({ k: 'text', f: field, style: TextStyle.FULL, map: m });
    } else if (styleOrMap && !(styleOrMap instanceof TextStyle)) {
      const m = new Map<number, string>();
      for (const [k, v] of Object.entries(styleOrMap)) m.set(Number(k), v);
      this.appendInternal({ k: 'text', f: field, style: TextStyle.FULL, map: m });
    } else {
      this.appendInternal({ k: 'text', f: field, style: (styleOrMap as TextStyle) ?? TextStyle.FULL });
    }
    return this;
  }

  appendInstant(fractionalDigits: number = -2): this {
    if (fractionalDigits < -1 - 1 || fractionalDigits > 9) throw new IllegalArgumentException(`The fractional digits must be from -1 to 9 inclusive but was ${fractionalDigits}`);
    this.appendInternal({ k: 'instant', digits: fractionalDigits });
    return this;
  }
  appendOffsetId(): this {
    this.appendInternal({ k: 'offset', pat: 6, noOff: 'Z' });
    return this;
  }
  appendOffset(pattern: string, noOffsetText: string): this {
    this.appendInternal({ k: 'offset', pat: offsetPatternIndex(pattern), noOff: noOffsetText });
    return this;
  }
  appendLocalizedOffset(style: TextStyle): this {
    if (style !== TextStyle.FULL && style !== TextStyle.SHORT) throw new IllegalArgumentException('Style must be either full or short');
    this.appendInternal({ k: 'locOffset', full: style === TextStyle.FULL });
    return this;
  }
  appendZoneId(): this {
    this.appendInternal({ k: 'zoneId', regionOnly: false });
    return this;
  }
  appendZoneRegionId(): this {
    this.appendInternal({ k: 'zoneId', regionOnly: true });
    return this;
  }
  appendZoneOrOffsetId(): this {
    return this.appendZoneId();
  }
  appendZoneText(style: TextStyle, _preferred?: unknown): this {
    this.appendInternal({ k: 'zoneText', full: style === TextStyle.FULL || style === TextStyle.FULL_STANDALONE });
    return this;
  }
  appendGenericZoneText(style: TextStyle): this {
    return this.appendZoneText(style);
  }
  appendLiteral(lit: string): this {
    const s = String(lit);
    if (s.length > 0) this.appendInternal({ k: 'lit', s });
    return this;
  }
  append(f: DateTimeFormatter): this {
    this.appendInternal({ k: 'group', els: f.$els, optional: false });
    return this;
  }
  appendOptional(f: DateTimeFormatter): this {
    this.appendInternal({ k: 'group', els: f.$els, optional: true });
    return this;
  }
  optionalStart(): this {
    this.cur.active = -1;
    this.levels.push({ els: [], active: -1, optional: true });
    return this;
  }
  optionalEnd(): this {
    if (this.levels.length === 1) throw new IllegalStateException('Cannot call optionalEnd() as there was no previous call to optionalStart()');
    const l = this.levels.pop()!;
    if (l.els.length > 0) this.appendInternal({ k: 'group', els: l.els, optional: true });
    else this.cur.active = -1;
    return this;
  }
  appendPattern(pattern: string): this {
    parsePattern(this, pattern);
    return this;
  }
  /** @internal */
  $appendWeek(letter: string, count: number): this {
    this.appendInternal({ k: 'week', letter, count });
    return this;
  }

  toFormatter(locale?: Locale, resolver: ResolverStyle = ResolverStyle.SMART): DateTimeFormatter {
    while (this.levels.length > 1) this.optionalEnd();
    return new DateTimeFormatter(this.levels[0].els, locale ?? Locale.getDefault(), resolver, null, describe(this.levels[0].els));
  }
}

function describe(els: El[]): string {
  return els
    .map((e) => {
      switch (e.k) {
        case 'lit':
          return `'${e.s}'`;
        case 'num':
          if (e.base !== undefined) return `ReducedValue(${e.f},${e.min},${e.max},${e.base})`;
          if (e.min === 1 && e.max === 19 && e.sign === SignStyle.NORMAL) return `Value(${e.f})`;
          if (e.min === e.max && e.sign === SignStyle.NOT_NEGATIVE) return `Value(${e.f},${e.min})`;
          return `Value(${e.f},${e.min},${e.max},${e.sign.name})`;
        case 'frac':
          return `Fraction(${e.f},${e.min},${e.max}${e.dp ? ',DecimalPoint' : ''})`;
        case 'text':
          return `Text(${e.f}${e.style === TextStyle.FULL ? '' : ',' + e.style.name})`;
        case 'offset':
          return `Offset(${OFFSET_PATTERNS[e.pat]},'${e.noOff}')`;
        case 'locOffset':
          return `LocalizedOffset(${e.full ? 'FULL' : 'SHORT'})`;
        case 'zoneId':
          return e.regionOnly ? 'ZoneRegionId()' : 'ZoneId()';
        case 'zoneText':
          return `ZoneText(${e.full ? 'FULL' : 'SHORT'})`;
        case 'instant':
          return 'ParseCaseSensitive(false)Instant()';
        case 'group':
          return e.optional ? `[${describe(e.els)}]` : `(${describe(e.els)})`;
        case 'set':
          return e.ci !== undefined ? `ParseCaseSensitive(${!e.ci})` : `ParseStrict(${e.strict})`;
        case 'default':
          return `DefaultValue(${e.f},${e.v})`;
        case 'week':
          return `Localized(${e.letter},${e.count})`;
      }
    })
    .join('');
}

// ---------- pattern parsing (DateTimeFormatterBuilder.parsePattern) ----------

const FIELD_MAP: Record<string, F> = {
  G: F.ERA,
  y: F.YEAR_OF_ERA,
  u: F.YEAR,
  M: F.MONTH_OF_YEAR,
  L: F.MONTH_OF_YEAR,
  D: F.DAY_OF_YEAR,
  d: F.DAY_OF_MONTH,
  F: F.ALIGNED_WEEK_OF_MONTH,
  E: F.DAY_OF_WEEK,
  a: F.AMPM_OF_DAY,
  H: F.HOUR_OF_DAY,
  k: F.CLOCK_HOUR_OF_DAY,
  K: F.HOUR_OF_AMPM,
  h: F.CLOCK_HOUR_OF_AMPM,
  m: F.MINUTE_OF_HOUR,
  s: F.SECOND_OF_MINUTE,
  S: F.NANO_OF_SECOND,
  A: F.MILLI_OF_DAY,
  n: F.NANO_OF_SECOND,
  N: F.NANO_OF_DAY,
};

function isLetter(c: string): boolean {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
}

function parsePattern(b: DateTimeFormatterBuilder, pattern: string): void {
  let pos = 0;
  while (pos < pattern.length) {
    const cur = pattern[pos];
    if (isLetter(cur)) {
      let start = pos++;
      while (pos < pattern.length && pattern[pos] === cur) pos++;
      let count = pos - start;
      if (cur === 'p') {
        throw new IllegalArgumentException(`Pattern letter 'p' (padding) is not supported: ${pattern}`);
      }
      const field = FIELD_MAP[cur];
      if (field) {
        parseField(b, cur, count, field);
      } else if (cur === 'z') {
        if (count > 4) throw new IllegalArgumentException(`Too many pattern letters: ${cur}`);
        b.appendZoneText(count === 4 ? TextStyle.FULL : TextStyle.SHORT);
      } else if (cur === 'V') {
        if (count !== 2) throw new IllegalArgumentException(`Pattern letter count must be 2: ${cur}`);
        b.appendZoneId();
      } else if (cur === 'v') {
        if (count === 1) b.appendGenericZoneText(TextStyle.SHORT);
        else if (count === 4) b.appendGenericZoneText(TextStyle.FULL);
        else throw new IllegalArgumentException(`Wrong number of pattern letters: ${cur}`);
      } else if (cur === 'Z') {
        if (count < 4) b.appendOffset('+HHMM', '+0000');
        else if (count === 4) b.appendLocalizedOffset(TextStyle.FULL);
        else if (count === 5) b.appendOffset('+HH:MM:ss', 'Z');
        else throw new IllegalArgumentException(`Too many pattern letters: ${cur}`);
      } else if (cur === 'O') {
        if (count === 1) b.appendLocalizedOffset(TextStyle.SHORT);
        else if (count === 4) b.appendLocalizedOffset(TextStyle.FULL);
        else throw new IllegalArgumentException(`Pattern letter count must be 1 or 4: ${cur}`);
      } else if (cur === 'X') {
        if (count > 5) throw new IllegalArgumentException(`Too many pattern letters: ${cur}`);
        b.appendOffset(OFFSET_PATTERNS[count + (count === 1 ? 0 : 1)], 'Z');
      } else if (cur === 'x') {
        if (count > 5) throw new IllegalArgumentException(`Too many pattern letters: ${cur}`);
        const zero = count === 1 ? '+00' : count % 2 === 0 ? '+0000' : '+00:00';
        b.appendOffset(OFFSET_PATTERNS[count + (count === 1 ? 0 : 1)], zero);
      } else if (cur === 'W') {
        if (count > 1) throw new IllegalArgumentException(`Too many pattern letters: ${cur}`);
        b.$appendWeek('W', count);
      } else if (cur === 'w') {
        if (count > 2) throw new IllegalArgumentException(`Too many pattern letters: ${cur}`);
        b.$appendWeek('w', count);
      } else if (cur === 'Y') {
        b.$appendWeek('Y', count);
      } else if (cur === 'e' || cur === 'c') {
        if (count > 5 || (cur === 'c' && count === 2)) throw new IllegalArgumentException(`Invalid pattern "${cur.repeat(count)}"`);
        b.$appendWeek(cur, count);
      } else {
        throw new IllegalArgumentException(`Unknown pattern letter: ${cur}`);
      }
      pos--;
    } else if (cur === "'") {
      const start = pos++;
      for (; pos < pattern.length; pos++) {
        if (pattern[pos] === "'") {
          if (pos + 1 < pattern.length && pattern[pos + 1] === "'") pos++;
          else break;
        }
      }
      if (pos >= pattern.length) throw new IllegalArgumentException(`Pattern ends with an incomplete string literal: ${pattern}`);
      const str = pattern.substring(start + 1, pos);
      if (str.length === 0) b.appendLiteral("'");
      else b.appendLiteral(str.replace(/''/g, "'"));
    } else if (cur === '[') {
      b.optionalStart();
    } else if (cur === ']') {
      if ((b as any).levels.length === 1) throw new IllegalArgumentException('Pattern invalid as it contains ] without previous [');
      b.optionalEnd();
    } else if (cur === '{' || cur === '}' || cur === '#') {
      throw new IllegalArgumentException(`Pattern includes reserved character: '${cur}'`);
    } else {
      b.appendLiteral(cur);
    }
    pos++;
  }
}

function parseField(b: DateTimeFormatterBuilder, cur: string, count: number, field: F): void {
  const standalone = cur === 'L';
  switch (cur) {
    case 'u':
    case 'y':
      if (count === 2) b.appendValueReduced(field, 2, 2, 2000);
      else if (count < 4) b.appendValue(field, count, 19, SignStyle.NORMAL);
      else b.appendValue(field, count, 19, SignStyle.EXCEEDS_PAD);
      return;
    case 'M':
    case 'L':
      switch (count) {
        case 1:
          b.appendValue(field);
          return;
        case 2:
          b.appendValue(field, 2);
          return;
        case 3:
          b.appendText(field, standalone ? TextStyle.SHORT_STANDALONE : TextStyle.SHORT);
          return;
        case 4:
          b.appendText(field, standalone ? TextStyle.FULL_STANDALONE : TextStyle.FULL);
          return;
        case 5:
          b.appendText(field, standalone ? TextStyle.NARROW_STANDALONE : TextStyle.NARROW);
          return;
        default:
          throw new IllegalArgumentException(`Too many pattern letters: ${cur}`);
      }
    case 'a':
      if (count === 1) b.appendText(field, TextStyle.SHORT);
      else throw new IllegalArgumentException(`Too many pattern letters: ${cur}`);
      return;
    case 'E':
    case 'G':
      if (count <= 3) b.appendText(field, TextStyle.SHORT);
      else if (count === 4) b.appendText(field, TextStyle.FULL);
      else if (count === 5) b.appendText(field, TextStyle.NARROW);
      else throw new IllegalArgumentException(`Too many pattern letters: ${cur}`);
      return;
    case 'S':
      b.appendFraction(F.NANO_OF_SECOND, count, count, false);
      return;
    case 'F':
      if (count === 1) b.appendValue(field);
      else throw new IllegalArgumentException(`Too many pattern letters: ${cur}`);
      return;
    case 'd':
    case 'h':
    case 'H':
    case 'k':
    case 'K':
    case 'm':
    case 's':
      if (count === 1) b.appendValue(field);
      else if (count === 2) b.appendValue(field, 2);
      else throw new IllegalArgumentException(`Too many pattern letters: ${cur}`);
      return;
    case 'D':
      if (count === 1) b.appendValue(field);
      else if (count === 2 || count === 3) b.appendValue(field, count, 3, SignStyle.NOT_NEGATIVE);
      else throw new IllegalArgumentException(`Too many pattern letters: ${cur}`);
      return;
    default:
      if (count === 1) b.appendValue(field);
      else b.appendValue(field, count);
  }
}

// ---------- parsing ----------

interface Snapshot {
  fields: Map<F, number>;
  zone: ZoneId | null;
  extra: Map<string, number>;
}

class ParseCtx {
  ci = false;
  strict = true;
  fields = new Map<F, number>();
  zone: ZoneId | null = null;
  extra = new Map<string, number>();
  leapSecond = false;
  constructor(
    readonly text: string,
    readonly locale: Locale,
  ) {}
  snapshot(): Snapshot {
    return { fields: new Map(this.fields), zone: this.zone, extra: new Map(this.extra) };
  }
  restore(s: Snapshot): void {
    this.fields = s.fields;
    this.zone = s.zone;
    this.extra = s.extra;
  }
  setField(f: F, v: number, errPos: number, okPos: number): number {
    const old = this.fields.get(f);
    this.fields.set(f, v);
    return old !== undefined && old !== v ? ~errPos : okPos;
  }
  charEq(a: string, b: string): boolean {
    if (a === b) return true;
    return this.ci && (a.toUpperCase() === b.toUpperCase() || a.toLowerCase() === b.toLowerCase());
  }
  matches(pos: number, s: string): boolean {
    if (pos + s.length > this.text.length) return false;
    for (let i = 0; i < s.length; i++) if (!this.charEq(this.text[pos + i], s[i])) return false;
    return true;
  }
}

function parseList(els: El[], ctx: ParseCtx, pos: number): number {
  for (const el of els) {
    pos = parseEl(el, ctx, pos);
    if (pos < 0) return pos;
  }
  return pos;
}

function parseEl(el: El, ctx: ParseCtx, pos: number): number {
  const text = ctx.text;
  switch (el.k) {
    case 'lit':
      if (pos > text.length) return ~pos;
      return ctx.matches(pos, el.s) ? pos + el.s.length : ~pos;
    case 'set':
      if (el.ci !== undefined) ctx.ci = el.ci;
      if (el.strict !== undefined) ctx.strict = el.strict;
      return pos;
    case 'default':
      if (!ctx.fields.has(el.f)) ctx.fields.set(el.f, el.v);
      return pos;
    case 'group': {
      if (!el.optional) return parseList(el.els, ctx, pos);
      const snap = ctx.snapshot();
      const r = parseList(el.els, ctx, pos);
      if (r < 0) {
        ctx.restore(snap);
        return pos;
      }
      return r;
    }
    case 'num':
      return parseNum(el, ctx, pos);
    case 'frac':
      return parseFrac(el, ctx, pos);
    case 'text':
      return parseText(el, ctx, pos);
    case 'offset':
      return parseOffset(el.pat, el.noOff, ctx, pos);
    case 'locOffset':
      return parseLocOffset(el.full, ctx, pos);
    case 'zoneId':
      return parseZoneId(ctx, pos, false);
    case 'zoneText':
      return parseZoneId(ctx, pos, true);
    case 'instant':
      return parseInstant(ctx, pos);
    case 'week':
      return parseWeek(el, ctx, pos);
  }
}

function parseNum(el: Extract<El, { k: 'num' }>, ctx: ParseCtx, position: number): number {
  const text = ctx.text;
  const length = text.length;
  if (position === length) return ~position;
  const sign = text[position];
  let positive = false;
  let negative = false;
  const fixed = el.min === el.max;
  if (sign === '+') {
    if (!el.sign.$parse(true, ctx.strict, fixed)) return ~position;
    positive = true;
    position++;
  } else if (sign === '-') {
    if (!el.sign.$parse(false, ctx.strict, fixed)) return ~position;
    negative = true;
    position++;
  } else if (el.sign === SignStyle.ALWAYS && ctx.strict) {
    return ~position;
  }
  const effMin = ctx.strict || el.fixedW ? el.min : 1;
  const minEndPos = position + effMin;
  if (minEndPos > length) return ~position;
  let effMax = (ctx.strict || el.fixedW ? el.max : 9) + Math.max(el.sub, 0);
  let total = 0;
  let pos = position;
  for (let pass = 0; pass < 2; pass++) {
    const maxEndPos = Math.min(pos + effMax, length);
    while (pos < maxEndPos) {
      const ch = text[pos];
      if (!isDigit(ch)) {
        if (pos < minEndPos) return ~position;
        break;
      }
      total = total * 10 + (ch.charCodeAt(0) - 48);
      pos++;
    }
    if (el.sub > 0 && pass === 0) {
      const parseLen = pos - position;
      effMax = Math.max(effMin, parseLen - el.sub);
      pos = position;
      total = 0;
    } else {
      break;
    }
  }
  if (negative) {
    if (total === 0 && ctx.strict) return ~(position - 1);
    total = -total;
  } else if (el.sign === SignStyle.EXCEEDS_PAD && ctx.strict) {
    const parseLen = pos - position;
    if (positive) {
      if (parseLen <= el.min) return ~(position - 1);
    } else if (parseLen > el.min) {
      return ~position;
    }
  }
  if (el.base !== undefined) {
    // ReducedPrinterParser.setValue
    const parseLen = pos - position;
    if (parseLen === el.min && total >= 0) {
      const range = POW10[el.min];
      const lastPart = el.base % range;
      const basePart = el.base - lastPart;
      total = el.base > 0 ? basePart + total : basePart - total;
      if (total < el.base) total += range;
    }
  }
  return ctx.setField(el.f, total, position, pos);
}

function parseFrac(el: Extract<El, { k: 'frac' }>, ctx: ParseCtx, position: number): number {
  const text = ctx.text;
  const length = text.length;
  const effMin = ctx.strict || el.fixedW ? el.min : 0;
  const effMax = ctx.strict || el.fixedW ? el.max : 9;
  if (el.dp) {
    if (position === length || text[position] !== '.') return effMin > 0 ? ~position : position;
    position++;
  }
  const minEndPos = position + effMin;
  if (minEndPos > length) return ~position;
  const maxEndPos = Math.min(position + effMax, length);
  let total = 0;
  let pos = position;
  while (pos < maxEndPos) {
    const ch = text[pos];
    if (!isDigit(ch)) {
      if (pos < minEndPos) return ~position;
      break;
    }
    total = total * 10 + (ch.charCodeAt(0) - 48);
    pos++;
  }
  const digits = pos - position;
  const value = digits === 0 ? 0 : total * POW10[9 - digits];
  return ctx.setField(el.f, el.f === F.NANO_OF_SECOND ? value : Math.floor(value / (1e9 / (el.f.$range.maximum + 1))), position, pos);
}

function textEntries(el: Extract<El, { k: 'text' }>, ctx: ParseCtx, style: TextStyle | null): [string, number][] {
  if (el.map) return [...el.map].map(([v, s]) => [s, v]);
  const out: [string, number][] = [];
  const styles = style ? [style] : TextStyle.values();
  const base = textBase(el.f);
  for (const st of styles) {
    const names = textNames(el.f, st, ctx.locale);
    if (!names) continue;
    names.forEach((n, i) => out.push([n, i + base]));
  }
  return out;
}

function parseText(el: Extract<El, { k: 'text' }>, ctx: ParseCtx, position: number): number {
  const text = ctx.text;
  if (position > text.length) return ~position;
  const entries = textEntries(el, ctx, ctx.strict ? el.style : null);
  if (entries.length > 0) {
    const [idx, len] = matchName(text, position, entries.map((e) => e[0]), ctx.ci);
    if (idx >= 0) return ctx.setField(el.f, entries[idx][1], position, position + len);
    if (ctx.strict) return ~position;
  }
  return parseNum({ k: 'num', f: el.f, min: 1, max: 19, sign: SignStyle.NORMAL, sub: 0, fixedW: false }, ctx, position);
}

// OffsetIdPrinterParser.parse (JDK 11+)
function parseOffset(patIndex: number, noOff: string, ctx: ParseCtx, position: number): number {
  const text = ctx.text;
  const length = text.length;
  const noOffsetLen = noOff.length;
  if (noOffsetLen === 0) {
    if (position === length) return ctx.setField(F.OFFSET_SECONDS, 0, position, position);
  } else {
    if (position === length) return ~position;
    if (ctx.matches(position, noOff)) return ctx.setField(F.OFFSET_SECONDS, 0, position, position + noOffsetLen);
  }
  const sign = text[position];
  if (sign === '+' || sign === '-') {
    const negative = sign === '-' ? -1 : 1;
    let isColon = OFFSET_PATTERNS[patIndex].includes(':');
    const paddedHour = patIndex < 11;
    const type = patIndex % 11;
    const arr = [position + 1, 0, 0, 0];
    let parseType = patIndex;
    if (!ctx.strict) {
      if (paddedHour) {
        if (isColon || (type === 0 && length > position + 3 && text[position + 3] === ':')) {
          isColon = true;
          parseType = 10;
        } else {
          parseType = 9;
        }
      } else if (isColon || (type === 0 && length > position + 3 && (text[position + 2] === ':' || text[position + 3] === ':'))) {
        isColon = true;
        parseType = 21;
      } else {
        parseType = 20;
      }
    }
    const parseDigits = (colon: boolean, idx: number): boolean => {
      let p = arr[0];
      if (p < 0) return true;
      if (colon && idx !== 1) {
        if (p + 1 > length || text[p] !== ':') return false;
        p++;
      }
      if (p + 2 > length) return false;
      const c1 = text[p++];
      const c2 = text[p++];
      if (!isDigit(c1) || !isDigit(c2)) return false;
      const v = (c1.charCodeAt(0) - 48) * 10 + (c2.charCodeAt(0) - 48);
      if (v > 59) return false;
      arr[idx] = v;
      arr[0] = p;
      return true;
    };
    const parseVariable = (minDigits: number, maxDigits: number) => {
      let p = arr[0];
      const chars: number[] = [];
      for (let i = 0; i < maxDigits; i++) {
        if (p + 1 > length) break;
        const ch = text[p++];
        if (!isDigit(ch)) {
          p--;
          break;
        }
        chars.push(ch.charCodeAt(0) - 48);
      }
      const n = chars.length;
      if (n < minDigits) {
        arr[0] = ~arr[0];
        return;
      }
      const two = (i: number) => chars[i] * 10 + chars[i + 1];
      switch (n) {
        case 1:
          arr[1] = chars[0];
          break;
        case 2:
          arr[1] = two(0);
          break;
        case 3:
          arr[1] = chars[0];
          arr[2] = two(1);
          break;
        case 4:
          arr[1] = two(0);
          arr[2] = two(2);
          break;
        case 5:
          arr[1] = chars[0];
          arr[2] = two(1);
          arr[3] = two(3);
          break;
        case 6:
          arr[1] = two(0);
          arr[2] = two(2);
          arr[3] = two(4);
          break;
      }
      arr[0] = p;
    };
    const parseHour = () => {
      if (paddedHour) {
        if (!parseDigits(false, 1)) arr[0] = ~arr[0];
      } else {
        parseVariable(1, 2);
      }
    };
    const parseMinute = (mandatory: boolean) => {
      if (!parseDigits(isColon, 2) && mandatory) arr[0] = ~arr[0];
    };
    const parseSecond = (mandatory: boolean) => {
      if (!parseDigits(isColon, 3) && mandatory) arr[0] = ~arr[0];
    };
    switch (parseType) {
      case 0:
      case 11:
        parseHour();
        break;
      case 1:
      case 2:
      case 13:
        parseHour();
        parseMinute(false);
        break;
      case 3:
      case 4:
      case 15:
        parseHour();
        parseMinute(true);
        break;
      case 5:
      case 6:
      case 17:
        parseHour();
        parseMinute(true);
        parseSecond(false);
        break;
      case 7:
      case 8:
      case 19:
        parseHour();
        parseMinute(true);
        parseSecond(true);
        break;
      case 9:
      case 10:
      case 21:
        parseHour();
        if (parseDigits(isColon, 2)) parseDigits(isColon, 3);
        break;
      case 12:
        parseVariable(1, 4);
        break;
      case 14:
        parseVariable(3, 4);
        break;
      case 16:
        parseVariable(3, 6);
        break;
      case 18:
        parseVariable(5, 6);
        break;
      case 20:
        parseVariable(1, 6);
        break;
    }
    if (arr[0] > 0) {
      if (arr[1] > 23 || arr[2] > 59 || arr[3] > 59) throw new DateTimeException('Value out of range: Hour[0-23], Minute[0-59], Second[0-59]');
      const secs = negative * (arr[1] * 3600 + arr[2] * 60 + arr[3]);
      return ctx.setField(F.OFFSET_SECONDS, secs, position, arr[0]);
    }
  }
  if (noOffsetLen === 0) return ctx.setField(F.OFFSET_SECONDS, 0, position, position);
  return ~position;
}

function parseLocOffset(full: boolean, ctx: ParseCtx, position: number): number {
  const text = ctx.text;
  const end = text.length;
  let pos = position;
  if (!ctx.matches(pos, 'GMT')) return ~position;
  pos += 3;
  if (pos === end) return ctx.setField(F.OFFSET_SECONDS, 0, position, pos);
  const sign = text[pos];
  let negative = 0;
  if (sign === '+') negative = 1;
  else if (sign === '-') negative = -1;
  else return ctx.setField(F.OFFSET_SECONDS, 0, position, pos);
  pos++;
  const dig = (p: number) => (p < end && isDigit(text[p]) ? text.charCodeAt(p) - 48 : -1);
  let h = 0;
  let m = 0;
  let s = 0;
  if (full) {
    const h1 = dig(pos++);
    const h2 = dig(pos++);
    if (h1 < 0 || h2 < 0 || text[pos++] !== ':') return ~position;
    h = h1 * 10 + h2;
    const m1 = dig(pos++);
    const m2 = dig(pos++);
    if (m1 < 0 || m2 < 0) return ~position;
    m = m1 * 10 + m2;
    if (pos + 2 < end + 1 && text[pos] === ':') {
      const s1 = dig(pos + 1);
      const s2 = dig(pos + 2);
      if (s1 >= 0 && s2 >= 0) {
        s = s1 * 10 + s2;
        pos += 3;
      }
    }
  } else {
    h = dig(pos++);
    if (h < 0) return ~position;
    if (pos < end) {
      const h2 = dig(pos);
      if (h2 >= 0) {
        h = h * 10 + h2;
        pos++;
      }
      if (pos + 2 < end + 1 && text[pos] === ':') {
        const m1 = dig(pos + 1);
        const m2 = dig(pos + 2);
        if (m1 >= 0 && m2 >= 0) {
          m = m1 * 10 + m2;
          pos += 3;
          if (pos + 2 < end + 1 && text[pos] === ':') {
            const s1 = dig(pos + 1);
            const s2 = dig(pos + 2);
            if (s1 >= 0 && s2 >= 0) {
              s = s1 * 10 + s2;
              pos += 3;
            }
          }
        }
      }
    }
  }
  return ctx.setField(F.OFFSET_SECONDS, negative * (h * 3600 + m * 60 + s), position, pos);
}

function validZone(id: string, ci: boolean): string | null {
  const canon = canonicalZone(id);
  if (!canon) return null;
  if (canon === id) return id;
  if (canon.toLowerCase() === id.toLowerCase()) return ci ? canon : null;
  return id; // alias accepted by Intl
}

function parseOffsetBased(ctx: ParseCtx, prefixPos: number, position: number, noOff: string): number {
  const text = ctx.text;
  const prefix = text.substring(prefixPos, position).toUpperCase();
  if (position >= text.length) {
    ctx.zone = ZoneId.of(prefix);
    return position;
  }
  if (text[position] === '0' || ctx.charEq(text[position], 'Z')) {
    ctx.zone = ZoneId.of(prefix);
    return position;
  }
  const sub = new ParseCtx(text, ctx.locale);
  sub.ci = ctx.ci;
  sub.strict = ctx.strict;
  const endPos = parseOffset(6, noOff, sub, position);
  try {
    if (endPos < 0) {
      if (noOff === 'Z') return ~prefixPos;
      ctx.zone = ZoneId.of(prefix);
      return position;
    }
    const off = ZoneOffset.ofTotalSeconds(sub.fields.get(F.OFFSET_SECONDS)!);
    ctx.zone = prefix ? ZoneId.ofOffset(prefix, off) : off;
    return endPos;
  } catch (e) {
    if (e instanceof DateTimeException) return ~prefixPos;
    throw e;
  }
}

function parseZoneId(ctx: ParseCtx, position: number, zoneText: boolean): number {
  const text = ctx.text;
  const length = text.length;
  if (position > length) return ~position;
  if (position === length) return ~position;
  const next = text[position];
  if (next === '+' || next === '-') return parseOffsetBased(ctx, position, position, 'Z');
  if (zoneText) {
    // Abbreviations such as "PST", "WIB", "JST" resolve to their region (like the JDK's zone names).
    const m = /^[A-Za-z]{2,5}/.exec(text.slice(position));
    if (m) {
      for (let len = m[0].length; len >= 2; len--) {
        const cand = m[0].slice(0, len);
        const key = ctx.ci ? cand.toUpperCase() : cand;
        const e = ZONE_ABBREVIATIONS[key];
        if (e && key !== 'UT' && key !== 'Z' && (len === m[0].length || !isLetter(text[position + len] ?? ''))) {
          if (key === 'UTC' || key === 'GMT') break; // handled below with offsets
          ctx.zone = ZoneId.of(e.id);
          return position + len;
        }
      }
    }
  }
  if (length >= position + 2) {
    const nn = text[position + 1];
    if (ctx.charEq(next, 'U') && ctx.charEq(nn, 'T')) {
      if (length >= position + 3 && ctx.charEq(text[position + 2], 'C')) {
        return parseOffsetBased(ctx, position, position + 3, '0');
      }
      return parseOffsetBased(ctx, position, position + 2, '0');
    } else if (ctx.charEq(next, 'G') && length >= position + 3 && ctx.charEq(nn, 'M') && ctx.charEq(text[position + 2], 'T')) {
      if (length >= position + 4 && ctx.charEq(text[position + 3], '0')) {
        ctx.zone = ZoneId.of('GMT');
        return position + 4;
      }
      return parseOffsetBased(ctx, position, position + 3, '0');
    }
  }
  // Region id: longest valid prefix of the id-like run.
  const m = /^[A-Za-z][A-Za-z0-9~/._+-]*/.exec(text.slice(position));
  if (m) {
    for (let len = m[0].length; len >= 2; len--) {
      const cand = m[0].slice(0, len);
      if (len < m[0].length && !/[A-Za-z0-9]/.test(cand[len - 1])) continue;
      const id = validZone(cand, ctx.ci);
      if (id) {
        ctx.zone = ZoneId.of(id);
        return position + len;
      }
    }
  }
  if (ctx.charEq(next, 'Z')) {
    ctx.zone = ZoneOffset.UTC;
    return position + 1;
  }
  return ~position;
}

const INSTANT_PARSER: El[] = (() => {
  const b = new DateTimeFormatterBuilder();
  b.appendValue(F.YEAR, 4, 10, SignStyle.EXCEEDS_PAD)
    .appendLiteral('-')
    .appendValue(F.MONTH_OF_YEAR, 2)
    .appendLiteral('-')
    .appendValue(F.DAY_OF_MONTH, 2)
    .appendLiteral('T')
    .appendValue(F.HOUR_OF_DAY, 2)
    .appendLiteral(':')
    .appendValue(F.MINUTE_OF_HOUR, 2)
    .appendLiteral(':')
    .appendValue(F.SECOND_OF_MINUTE, 2)
    .appendFraction(F.NANO_OF_SECOND, 0, 9, true)
    .appendOffsetId();
  return (b as any).levels[0].els;
})();

function parseInstant(ctx: ParseCtx, position: number): number {
  const sub = new ParseCtx(ctx.text, ctx.locale);
  sub.ci = ctx.ci;
  sub.strict = ctx.strict;
  const pos = parseList(INSTANT_PARSER, sub, position);
  if (pos < 0) return pos;
  const g = (f: F) => sub.fields.get(f) ?? 0;
  const yearParsed = g(F.YEAR);
  const month = g(F.MONTH_OF_YEAR);
  const day = g(F.DAY_OF_MONTH);
  let hour = g(F.HOUR_OF_DAY);
  const min = g(F.MINUTE_OF_HOUR);
  let sec = g(F.SECOND_OF_MINUTE);
  const nano = g(F.NANO_OF_SECOND);
  const offset = g(F.OFFSET_SECONDS);
  let days = 0;
  if (hour === 24 && min === 0 && sec === 0 && nano === 0) {
    hour = 0;
    days = 1;
  } else if (hour === 23 && min === 59 && sec === 60) {
    ctx.leapSecond = true;
    sec = 59;
  }
  let instantSecs: number;
  try {
    const ldt = LocalDateTime.of(yearParsed, month, day, hour, min, sec, 0).plusDays(days);
    instantSecs = ldt.toEpochSecond(ZoneOffset.ofTotalSeconds(offset));
  } catch (e) {
    if (e instanceof Error) return ~position;
    throw e;
  }
  const r = ctx.setField(F.INSTANT_SECONDS, instantSecs, position, pos);
  if (r < 0) return r;
  return ctx.setField(F.NANO_OF_SECOND, nano, position, r);
}

function weekFieldsFor(locale: Locale): { sow: number; minDays: number } {
  const r = symbolsFor(locale).weekRules;
  return { sow: isoFromCalendarDow(r.firstDayOfWeek), minDays: r.minimalDays };
}

function parseWeek(el: Extract<El, { k: 'week' }>, ctx: ParseCtx, position: number): number {
  const sub = new ParseCtx(ctx.text, ctx.locale);
  sub.ci = ctx.ci;
  sub.strict = ctx.strict;
  let pos: number;
  if ((el.letter === 'e' || el.letter === 'c') && el.count >= 3) {
    const style = el.count === 3 ? TextStyle.SHORT : el.count === 4 ? TextStyle.FULL : TextStyle.NARROW;
    pos = parseText({ k: 'text', f: F.DAY_OF_WEEK, style }, ctx, position);
    return pos;
  }
  const isY = el.letter === 'Y';
  const numEl: Extract<El, { k: 'num' }> = isY
    ? el.count === 2
      ? { k: 'num', f: F.YEAR, min: 2, max: 2, sign: SignStyle.NOT_NEGATIVE, sub: 0, fixedW: false, base: 2000 }
      : { k: 'num', f: F.YEAR, min: el.count, max: 19, sign: el.count < 4 ? SignStyle.NORMAL : SignStyle.EXCEEDS_PAD, sub: 0, fixedW: false }
    : { k: 'num', f: F.YEAR, min: el.count, max: el.count === 1 ? 2 : el.count, sign: SignStyle.NOT_NEGATIVE, sub: 0, fixedW: false };
  pos = parseNum(numEl, sub, position);
  if (pos < 0) return pos;
  const v = sub.fields.get(F.YEAR)!;
  const key = el.letter === 'c' ? 'e' : el.letter;
  const old = ctx.extra.get(key);
  if (old !== undefined && old !== v) return ~position;
  ctx.extra.set(key, v);
  return pos;
}

// ---------- resolution ----------

function conflict(f: F, a: number, b: number): never {
  throw new DateTimeException(`Conflict found: Field ${f} ${a} differs from ${f} ${b} derived from ${f}`);
}

function addFieldValue(fields: Map<F, number>, f: F, v: number): void {
  const old = fields.get(f);
  if (old !== undefined && old !== v) throw new DateTimeException(`Conflict found: ${f} ${old} differs from ${f} ${v} while resolving  ${f}`);
  fields.set(f, v);
}

/** Result of DateTimeFormatter.parse: a TemporalAccessor ("Parsed" in the JDK). */
export class Parsed extends TemporalBase {
  fields = new Map<F, number>();
  zone: ZoneId | null = null;
  date: LocalDate | null = null;
  time: LocalTime | null = null;
  leapSecond = false;
  private excessDays = 0;

  $get(f: F): number | undefined {
    const v = this.fields.get(f);
    if (v !== undefined) return v;
    if (this.date) {
      const d = this.date.$get(f);
      if (d !== undefined) return d;
    }
    if (this.time) {
      const t = this.time.$get(f);
      if (t !== undefined) return t;
    }
    return undefined;
  }
  $date(): LocalDate | null {
    return this.date;
  }
  $time(): LocalTime | null {
    return this.time;
  }
  $offset(): number | null {
    const o = this.fields.get(F.OFFSET_SECONDS);
    if (o !== undefined) return o;
    if (this.zone instanceof ZoneOffset) return this.zone.totalSeconds;
    return null;
  }
  $zone(): ZoneId | null {
    if (this.zone) return this.zone;
    const o = this.fields.get(F.OFFSET_SECONDS);
    return o !== undefined ? ZoneOffset.ofTotalSeconds(o) : null;
  }
  $instant(): [number, number] | null {
    const s = this.fields.get(F.INSTANT_SECONDS);
    if (s === undefined) return null;
    return [s, this.time ? this.time.$n : (this.fields.get(F.NANO_OF_SECOND) ?? 0)];
  }

  resolve(style: ResolverStyle): void {
    const fv = this.fields;
    // instant fields first (ISO_INSTANT with a zone)
    this.resolveInstantFields();
    this.resolveDateFields(style);
    this.resolveTimeFields(style);
    if (this.date && this.time && this.excessDays !== 0) {
      this.date = this.date.plusDays(this.excessDays);
      this.excessDays = 0;
    }
    this.crossCheck();
    this.resolveInstant();
    void fv;
  }

  private resolveInstantFields(): void {
    const s = this.fields.get(F.INSTANT_SECONDS);
    if (s === undefined) return;
    const zone = this.zone ?? (this.fields.has(F.OFFSET_SECONDS) ? ZoneOffset.ofTotalSeconds(this.fields.get(F.OFFSET_SECONDS)!) : null);
    if (!zone) return;
    const zdt = Instant.ofEpochSecond(s, 0).atZone(zone);
    this.date = zdt.toLocalDate();
    const t = zdt.toLocalTime();
    this.time = null;
    this.fields.set(F.HOUR_OF_DAY, t.hour);
    this.fields.set(F.MINUTE_OF_HOUR, t.minute);
    this.fields.set(F.SECOND_OF_MINUTE, t.second);
    if (!this.fields.has(F.NANO_OF_SECOND)) this.fields.set(F.NANO_OF_SECOND, 0);
    this.fields.delete(F.INSTANT_SECONDS);
    this.$instantSecs = s;
  }
  private $instantSecs: number | null = null;

  private resolveDateFields(style: ResolverStyle): void {
    const fv = this.fields;
    const pm = fv.get(F.PROLEPTIC_MONTH);
    if (pm !== undefined) {
      fv.delete(F.PROLEPTIC_MONTH);
      addFieldValue(fv, F.MONTH_OF_YEAR, floorMod(pm, 12) + 1);
      addFieldValue(fv, F.YEAR, floorDiv(pm, 12));
    }
    const yoe = fv.get(F.YEAR_OF_ERA);
    if (yoe !== undefined) {
      fv.delete(F.YEAR_OF_ERA);
      if (style !== ResolverStyle.LENIENT) F.YEAR_OF_ERA.checkValidValue(yoe);
      const era = fv.get(F.ERA);
      fv.delete(F.ERA);
      if (era === undefined) {
        const year = fv.get(F.YEAR);
        if (style === ResolverStyle.STRICT) {
          if (year !== undefined) addFieldValue(fv, F.YEAR, year > 0 ? yoe : 1 - yoe);
          else fv.set(F.YEAR_OF_ERA, yoe);
        } else {
          addFieldValue(fv, F.YEAR, year === undefined || year > 0 ? yoe : 1 - yoe);
        }
      } else if (era === 1) {
        addFieldValue(fv, F.YEAR, yoe);
      } else if (era === 0) {
        addFieldValue(fv, F.YEAR, 1 - yoe);
      } else {
        throw new DateTimeException(`Invalid value for era: ${era}`);
      }
    } else if (fv.has(F.ERA)) {
      F.ERA.checkValidValue(fv.get(F.ERA)!);
    }
    // localized day-of-week (e/c)
    const ldow = this.$extra?.get('e');
    if (ldow !== undefined && this.$locale) {
      const { sow } = weekFieldsFor(this.$locale);
      addFieldValue(fv, F.DAY_OF_WEEK, floorMod(sow - 1 + ldow - 1, 7) + 1);
    }
    let date: LocalDate | null = null;
    if (fv.has(F.EPOCH_DAY)) {
      date = LocalDate.ofEpochDay(fv.get(F.EPOCH_DAY)!);
      fv.delete(F.EPOCH_DAY);
    } else if (fv.has(F.YEAR)) {
      const y = fv.get(F.YEAR)!;
      if (fv.has(F.MONTH_OF_YEAR) && fv.has(F.DAY_OF_MONTH)) {
        F.YEAR.checkValidValue(y);
        const moy = fv.get(F.MONTH_OF_YEAR)!;
        let dom = fv.get(F.DAY_OF_MONTH)!;
        if (style === ResolverStyle.LENIENT) {
          date = LocalDate.of(y, 1, 1).plusMonths(moy - 1).plusDays(dom - 1);
        } else {
          F.MONTH_OF_YEAR.checkValidValue(moy);
          F.DAY_OF_MONTH.checkValidValue(dom);
          if (style === ResolverStyle.SMART) dom = Math.min(dom, monthLength(y, moy));
          date = LocalDate.of(y, moy, dom);
        }
        fv.delete(F.YEAR);
        fv.delete(F.MONTH_OF_YEAR);
        fv.delete(F.DAY_OF_MONTH);
      } else if (fv.has(F.DAY_OF_YEAR)) {
        F.YEAR.checkValidValue(y);
        const doy = fv.get(F.DAY_OF_YEAR)!;
        if (style === ResolverStyle.LENIENT) date = LocalDate.ofYearDay(y, 1).plusDays(doy - 1);
        else date = LocalDate.ofYearDay(y, F.DAY_OF_YEAR.checkValidValue(doy));
        fv.delete(F.YEAR);
        fv.delete(F.DAY_OF_YEAR);
      }
    }
    if (date) {
      if (this.date && !this.date.equals(date)) throw new DateTimeException(`Conflict found: Fields resolved to two different dates: ${this.date} ${date}`);
      this.date = date;
    }
  }
  $extra: Map<string, number> | null = null;
  $locale: Locale | null = null;

  private update(target: F, v: number): void {
    const old = this.fields.get(target);
    if (old !== undefined && old !== v) throw new DateTimeException(`Conflict found: ${target} ${old} differs from ${target} ${v}`);
    this.fields.set(target, v);
  }

  private resolveTimeFields(style: ResolverStyle): void {
    const fv = this.fields;
    const take = (f: F) => {
      const v = fv.get(f);
      fv.delete(f);
      return v;
    };
    if (fv.has(F.CLOCK_HOUR_OF_DAY)) {
      const ch = take(F.CLOCK_HOUR_OF_DAY)!;
      if (style === ResolverStyle.STRICT || (style === ResolverStyle.SMART && ch !== 0)) F.CLOCK_HOUR_OF_DAY.checkValidValue(ch);
      this.update(F.HOUR_OF_DAY, ch === 24 ? 0 : ch);
    }
    if (fv.has(F.CLOCK_HOUR_OF_AMPM)) {
      const ch = take(F.CLOCK_HOUR_OF_AMPM)!;
      if (style === ResolverStyle.STRICT || (style === ResolverStyle.SMART && ch !== 0)) F.CLOCK_HOUR_OF_AMPM.checkValidValue(ch);
      this.update(F.HOUR_OF_AMPM, ch === 12 ? 0 : ch);
    }
    if (fv.has(F.AMPM_OF_DAY) && fv.has(F.HOUR_OF_AMPM)) {
      const ap = take(F.AMPM_OF_DAY)!;
      const hap = take(F.HOUR_OF_AMPM)!;
      if (style !== ResolverStyle.LENIENT) {
        F.AMPM_OF_DAY.checkValidValue(ap);
        F.HOUR_OF_AMPM.checkValidValue(hap);
      }
      this.update(F.HOUR_OF_DAY, ap * 12 + hap);
    }
    if (fv.has(F.NANO_OF_DAY)) {
      const nod = take(F.NANO_OF_DAY)!;
      if (style !== ResolverStyle.LENIENT) F.NANO_OF_DAY.checkValidValue(nod);
      const secs = Math.floor(nod / 1e9);
      this.update(F.HOUR_OF_DAY, Math.floor(secs / 3600));
      this.update(F.MINUTE_OF_HOUR, Math.floor(secs / 60) % 60);
      this.update(F.SECOND_OF_MINUTE, secs % 60);
      this.update(F.NANO_OF_SECOND, nod - secs * 1e9);
    }
    if (fv.has(F.MICRO_OF_DAY)) {
      const cod = take(F.MICRO_OF_DAY)!;
      this.update(F.SECOND_OF_DAY, Math.floor(cod / 1e6));
      this.update(F.MICRO_OF_SECOND, cod % 1e6);
    }
    if (fv.has(F.MILLI_OF_DAY)) {
      const lod = take(F.MILLI_OF_DAY)!;
      if (style !== ResolverStyle.LENIENT) F.MILLI_OF_DAY.checkValidValue(lod);
      this.update(F.SECOND_OF_DAY, Math.floor(lod / 1000));
      this.update(F.MILLI_OF_SECOND, lod % 1000);
    }
    if (fv.has(F.SECOND_OF_DAY)) {
      const sod = take(F.SECOND_OF_DAY)!;
      this.update(F.HOUR_OF_DAY, Math.floor(sod / 3600));
      this.update(F.MINUTE_OF_HOUR, Math.floor(sod / 60) % 60);
      this.update(F.SECOND_OF_MINUTE, sod % 60);
    }
    if (fv.has(F.MINUTE_OF_DAY)) {
      const mod = take(F.MINUTE_OF_DAY)!;
      this.update(F.HOUR_OF_DAY, Math.floor(mod / 60));
      this.update(F.MINUTE_OF_HOUR, mod % 60);
    }
    if (fv.has(F.MILLI_OF_SECOND)) {
      const los = take(F.MILLI_OF_SECOND)!;
      if (fv.has(F.MICRO_OF_SECOND)) {
        const cos = take(F.MICRO_OF_SECOND)!;
        this.update(F.MICRO_OF_SECOND, los * 1000 + (cos % 1000));
      } else {
        this.update(F.NANO_OF_SECOND, los * 1_000_000 + ((fv.get(F.NANO_OF_SECOND) ?? los * 1_000_000) % 1_000_000));
      }
    }
    if (fv.has(F.MICRO_OF_SECOND)) {
      const cos = take(F.MICRO_OF_SECOND)!;
      this.update(F.NANO_OF_SECOND, cos * 1000 + ((fv.get(F.NANO_OF_SECOND) ?? cos * 1000) % 1000));
    }
    const hod = fv.get(F.HOUR_OF_DAY);
    if (hod !== undefined) {
      const moh = fv.get(F.MINUTE_OF_HOUR);
      const som = fv.get(F.SECOND_OF_MINUTE);
      const nos = fv.get(F.NANO_OF_SECOND);
      if ((moh === undefined && (som !== undefined || nos !== undefined)) || (moh !== undefined && som === undefined && nos !== undefined)) return;
      const mohVal = moh ?? 0;
      const somVal = som ?? 0;
      const nosVal = nos ?? 0;
      this.resolveTime(hod, mohVal, somVal, nosVal, style);
      fv.delete(F.HOUR_OF_DAY);
      fv.delete(F.MINUTE_OF_HOUR);
      fv.delete(F.SECOND_OF_MINUTE);
      fv.delete(F.NANO_OF_SECOND);
    }
  }

  private resolveTime(hod: number, moh: number, som: number, nos: number, style: ResolverStyle): void {
    let time: LocalTime;
    let excess = 0;
    if (style === ResolverStyle.LENIENT) {
      const total = ((hod * 60 + moh) * 60 + som) * 1e9 + nos;
      excess = floorDiv(total, 86400e9);
      time = LocalTime.ofNanoOfDay(floorMod(total, 86400e9));
    } else {
      F.MINUTE_OF_HOUR.checkValidValue(moh);
      F.NANO_OF_SECOND.checkValidValue(nos);
      if (style === ResolverStyle.SMART && hod === 24 && moh === 0 && som === 0 && nos === 0) {
        time = LocalTime.MIDNIGHT;
        excess = 1;
      } else {
        F.HOUR_OF_DAY.checkValidValue(hod);
        F.SECOND_OF_MINUTE.checkValidValue(som);
        time = LocalTime.of(hod, moh, som, nos);
      }
    }
    if (this.time && !this.time.equals(time)) throw new DateTimeException(`Conflict found: Fields resolved to different times: ${this.time} ${time}`);
    this.time = time;
    this.excessDays += excess;
  }

  private crossCheck(): void {
    for (const [f, v] of [...this.fields]) {
      let derived: number | undefined;
      let target: any = null;
      if (this.date) {
        derived = this.date.$get(f);
        target = this.date;
      }
      if (derived === undefined && this.time) {
        derived = this.time.$get(f);
        target = this.time;
      }
      if (derived === undefined) continue;
      if (derived !== v) throw new DateTimeException(`Conflict found: Field ${f} ${derived} differs from ${f} ${v} derived from ${target}`);
      this.fields.delete(f);
    }
  }

  private resolveInstant(): void {
    if (this.$instantSecs !== null) {
      this.fields.set(F.INSTANT_SECONDS, this.$instantSecs);
      return;
    }
    if (this.date && this.time) {
      const off = this.fields.get(F.OFFSET_SECONDS);
      if (off !== undefined) {
        this.fields.set(F.INSTANT_SECONDS, new LocalDateTime(this.date, this.time).toEpochSecond(ZoneOffset.ofTotalSeconds(off)));
      } else if (this.zone) {
        this.fields.set(F.INSTANT_SECONDS, ZonedDateTime.of(new LocalDateTime(this.date, this.time), this.zone).toEpochSecond());
      }
    }
  }

  toString(): string {
    const fieldStr = [...this.fields]
      .filter(([f]) => f !== F.INSTANT_SECONDS || (!this.date && !this.time))
      .map(([f, v]) => `${f}=${v}`)
      .join(', ');
    let s = `{${fieldStr}},ISO`;
    if (this.zone) s += ',' + this.zone.toString();
    if (this.date || this.time) {
      s += ' resolved to ';
      if (this.date) {
        s += this.date.toString();
        if (this.time) s += 'T' + this.time.toString();
      } else {
        s += this.time!.toString();
      }
    }
    return s;
  }
}
void conflict;

// ---------- formatting ----------

class FmtCtx {
  optional = 0;
  constructor(
    readonly t: any,
    readonly locale: Locale,
  ) {}
  value(f: F): number | null {
    const v = this.t.$get ? this.t.$get(f) : undefined;
    if (v === undefined) {
      if (this.optional > 0) return null;
      throw new UnsupportedTemporalTypeException(`Unsupported field: ${f}`);
    }
    return v;
  }
  zone(regionOnly: boolean): ZoneId | null {
    const z: ZoneId | null = this.t.$zone ? this.t.$zone() : null;
    if (regionOnly && z instanceof ZoneOffset) return null;
    if (!z) {
      if (this.optional > 0) return null;
      throw new DateTimeException(`Unable to extract ZoneId from temporal ${this.t}`);
    }
    return z;
  }
}

function formatList(els: El[], ctx: FmtCtx, out: string[]): boolean {
  for (const el of els) if (!formatEl(el, ctx, out)) return false;
  return true;
}

function formatNumber(el: Extract<El, { k: 'num' }>, value: number, out: string[]): void {
  let v = value;
  if (el.base !== undefined) {
    const abs = Math.abs(v);
    v = v >= el.base && v < el.base + POW10[el.min] ? abs % POW10[el.min] : abs % POW10[el.max];
  }
  const str = String(Math.abs(v));
  if (str.length > el.max) {
    throw new DateTimeException(`Field ${el.f} cannot be printed as the value ${v} exceeds the maximum print width of ${el.max}`);
  }
  if (v >= 0) {
    if (el.sign === SignStyle.EXCEEDS_PAD) {
      if (el.min < 19 && v >= POW10[el.min]) out.push('+');
    } else if (el.sign === SignStyle.ALWAYS) {
      out.push('+');
    }
  } else if (el.sign === SignStyle.NOT_NEGATIVE) {
    throw new DateTimeException(`Field ${el.f} cannot be printed as the value ${v} cannot be negative according to the SignStyle`);
  } else if (el.sign !== SignStyle.NEVER) {
    out.push('-');
  }
  out.push('0'.repeat(Math.max(0, el.min - str.length)) + str);
}

function formatOffset(pat: number, noOff: string, totalSecs: number, out: string[]): void {
  if (totalSecs === 0) {
    out.push(noOff);
    return;
  }
  const absHours = Math.floor(Math.abs(totalSecs) / 3600);
  const absMinutes = Math.floor(Math.abs(totalSecs) / 60) % 60;
  const absSeconds = Math.abs(totalSecs) % 60;
  const type = pat % 11;
  const colon = OFFSET_PATTERNS[pat].includes(':');
  const padded = pat < 11;
  let buf = totalSecs < 0 ? '-' : '+';
  let output = absHours;
  buf += padded || absHours >= 10 ? pad(absHours, 2) : String(absHours);
  if ((type >= 3 && type <= 8) || (type >= 9 && absSeconds > 0) || (type >= 1 && absMinutes > 0)) {
    buf += (colon ? ':' : '') + pad(absMinutes, 2);
    output += absMinutes;
    if (type === 7 || type === 8 || (type >= 5 && absSeconds > 0)) {
      buf += (colon ? ':' : '') + pad(absSeconds, 2);
      output += absSeconds;
    }
  }
  out.push(output === 0 ? noOff : buf);
}

function formatEl(el: El, ctx: FmtCtx, out: string[]): boolean {
  switch (el.k) {
    case 'lit':
      out.push(el.s);
      return true;
    case 'set':
    case 'default':
      return true;
    case 'group': {
      if (!el.optional) return formatList(el.els, ctx, out);
      ctx.optional++;
      const sub: string[] = [];
      const ok = formatList(el.els, ctx, sub);
      ctx.optional--;
      if (ok) out.push(...sub);
      return true;
    }
    case 'num': {
      const v = ctx.value(el.f);
      if (v === null) return false;
      formatNumber(el, v, out);
      return true;
    }
    case 'frac': {
      const v = ctx.value(el.f);
      if (v === null) return false;
      const max = el.f.$range.maximum + 1;
      const digitsTotal = Math.round(Math.log10(max));
      let frac = pad(v, digitsTotal).replace(/0+$/, '');
      if (frac.length === 0) {
        if (el.min > 0) {
          if (el.dp) out.push('.');
          out.push('0'.repeat(el.min));
        }
        return true;
      }
      const scale = Math.min(Math.max(frac.length, el.min), el.max);
      frac = (frac + '0'.repeat(9)).slice(0, scale);
      if (el.dp) out.push('.');
      out.push(frac);
      return true;
    }
    case 'text': {
      const v = ctx.value(el.f);
      if (v === null) return false;
      let name: string | undefined;
      if (el.map) name = el.map.get(v);
      else {
        const names = textNames(el.f, el.style, ctx.locale);
        if (names) name = names[v - textBase(el.f)];
      }
      if (name === undefined) formatNumber({ k: 'num', f: el.f, min: 1, max: 19, sign: SignStyle.NORMAL, sub: 0, fixedW: false }, v, out);
      else out.push(name);
      return true;
    }
    case 'offset': {
      const v = ctx.value(F.OFFSET_SECONDS);
      if (v === null) return false;
      formatOffset(el.pat, el.noOff, v, out);
      return true;
    }
    case 'locOffset': {
      const v = ctx.value(F.OFFSET_SECONDS);
      if (v === null) return false;
      let s = 'GMT';
      if (v !== 0) {
        const h = Math.floor(Math.abs(v) / 3600);
        const m = Math.floor(Math.abs(v) / 60) % 60;
        const sec = Math.abs(v) % 60;
        s += v < 0 ? '-' : '+';
        if (el.full) {
          s += pad(h, 2) + ':' + pad(m, 2);
          if (sec) s += ':' + pad(sec, 2);
        } else {
          s += String(h);
          if (m || sec) {
            s += ':' + pad(m, 2);
            if (sec) s += ':' + pad(sec, 2);
          }
        }
      }
      out.push(s);
      return true;
    }
    case 'zoneId': {
      const z = ctx.zone(el.regionOnly);
      if (!z) return false;
      out.push(z.id);
      return true;
    }
    case 'zoneText': {
      const z = ctx.zone(false);
      if (!z) return false;
      if (z instanceof ZoneOffset) {
        out.push(z.id);
        return true;
      }
      const iana = (z as ZoneRegion).$iana;
      if (!iana) {
        out.push(z.id);
        return true;
      }
      const inst = ctx.t.$instant ? ctx.t.$instant() : null;
      const ms = inst ? inst[0] * 1000 : Date.now();
      out.push(el.full ? longZoneName(iana, ms, ctx.locale.$intlTag) : shortZoneName(iana, ms, ctx.locale.$intlTag));
      return true;
    }
    case 'instant': {
      const secs = ctx.value(F.INSTANT_SECONDS);
      if (secs === null) return false;
      const nano = ctx.t.$get(F.NANO_OF_SECOND) ?? 0;
      const ldt = LocalDateTime.ofEpochSecond(secs, 0, ZoneOffset.UTC);
      let s = isoYear(ldt.year) + '-' + pad(ldt.monthValue, 2) + '-' + pad(ldt.dayOfMonth, 2) + 'T' + pad(ldt.hour, 2) + ':' + pad(ldt.minute, 2) + ':' + pad(ldt.second, 2);
      const d = el.digits;
      if ((d < 0 && nano > 0) || d > 0) {
        s += '.';
        if (d === -2) {
          if (nano % 1e6 === 0) s += pad(nano / 1e6, 3);
          else if (nano % 1000 === 0) s += pad(nano / 1000, 6);
          else s += pad(nano, 9);
        } else if (d === -1) {
          s += pad(nano, 9).replace(/0+$/, '');
        } else {
          s += pad(nano, 9).slice(0, d);
        }
      }
      out.push(s + 'Z');
      return true;
    }
    case 'week': {
      const ed = ctx.value(F.EPOCH_DAY);
      if (ed === null) return false;
      const { sow, minDays } = weekFieldsFor(ctx.locale);
      switch (el.letter) {
        case 'e':
        case 'c':
          if (el.count >= 3) {
            const style = el.count === 3 ? TextStyle.SHORT : el.count === 4 ? TextStyle.FULL : TextStyle.NARROW;
            out.push(textNames(F.DAY_OF_WEEK, style, ctx.locale)![floorMod(ed + 3, 7)]);
          } else {
            out.push(pad(localizedDow(ed, sow), el.count));
          }
          return true;
        case 'w':
          out.push(pad(weekOfWeekBasedYear(ed, sow, minDays), el.count));
          return true;
        case 'W':
          out.push(String(weekOfMonth(ed, sow, minDays)));
          return true;
        case 'Y': {
          const y = weekBasedYear(ed, sow, minDays);
          if (el.count === 2) out.push(pad(Math.abs(y) % 100, 2));
          else formatNumber({ k: 'num', f: F.YEAR, min: el.count, max: 19, sign: el.count < 4 ? SignStyle.NORMAL : SignStyle.EXCEEDS_PAD, sub: 0, fixedW: false }, y, out);
          return true;
        }
      }
      return true;
    }
  }
}

// ---------- DateTimeFormatter ----------

export class DateTimeFormatter {
  constructor(
    readonly $els: El[],
    readonly locale: Locale,
    readonly resolverStyle: ResolverStyle,
    readonly zone: ZoneId | null,
    readonly $desc: string,
  ) {}

  getLocale(): Locale {
    return this.locale;
  }
  getZone(): ZoneId | null {
    return this.zone;
  }
  getResolverStyle(): ResolverStyle {
    return this.resolverStyle;
  }
  withZone(zone: ZoneId | null): DateTimeFormatter {
    if (zone === this.zone || (zone && this.zone && zone.equals(this.zone))) return this;
    return new DateTimeFormatter(this.$els, this.locale, this.resolverStyle, zone, this.$desc);
  }
  withLocale(locale: Locale): DateTimeFormatter {
    if (locale.equals(this.locale)) return this;
    return new DateTimeFormatter(this.$els, locale, this.resolverStyle, this.zone, this.$desc);
  }
  localizedBy(locale: Locale): DateTimeFormatter {
    return this.withLocale(locale);
  }
  withResolverStyle(style: ResolverStyle): DateTimeFormatter {
    return new DateTimeFormatter(this.$els, this.locale, style, this.zone, this.$desc);
  }
  withChronology(_c: unknown): DateTimeFormatter {
    return this;
  }
  withDecimalStyle(_d: unknown): DateTimeFormatter {
    return this;
  }

  format(temporal: any): string {
    if (temporal === null || temporal === undefined) throw new NullPointerException('temporal');
    const t = this.adjust(temporal);
    const out: string[] = [];
    formatList(this.$els, new FmtCtx(t, this.locale), out);
    return out.join('');
  }
  formatTo(temporal: any, appendable: any): void {
    const s = this.format(temporal);
    if (typeof appendable.append === 'function') appendable.append(s);
  }

  private adjust(t: any): any {
    const zone = this.zone;
    if (!zone) return t;
    const tz: ZoneId | null = t.$zone ? t.$zone() : null;
    if (tz && tz.equals(zone)) return t;
    const inst = t.$instant ? t.$instant() : null;
    if (inst) return Instant.ofEpochSecond(inst[0], inst[1]).atZone(zone);
    const w = Object.create(t);
    w.$zone = () => zone;
    return w;
  }

  /** Parses to a resolved TemporalAccessor, or applies `query` (e.g. `LocalDate::from`). */
  parse(text: string, query?: any): any {
    if (text === null || text === undefined) throw new NullPointerException('text');
    text = String(text);
    const parsed = this.$parseResolved(text);
    if (query === undefined || query === null) return parsed;
    try {
      if (typeof query === 'function') return query(parsed);
      if (typeof query.queryFrom === 'function') return query.queryFrom(parsed);
      return query(parsed);
    } catch (e) {
      if (e instanceof DateTimeParseException) throw e;
      if (e instanceof DateTimeException) throw this.$error(text, `Text '${abbrev(text)}' could not be parsed: ${e.message}`, e);
      throw e;
    }
  }
  parseBest(text: string, ...queries: any[]): any {
    const parsed = this.$parseResolved(String(text));
    let last: unknown = null;
    for (const q of queries) {
      try {
        return typeof q === 'function' ? q(parsed) : q.queryFrom(parsed);
      } catch (e) {
        last = e;
      }
    }
    throw this.$error(text, `Text '${abbrev(text)}' could not be parsed: Unable to convert parsed text using any of the specified queries`, last);
  }
  parseUnresolved(text: string, position: any): any {
    const ctx = new ParseCtx(String(text), this.locale);
    const pos = parseList(this.$els, ctx, position.index);
    if (pos < 0) {
      position.errorIndex = ~pos;
      return null;
    }
    position.index = pos;
    const p = new Parsed();
    p.fields = ctx.fields;
    p.zone = ctx.zone;
    return p;
  }

  $error(_text: string, msg: string, cause?: unknown): DateTimeParseException {
    return new DateTimeParseException(msg, cause);
  }

  $parseResolved(text: string): Parsed {
    const ctx = new ParseCtx(text, this.locale);
    const pos = parseList(this.$els, ctx, 0);
    if (pos < 0) throw this.$error(text, `Text '${abbrev(text)}' could not be parsed at index ${~pos}`);
    if (pos < text.length) throw this.$error(text, `Text '${abbrev(text)}' could not be parsed, unparsed text found at index ${pos}`);
    const p = new Parsed();
    p.fields = ctx.fields;
    p.zone = ctx.zone ?? this.zone;
    p.leapSecond = ctx.leapSecond;
    p.$extra = ctx.extra;
    p.$locale = this.locale;
    try {
      p.resolve(this.resolverStyle);
    } catch (e) {
      if (e instanceof DateTimeException) throw this.$error(text, `Text '${abbrev(text)}' could not be parsed: ${e.message}`, e);
      throw e;
    }
    return p;
  }

  toFormat(): unknown {
    throw new UnsupportedTemporalTypeException('toFormat is not supported');
  }

  toString(): string {
    return this.$desc;
  }

  // ----- factories -----

  static ofPattern(pattern: string, locale?: Locale): DateTimeFormatter {
    const f = new DateTimeFormatterBuilder().appendPattern(pattern).toFormatter(locale ?? Locale.getDefault());
    return f;
  }
  static ofLocalizedDate(style: FormatStyle): DateTimeFormatter {
    return DateTimeFormatter.ofPattern(LOCALIZED_DATE[style.name]);
  }
  static ofLocalizedTime(style: FormatStyle): DateTimeFormatter {
    return DateTimeFormatter.ofPattern(LOCALIZED_TIME[style.name]);
  }
  static ofLocalizedDateTime(dateStyle: FormatStyle, timeStyle?: FormatStyle): DateTimeFormatter {
    return DateTimeFormatter.ofPattern(`${LOCALIZED_DATE[dateStyle.name]}, ${LOCALIZED_TIME[(timeStyle ?? dateStyle).name]}`);
  }

  static ISO_LOCAL_DATE: DateTimeFormatter;
  static ISO_OFFSET_DATE: DateTimeFormatter;
  static ISO_DATE: DateTimeFormatter;
  static ISO_LOCAL_TIME: DateTimeFormatter;
  static ISO_OFFSET_TIME: DateTimeFormatter;
  static ISO_TIME: DateTimeFormatter;
  static ISO_LOCAL_DATE_TIME: DateTimeFormatter;
  static ISO_OFFSET_DATE_TIME: DateTimeFormatter;
  static ISO_ZONED_DATE_TIME: DateTimeFormatter;
  static ISO_DATE_TIME: DateTimeFormatter;
  static ISO_ORDINAL_DATE: DateTimeFormatter;
  static ISO_INSTANT: DateTimeFormatter;
  static BASIC_ISO_DATE: DateTimeFormatter;
  static RFC_1123_DATE_TIME: DateTimeFormatter;
}

/** en-US CLDR patterns for ofLocalized* (other locales use the same shapes). */
const LOCALIZED_DATE: Record<string, string> = { SHORT: 'M/d/yy', MEDIUM: 'MMM d, y', LONG: 'MMMM d, y', FULL: 'EEEE, MMMM d, y' };
const LOCALIZED_TIME: Record<string, string> = { SHORT: 'h:mm a', MEDIUM: 'h:mm:ss a', LONG: 'h:mm:ss a z', FULL: 'h:mm:ss a zzzz' };

function abbrev(text: string): string {
  return text.length > 64 ? text.substring(0, 64) + '...' : text;
}

function iso(build: (b: DateTimeFormatterBuilder) => DateTimeFormatterBuilder, style: ResolverStyle = ResolverStyle.STRICT): DateTimeFormatter {
  return build(new DateTimeFormatterBuilder()).toFormatter(Locale.ROOT, style);
}

DateTimeFormatter.ISO_LOCAL_DATE = iso((b) =>
  b.appendValue(F.YEAR, 4, 10, SignStyle.EXCEEDS_PAD).appendLiteral('-').appendValue(F.MONTH_OF_YEAR, 2).appendLiteral('-').appendValue(F.DAY_OF_MONTH, 2),
);
DateTimeFormatter.ISO_OFFSET_DATE = iso((b) => b.parseCaseInsensitive().append(DateTimeFormatter.ISO_LOCAL_DATE).appendOffsetId());
DateTimeFormatter.ISO_DATE = iso((b) => b.parseCaseInsensitive().append(DateTimeFormatter.ISO_LOCAL_DATE).optionalStart().appendOffsetId());
DateTimeFormatter.ISO_LOCAL_TIME = iso((b) =>
  b
    .appendValue(F.HOUR_OF_DAY, 2)
    .appendLiteral(':')
    .appendValue(F.MINUTE_OF_HOUR, 2)
    .optionalStart()
    .appendLiteral(':')
    .appendValue(F.SECOND_OF_MINUTE, 2)
    .optionalStart()
    .appendFraction(F.NANO_OF_SECOND, 0, 9, true),
);
DateTimeFormatter.ISO_OFFSET_TIME = iso((b) => b.parseCaseInsensitive().append(DateTimeFormatter.ISO_LOCAL_TIME).appendOffsetId());
DateTimeFormatter.ISO_TIME = iso((b) => b.parseCaseInsensitive().append(DateTimeFormatter.ISO_LOCAL_TIME).optionalStart().appendOffsetId());
DateTimeFormatter.ISO_LOCAL_DATE_TIME = iso((b) =>
  b.parseCaseInsensitive().append(DateTimeFormatter.ISO_LOCAL_DATE).appendLiteral('T').append(DateTimeFormatter.ISO_LOCAL_TIME),
);
DateTimeFormatter.ISO_OFFSET_DATE_TIME = iso((b) =>
  b.parseCaseInsensitive().append(DateTimeFormatter.ISO_LOCAL_DATE_TIME).parseLenient().appendOffsetId().parseStrict(),
);
DateTimeFormatter.ISO_ZONED_DATE_TIME = iso((b) =>
  b.append(DateTimeFormatter.ISO_OFFSET_DATE_TIME).optionalStart().appendLiteral('[').parseCaseSensitive().appendZoneRegionId().appendLiteral(']'),
);
DateTimeFormatter.ISO_DATE_TIME = iso((b) =>
  b
    .append(DateTimeFormatter.ISO_LOCAL_DATE_TIME)
    .optionalStart()
    .appendOffsetId()
    .optionalStart()
    .appendLiteral('[')
    .parseCaseSensitive()
    .appendZoneRegionId()
    .appendLiteral(']'),
);
DateTimeFormatter.ISO_ORDINAL_DATE = iso((b) =>
  b.parseCaseInsensitive().appendValue(F.YEAR, 4, 10, SignStyle.EXCEEDS_PAD).appendLiteral('-').appendValue(F.DAY_OF_YEAR, 3).optionalStart().appendOffsetId(),
);
DateTimeFormatter.ISO_INSTANT = iso((b) => b.parseCaseInsensitive().appendInstant());
DateTimeFormatter.BASIC_ISO_DATE = iso((b) =>
  b
    .parseCaseInsensitive()
    .appendValue(F.YEAR, 4)
    .appendValue(F.MONTH_OF_YEAR, 2)
    .appendValue(F.DAY_OF_MONTH, 2)
    .optionalStart()
    .parseLenient()
    .appendOffset('+HHMMss', 'Z')
    .parseStrict(),
);
DateTimeFormatter.RFC_1123_DATE_TIME = (() => {
  const dow = new Map<number, string>([
    [1, 'Mon'],
    [2, 'Tue'],
    [3, 'Wed'],
    [4, 'Thu'],
    [5, 'Fri'],
    [6, 'Sat'],
    [7, 'Sun'],
  ]);
  const moy = new Map<number, string>(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => [i + 1, m]));
  return iso(
    (b) =>
      b
        .parseCaseInsensitive()
        .parseLenient()
        .optionalStart()
        .appendText(F.DAY_OF_WEEK, dow)
        .appendLiteral(', ')
        .optionalEnd()
        .appendValue(F.DAY_OF_MONTH, 1, 2, SignStyle.NOT_NEGATIVE)
        .appendLiteral(' ')
        .appendText(F.MONTH_OF_YEAR, moy)
        .appendLiteral(' ')
        .appendValue(F.YEAR, 4)
        .appendLiteral(' ')
        .appendValue(F.HOUR_OF_DAY, 2)
        .appendLiteral(':')
        .appendValue(F.MINUTE_OF_HOUR, 2)
        .optionalStart()
        .appendLiteral(':')
        .appendValue(F.SECOND_OF_MINUTE, 2)
        .optionalEnd()
        .appendLiteral(' ')
        .appendOffset('+HHMM', 'GMT'),
    ResolverStyle.SMART,
  );
})();

export { epochDayOf };

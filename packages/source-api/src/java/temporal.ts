// java.time value types: ZoneId/ZoneOffset, Instant, LocalDate, LocalTime, LocalDateTime,
// ZonedDateTime, OffsetDateTime, Duration, Year, WeekFields.

import { ArithmeticException, DateTimeException, NullPointerException, stringHash } from '../kotlin/core';
import { ChronoField, ChronoUnit, DayOfWeek, Month, TextStyle, UnsupportedTemporalTypeException } from './fields';
import { TemporalBase } from './base';
import { DateTimeFormatter } from './formatter';
import { Locale } from './locale';
import {
  civil,
  dayOfYear,
  epochDayOf,
  floorDiv,
  floorMod,
  isLeap,
  isoDow,
  isoFromCalendarDow,
  localizedDow,
  MS_PER_DAY,
  monthLength,
  NANOS_PER_DAY,
  pad,
  weekBasedYear,
  weekOfMonth,
  weekOfWeekBasedYear,
  weekOfYearPlain,
  weekRulesFor,
} from './util';
import {
  canonicalZone,
  longZoneName,
  offsetId,
  parseOffsetId,
  resolveOffset,
  shortZoneName,
  systemZoneId,
  ZoneRulesException,
  zoneOffsetSeconds,
} from './zone';

const HAS_INTL = typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function';

function unsupportedField(f: any): never {
  throw new UnsupportedTemporalTypeException(`Unsupported field: ${f}`);
}
function unsupportedUnit(u: any): never {
  throw new UnsupportedTemporalTypeException(`Unsupported unit: ${u}`);
}

/** Defines a Kotlin boolean property for a Java `isX()` getter: `x.isX` and `x.isX()` both work. */
function boolProp(C: any, name: string, get: (self: any) => boolean): void {
  Object.defineProperty(C.prototype, name, {
    get() {
      return get(this);
    },
    configurable: true,
  });
  C.prototype[name + '$call'] = function () {
    return get(this);
  };
}

/** Year formatting used by ISO toString(): 4 digits, sign/extra digits outside 0000..9999. */
export function isoYear(y: number): string {
  const abs = Math.abs(y);
  if (abs < 1000) return (y < 0 ? '-' : '') + pad(abs, 4);
  return (y > 9999 ? '+' : '') + String(y);
}

function dateField(y: number, m: number, d: number, f: ChronoField): number | undefined {
  switch (f) {
    case ChronoField.YEAR:
      return y;
    case ChronoField.YEAR_OF_ERA:
      return y >= 1 ? y : 1 - y;
    case ChronoField.ERA:
      return y >= 1 ? 1 : 0;
    case ChronoField.MONTH_OF_YEAR:
      return m;
    case ChronoField.PROLEPTIC_MONTH:
      return y * 12 + m - 1;
    case ChronoField.DAY_OF_MONTH:
      return d;
    case ChronoField.DAY_OF_YEAR:
      return dayOfYear(y, m, d);
    case ChronoField.DAY_OF_WEEK:
      return isoDow(epochDayOf(y, m, d));
    case ChronoField.EPOCH_DAY:
      return epochDayOf(y, m, d);
    case ChronoField.ALIGNED_WEEK_OF_MONTH:
      return Math.floor((d - 1) / 7) + 1;
    case ChronoField.ALIGNED_WEEK_OF_YEAR:
      return Math.floor((dayOfYear(y, m, d) - 1) / 7) + 1;
    case ChronoField.ALIGNED_DAY_OF_WEEK_IN_MONTH:
      return ((d - 1) % 7) + 1;
    case ChronoField.ALIGNED_DAY_OF_WEEK_IN_YEAR:
      return ((dayOfYear(y, m, d) - 1) % 7) + 1;
    default:
      return undefined;
  }
}

function timeField(h: number, mi: number, s: number, n: number, f: ChronoField): number | undefined {
  switch (f) {
    case ChronoField.NANO_OF_SECOND:
      return n;
    case ChronoField.NANO_OF_DAY:
      return (h * 3600 + mi * 60 + s) * 1e9 + n;
    case ChronoField.MICRO_OF_SECOND:
      return Math.floor(n / 1000);
    case ChronoField.MICRO_OF_DAY:
      return (h * 3600 + mi * 60 + s) * 1e6 + Math.floor(n / 1000);
    case ChronoField.MILLI_OF_SECOND:
      return Math.floor(n / 1e6);
    case ChronoField.MILLI_OF_DAY:
      return (h * 3600 + mi * 60 + s) * 1000 + Math.floor(n / 1e6);
    case ChronoField.SECOND_OF_MINUTE:
      return s;
    case ChronoField.SECOND_OF_DAY:
      return h * 3600 + mi * 60 + s;
    case ChronoField.MINUTE_OF_HOUR:
      return mi;
    case ChronoField.MINUTE_OF_DAY:
      return h * 60 + mi;
    case ChronoField.HOUR_OF_DAY:
      return h;
    case ChronoField.CLOCK_HOUR_OF_DAY:
      return h === 0 ? 24 : h;
    case ChronoField.HOUR_OF_AMPM:
      return h % 12;
    case ChronoField.CLOCK_HOUR_OF_AMPM:
      return h % 12 === 0 ? 12 : h % 12;
    case ChronoField.AMPM_OF_DAY:
      return h >= 12 ? 1 : 0;
    default:
      return undefined;
  }
}

/** Splits a (seconds, nanos) difference into a whole amount of a time-based unit. */
function timeAmount(secs: number, nanos: number, unit: ChronoUnit): number {
  secs += floorDiv(nanos, 1e9);
  nanos = floorMod(nanos, 1e9);
  if (secs < 0 && nanos > 0) {
    secs += 1;
    nanos -= 1e9;
  }
  switch (unit) {
    case ChronoUnit.NANOS:
      return secs * 1e9 + nanos;
    case ChronoUnit.MICROS:
      return secs * 1e6 + Math.trunc(nanos / 1000);
    case ChronoUnit.MILLIS:
      return secs * 1000 + Math.trunc(nanos / 1e6);
    default:
      return Math.trunc(secs / unit.seconds);
  }
}

function zoneArg(z: any): ZoneId {
  if (z instanceof ZoneId) return z;
  if (z && typeof z.toZoneId === 'function') return z.toZoneId();
  if (typeof z === 'string') return ZoneId.of(z);
  return ZoneId.systemDefault();
}

function nowMs(): number {
  return Date.now();
}

// ---------- zones ----------

export class ZoneRules {
  constructor(private readonly zone: ZoneId) {}
  getOffset(x: any): ZoneOffset {
    if (x instanceof Instant) return ZoneOffset.ofTotalSeconds(this.zone.$offsetAt(x.toEpochMilli()));
    if (x instanceof LocalDateTime) return ZoneOffset.ofTotalSeconds(this.zone.$resolveOffset(x.$localMs()));
    throw new DateTimeException('Unsupported argument');
  }
  isFixedOffset(): boolean {
    return this.zone instanceof ZoneOffset || (this.zone as ZoneRegion).$iana === null;
  }
  getStandardOffset(instant: Instant): ZoneOffset {
    const y = new Date(instant.toEpochMilli()).getUTCFullYear();
    const jan = this.zone.$offsetAt(Date.UTC(y, 0, 1));
    const jul = this.zone.$offsetAt(Date.UTC(y, 6, 1));
    return ZoneOffset.ofTotalSeconds(Math.min(jan, jul));
  }
  isDaylightSavings(instant: Instant): boolean {
    return this.getOffset(instant).totalSeconds !== this.getStandardOffset(instant).totalSeconds;
  }
  toString(): string {
    return `ZoneRules[${this.zone.id}]`;
  }
}

export abstract class ZoneId {
  abstract readonly id: string;
  /** Offset in seconds at an instant (epoch millis). */
  abstract $offsetAt(epochMs: number): number;
  /** Valid offset (seconds) for a local date-time expressed as "local epoch millis". */
  abstract $resolveOffset(localMs: number, preferred?: number | null): number;

  getId(): string {
    return this.id;
  }
  get rules(): ZoneRules {
    return new ZoneRules(this);
  }
  getRules(): ZoneRules {
    return this.rules;
  }
  normalized(): ZoneId {
    return this;
  }
  getDisplayName(style: TextStyle, locale: Locale): string {
    if (this instanceof ZoneOffset) return this.id;
    const iana = (this as any).$iana as string | null;
    if (!iana) return this.id;
    const full = style === TextStyle.FULL || style === TextStyle.FULL_STANDALONE;
    return full ? longZoneName(iana, Date.now(), locale.$intlTag) : shortZoneName(iana, Date.now(), locale.$intlTag);
  }
  equals(o: any): boolean {
    return o instanceof ZoneId && o.id === this.id;
  }
  hashCode(): number {
    return stringHash(this.id);
  }
  toString(): string {
    return this.id;
  }

  static of(id: string, aliasMap?: Map<string, string>): ZoneId {
    if (id === null || id === undefined) throw new NullPointerException('zoneId');
    if (aliasMap && aliasMap.has(id)) id = aliasMap.get(id)!;
    if (id.length <= 1 || id.startsWith('+') || id.startsWith('-')) return ZoneOffset.of(id);
    if (id === 'UTC' || id === 'GMT' || id === 'UT') return new ZoneRegion(id, null, 0);
    const pm = /^(UTC|GMT|UT)([+-].*)$/.exec(id);
    if (pm) {
      const off = ZoneOffset.of(pm[2]);
      if (off.totalSeconds === 0) return new ZoneRegion(pm[1], null, 0);
      return new ZoneRegion(pm[1] + off.id, null, off.totalSeconds);
    }
    if (!/^[A-Za-z][A-Za-z0-9~/._+-]+$/.test(id)) {
      throw new DateTimeException(`Invalid ID for region-based ZoneId, invalid format: ${id}`);
    }
    const canon = canonicalZone(id);
    if (canon === null) {
      if (!HAS_INTL) return new ZoneRegion(id, null, 0); // no tz data: behave like UTC
      throw new ZoneRulesException(`Unknown time-zone ID: ${id}`);
    }
    if (canon !== id && canon.toLowerCase() === id.toLowerCase()) throw new ZoneRulesException(`Unknown time-zone ID: ${id}`);
    if (canon === 'UTC' || canon === 'GMT' || canon === 'UT') return new ZoneRegion(id, null, 0);
    return new ZoneRegion(id, id, null);
  }

  static ofOffset(prefix: string, offset: ZoneOffset): ZoneId {
    if (!prefix) return offset;
    if (offset.totalSeconds === 0) return new ZoneRegion(prefix, null, 0);
    return new ZoneRegion(prefix + offset.id, null, offset.totalSeconds);
  }

  static systemDefault(): ZoneId {
    return ZoneId.of(systemZoneId());
  }

  static from(t: any): ZoneId {
    if (t instanceof ZoneId) return t;
    const z = t?.$zone?.();
    if (!z) throw new DateTimeException(`Unable to obtain ZoneId from TemporalAccessor: ${t}`);
    return z;
  }

  static getAvailableZoneIds(): Set<string> {
    const sv = HAS_INTL ? (Intl as any).supportedValuesOf : undefined;
    if (typeof sv === 'function') {
      try {
        return new Set<string>(['UTC', ...sv('timeZone')]);
      } catch {
        /* ignore */
      }
    }
    return new Set(['UTC']);
  }

  static SHORT_IDS = new Map<string, string>([
    ['ACT', 'Australia/Darwin'],
    ['AET', 'Australia/Sydney'],
    ['AGT', 'America/Argentina/Buenos_Aires'],
    ['ART', 'Africa/Cairo'],
    ['AST', 'America/Anchorage'],
    ['BET', 'America/Sao_Paulo'],
    ['BST', 'Asia/Dhaka'],
    ['CAT', 'Africa/Harare'],
    ['CNT', 'America/St_Johns'],
    ['CST', 'America/Chicago'],
    ['CTT', 'Asia/Shanghai'],
    ['EAT', 'Africa/Addis_Ababa'],
    ['ECT', 'Europe/Paris'],
    ['IET', 'America/Indiana/Indianapolis'],
    ['IST', 'Asia/Kolkata'],
    ['JST', 'Asia/Tokyo'],
    ['MIT', 'Pacific/Apia'],
    ['NET', 'Asia/Yerevan'],
    ['NST', 'Pacific/Auckland'],
    ['PLT', 'Asia/Karachi'],
    ['PNT', 'America/Phoenix'],
    ['PRT', 'America/Puerto_Rico'],
    ['PST', 'America/Los_Angeles'],
    ['SST', 'Pacific/Guadalcanal'],
    ['VST', 'Asia/Ho_Chi_Minh'],
    ['EST', '-05:00'],
    ['MST', '-07:00'],
    ['HST', '-10:00'],
  ]);
}

export class ZoneRegion extends ZoneId {
  constructor(
    readonly id: string,
    /** IANA id used for rules, or null for a fixed offset region (UTC, GMT+07:00). */
    readonly $iana: string | null,
    readonly $fixed: number | null,
  ) {
    super();
  }
  $offsetAt(epochMs: number): number {
    return this.$iana ? zoneOffsetSeconds(this.$iana, epochMs) : (this.$fixed ?? 0);
  }
  $resolveOffset(localMs: number, preferred?: number | null): number {
    return this.$iana ? resolveOffset(this.$iana, localMs, preferred ?? undefined) : (this.$fixed ?? 0);
  }
  normalized(): ZoneId {
    return this.$iana ? this : ZoneOffset.ofTotalSeconds(this.$fixed ?? 0);
  }
}

const offsetCache = new Map<number, ZoneOffset>();

export class ZoneOffset extends ZoneId {
  readonly id: string;
  constructor(readonly totalSeconds: number) {
    super();
    this.id = offsetId(totalSeconds);
  }
  getTotalSeconds(): number {
    return this.totalSeconds;
  }
  $offsetAt(): number {
    return this.totalSeconds;
  }
  $resolveOffset(): number {
    return this.totalSeconds;
  }
  get(f: ChronoField): number {
    if (f === ChronoField.OFFSET_SECONDS) return this.totalSeconds;
    return unsupportedField(f);
  }
  getLong(f: ChronoField): number {
    return this.get(f);
  }
  compareTo(o: ZoneOffset): number {
    return o.totalSeconds - this.totalSeconds;
  }
  $get(f: ChronoField): number | undefined {
    return f === ChronoField.OFFSET_SECONDS ? this.totalSeconds : undefined;
  }

  static ofTotalSeconds(s: number): ZoneOffset {
    if (Math.abs(s) > 18 * 3600) throw new DateTimeException('Zone offset not in valid range: -18:00 to +18:00');
    let o = offsetCache.get(s);
    if (!o) {
      o = new ZoneOffset(s);
      if (s % 900 === 0) offsetCache.set(s, o);
    }
    return o;
  }
  static ofHours(h: number): ZoneOffset {
    if (Math.abs(h) > 18) throw new DateTimeException(`Zone offset hours not in valid range: value ${h} is not in the range -18 to 18`);
    return ZoneOffset.ofTotalSeconds(h * 3600);
  }
  static ofHoursMinutes(h: number, m: number): ZoneOffset {
    return ZoneOffset.ofTotalSeconds(h * 3600 + m * 60);
  }
  static ofHoursMinutesSeconds(h: number, m: number, s: number): ZoneOffset {
    return ZoneOffset.ofTotalSeconds(h * 3600 + m * 60 + s);
  }
  static of(id: string): ZoneOffset {
    const s = parseOffsetId(id);
    if (s === null) throw new DateTimeException(`Invalid ID for ZoneOffset, invalid format: ${id}`);
    return ZoneOffset.ofTotalSeconds(s);
  }
  static from(t: any): ZoneOffset {
    if (t instanceof ZoneOffset) return t;
    const o = t?.$offset?.();
    if (o === null || o === undefined) throw new DateTimeException(`Unable to obtain ZoneOffset from TemporalAccessor: ${t}`);
    return ZoneOffset.ofTotalSeconds(o);
  }
  declare static UTC: ZoneOffset;
  declare static MIN: ZoneOffset;
  declare static MAX: ZoneOffset;
}
ZoneOffset.UTC = ZoneOffset.ofTotalSeconds(0);
ZoneOffset.MIN = ZoneOffset.ofTotalSeconds(-18 * 3600);
ZoneOffset.MAX = ZoneOffset.ofTotalSeconds(18 * 3600);

// ---------- Instant ----------

export class Instant extends TemporalBase {
  constructor(
    readonly $sec: number,
    readonly $nano: number,
  ) {
    super();
  }

  static ofEpochSecond(sec: number, nanoAdjustment: number = 0): Instant {
    return new Instant(sec + floorDiv(nanoAdjustment, 1e9), floorMod(nanoAdjustment, 1e9));
  }
  static ofEpochMilli(ms: number): Instant {
    return new Instant(floorDiv(ms, 1000), floorMod(ms, 1000) * 1e6);
  }
  static now(_clock?: unknown): Instant {
    return Instant.ofEpochMilli(nowMs());
  }
  static parse(text: string): Instant {
    return DateTimeFormatter.ISO_INSTANT.parse(text, Instant.from);
  }
  static from(t: any): Instant {
    if (t instanceof Instant) return t;
    const i = t?.$instant?.();
    if (!i) throw new DateTimeException(`Unable to obtain Instant from TemporalAccessor: ${t} of type ${t?.constructor?.name}`);
    return new Instant(i[0], i[1]);
  }
  declare static EPOCH: Instant;
  declare static MIN: Instant;
  declare static MAX: Instant;

  get epochSecond(): number {
    return this.$sec;
  }
  getEpochSecond(): number {
    return this.$sec;
  }
  get nano(): number {
    return this.$nano;
  }
  getNano(): number {
    return this.$nano;
  }
  toEpochMilli(): number {
    return this.$sec * 1000 + Math.floor(this.$nano / 1e6);
  }

  $get(f: ChronoField): number | undefined {
    switch (f) {
      case ChronoField.INSTANT_SECONDS:
        return this.$sec;
      case ChronoField.NANO_OF_SECOND:
        return this.$nano;
      case ChronoField.MICRO_OF_SECOND:
        return Math.floor(this.$nano / 1000);
      case ChronoField.MILLI_OF_SECOND:
        return Math.floor(this.$nano / 1e6);
      default:
        return undefined;
    }
  }
  $instant(): [number, number] {
    return [this.$sec, this.$nano];
  }
  $supportsUnit(u: ChronoUnit): boolean {
    return u.ordinal <= ChronoUnit.DAYS.ordinal;
  }

  $plus(secs: number, nanos: number): Instant {
    if (secs === 0 && nanos === 0) return this;
    const n = this.$nano + nanos;
    return new Instant(this.$sec + secs + floorDiv(n, 1e9), floorMod(n, 1e9));
  }
  plus(amount: any, unit?: ChronoUnit): Instant {
    if (unit === undefined) return amount.addTo(this);
    switch (unit) {
      case ChronoUnit.NANOS:
        return this.$plus(0, amount);
      case ChronoUnit.MICROS:
        return this.$plus(floorDiv(amount, 1e6), floorMod(amount, 1e6) * 1000);
      case ChronoUnit.MILLIS:
        return this.$plus(floorDiv(amount, 1000), floorMod(amount, 1000) * 1e6);
      case ChronoUnit.SECONDS:
      case ChronoUnit.MINUTES:
      case ChronoUnit.HOURS:
      case ChronoUnit.HALF_DAYS:
      case ChronoUnit.DAYS:
        return this.$plus(amount * unit.seconds, 0);
      default:
        return unsupportedUnit(unit);
    }
  }
  minus(amount: any, unit?: ChronoUnit): Instant {
    if (unit === undefined) return amount.subtractFrom(this);
    return this.plus(-amount, unit);
  }
  plusSeconds(s: number): Instant {
    return this.$plus(s, 0);
  }
  plusMillis(ms: number): Instant {
    return this.plus(ms, ChronoUnit.MILLIS);
  }
  plusNanos(n: number): Instant {
    return this.$plus(0, n);
  }
  minusSeconds(s: number): Instant {
    return this.$plus(-s, 0);
  }
  minusMillis(ms: number): Instant {
    return this.plus(-ms, ChronoUnit.MILLIS);
  }
  minusNanos(n: number): Instant {
    return this.$plus(0, -n);
  }
  truncatedTo(unit: ChronoUnit): Instant {
    if (unit === ChronoUnit.NANOS) return this;
    if (unit.ordinal > ChronoUnit.DAYS.ordinal) throw new UnsupportedTemporalTypeException('Unit is too large to be used for truncation');
    const dur = unit.$nanos;
    const nod = floorMod(this.$sec, 86400) * 1e9 + this.$nano;
    const result = Math.floor(nod / dur) * dur;
    return this.$plus(0, result - nod);
  }
  until(end: any, unit: ChronoUnit): number {
    const e = Instant.from(end);
    if (!this.$supportsUnit(unit)) unsupportedUnit(unit);
    return timeAmount(e.$sec - this.$sec, e.$nano - this.$nano, unit);
  }
  atZone(zone: ZoneId): ZonedDateTime {
    return ZonedDateTime.ofInstant(this, zone);
  }
  atOffset(offset: ZoneOffset): OffsetDateTime {
    return OffsetDateTime.ofInstant(this, offset);
  }
  isBefore(o: Instant): boolean {
    return this.compareTo(o) < 0;
  }
  isAfter(o: Instant): boolean {
    return this.compareTo(o) > 0;
  }
  compareTo(o: Instant): number {
    return this.$sec !== o.$sec ? (this.$sec < o.$sec ? -1 : 1) : this.$nano - o.$nano;
  }
  equals(o: any): boolean {
    return o instanceof Instant && o.$sec === this.$sec && o.$nano === this.$nano;
  }
  hashCode(): number {
    return (this.$sec ^ (this.$sec / 2 ** 32)) + 51 * this.$nano;
  }
  toString(): string {
    return DateTimeFormatter.ISO_INSTANT.format(this);
  }
}
Instant.EPOCH = new Instant(0, 0);
Instant.MIN = new Instant(-31557014167219200, 0);
Instant.MAX = new Instant(31556889864403199, 999_999_999);

// ---------- LocalDate ----------

function checkDate(y: number, m: number, d: number): void {
  ChronoField.YEAR.checkValidValue(y);
  ChronoField.MONTH_OF_YEAR.checkValidValue(m);
  ChronoField.DAY_OF_MONTH.checkValidValue(d);
  if (d > 28 && d > monthLength(y, m)) {
    if (d === 29) throw new DateTimeException(`Invalid date 'February 29' as '${y}' is not a leap year`);
    throw new DateTimeException(`Invalid date '${Month.of(m).name} ${d}'`);
  }
}

export class LocalDate extends TemporalBase {
  constructor(
    readonly $y: number,
    readonly $m: number,
    readonly $d: number,
  ) {
    super();
  }

  static of(y: number, m: number | Month, d: number): LocalDate {
    const mm = m instanceof Month ? m.value : m;
    checkDate(y, mm, d);
    return new LocalDate(y, mm, d);
  }
  static ofEpochDay(day: number): LocalDate {
    const [y, m, d] = civil(day);
    return new LocalDate(y, m, d);
  }
  static ofYearDay(y: number, doy: number): LocalDate {
    ChronoField.YEAR.checkValidValue(y);
    ChronoField.DAY_OF_YEAR.checkValidValue(doy);
    if (doy === 366 && !isLeap(y)) throw new DateTimeException(`Invalid date 'DayOfYear 366' as '${y}' is not a leap year`);
    return LocalDate.ofEpochDay(epochDayOf(y, 1, 1) + doy - 1);
  }
  static ofInstant(instant: Instant, zone: ZoneId): LocalDate {
    const off = zone.$offsetAt(instant.toEpochMilli());
    return LocalDate.ofEpochDay(floorDiv(instant.$sec + off, 86400));
  }
  static now(zone?: any): LocalDate {
    return LocalDate.ofInstant(Instant.now(), zoneArg(zone));
  }
  static parse(text: string, formatter?: DateTimeFormatter): LocalDate {
    return (formatter ?? DateTimeFormatter.ISO_LOCAL_DATE).parse(text, LocalDate.from);
  }
  static from(t: any): LocalDate {
    if (t instanceof LocalDate) return t;
    const d = t?.$date?.();
    if (!d) throw new DateTimeException(`Unable to obtain LocalDate from TemporalAccessor: ${t} of type ${t?.constructor?.name}`);
    return d;
  }
  declare static MIN: LocalDate;
  declare static MAX: LocalDate;
  declare static EPOCH: LocalDate;

  get year(): number {
    return this.$y;
  }
  getYear(): number {
    return this.$y;
  }
  get monthValue(): number {
    return this.$m;
  }
  getMonthValue(): number {
    return this.$m;
  }
  get month(): Month {
    return Month.of(this.$m);
  }
  getMonth(): Month {
    return this.month;
  }
  get dayOfMonth(): number {
    return this.$d;
  }
  getDayOfMonth(): number {
    return this.$d;
  }
  get dayOfYear(): number {
    return dayOfYear(this.$y, this.$m, this.$d);
  }
  getDayOfYear(): number {
    return this.dayOfYear;
  }
  get dayOfWeek(): DayOfWeek {
    return DayOfWeek.of(isoDow(this.toEpochDay()));
  }
  getDayOfWeek(): DayOfWeek {
    return this.dayOfWeek;
  }
  lengthOfMonth(): number {
    return monthLength(this.$y, this.$m);
  }
  lengthOfYear(): number {
    return isLeap(this.$y) ? 366 : 365;
  }
  toEpochDay(): number {
    return epochDayOf(this.$y, this.$m, this.$d);
  }

  $get(f: ChronoField): number | undefined {
    return dateField(this.$y, this.$m, this.$d, f);
  }
  $date(): LocalDate {
    return this;
  }
  $supportsUnit(u: ChronoUnit): boolean {
    return u.isDateBased();
  }

  plusDays(n: number): LocalDate {
    return n === 0 ? this : LocalDate.ofEpochDay(this.toEpochDay() + n);
  }
  plusWeeks(n: number): LocalDate {
    return this.plusDays(n * 7);
  }
  plusMonths(n: number): LocalDate {
    if (n === 0) return this;
    const pm = this.$y * 12 + (this.$m - 1) + n;
    const y = floorDiv(pm, 12);
    const m = floorMod(pm, 12) + 1;
    ChronoField.YEAR.checkValidValue(y);
    return new LocalDate(y, m, Math.min(this.$d, monthLength(y, m)));
  }
  plusYears(n: number): LocalDate {
    if (n === 0) return this;
    const y = this.$y + n;
    ChronoField.YEAR.checkValidValue(y);
    return new LocalDate(y, this.$m, Math.min(this.$d, monthLength(y, this.$m)));
  }
  minusDays(n: number): LocalDate {
    return this.plusDays(-n);
  }
  minusWeeks(n: number): LocalDate {
    return this.plusWeeks(-n);
  }
  minusMonths(n: number): LocalDate {
    return this.plusMonths(-n);
  }
  minusYears(n: number): LocalDate {
    return this.plusYears(-n);
  }
  plus(amount: any, unit?: ChronoUnit): LocalDate {
    if (unit === undefined) return amount.addTo(this);
    switch (unit) {
      case ChronoUnit.DAYS:
        return this.plusDays(amount);
      case ChronoUnit.WEEKS:
        return this.plusWeeks(amount);
      case ChronoUnit.MONTHS:
        return this.plusMonths(amount);
      case ChronoUnit.YEARS:
        return this.plusYears(amount);
      case ChronoUnit.DECADES:
        return this.plusYears(amount * 10);
      case ChronoUnit.CENTURIES:
        return this.plusYears(amount * 100);
      case ChronoUnit.MILLENNIA:
        return this.plusYears(amount * 1000);
      default:
        return unsupportedUnit(unit);
    }
  }
  minus(amount: any, unit?: ChronoUnit): LocalDate {
    if (unit === undefined) return amount.subtractFrom(this);
    return this.plus(-amount, unit);
  }
  withDayOfMonth(d: number): LocalDate {
    return LocalDate.of(this.$y, this.$m, d);
  }
  withDayOfYear(doy: number): LocalDate {
    return LocalDate.ofYearDay(this.$y, doy);
  }
  withMonth(m: number): LocalDate {
    ChronoField.MONTH_OF_YEAR.checkValidValue(m);
    return new LocalDate(this.$y, m, Math.min(this.$d, monthLength(this.$y, m)));
  }
  withYear(y: number): LocalDate {
    ChronoField.YEAR.checkValidValue(y);
    return new LocalDate(y, this.$m, Math.min(this.$d, monthLength(y, this.$m)));
  }
  with(a: any, v?: number): LocalDate {
    if (v === undefined) return typeof a === 'function' ? a(this) : a.adjustInto(this);
    switch (a) {
      case ChronoField.DAY_OF_MONTH:
        return this.withDayOfMonth(v);
      case ChronoField.DAY_OF_YEAR:
        return this.withDayOfYear(v);
      case ChronoField.MONTH_OF_YEAR:
        return this.withMonth(v);
      case ChronoField.YEAR:
        return this.withYear(v);
      case ChronoField.DAY_OF_WEEK:
        return this.plusDays(ChronoField.DAY_OF_WEEK.checkValidValue(v) - isoDow(this.toEpochDay()));
      case ChronoField.EPOCH_DAY:
        return LocalDate.ofEpochDay(v);
      default:
        return unsupportedField(a);
    }
  }
  adjustInto(t: any): any {
    return t.with(ChronoField.EPOCH_DAY, this.toEpochDay());
  }

  atStartOfDay(zone?: ZoneId): any {
    const ldt = new LocalDateTime(this, LocalTime.MIDNIGHT);
    return zone === undefined || zone === null ? ldt : ZonedDateTime.of(ldt, zone);
  }
  atTime(h: any, m?: number, s: number = 0, n: number = 0): LocalDateTime {
    if (h instanceof LocalTime) return new LocalDateTime(this, h);
    return new LocalDateTime(this, LocalTime.of(h, m ?? 0, s, n));
  }
  until(end: any, unit?: ChronoUnit): any {
    const e = LocalDate.from(end);
    if (unit === undefined) throw new DateTimeException('Period is not supported');
    const days = e.toEpochDay() - this.toEpochDay();
    const months = () => {
      const p1 = (this.$y * 12 + this.$m - 1) * 32 + this.$d;
      const p2 = (e.$y * 12 + e.$m - 1) * 32 + e.$d;
      return Math.trunc((p2 - p1) / 32);
    };
    switch (unit) {
      case ChronoUnit.DAYS:
        return days;
      case ChronoUnit.WEEKS:
        return Math.trunc(days / 7);
      case ChronoUnit.MONTHS:
        return months();
      case ChronoUnit.YEARS:
        return Math.trunc(months() / 12);
      case ChronoUnit.DECADES:
        return Math.trunc(months() / 120);
      case ChronoUnit.CENTURIES:
        return Math.trunc(months() / 1200);
      case ChronoUnit.MILLENNIA:
        return Math.trunc(months() / 12000);
      case ChronoUnit.ERAS:
        return dateField(e.$y, 1, 1, ChronoField.ERA)! - dateField(this.$y, 1, 1, ChronoField.ERA)!;
      default:
        return unsupportedUnit(unit);
    }
  }
  format(f: DateTimeFormatter): string {
    return f.format(this);
  }
  compareTo(o: LocalDate): number {
    return this.$y !== o.$y ? this.$y - o.$y : this.$m !== o.$m ? this.$m - o.$m : this.$d - o.$d;
  }
  isBefore(o: LocalDate): boolean {
    return this.compareTo(LocalDate.from(o)) < 0;
  }
  isAfter(o: LocalDate): boolean {
    return this.compareTo(LocalDate.from(o)) > 0;
  }
  isEqual(o: LocalDate): boolean {
    return this.compareTo(LocalDate.from(o)) === 0;
  }
  equals(o: any): boolean {
    return o instanceof LocalDate && this.compareTo(o) === 0;
  }
  hashCode(): number {
    return (this.$y & 0xfffff800) ^ ((this.$y << 11) + (this.$m << 6) + this.$d);
  }
  toString(): string {
    return isoYear(this.$y) + '-' + pad(this.$m, 2) + '-' + pad(this.$d, 2);
  }
}
boolProp(LocalDate, 'isLeapYear', (d: LocalDate) => isLeap(d.$y));
LocalDate.MIN = new LocalDate(-999999999, 1, 1);
LocalDate.MAX = new LocalDate(999999999, 12, 31);
LocalDate.EPOCH = new LocalDate(1970, 1, 1);

// ---------- LocalTime ----------

export class LocalTime extends TemporalBase {
  constructor(
    readonly $h: number,
    readonly $mi: number,
    readonly $s: number,
    readonly $n: number,
  ) {
    super();
  }

  static of(h: number, m: number, s: number = 0, n: number = 0): LocalTime {
    ChronoField.HOUR_OF_DAY.checkValidValue(h);
    ChronoField.MINUTE_OF_HOUR.checkValidValue(m);
    ChronoField.SECOND_OF_MINUTE.checkValidValue(s);
    ChronoField.NANO_OF_SECOND.checkValidValue(n);
    return new LocalTime(h, m, s, n);
  }
  static ofSecondOfDay(sod: number): LocalTime {
    ChronoField.SECOND_OF_DAY.checkValidValue(sod);
    return new LocalTime(Math.floor(sod / 3600), Math.floor((sod % 3600) / 60), sod % 60, 0);
  }
  static ofNanoOfDay(nod: number): LocalTime {
    ChronoField.NANO_OF_DAY.checkValidValue(nod);
    const secs = Math.floor(nod / 1e9);
    return new LocalTime(Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60, nod - secs * 1e9);
  }
  static now(zone?: any): LocalTime {
    return LocalDateTime.now(zone).toLocalTime();
  }
  static parse(text: string, formatter?: DateTimeFormatter): LocalTime {
    return (formatter ?? DateTimeFormatter.ISO_LOCAL_TIME).parse(text, LocalTime.from);
  }
  static from(t: any): LocalTime {
    if (t instanceof LocalTime) return t;
    const x = t?.$time?.();
    if (!x) throw new DateTimeException(`Unable to obtain LocalTime from TemporalAccessor: ${t} of type ${t?.constructor?.name}`);
    return x;
  }
  declare static MIDNIGHT: LocalTime;
  declare static NOON: LocalTime;
  declare static MIN: LocalTime;
  declare static MAX: LocalTime;

  get hour(): number {
    return this.$h;
  }
  getHour(): number {
    return this.$h;
  }
  get minute(): number {
    return this.$mi;
  }
  getMinute(): number {
    return this.$mi;
  }
  get second(): number {
    return this.$s;
  }
  getSecond(): number {
    return this.$s;
  }
  get nano(): number {
    return this.$n;
  }
  getNano(): number {
    return this.$n;
  }
  toSecondOfDay(): number {
    return this.$h * 3600 + this.$mi * 60 + this.$s;
  }
  toNanoOfDay(): number {
    return this.toSecondOfDay() * 1e9 + this.$n;
  }

  $get(f: ChronoField): number | undefined {
    return timeField(this.$h, this.$mi, this.$s, this.$n, f);
  }
  $time(): LocalTime {
    return this;
  }
  $supportsUnit(u: ChronoUnit): boolean {
    return u.isTimeBased();
  }

  /** Adds nanoseconds, wrapping around midnight. */
  $plusNanos(n: number): LocalTime {
    if (n === 0) return this;
    return LocalTime.ofNanoOfDay(floorMod(this.toNanoOfDay() + floorMod(n, NANOS_PER_DAY), NANOS_PER_DAY));
  }
  plusHours(n: number): LocalTime {
    return this.$plusNanos(floorMod(n, 24) * 3600e9);
  }
  plusMinutes(n: number): LocalTime {
    return this.$plusNanos(floorMod(n, 1440) * 60e9);
  }
  plusSeconds(n: number): LocalTime {
    return this.$plusNanos(floorMod(n, 86400) * 1e9);
  }
  plusNanos(n: number): LocalTime {
    return this.$plusNanos(n);
  }
  minusHours(n: number): LocalTime {
    return this.plusHours(-n);
  }
  minusMinutes(n: number): LocalTime {
    return this.plusMinutes(-n);
  }
  minusSeconds(n: number): LocalTime {
    return this.plusSeconds(-n);
  }
  minusNanos(n: number): LocalTime {
    return this.$plusNanos(-n);
  }
  plus(amount: any, unit?: ChronoUnit): LocalTime {
    if (unit === undefined) return amount.addTo(this);
    if (!unit.isTimeBased()) unsupportedUnit(unit);
    if (unit === ChronoUnit.NANOS) return this.$plusNanos(amount);
    if (unit === ChronoUnit.MICROS) return this.$plusNanos(floorMod(amount, 86400e6) * 1000);
    if (unit === ChronoUnit.MILLIS) return this.$plusNanos(floorMod(amount, 86400e3) * 1e6);
    return this.plusSeconds(floorMod(amount * unit.seconds, 86400));
  }
  minus(amount: any, unit?: ChronoUnit): LocalTime {
    if (unit === undefined) return amount.subtractFrom(this);
    return this.plus(-amount, unit);
  }
  withHour(h: number): LocalTime {
    return LocalTime.of(h, this.$mi, this.$s, this.$n);
  }
  withMinute(m: number): LocalTime {
    return LocalTime.of(this.$h, m, this.$s, this.$n);
  }
  withSecond(s: number): LocalTime {
    return LocalTime.of(this.$h, this.$mi, s, this.$n);
  }
  withNano(n: number): LocalTime {
    return LocalTime.of(this.$h, this.$mi, this.$s, n);
  }
  truncatedTo(unit: ChronoUnit): LocalTime {
    if (unit === ChronoUnit.NANOS) return this;
    if (unit === ChronoUnit.DAYS) return LocalTime.MIDNIGHT;
    if (!unit.isTimeBased()) throw new UnsupportedTemporalTypeException('Unit is too large to be used for truncation');
    const dur = unit.$nanos;
    return LocalTime.ofNanoOfDay(Math.floor(this.toNanoOfDay() / dur) * dur);
  }
  until(end: any, unit: ChronoUnit): number {
    const e = LocalTime.from(end);
    if (!unit.isTimeBased()) unsupportedUnit(unit);
    return timeAmount(e.toSecondOfDay() - this.toSecondOfDay(), e.$n - this.$n, unit);
  }
  atDate(d: LocalDate): LocalDateTime {
    return new LocalDateTime(d, this);
  }
  format(f: DateTimeFormatter): string {
    return f.format(this);
  }
  compareTo(o: LocalTime): number {
    const a = this.toSecondOfDay();
    const b = o.toSecondOfDay();
    return a !== b ? a - b : this.$n - o.$n;
  }
  isBefore(o: LocalTime): boolean {
    return this.compareTo(o) < 0;
  }
  isAfter(o: LocalTime): boolean {
    return this.compareTo(o) > 0;
  }
  equals(o: any): boolean {
    return o instanceof LocalTime && this.compareTo(o) === 0;
  }
  hashCode(): number {
    return stringHash(this.toString());
  }
  toString(): string {
    let s = pad(this.$h, 2) + ':' + pad(this.$mi, 2);
    if (this.$s > 0 || this.$n > 0) {
      s += ':' + pad(this.$s, 2);
      if (this.$n > 0) {
        if (this.$n % 1e6 === 0) s += '.' + pad(this.$n / 1e6, 3);
        else if (this.$n % 1000 === 0) s += '.' + pad(this.$n / 1000, 6);
        else s += '.' + pad(this.$n, 9);
      }
    }
    return s;
  }
}
LocalTime.MIDNIGHT = new LocalTime(0, 0, 0, 0);
LocalTime.MIN = LocalTime.MIDNIGHT;
LocalTime.NOON = new LocalTime(12, 0, 0, 0);
LocalTime.MAX = new LocalTime(23, 59, 59, 999_999_999);

// ---------- LocalDateTime ----------

export class LocalDateTime extends TemporalBase {
  constructor(
    readonly $dt: LocalDate,
    readonly $tm: LocalTime,
  ) {
    super();
  }

  static of(a: any, b?: any, c?: any, d?: any, e?: any, f: number = 0, g: number = 0): LocalDateTime {
    if (a instanceof LocalDate) return new LocalDateTime(a, b as LocalTime);
    return new LocalDateTime(LocalDate.of(a, b, c), LocalTime.of(d, e, f, g));
  }
  static ofEpochSecond(sec: number, nano: number, offset: ZoneOffset): LocalDateTime {
    ChronoField.NANO_OF_SECOND.checkValidValue(nano);
    const local = sec + offset.totalSeconds;
    const day = floorDiv(local, 86400);
    const sod = floorMod(local, 86400);
    return new LocalDateTime(LocalDate.ofEpochDay(day), LocalTime.ofNanoOfDay(sod * 1e9 + nano));
  }
  static ofInstant(instant: Instant, zone: ZoneId): LocalDateTime {
    const off = zone.$offsetAt(instant.toEpochMilli());
    return LocalDateTime.ofEpochSecond(instant.$sec, instant.$nano, ZoneOffset.ofTotalSeconds(off));
  }
  static now(zone?: any): LocalDateTime {
    return LocalDateTime.ofInstant(Instant.now(), zoneArg(zone));
  }
  static parse(text: string, formatter?: DateTimeFormatter): LocalDateTime {
    return (formatter ?? DateTimeFormatter.ISO_LOCAL_DATE_TIME).parse(text, LocalDateTime.from);
  }
  static from(t: any): LocalDateTime {
    if (t instanceof LocalDateTime) return t;
    if (t instanceof ZonedDateTime || t instanceof OffsetDateTime) return t.toLocalDateTime();
    const d = t?.$date?.();
    const tm = t?.$time?.();
    if (!d || !tm) throw new DateTimeException(`Unable to obtain LocalDateTime from TemporalAccessor: ${t} of type ${t?.constructor?.name}`);
    return new LocalDateTime(d, tm);
  }
  declare static MIN: LocalDateTime;
  declare static MAX: LocalDateTime;

  /** Wall-clock time as if the zone were UTC, in epoch millis (for zone-offset resolution). */
  $localMs(): number {
    return this.$dt.toEpochDay() * MS_PER_DAY + this.$tm.toSecondOfDay() * 1000 + Math.floor(this.$tm.$n / 1e6);
  }

  get year(): number {
    return this.$dt.$y;
  }
  getYear(): number {
    return this.$dt.$y;
  }
  get monthValue(): number {
    return this.$dt.$m;
  }
  getMonthValue(): number {
    return this.$dt.$m;
  }
  get month(): Month {
    return this.$dt.month;
  }
  getMonth(): Month {
    return this.$dt.month;
  }
  get dayOfMonth(): number {
    return this.$dt.$d;
  }
  getDayOfMonth(): number {
    return this.$dt.$d;
  }
  get dayOfYear(): number {
    return this.$dt.dayOfYear;
  }
  getDayOfYear(): number {
    return this.$dt.dayOfYear;
  }
  get dayOfWeek(): DayOfWeek {
    return this.$dt.dayOfWeek;
  }
  getDayOfWeek(): DayOfWeek {
    return this.$dt.dayOfWeek;
  }
  get hour(): number {
    return this.$tm.$h;
  }
  getHour(): number {
    return this.$tm.$h;
  }
  get minute(): number {
    return this.$tm.$mi;
  }
  getMinute(): number {
    return this.$tm.$mi;
  }
  get second(): number {
    return this.$tm.$s;
  }
  getSecond(): number {
    return this.$tm.$s;
  }
  get nano(): number {
    return this.$tm.$n;
  }
  getNano(): number {
    return this.$tm.$n;
  }
  toLocalDate(): LocalDate {
    return this.$dt;
  }
  toLocalTime(): LocalTime {
    return this.$tm;
  }

  $get(f: ChronoField): number | undefined {
    return f.isDateBased() ? this.$dt.$get(f) : this.$tm.$get(f);
  }
  $date(): LocalDate {
    return this.$dt;
  }
  $time(): LocalTime {
    return this.$tm;
  }
  $supportsUnit(u: ChronoUnit): boolean {
    return u !== ChronoUnit.FOREVER;
  }

  $with(d: LocalDate, t: LocalTime): LocalDateTime {
    return d === this.$dt && t === this.$tm ? this : new LocalDateTime(d, t);
  }
  /** Adds a time span (seconds + nanos) with day carry. */
  $plusTime(secs: number, nanos: number): LocalDateTime {
    if (secs === 0 && nanos === 0) return this;
    const curNod = this.$tm.toNanoOfDay();
    const totSecs = this.$tm.toSecondOfDay() + secs + floorDiv(this.$tm.$n + nanos, 1e9);
    const n = floorMod(this.$tm.$n + nanos, 1e9);
    const days = floorDiv(totSecs, 86400);
    const sod = floorMod(totSecs, 86400);
    const newNod = sod * 1e9 + n;
    const t = newNod === curNod ? this.$tm : LocalTime.ofNanoOfDay(newNod);
    return this.$with(this.$dt.plusDays(days), t);
  }
  plusYears(n: number): LocalDateTime {
    return this.$with(this.$dt.plusYears(n), this.$tm);
  }
  plusMonths(n: number): LocalDateTime {
    return this.$with(this.$dt.plusMonths(n), this.$tm);
  }
  plusWeeks(n: number): LocalDateTime {
    return this.$with(this.$dt.plusWeeks(n), this.$tm);
  }
  plusDays(n: number): LocalDateTime {
    return this.$with(this.$dt.plusDays(n), this.$tm);
  }
  plusHours(n: number): LocalDateTime {
    return this.$plusTime(n * 3600, 0);
  }
  plusMinutes(n: number): LocalDateTime {
    return this.$plusTime(n * 60, 0);
  }
  plusSeconds(n: number): LocalDateTime {
    return this.$plusTime(n, 0);
  }
  plusNanos(n: number): LocalDateTime {
    return this.$plusTime(0, n);
  }
  minusYears(n: number): LocalDateTime {
    return this.plusYears(-n);
  }
  minusMonths(n: number): LocalDateTime {
    return this.plusMonths(-n);
  }
  minusWeeks(n: number): LocalDateTime {
    return this.plusWeeks(-n);
  }
  minusDays(n: number): LocalDateTime {
    return this.plusDays(-n);
  }
  minusHours(n: number): LocalDateTime {
    return this.plusHours(-n);
  }
  minusMinutes(n: number): LocalDateTime {
    return this.plusMinutes(-n);
  }
  minusSeconds(n: number): LocalDateTime {
    return this.plusSeconds(-n);
  }
  minusNanos(n: number): LocalDateTime {
    return this.plusNanos(-n);
  }
  plus(amount: any, unit?: ChronoUnit): LocalDateTime {
    if (unit === undefined) return amount.addTo(this);
    if (unit.isDateBased()) return this.$with(this.$dt.plus(amount, unit), this.$tm);
    switch (unit) {
      case ChronoUnit.NANOS:
        return this.plusNanos(amount);
      case ChronoUnit.MICROS:
        return this.$plusTime(floorDiv(amount, 1e6), floorMod(amount, 1e6) * 1000);
      case ChronoUnit.MILLIS:
        return this.$plusTime(floorDiv(amount, 1000), floorMod(amount, 1000) * 1e6);
      default:
        return this.$plusTime(amount * unit.seconds, 0);
    }
  }
  minus(amount: any, unit?: ChronoUnit): LocalDateTime {
    if (unit === undefined) return amount.subtractFrom(this);
    return this.plus(-amount, unit);
  }
  withYear(y: number): LocalDateTime {
    return this.$with(this.$dt.withYear(y), this.$tm);
  }
  withMonth(m: number): LocalDateTime {
    return this.$with(this.$dt.withMonth(m), this.$tm);
  }
  withDayOfMonth(d: number): LocalDateTime {
    return this.$with(this.$dt.withDayOfMonth(d), this.$tm);
  }
  withDayOfYear(d: number): LocalDateTime {
    return this.$with(this.$dt.withDayOfYear(d), this.$tm);
  }
  withHour(h: number): LocalDateTime {
    return this.$with(this.$dt, this.$tm.withHour(h));
  }
  withMinute(m: number): LocalDateTime {
    return this.$with(this.$dt, this.$tm.withMinute(m));
  }
  withSecond(s: number): LocalDateTime {
    return this.$with(this.$dt, this.$tm.withSecond(s));
  }
  withNano(n: number): LocalDateTime {
    return this.$with(this.$dt, this.$tm.withNano(n));
  }
  with(a: any, v?: number): LocalDateTime {
    if (v === undefined) {
      if (a instanceof LocalDate) return this.$with(a, this.$tm);
      if (a instanceof LocalTime) return this.$with(this.$dt, a);
      return typeof a === 'function' ? a(this) : a.adjustInto(this);
    }
    if ((a as ChronoField).isTimeBased()) {
      const t = this.$tm;
      switch (a) {
        case ChronoField.HOUR_OF_DAY:
          return this.withHour(v);
        case ChronoField.MINUTE_OF_HOUR:
          return this.withMinute(v);
        case ChronoField.SECOND_OF_MINUTE:
          return this.withSecond(v);
        case ChronoField.NANO_OF_SECOND:
          return this.withNano(v);
        case ChronoField.MILLI_OF_SECOND:
          return this.withNano(ChronoField.MILLI_OF_SECOND.checkValidValue(v) * 1e6);
        case ChronoField.NANO_OF_DAY:
          return this.$with(this.$dt, LocalTime.ofNanoOfDay(v));
        case ChronoField.SECOND_OF_DAY:
          return this.$with(this.$dt, LocalTime.ofSecondOfDay(v).withNano(t.$n));
        default:
          return unsupportedField(a);
      }
    }
    return this.$with(this.$dt.with(a, v), this.$tm);
  }
  truncatedTo(unit: ChronoUnit): LocalDateTime {
    return this.$with(this.$dt, this.$tm.truncatedTo(unit));
  }
  atZone(zone: ZoneId): ZonedDateTime {
    return ZonedDateTime.of(this, zone);
  }
  atOffset(offset: ZoneOffset): OffsetDateTime {
    return new OffsetDateTime(this, offset);
  }
  toEpochSecond(offset: ZoneOffset): number {
    return this.$dt.toEpochDay() * 86400 + this.$tm.toSecondOfDay() - offset.totalSeconds;
  }
  toInstant(offset: ZoneOffset): Instant {
    return new Instant(this.toEpochSecond(offset), this.$tm.$n);
  }
  until(end: any, unit: ChronoUnit): number {
    const e = LocalDateTime.from(end);
    if (unit.isTimeBased()) {
      const days = e.$dt.toEpochDay() - this.$dt.toEpochDay();
      return timeAmount(days * 86400 + e.$tm.toSecondOfDay() - this.$tm.toSecondOfDay(), e.$tm.$n - this.$tm.$n, unit);
    }
    let endDate = e.$dt;
    if (endDate.isAfter(this.$dt) && e.$tm.isBefore(this.$tm)) endDate = endDate.minusDays(1);
    else if (endDate.isBefore(this.$dt) && e.$tm.isAfter(this.$tm)) endDate = endDate.plusDays(1);
    return this.$dt.until(endDate, unit);
  }
  format(f: DateTimeFormatter): string {
    return f.format(this);
  }
  compareTo(o: LocalDateTime): number {
    const c = this.$dt.compareTo(o.$dt);
    return c !== 0 ? c : this.$tm.compareTo(o.$tm);
  }
  isBefore(o: LocalDateTime): boolean {
    return this.compareTo(o) < 0;
  }
  isAfter(o: LocalDateTime): boolean {
    return this.compareTo(o) > 0;
  }
  isEqual(o: LocalDateTime): boolean {
    return this.compareTo(o) === 0;
  }
  equals(o: any): boolean {
    return o instanceof LocalDateTime && this.compareTo(o) === 0;
  }
  hashCode(): number {
    return this.$dt.hashCode() ^ this.$tm.hashCode();
  }
  toString(): string {
    return this.$dt.toString() + 'T' + this.$tm.toString();
  }
}
LocalDateTime.MIN = new LocalDateTime(LocalDate.MIN, LocalTime.MIN);
LocalDateTime.MAX = new LocalDateTime(LocalDate.MAX, LocalTime.MAX);

// ---------- ZonedDateTime ----------

/** Shared getters for date-time-with-offset types. */
abstract class OffsetTemporal extends TemporalBase {
  abstract readonly $ldt: LocalDateTime;
  abstract readonly $off: ZoneOffset;

  get year(): number {
    return this.$ldt.year;
  }
  getYear(): number {
    return this.$ldt.year;
  }
  get monthValue(): number {
    return this.$ldt.monthValue;
  }
  getMonthValue(): number {
    return this.$ldt.monthValue;
  }
  get month(): Month {
    return this.$ldt.month;
  }
  getMonth(): Month {
    return this.$ldt.month;
  }
  get dayOfMonth(): number {
    return this.$ldt.dayOfMonth;
  }
  getDayOfMonth(): number {
    return this.$ldt.dayOfMonth;
  }
  get dayOfYear(): number {
    return this.$ldt.dayOfYear;
  }
  getDayOfYear(): number {
    return this.$ldt.dayOfYear;
  }
  get dayOfWeek(): DayOfWeek {
    return this.$ldt.dayOfWeek;
  }
  getDayOfWeek(): DayOfWeek {
    return this.$ldt.dayOfWeek;
  }
  get hour(): number {
    return this.$ldt.hour;
  }
  getHour(): number {
    return this.$ldt.hour;
  }
  get minute(): number {
    return this.$ldt.minute;
  }
  getMinute(): number {
    return this.$ldt.minute;
  }
  get second(): number {
    return this.$ldt.second;
  }
  getSecond(): number {
    return this.$ldt.second;
  }
  get nano(): number {
    return this.$ldt.nano;
  }
  getNano(): number {
    return this.$ldt.nano;
  }
  get offset(): ZoneOffset {
    return this.$off;
  }
  getOffset(): ZoneOffset {
    return this.$off;
  }
  toLocalDateTime(): LocalDateTime {
    return this.$ldt;
  }
  toLocalDate(): LocalDate {
    return this.$ldt.$dt;
  }
  toLocalTime(): LocalTime {
    return this.$ldt.$tm;
  }
  toEpochSecond(): number {
    return this.$ldt.toEpochSecond(this.$off);
  }
  toInstant(): Instant {
    return new Instant(this.toEpochSecond(), this.$ldt.$tm.$n);
  }

  $get(f: ChronoField): number | undefined {
    if (f === ChronoField.OFFSET_SECONDS) return this.$off.totalSeconds;
    if (f === ChronoField.INSTANT_SECONDS) return this.toEpochSecond();
    return this.$ldt.$get(f);
  }
  $date(): LocalDate {
    return this.$ldt.$dt;
  }
  $time(): LocalTime {
    return this.$ldt.$tm;
  }
  $offset(): number {
    return this.$off.totalSeconds;
  }
  $instant(): [number, number] {
    return [this.toEpochSecond(), this.$ldt.$tm.$n];
  }
  $supportsUnit(u: ChronoUnit): boolean {
    return u !== ChronoUnit.FOREVER;
  }
  format(f: DateTimeFormatter): string {
    return f.format(this);
  }
  isBefore(o: any): boolean {
    return this.toInstant().compareTo(Instant.from(o)) < 0;
  }
  isAfter(o: any): boolean {
    return this.toInstant().compareTo(Instant.from(o)) > 0;
  }
  isEqual(o: any): boolean {
    return this.toInstant().compareTo(Instant.from(o)) === 0;
  }
}

export class ZonedDateTime extends OffsetTemporal {
  constructor(
    readonly $ldt: LocalDateTime,
    readonly $off: ZoneOffset,
    readonly $zn: ZoneId,
  ) {
    super();
  }

  static of(a: any, b?: any, c?: any, d?: any, e?: any, f?: any, g?: any, h?: any): ZonedDateTime {
    if (a instanceof LocalDateTime) return ZonedDateTime.ofLocal(a, b, null);
    if (a instanceof LocalDate) return ZonedDateTime.ofLocal(new LocalDateTime(a, b), c, null);
    return ZonedDateTime.ofLocal(LocalDateTime.of(a, b, c, d, e, f, g), h, null);
  }
  static ofLocal(ldt: LocalDateTime, zone: ZoneId, preferredOffset?: ZoneOffset | null): ZonedDateTime {
    if (zone instanceof ZoneOffset) return new ZonedDateTime(ldt, zone, zone);
    const off = zone.$resolveOffset(ldt.$localMs(), preferredOffset ? preferredOffset.totalSeconds : null);
    const epoch = ldt.toEpochSecond(ZoneOffset.ofTotalSeconds(off));
    const actual = zone.$offsetAt(epoch * 1000);
    if (actual !== off) return ZonedDateTime.$create(epoch, ldt.$tm.$n, zone); // gap: shifted later
    return new ZonedDateTime(ldt, ZoneOffset.ofTotalSeconds(off), zone);
  }
  static $create(epochSecond: number, nano: number, zone: ZoneId): ZonedDateTime {
    const off = ZoneOffset.ofTotalSeconds(zone.$offsetAt(epochSecond * 1000 + Math.floor(nano / 1e6)));
    return new ZonedDateTime(LocalDateTime.ofEpochSecond(epochSecond, nano, off), off, zone);
  }
  static ofInstant(a: any, b: any, c?: any): ZonedDateTime {
    if (a instanceof Instant) return ZonedDateTime.$create(a.$sec, a.$nano, b);
    // ofInstant(LocalDateTime, ZoneOffset, ZoneId)
    return ZonedDateTime.$create((a as LocalDateTime).toEpochSecond(b), a.$tm.$n, c);
  }
  static now(zone?: any): ZonedDateTime {
    return Instant.now().atZone(zoneArg(zone));
  }
  static parse(text: string, formatter?: DateTimeFormatter): ZonedDateTime {
    return (formatter ?? DateTimeFormatter.ISO_ZONED_DATE_TIME).parse(text, ZonedDateTime.from);
  }
  static from(t: any): ZonedDateTime {
    if (t instanceof ZonedDateTime) return t;
    const zone: ZoneId | null = t?.$zone?.() ?? null;
    if (!zone) throw new DateTimeException(`Unable to obtain ZonedDateTime from TemporalAccessor: ${t} of type ${t?.constructor?.name}`);
    const inst = t.$instant?.();
    if (inst) return ZonedDateTime.$create(inst[0], inst[1], zone);
    return ZonedDateTime.ofLocal(LocalDateTime.from(t), zone, null);
  }

  get zone(): ZoneId {
    return this.$zn;
  }
  getZone(): ZoneId {
    return this.$zn;
  }
  $zone(): ZoneId {
    return this.$zn;
  }

  $local(ldt: LocalDateTime): ZonedDateTime {
    return ZonedDateTime.ofLocal(ldt, this.$zn, this.$off);
  }
  $inst(ldt: LocalDateTime): ZonedDateTime {
    return ZonedDateTime.$create(ldt.toEpochSecond(this.$off), ldt.$tm.$n, this.$zn);
  }
  plus(amount: any, unit?: ChronoUnit): ZonedDateTime {
    if (unit === undefined) return amount.addTo(this);
    if (unit.isDateBased()) return this.$local(this.$ldt.plus(amount, unit));
    return this.$inst(this.$ldt.plus(amount, unit));
  }
  minus(amount: any, unit?: ChronoUnit): ZonedDateTime {
    if (unit === undefined) return amount.subtractFrom(this);
    return this.plus(-amount, unit);
  }
  plusYears(n: number): ZonedDateTime {
    return this.$local(this.$ldt.plusYears(n));
  }
  plusMonths(n: number): ZonedDateTime {
    return this.$local(this.$ldt.plusMonths(n));
  }
  plusWeeks(n: number): ZonedDateTime {
    return this.$local(this.$ldt.plusWeeks(n));
  }
  plusDays(n: number): ZonedDateTime {
    return this.$local(this.$ldt.plusDays(n));
  }
  plusHours(n: number): ZonedDateTime {
    return this.$inst(this.$ldt.plusHours(n));
  }
  plusMinutes(n: number): ZonedDateTime {
    return this.$inst(this.$ldt.plusMinutes(n));
  }
  plusSeconds(n: number): ZonedDateTime {
    return this.$inst(this.$ldt.plusSeconds(n));
  }
  plusNanos(n: number): ZonedDateTime {
    return this.$inst(this.$ldt.plusNanos(n));
  }
  minusYears(n: number): ZonedDateTime {
    return this.plusYears(-n);
  }
  minusMonths(n: number): ZonedDateTime {
    return this.plusMonths(-n);
  }
  minusWeeks(n: number): ZonedDateTime {
    return this.plusWeeks(-n);
  }
  minusDays(n: number): ZonedDateTime {
    return this.plusDays(-n);
  }
  minusHours(n: number): ZonedDateTime {
    return this.plusHours(-n);
  }
  minusMinutes(n: number): ZonedDateTime {
    return this.plusMinutes(-n);
  }
  minusSeconds(n: number): ZonedDateTime {
    return this.plusSeconds(-n);
  }
  minusNanos(n: number): ZonedDateTime {
    return this.plusNanos(-n);
  }
  withYear(v: number): ZonedDateTime {
    return this.$local(this.$ldt.withYear(v));
  }
  withMonth(v: number): ZonedDateTime {
    return this.$local(this.$ldt.withMonth(v));
  }
  withDayOfMonth(v: number): ZonedDateTime {
    return this.$local(this.$ldt.withDayOfMonth(v));
  }
  withDayOfYear(v: number): ZonedDateTime {
    return this.$local(this.$ldt.withDayOfYear(v));
  }
  withHour(v: number): ZonedDateTime {
    return this.$local(this.$ldt.withHour(v));
  }
  withMinute(v: number): ZonedDateTime {
    return this.$local(this.$ldt.withMinute(v));
  }
  withSecond(v: number): ZonedDateTime {
    return this.$local(this.$ldt.withSecond(v));
  }
  withNano(v: number): ZonedDateTime {
    return this.$local(this.$ldt.withNano(v));
  }
  with(a: any, v?: number): ZonedDateTime {
    if (v === undefined && a instanceof ZoneOffset) return this.$local(this.$ldt);
    if (a === ChronoField.INSTANT_SECONDS) return ZonedDateTime.$create(v!, this.nano, this.$zn);
    if (a === ChronoField.OFFSET_SECONDS) return ZonedDateTime.ofLocal(this.$ldt, this.$zn, ZoneOffset.ofTotalSeconds(v!));
    return this.$local(this.$ldt.with(a, v));
  }
  truncatedTo(unit: ChronoUnit): ZonedDateTime {
    return this.$local(this.$ldt.truncatedTo(unit));
  }
  withZoneSameInstant(zone: ZoneId): ZonedDateTime {
    return zone.equals(this.$zn) ? this : ZonedDateTime.$create(this.toEpochSecond(), this.nano, zone);
  }
  withZoneSameLocal(zone: ZoneId): ZonedDateTime {
    return zone.equals(this.$zn) ? this : ZonedDateTime.ofLocal(this.$ldt, zone, this.$off);
  }
  withEarlierOffsetAtOverlap(): ZonedDateTime {
    return ZonedDateTime.ofLocal(this.$ldt, this.$zn, null);
  }
  withFixedOffsetZone(): ZonedDateTime {
    return new ZonedDateTime(this.$ldt, this.$off, this.$off);
  }
  toOffsetDateTime(): OffsetDateTime {
    return new OffsetDateTime(this.$ldt, this.$off);
  }
  until(end: any, unit: ChronoUnit): number {
    const e = ZonedDateTime.from(end).withZoneSameInstant(this.$zn);
    if (unit.isDateBased()) return this.$ldt.until(e.$ldt, unit);
    return this.toInstant().until(e.toInstant(), unit);
  }
  compareTo(o: ZonedDateTime): number {
    const c = this.toInstant().compareTo(o.toInstant());
    if (c !== 0) return c;
    const c2 = this.$ldt.compareTo(o.$ldt);
    if (c2 !== 0) return c2;
    return this.$zn.id < o.$zn.id ? -1 : this.$zn.id > o.$zn.id ? 1 : 0;
  }
  equals(o: any): boolean {
    return o instanceof ZonedDateTime && this.$ldt.equals(o.$ldt) && this.$off.equals(o.$off) && this.$zn.equals(o.$zn);
  }
  hashCode(): number {
    return this.$ldt.hashCode() ^ this.$off.hashCode() ^ this.$zn.hashCode();
  }
  toString(): string {
    let s = this.$ldt.toString() + this.$off.toString();
    if (this.$off !== this.$zn) s += '[' + this.$zn.toString() + ']';
    return s;
  }
}

// ---------- OffsetDateTime ----------

export class OffsetDateTime extends OffsetTemporal {
  constructor(
    readonly $ldt: LocalDateTime,
    readonly $off: ZoneOffset,
  ) {
    super();
  }

  static of(a: any, b?: any, c?: any, d?: any, e?: any, f?: any, g?: any, h?: any): OffsetDateTime {
    if (a instanceof LocalDateTime) return new OffsetDateTime(a, b);
    if (a instanceof LocalDate) return new OffsetDateTime(new LocalDateTime(a, b), c);
    return new OffsetDateTime(LocalDateTime.of(a, b, c, d, e, f, g), h);
  }
  static ofInstant(instant: Instant, zone: ZoneId): OffsetDateTime {
    const off = ZoneOffset.ofTotalSeconds(zone.$offsetAt(instant.toEpochMilli()));
    return new OffsetDateTime(LocalDateTime.ofEpochSecond(instant.$sec, instant.$nano, off), off);
  }
  static now(zone?: any): OffsetDateTime {
    return OffsetDateTime.ofInstant(Instant.now(), zoneArg(zone));
  }
  static parse(text: string, formatter?: DateTimeFormatter): OffsetDateTime {
    return (formatter ?? DateTimeFormatter.ISO_OFFSET_DATE_TIME).parse(text, OffsetDateTime.from);
  }
  static from(t: any): OffsetDateTime {
    if (t instanceof OffsetDateTime) return t;
    if (t instanceof ZonedDateTime) return t.toOffsetDateTime();
    const off = t?.$offset?.();
    if (off === null || off === undefined) throw new DateTimeException(`Unable to obtain OffsetDateTime from TemporalAccessor: ${t} of type ${t?.constructor?.name}`);
    const d = t.$date?.();
    const tm = t.$time?.();
    if (d && tm) return new OffsetDateTime(new LocalDateTime(d, tm), ZoneOffset.ofTotalSeconds(off));
    return OffsetDateTime.ofInstant(Instant.from(t), ZoneOffset.ofTotalSeconds(off));
  }
  declare static MIN: OffsetDateTime;
  declare static MAX: OffsetDateTime;

  $zone(): ZoneId {
    return this.$off;
  }
  $w(ldt: LocalDateTime): OffsetDateTime {
    return ldt === this.$ldt ? this : new OffsetDateTime(ldt, this.$off);
  }
  plus(amount: any, unit?: ChronoUnit): OffsetDateTime {
    if (unit === undefined) return amount.addTo(this);
    return this.$w(this.$ldt.plus(amount, unit));
  }
  minus(amount: any, unit?: ChronoUnit): OffsetDateTime {
    if (unit === undefined) return amount.subtractFrom(this);
    return this.$w(this.$ldt.plus(-amount, unit));
  }
  plusYears(n: number): OffsetDateTime {
    return this.$w(this.$ldt.plusYears(n));
  }
  plusMonths(n: number): OffsetDateTime {
    return this.$w(this.$ldt.plusMonths(n));
  }
  plusWeeks(n: number): OffsetDateTime {
    return this.$w(this.$ldt.plusWeeks(n));
  }
  plusDays(n: number): OffsetDateTime {
    return this.$w(this.$ldt.plusDays(n));
  }
  plusHours(n: number): OffsetDateTime {
    return this.$w(this.$ldt.plusHours(n));
  }
  plusMinutes(n: number): OffsetDateTime {
    return this.$w(this.$ldt.plusMinutes(n));
  }
  plusSeconds(n: number): OffsetDateTime {
    return this.$w(this.$ldt.plusSeconds(n));
  }
  plusNanos(n: number): OffsetDateTime {
    return this.$w(this.$ldt.plusNanos(n));
  }
  minusYears(n: number): OffsetDateTime {
    return this.plusYears(-n);
  }
  minusMonths(n: number): OffsetDateTime {
    return this.plusMonths(-n);
  }
  minusWeeks(n: number): OffsetDateTime {
    return this.plusWeeks(-n);
  }
  minusDays(n: number): OffsetDateTime {
    return this.plusDays(-n);
  }
  minusHours(n: number): OffsetDateTime {
    return this.plusHours(-n);
  }
  minusMinutes(n: number): OffsetDateTime {
    return this.plusMinutes(-n);
  }
  minusSeconds(n: number): OffsetDateTime {
    return this.plusSeconds(-n);
  }
  minusNanos(n: number): OffsetDateTime {
    return this.plusNanos(-n);
  }
  withYear(v: number): OffsetDateTime {
    return this.$w(this.$ldt.withYear(v));
  }
  withMonth(v: number): OffsetDateTime {
    return this.$w(this.$ldt.withMonth(v));
  }
  withDayOfMonth(v: number): OffsetDateTime {
    return this.$w(this.$ldt.withDayOfMonth(v));
  }
  withHour(v: number): OffsetDateTime {
    return this.$w(this.$ldt.withHour(v));
  }
  withMinute(v: number): OffsetDateTime {
    return this.$w(this.$ldt.withMinute(v));
  }
  withSecond(v: number): OffsetDateTime {
    return this.$w(this.$ldt.withSecond(v));
  }
  withNano(v: number): OffsetDateTime {
    return this.$w(this.$ldt.withNano(v));
  }
  with(a: any, v?: number): OffsetDateTime {
    return this.$w(this.$ldt.with(a, v));
  }
  truncatedTo(unit: ChronoUnit): OffsetDateTime {
    return this.$w(this.$ldt.truncatedTo(unit));
  }
  withOffsetSameInstant(off: ZoneOffset): OffsetDateTime {
    if (off.equals(this.$off)) return this;
    return new OffsetDateTime(this.$ldt.plusSeconds(off.totalSeconds - this.$off.totalSeconds), off);
  }
  withOffsetSameLocal(off: ZoneOffset): OffsetDateTime {
    return new OffsetDateTime(this.$ldt, off);
  }
  atZoneSameInstant(zone: ZoneId): ZonedDateTime {
    return ZonedDateTime.$create(this.toEpochSecond(), this.nano, zone);
  }
  atZoneSimilarLocal(zone: ZoneId): ZonedDateTime {
    return ZonedDateTime.ofLocal(this.$ldt, zone, this.$off);
  }
  toZonedDateTime(): ZonedDateTime {
    return new ZonedDateTime(this.$ldt, this.$off, this.$off);
  }
  until(end: any, unit: ChronoUnit): number {
    const e = OffsetDateTime.from(end).withOffsetSameInstant(this.$off);
    return this.$ldt.until(e.$ldt, unit);
  }
  compareTo(o: OffsetDateTime): number {
    const c = this.toInstant().compareTo(o.toInstant());
    return c !== 0 ? c : this.$ldt.compareTo(o.$ldt);
  }
  equals(o: any): boolean {
    return o instanceof OffsetDateTime && this.$ldt.equals(o.$ldt) && this.$off.equals(o.$off);
  }
  hashCode(): number {
    return this.$ldt.hashCode() ^ this.$off.hashCode();
  }
  toString(): string {
    return this.$ldt.toString() + this.$off.toString();
  }
}
OffsetDateTime.MIN = new OffsetDateTime(LocalDateTime.MIN, ZoneOffset.MAX);
OffsetDateTime.MAX = new OffsetDateTime(LocalDateTime.MAX, ZoneOffset.MIN);

// ---------- Duration (java.time) ----------

export class Duration {
  constructor(
    readonly $sec: number,
    readonly $nano: number,
  ) {}

  static ofSeconds(s: number, nanoAdjustment: number = 0): Duration {
    return new Duration(s + floorDiv(nanoAdjustment, 1e9), floorMod(nanoAdjustment, 1e9));
  }
  static ofDays(d: number): Duration {
    return Duration.ofSeconds(d * 86400);
  }
  static ofHours(h: number): Duration {
    return Duration.ofSeconds(h * 3600);
  }
  static ofMinutes(m: number): Duration {
    return Duration.ofSeconds(m * 60);
  }
  static ofMillis(ms: number): Duration {
    return new Duration(floorDiv(ms, 1000), floorMod(ms, 1000) * 1e6);
  }
  static ofNanos(n: number): Duration {
    return new Duration(floorDiv(n, 1e9), floorMod(n, 1e9));
  }
  static of(amount: number, unit: ChronoUnit): Duration {
    return Duration.ZERO.plus(amount, unit);
  }
  static between(a: any, b: any): Duration {
    let secs = a.until(b, ChronoUnit.SECONDS);
    let nanos = 0;
    try {
      nanos = b.getLong(ChronoField.NANO_OF_SECOND) - a.getLong(ChronoField.NANO_OF_SECOND);
      if (secs > 0 && nanos < 0) secs++;
      else if (secs < 0 && nanos > 0) secs--;
    } catch {
      nanos = 0;
    }
    return Duration.ofSeconds(secs, nanos);
  }
  static from(amount: any): Duration {
    if (amount instanceof Duration) return amount;
    throw new DateTimeException('Unable to obtain Duration');
  }
  static parse(text: string): Duration {
    const m = /^([-+]?)P(?:([-+]?\d+)D)?(T(?:([-+]?\d+)H)?(?:([-+]?\d+)M)?(?:([-+]?\d+)(?:[.,](\d{0,9}))?S)?)?$/i.exec(text);
    if (!m || (m[3] === 'T') || (!m[2] && !m[3])) throw new DateTimeException(`Text cannot be parsed to a Duration`);
    const neg = m[1] === '-';
    const days = m[2] ? +m[2] : 0;
    const hours = m[4] ? +m[4] : 0;
    const mins = m[5] ? +m[5] : 0;
    const secs = m[6] ? +m[6] : 0;
    let nanos = m[7] ? +(m[7] + '000000000').slice(0, 9) : 0;
    if (m[6] && m[6].startsWith('-')) nanos = -nanos;
    const d = Duration.ofSeconds(days * 86400 + hours * 3600 + mins * 60 + secs, nanos);
    return neg ? d.negated() : d;
  }
  declare static ZERO: Duration;

  get seconds(): number {
    return this.$sec;
  }
  getSeconds(): number {
    return this.$sec;
  }
  get nano(): number {
    return this.$nano;
  }
  getNano(): number {
    return this.$nano;
  }
  get units(): ChronoUnit[] {
    return [ChronoUnit.SECONDS, ChronoUnit.NANOS];
  }
  getUnits(): ChronoUnit[] {
    return this.units;
  }
  get(unit: ChronoUnit): number {
    if (unit === ChronoUnit.SECONDS) return this.$sec;
    if (unit === ChronoUnit.NANOS) return this.$nano;
    return unsupportedUnit(unit);
  }
  toDays(): number {
    return Math.trunc(this.$sec / 86400);
  }
  toHours(): number {
    return Math.trunc(this.$sec / 3600);
  }
  toMinutes(): number {
    return Math.trunc(this.$sec / 60);
  }
  toSeconds(): number {
    return this.$sec;
  }
  toMillis(): number {
    return this.$sec * 1000 + Math.floor(this.$nano / 1e6);
  }
  toNanos(): number {
    return this.$sec * 1e9 + this.$nano;
  }
  toDaysPart(): number {
    return this.toDays();
  }
  toHoursPart(): number {
    return this.toHours() % 24;
  }
  toMinutesPart(): number {
    return this.toMinutes() % 60;
  }
  toSecondsPart(): number {
    return this.$sec % 60;
  }
  toMillisPart(): number {
    return Math.floor(this.$nano / 1e6);
  }
  toNanosPart(): number {
    return this.$nano;
  }
  $plus(secs: number, nanos: number): Duration {
    if (secs === 0 && nanos === 0) return this;
    return Duration.ofSeconds(this.$sec + secs, this.$nano + nanos);
  }
  plus(a: any, unit?: ChronoUnit): Duration {
    if (unit === undefined) return this.$plus((a as Duration).$sec, (a as Duration).$nano);
    if (unit === ChronoUnit.DAYS) return this.$plus(a * 86400, 0);
    if (unit.isDurationEstimated()) throw new UnsupportedTemporalTypeException('Unit must not have an estimated duration');
    switch (unit) {
      case ChronoUnit.NANOS:
        return this.$plus(0, a);
      case ChronoUnit.MICROS:
        return this.$plus(floorDiv(a, 1e6), floorMod(a, 1e6) * 1000);
      case ChronoUnit.MILLIS:
        return this.$plus(floorDiv(a, 1000), floorMod(a, 1000) * 1e6);
      default:
        return this.$plus(a * unit.seconds, 0);
    }
  }
  minus(a: any, unit?: ChronoUnit): Duration {
    if (unit === undefined) return this.$plus(-(a as Duration).$sec, -(a as Duration).$nano);
    return this.plus(-a, unit);
  }
  plusDays(n: number): Duration {
    return this.$plus(n * 86400, 0);
  }
  plusHours(n: number): Duration {
    return this.$plus(n * 3600, 0);
  }
  plusMinutes(n: number): Duration {
    return this.$plus(n * 60, 0);
  }
  plusSeconds(n: number): Duration {
    return this.$plus(n, 0);
  }
  plusMillis(n: number): Duration {
    return this.plus(n, ChronoUnit.MILLIS);
  }
  plusNanos(n: number): Duration {
    return this.$plus(0, n);
  }
  minusDays(n: number): Duration {
    return this.plusDays(-n);
  }
  minusHours(n: number): Duration {
    return this.plusHours(-n);
  }
  minusMinutes(n: number): Duration {
    return this.plusMinutes(-n);
  }
  minusSeconds(n: number): Duration {
    return this.plusSeconds(-n);
  }
  minusMillis(n: number): Duration {
    return this.plusMillis(-n);
  }
  minusNanos(n: number): Duration {
    return this.plusNanos(-n);
  }
  multipliedBy(k: number): Duration {
    if (k === 1) return this;
    const sec = this.$sec * k;
    const nanos = this.$nano * k;
    return Duration.ofSeconds(sec, nanos);
  }
  dividedBy(d: any): any {
    if (d instanceof Duration) {
      const a = this.$sec * 1e9 + this.$nano;
      const b = d.$sec * 1e9 + d.$nano;
      if (b === 0) throw new ArithmeticException('Cannot divide by zero');
      return Math.trunc(a / b);
    }
    if (d === 0) throw new ArithmeticException('Cannot divide by zero');
    if (d === 1) return this;
    const total = this.$sec * 1e9 + this.$nano;
    return Duration.ofNanos(Math.trunc(total / d));
  }
  negated(): Duration {
    return Duration.ofSeconds(-this.$sec, -this.$nano);
  }
  abs(): Duration {
    return this.$sec < 0 ? this.negated() : this;
  }
  withSeconds(s: number): Duration {
    return new Duration(s, this.$nano);
  }
  withNanos(n: number): Duration {
    ChronoField.NANO_OF_SECOND.checkValidValue(n);
    return new Duration(this.$sec, n);
  }
  addTo(t: any): any {
    let r = t;
    if (this.$sec !== 0) r = r.plus(this.$sec, ChronoUnit.SECONDS);
    if (this.$nano !== 0) r = r.plus(this.$nano, ChronoUnit.NANOS);
    return r;
  }
  subtractFrom(t: any): any {
    let r = t;
    if (this.$sec !== 0) r = r.minus(this.$sec, ChronoUnit.SECONDS);
    if (this.$nano !== 0) r = r.minus(this.$nano, ChronoUnit.NANOS);
    return r;
  }
  compareTo(o: Duration): number {
    return this.$sec !== o.$sec ? (this.$sec < o.$sec ? -1 : 1) : this.$nano - o.$nano;
  }
  equals(o: any): boolean {
    return o instanceof Duration && o.$sec === this.$sec && o.$nano === this.$nano;
  }
  hashCode(): number {
    return (this.$sec | 0) + 51 * this.$nano;
  }
  toString(): string {
    if (this.$sec === 0 && this.$nano === 0) return 'PT0S';
    let eff = this.$sec;
    if (this.$sec < 0 && this.$nano > 0) eff++;
    const hours = Math.trunc(eff / 3600);
    const minutes = Math.trunc((eff % 3600) / 60);
    const secs = eff % 60;
    let buf = 'PT';
    if (hours !== 0) buf += hours + 'H';
    if (minutes !== 0) buf += minutes + 'M';
    if (secs === 0 && this.$nano === 0 && buf.length > 2) return buf;
    if (this.$sec < 0 && this.$nano > 0) buf += secs === 0 ? '-0' : String(secs);
    else buf += String(secs);
    if (this.$nano > 0) {
      let frac = String(this.$sec < 0 ? 2e9 - this.$nano : this.$nano + 1e9);
      frac = frac.replace(/0+$/, '');
      buf += '.' + frac.slice(1);
    }
    return buf + 'S';
  }
}
boolProp(Duration, 'isNegative', (d: Duration) => d.$sec < 0);
boolProp(Duration, 'isZero', (d: Duration) => d.$sec === 0 && d.$nano === 0);
boolProp(Duration, 'isPositive', (d: Duration) => d.$sec > 0 || (d.$sec === 0 && d.$nano > 0));
Duration.ZERO = new Duration(0, 0);
ChronoUnit.$durationFactory = (s, n) => Duration.ofSeconds(s, n);

// ---------- Year ----------

export class Year {
  constructor(readonly value: number) {}
  static of(y: number): Year {
    ChronoField.YEAR.checkValidValue(y);
    return new Year(y);
  }
  static now(zone?: any): Year {
    return new Year(LocalDate.now(zone).year);
  }
  static isLeap(y: number): boolean {
    return isLeap(y);
  }
  static parse(text: string): Year {
    if (!/^[+-]?\d{4,10}$/.test(text)) throw new DateTimeException(`Text '${text}' could not be parsed at index 0`);
    return Year.of(parseInt(text, 10));
  }
  static from(t: any): Year {
    if (t instanceof Year) return t;
    return Year.of(t.get(ChronoField.YEAR));
  }
  getValue(): number {
    return this.value;
  }
  length(): number {
    return isLeap(this.value) ? 366 : 365;
  }
  atDay(doy: number): LocalDate {
    return LocalDate.ofYearDay(this.value, doy);
  }
  atMonthDay(md: any): LocalDate {
    return LocalDate.of(this.value, md.month, md.dayOfMonth);
  }
  plusYears(n: number): Year {
    return Year.of(this.value + n);
  }
  minusYears(n: number): Year {
    return Year.of(this.value - n);
  }
  get(f: ChronoField): number {
    const v = dateField(this.value, 1, 1, f);
    if (f !== ChronoField.YEAR && f !== ChronoField.YEAR_OF_ERA && f !== ChronoField.ERA) unsupportedField(f);
    return v!;
  }
  getLong(f: ChronoField): number {
    return this.get(f);
  }
  isBefore(o: Year): boolean {
    return this.value < o.value;
  }
  isAfter(o: Year): boolean {
    return this.value > o.value;
  }
  compareTo(o: Year): number {
    return this.value - o.value;
  }
  equals(o: any): boolean {
    return o instanceof Year && o.value === this.value;
  }
  hashCode(): number {
    return this.value;
  }
  toString(): string {
    return String(this.value);
  }
}
boolProp(Year, 'isLeap', (y: Year) => isLeap(y.value));

// ---------- WeekFields ----------

/** A localized week-based TemporalField (WeekFields.dayOfWeek(), weekOfYear(), ...). */
export class WeekField {
  constructor(
    readonly displayName: string,
    readonly $getFrom: (t: any) => number,
  ) {}
  getFrom(t: any): number {
    return this.$getFrom(t);
  }
  isDateBased(): boolean {
    return true;
  }
  isTimeBased(): boolean {
    return false;
  }
  toString(): string {
    return this.displayName;
  }
}

function epochDayFrom(t: any): number {
  return t.getLong(ChronoField.EPOCH_DAY);
}

export class WeekFields {
  private readonly fields: Record<string, WeekField>;
  constructor(
    readonly firstDayOfWeek: DayOfWeek,
    readonly minimalDaysInFirstWeek: number,
  ) {
    const sow = firstDayOfWeek.value;
    const md = minimalDaysInFirstWeek;
    const tag = `[${firstDayOfWeek.name},${md}]`;
    this.fields = {
      dayOfWeek: new WeekField(`DayOfWeek${tag}`, (t) => localizedDow(epochDayFrom(t), sow)),
      weekOfMonth: new WeekField(`WeekOfMonth${tag}`, (t) => weekOfMonth(epochDayFrom(t), sow, md)),
      weekOfYear: new WeekField(`WeekOfYear${tag}`, (t) => weekOfYearPlain(epochDayFrom(t), sow, md)),
      weekOfWeekBasedYear: new WeekField(`WeekOfWeekBasedYear${tag}`, (t) => weekOfWeekBasedYear(epochDayFrom(t), sow, md)),
      weekBasedYear: new WeekField(`WeekBasedYear${tag}`, (t) => weekBasedYear(epochDayFrom(t), sow, md)),
    };
  }
  static of(a: any, b?: number): WeekFields {
    if (a instanceof DayOfWeek) return new WeekFields(a, b ?? 1);
    const loc = a as Locale;
    // Same week rules as java.util.Calendar for the locale.
    const r = weekRulesFor(loc.language, loc.country);
    return new WeekFields(DayOfWeek.of(isoFromCalendarDow(r.firstDayOfWeek)), r.minimalDays);
  }
  declare static ISO: WeekFields;
  declare static SUNDAY_START: WeekFields;
  getFirstDayOfWeek(): DayOfWeek {
    return this.firstDayOfWeek;
  }
  getMinimalDaysInFirstWeek(): number {
    return this.minimalDaysInFirstWeek;
  }
  dayOfWeek(): WeekField {
    return this.fields.dayOfWeek;
  }
  weekOfMonth(): WeekField {
    return this.fields.weekOfMonth;
  }
  weekOfYear(): WeekField {
    return this.fields.weekOfYear;
  }
  weekOfWeekBasedYear(): WeekField {
    return this.fields.weekOfWeekBasedYear;
  }
  weekBasedYear(): WeekField {
    return this.fields.weekBasedYear;
  }
  equals(o: any): boolean {
    return o instanceof WeekFields && o.firstDayOfWeek === this.firstDayOfWeek && o.minimalDaysInFirstWeek === this.minimalDaysInFirstWeek;
  }
  toString(): string {
    return `WeekFields[${this.firstDayOfWeek},${this.minimalDaysInFirstWeek}]`;
  }
}
WeekFields.ISO = new WeekFields(DayOfWeek.MONDAY, 4);
WeekFields.SUNDAY_START = new WeekFields(DayOfWeek.SUNDAY, 1);

export { civil, epochDayOf, TemporalBase };

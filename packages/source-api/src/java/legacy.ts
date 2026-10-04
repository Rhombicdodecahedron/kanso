// java.util.TimeZone, java.util.Date, java.util.Calendar/GregorianCalendar, java.text.SimpleDateFormat
// and java.text.ParsePosition. Field resolution follows the JDK's GregorianCalendar.computeTime /
// selectFields; parsing follows SimpleDateFormat.subParse.

import { IllegalArgumentException, NullPointerException, ParseException, stringHash } from '../kotlin/core';
import { Locale, symbolsFor } from './locale';
import { Instant, ZoneId, ZoneOffset, ZoneRegion } from './temporal';
import {
  civil,
  dayOfYear,
  epochDayOf,
  floorDiv,
  floorMod,
  isDigit,
  isLeap,
  isoDow,
  isoFromCalendarDow,
  MS_PER_DAY,
  monthLength,
  pad,
  weekOfMonth,
  weekOfWeekBasedYear,
} from './util';
import { abbreviationOffset, gmtId, longZoneName, setSystemZoneId, shortZoneName, systemZoneId, ZONE_ABBREVIATIONS } from './zone';

// ---------- TimeZone ----------

export class TimeZone {
  static SHORT = 0;
  static LONG = 1;

  constructor(
    private $idValue: string,
    readonly $zone: ZoneId,
  ) {}

  get id(): string {
    return this.$idValue;
  }
  set id(v: string) {
    this.$idValue = v;
  }
  getID(): string {
    return this.$idValue;
  }
  setID(v: string): void {
    this.$idValue = v;
  }
  /** Offset from UTC in milliseconds at the given instant. */
  getOffset(ms: number): number {
    return this.$zone.$offsetAt(ms) * 1000;
  }
  get rawOffset(): number {
    return this.getRawOffset();
  }
  getRawOffset(): number {
    const y = new Date().getUTCFullYear();
    const jan = this.$zone.$offsetAt(Date.UTC(y, 0, 1));
    const jul = this.$zone.$offsetAt(Date.UTC(y, 6, 1));
    return Math.min(jan, jul) * 1000;
  }
  get dstSavings(): number {
    return this.getDSTSavings();
  }
  getDSTSavings(): number {
    const y = new Date().getUTCFullYear();
    const jan = this.$zone.$offsetAt(Date.UTC(y, 0, 1));
    const jul = this.$zone.$offsetAt(Date.UTC(y, 6, 1));
    return Math.abs(jan - jul) * 1000;
  }
  useDaylightTime(): boolean {
    return this.getDSTSavings() !== 0;
  }
  observesDaylightTime(): boolean {
    return this.useDaylightTime();
  }
  inDaylightTime(date: JDate): boolean {
    return this.getOffset(date.getTime()) !== this.getRawOffset();
  }
  get displayName(): string {
    return this.getDisplayName();
  }
  getDisplayName(a?: any, b?: any, c?: any): string {
    let daylight = false;
    let style = TimeZone.LONG;
    let locale: Locale = Locale.getDefault();
    if (a instanceof Locale) locale = a;
    else if (typeof a === 'boolean') {
      daylight = a;
      style = b ?? TimeZone.LONG;
      if (c instanceof Locale) locale = c;
    }
    const iana = (this.$zone as ZoneRegion).$iana;
    if (this.$idValue === 'UTC') return style === TimeZone.SHORT ? 'UTC' : 'Coordinated Universal Time';
    if (this.$idValue === 'GMT') return style === TimeZone.SHORT ? 'GMT' : 'Greenwich Mean Time';
    if (!iana) return this.$zone instanceof ZoneOffset || this.$idValue.startsWith('GMT') ? gmtId(this.$zone.$offsetAt(0)) : this.$idValue;
    // Pick an instant in (or out of) daylight time so the right name variant comes back.
    const y = new Date().getUTCFullYear();
    const jan = Date.UTC(y, 0, 15);
    const jul = Date.UTC(y, 6, 15);
    const janOff = this.$zone.$offsetAt(jan);
    const julOff = this.$zone.$offsetAt(jul);
    const std = janOff <= julOff ? jan : jul;
    const dst = janOff <= julOff ? jul : jan;
    const ms = daylight && janOff !== julOff ? dst : std;
    return style === TimeZone.SHORT ? shortZoneName(iana, ms, locale.$intlTag) : longZoneName(iana, ms, locale.$intlTag);
  }
  toZoneId(): ZoneId {
    return this.$zone instanceof ZoneRegion && !this.$zone.$iana && this.$idValue.startsWith('GMT') && this.$idValue.length > 3
      ? ZoneId.of(this.$idValue)
      : this.$zone;
  }
  hasSameRules(o: TimeZone): boolean {
    return o instanceof TimeZone && o.$zone.equals(this.$zone);
  }
  clone(): TimeZone {
    return new TimeZone(this.$idValue, this.$zone);
  }
  equals(o: any): boolean {
    return o instanceof TimeZone && o.$idValue === this.$idValue;
  }
  hashCode(): number {
    return stringHash(this.$idValue);
  }
  toString(): string {
    return `sun.util.calendar.ZoneInfo[id="${this.$idValue}",offset=${this.getRawOffset()}]`;
  }

  static getTimeZone(id: any): TimeZone {
    if (id instanceof ZoneId) {
      if (id instanceof ZoneOffset) return id.totalSeconds === 0 ? new TimeZone('UTC', ZoneId.of('UTC')) : new TimeZone(gmtId(id.totalSeconds), id);
      const zid = id.id;
      return TimeZone.getTimeZone(zid.startsWith('UTC') || zid.startsWith('UT+') || zid.startsWith('UT-') ? zid.replace(/^UTC?/, 'GMT') : zid);
    }
    if (id === null || id === undefined) throw new NullPointerException('id');
    const s = String(id);
    if (s === 'UTC' || s === 'GMT' || s === 'UT') return new TimeZone(s, ZoneId.of(s));
    const custom = /^GMT([+-])(\d{1,2})(?::(\d{2})|(\d{2}))?$/.exec(s);
    if (custom) {
      const h = +custom[2];
      const m = +(custom[3] ?? custom[4] ?? 0);
      if (h <= 23 && m <= 59) {
        const secs = (h * 3600 + m * 60) * (custom[1] === '-' ? -1 : 1);
        const z = ZoneOffset.ofTotalSeconds(secs);
        return new TimeZone(secs === 0 ? `GMT${custom[1]}00:00` : gmtId(secs), z);
      }
      return new TimeZone('GMT', ZoneId.of('GMT'));
    }
    const short = ZoneId.SHORT_IDS.get(s);
    if (short && (s === 'EST' || s === 'MST' || s === 'HST')) return new TimeZone(s, ZoneId.of(short));
    try {
      const z = ZoneId.of(s);
      if (z instanceof ZoneOffset) return new TimeZone('GMT', ZoneId.of('GMT')); // "+07:00" is not a TimeZone id
      return new TimeZone(s, z);
    } catch {
      if (short) {
        try {
          return new TimeZone(s, ZoneId.of(short));
        } catch {
          /* fall through */
        }
      }
      return new TimeZone('GMT', ZoneId.of('GMT'));
    }
  }

  private static $default: TimeZone | null = null;

  static getDefault(): TimeZone {
    if (!TimeZone.$default) TimeZone.$default = TimeZone.getTimeZone(systemZoneId());
    return TimeZone.$default.clone();
  }
  static setDefault(tz: TimeZone | null): void {
    TimeZone.$default = tz ? tz.clone() : null;
    setSystemZoneId(tz ? (tz.$zone instanceof ZoneRegion && tz.$zone.$iana ? tz.$zone.$iana : tz.toZoneId().id) : null);
  }
  static getAvailableIDs(): string[] {
    return [...ZoneId.getAvailableZoneIds()];
  }
}

function defaultTz(): TimeZone {
  return TimeZone.getDefault();
}

// ---------- Date ----------

export class JDate {
  $ms: number;

  constructor(a?: any, b?: number, c?: number, d: number = 0, e: number = 0, f: number = 0) {
    if (a === undefined) this.$ms = Date.now();
    else if (b === undefined) {
      if (typeof a === 'string') {
        const p = Date.parse(a);
        if (Number.isNaN(p)) throw new IllegalArgumentException();
        this.$ms = p;
      } else {
        this.$ms = Number(a);
      }
    } else {
      // Deprecated Date(year - 1900, month, date[, hrs, min[, sec]]) in the default zone.
      const cal = Calendar.getInstance();
      cal.clear();
      cal.set(a + 1900, b, c ?? 1, d, e, f);
      this.$ms = cal.getTimeInMillis();
    }
  }

  get time(): number {
    return this.$ms;
  }
  set time(v: number) {
    this.$ms = v;
  }
  getTime(): number {
    return this.$ms;
  }
  setTime(v: number): void {
    this.$ms = v;
  }
  before(o: JDate): boolean {
    return this.$ms < o.$ms;
  }
  after(o: JDate): boolean {
    return this.$ms > o.$ms;
  }
  compareTo(o: JDate): number {
    return this.$ms < o.$ms ? -1 : this.$ms > o.$ms ? 1 : 0;
  }
  equals(o: any): boolean {
    return o instanceof JDate && o.$ms === this.$ms;
  }
  hashCode(): number {
    const hi = Math.floor(this.$ms / 2 ** 32);
    return (this.$ms | 0) ^ (hi | 0);
  }
  toInstant(): Instant {
    return Instant.ofEpochMilli(this.$ms);
  }
  clone(): JDate {
    return new JDate(this.$ms);
  }
  private $cal(): Calendar {
    const c = Calendar.getInstance();
    c.setTimeInMillis(this.$ms);
    return c;
  }
  getYear(): number {
    return this.$cal().get(Calendar.YEAR) - 1900;
  }
  getMonth(): number {
    return this.$cal().get(Calendar.MONTH);
  }
  getDate(): number {
    return this.$cal().get(Calendar.DAY_OF_MONTH);
  }
  getDay(): number {
    return this.$cal().get(Calendar.DAY_OF_WEEK) - 1;
  }
  getHours(): number {
    return this.$cal().get(Calendar.HOUR_OF_DAY);
  }
  getMinutes(): number {
    return this.$cal().get(Calendar.MINUTE);
  }
  getSeconds(): number {
    return this.$cal().get(Calendar.SECOND);
  }
  getTimezoneOffset(): number {
    return -defaultTz().getOffset(this.$ms) / 60000;
  }
  toString(): string {
    return new SimpleDateFormat('EEE MMM dd HH:mm:ss zzz yyyy', Locale.US).format(this);
  }
  static from(instant: Instant): JDate {
    return new JDate(instant.toEpochMilli());
  }
}

// ---------- Calendar ----------

const FIELD_NAMES = [
  'ERA',
  'YEAR',
  'MONTH',
  'WEEK_OF_YEAR',
  'WEEK_OF_MONTH',
  'DAY_OF_MONTH',
  'DAY_OF_YEAR',
  'DAY_OF_WEEK',
  'DAY_OF_WEEK_IN_MONTH',
  'AM_PM',
  'HOUR',
  'HOUR_OF_DAY',
  'MINUTE',
  'SECOND',
  'MILLISECOND',
  'ZONE_OFFSET',
  'DST_OFFSET',
];
const FIELD_COUNT = 17;
const UNSET = 0;
const COMPUTED = 1;
const MIN_USER_STAMP = 2;

const ERA = 0;
const YEAR = 1;
const MONTH = 2;
const WEEK_OF_YEAR = 3;
const WEEK_OF_MONTH = 4;
const DAY_OF_MONTH = 5;
const DAY_OF_YEAR = 6;
const DAY_OF_WEEK = 7;
const DAY_OF_WEEK_IN_MONTH = 8;
const AM_PM = 9;
const HOUR = 10;
const HOUR_OF_DAY = 11;
const MINUTE = 12;
const SECOND = 13;
const MILLISECOND = 14;
const ZONE_OFFSET = 15;
const DST_OFFSET = 16;

const MIN_VALUES = [0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, -13 * 3600000, 0];
const LEAST_MAX_VALUES = [1, 292269054, 11, 52, 4, 28, 365, 7, 4, 1, 11, 23, 59, 59, 999, 14 * 3600000, 20 * 60000];
const MAX_VALUES = [1, 292278994, 11, 53, 6, 31, 366, 7, 6, 1, 11, 23, 59, 59, 999, 14 * 3600000, 2 * 3600000];

/** Calendar day-of-week (1 = Sunday) of an epoch day. */
function calDow(epochDay: number): number {
  return (isoDow(epochDay) % 7) + 1;
}
function dowOnOrBefore(epochDay: number, dow: number): number {
  return epochDay - floorMod(calDow(epochDay) - dow, 7);
}
function aggregateStamp(a: number, b: number): number {
  if (a === UNSET || b === UNSET) return UNSET;
  return Math.max(a, b);
}

export class Calendar {
  static ERA = ERA;
  static YEAR = YEAR;
  static MONTH = MONTH;
  static WEEK_OF_YEAR = WEEK_OF_YEAR;
  static WEEK_OF_MONTH = WEEK_OF_MONTH;
  static DATE = DAY_OF_MONTH;
  static DAY_OF_MONTH = DAY_OF_MONTH;
  static DAY_OF_YEAR = DAY_OF_YEAR;
  static DAY_OF_WEEK = DAY_OF_WEEK;
  static DAY_OF_WEEK_IN_MONTH = DAY_OF_WEEK_IN_MONTH;
  static AM_PM = AM_PM;
  static HOUR = HOUR;
  static HOUR_OF_DAY = HOUR_OF_DAY;
  static MINUTE = MINUTE;
  static SECOND = SECOND;
  static MILLISECOND = MILLISECOND;
  static ZONE_OFFSET = ZONE_OFFSET;
  static DST_OFFSET = DST_OFFSET;
  static FIELD_COUNT = FIELD_COUNT;
  static SUNDAY = 1;
  static MONDAY = 2;
  static TUESDAY = 3;
  static WEDNESDAY = 4;
  static THURSDAY = 5;
  static FRIDAY = 6;
  static SATURDAY = 7;
  static JANUARY = 0;
  static FEBRUARY = 1;
  static MARCH = 2;
  static APRIL = 3;
  static MAY = 4;
  static JUNE = 5;
  static JULY = 6;
  static AUGUST = 7;
  static SEPTEMBER = 8;
  static OCTOBER = 9;
  static NOVEMBER = 10;
  static DECEMBER = 11;
  static UNDECIMBER = 12;
  static AM = 0;
  static PM = 1;
  static ALL_STYLES = 0;
  static SHORT = 1;
  static LONG = 2;
  static NARROW_FORMAT = 4;
  static NARROW_STANDALONE = 0x8004;
  static SHORT_FORMAT = 1;
  static LONG_FORMAT = 2;
  static SHORT_STANDALONE = 0x8001;
  static LONG_STANDALONE = 0x8002;

  protected $fields: number[] = new Array(FIELD_COUNT).fill(0);
  protected $stamp: number[] = new Array(FIELD_COUNT).fill(UNSET);
  protected $nextStamp = MIN_USER_STAMP;
  protected $time = 0;
  protected $isTimeSet = false;
  protected $areFieldsSet = false;
  $tz: TimeZone;
  $locale: Locale;
  $firstDayOfWeek: number;
  $minimalDays: number;
  $lenient = true;

  constructor(zone?: TimeZone, locale?: Locale) {
    this.$tz = zone ?? defaultTz();
    this.$locale = locale ?? Locale.getDefault();
    const r = symbolsFor(this.$locale).weekRules;
    this.$firstDayOfWeek = r.firstDayOfWeek;
    this.$minimalDays = r.minimalDays;
  }

  static getInstance(a?: any, b?: any): Calendar {
    let tz: TimeZone | undefined;
    let loc: Locale | undefined;
    for (const x of [a, b]) {
      if (x instanceof TimeZone) tz = x;
      else if (x instanceof Locale) loc = x;
    }
    const c = new GregorianCalendar(tz ?? defaultTz(), loc ?? Locale.getDefault());
    c.setTimeInMillis(Date.now());
    return c;
  }
  static getAvailableLocales(): Locale[] {
    return Locale.getAvailableLocales();
  }

  // ----- time -----

  getTimeInMillis(): number {
    if (!this.$isTimeSet) this.updateTime();
    return this.$time;
  }
  setTimeInMillis(ms: number): void {
    this.$time = ms;
    this.$isTimeSet = true;
    this.computeFields();
    this.$areFieldsSet = true;
  }
  get timeInMillis(): number {
    return this.getTimeInMillis();
  }
  set timeInMillis(v: number) {
    this.setTimeInMillis(v);
  }
  getTime(): JDate {
    return new JDate(this.getTimeInMillis());
  }
  setTime(d: JDate): void {
    this.setTimeInMillis(d.getTime());
  }
  get time(): JDate {
    return this.getTime();
  }
  set time(d: JDate) {
    this.setTime(d);
  }
  toInstant(): Instant {
    return Instant.ofEpochMilli(this.getTimeInMillis());
  }

  getTimeZone(): TimeZone {
    return this.$tz;
  }
  setTimeZone(tz: TimeZone): void {
    this.complete();
    this.$tz = tz;
    this.$areFieldsSet = false;
    this.computeFields();
    this.$areFieldsSet = true;
  }
  get timeZone(): TimeZone {
    return this.getTimeZone();
  }
  set timeZone(tz: TimeZone) {
    this.setTimeZone(tz);
  }
  getFirstDayOfWeek(): number {
    return this.$firstDayOfWeek;
  }
  setFirstDayOfWeek(v: number): void {
    this.$firstDayOfWeek = v;
    this.invalidateWeekFields();
  }
  get firstDayOfWeek(): number {
    return this.$firstDayOfWeek;
  }
  set firstDayOfWeek(v: number) {
    this.setFirstDayOfWeek(v);
  }
  getMinimalDaysInFirstWeek(): number {
    return this.$minimalDays;
  }
  setMinimalDaysInFirstWeek(v: number): void {
    this.$minimalDays = v;
    this.invalidateWeekFields();
  }
  get minimalDaysInFirstWeek(): number {
    return this.$minimalDays;
  }
  set minimalDaysInFirstWeek(v: number) {
    this.setMinimalDaysInFirstWeek(v);
  }
  setLenient(v: boolean): void {
    this.$lenient = v;
  }
  get isLenient(): boolean {
    return this.$lenient;
  }
  set isLenient(v: boolean) {
    this.$lenient = v;
  }
  isLenient$call(): boolean {
    return this.$lenient;
  }
  private invalidateWeekFields(): void {
    if (this.$isTimeSet && this.$areFieldsSet) this.computeFields();
  }

  // ----- fields -----

  get(field: number): number {
    this.complete();
    return this.$fields[field];
  }
  set(a: number, b: number, c?: number, d?: number, e?: number, f?: number): void {
    if (c === undefined) {
      this.$fields[a] = b;
      this.$stamp[a] = this.$nextStamp++;
      this.$isTimeSet = false;
      this.$areFieldsSet = false;
      return;
    }
    this.set(YEAR, a);
    this.set(MONTH, b);
    this.set(DAY_OF_MONTH, c);
    if (d !== undefined) {
      this.set(HOUR_OF_DAY, d);
      this.set(MINUTE, e ?? 0);
      if (f !== undefined) this.set(SECOND, f);
    }
  }
  clear(field?: number): void {
    if (field === undefined) {
      this.$fields.fill(0);
      this.$stamp.fill(UNSET);
    } else {
      this.$fields[field] = 0;
      this.$stamp[field] = UNSET;
    }
    this.$isTimeSet = false;
    this.$areFieldsSet = false;
  }
  isSet(field: number): boolean {
    return this.$stamp[field] !== UNSET;
  }

  protected complete(): void {
    if (!this.$isTimeSet) this.updateTime();
    if (!this.$areFieldsSet) {
      this.computeFields();
      this.$areFieldsSet = true;
    }
  }

  private updateTime(): void {
    this.computeTime();
    this.$isTimeSet = true;
  }

  /** Local wall-clock fields of an instant, plus offsets (ms). */
  protected computeFields(): void {
    const off = this.$tz.getOffset(this.$time);
    const raw = this.$tz.getRawOffset();
    const local = this.$time + off;
    const day = floorDiv(local, MS_PER_DAY);
    let tod = floorMod(local, MS_PER_DAY);
    const [y, m, d] = civil(day);
    const f = this.$fields;
    f[ERA] = y > 0 ? 1 : 0;
    f[YEAR] = y > 0 ? y : 1 - y;
    f[MONTH] = m - 1;
    f[DAY_OF_MONTH] = d;
    f[DAY_OF_WEEK] = calDow(day);
    f[DAY_OF_YEAR] = dayOfYear(y, m, d);
    const sow = isoFromCalendarDow(this.$firstDayOfWeek);
    f[WEEK_OF_YEAR] = weekOfWeekBasedYear(day, sow, this.$minimalDays);
    f[WEEK_OF_MONTH] = weekOfMonth(day, sow, this.$minimalDays);
    f[DAY_OF_WEEK_IN_MONTH] = Math.floor((d - 1) / 7) + 1;
    f[MILLISECOND] = tod % 1000;
    tod = Math.floor(tod / 1000);
    f[SECOND] = tod % 60;
    tod = Math.floor(tod / 60);
    f[MINUTE] = tod % 60;
    const h = Math.floor(tod / 60);
    f[HOUR_OF_DAY] = h;
    f[AM_PM] = h >= 12 ? 1 : 0;
    f[HOUR] = h % 12;
    f[ZONE_OFFSET] = raw;
    f[DST_OFFSET] = off - raw;
    this.$stamp.fill(COMPUTED);
  }

  private selectFields(): Set<number> {
    const s = this.$stamp;
    const mask = new Set<number>([YEAR]);
    if (s[ERA] !== UNSET) mask.add(ERA);
    const dowStamp = s[DAY_OF_WEEK];
    const monthStamp = s[MONTH];
    let domStamp = s[DAY_OF_MONTH];
    let womStamp = aggregateStamp(s[WEEK_OF_MONTH], dowStamp);
    let dowimStamp = aggregateStamp(s[DAY_OF_WEEK_IN_MONTH], dowStamp);
    const doyStamp = s[DAY_OF_YEAR];
    let woyStamp = aggregateStamp(s[WEEK_OF_YEAR], dowStamp);
    let best = domStamp;
    if (womStamp > best) best = womStamp;
    if (dowimStamp > best) best = dowimStamp;
    if (doyStamp > best) best = doyStamp;
    if (woyStamp > best) best = woyStamp;
    if (best === UNSET) {
      womStamp = s[WEEK_OF_MONTH];
      dowimStamp = Math.max(s[DAY_OF_WEEK_IN_MONTH], dowStamp);
      woyStamp = s[WEEK_OF_YEAR];
      best = Math.max(Math.max(womStamp, dowimStamp), woyStamp);
      if (best === UNSET) best = domStamp = monthStamp;
    }
    if (best === domStamp || (best === womStamp && s[WEEK_OF_MONTH] >= s[WEEK_OF_YEAR]) || (best === dowimStamp && s[DAY_OF_WEEK_IN_MONTH] >= s[WEEK_OF_YEAR])) {
      mask.add(MONTH);
      if (best === domStamp) mask.add(DAY_OF_MONTH);
      else {
        if (dowStamp !== UNSET) mask.add(DAY_OF_WEEK);
        if (womStamp === dowimStamp) {
          if (s[WEEK_OF_MONTH] >= s[DAY_OF_WEEK_IN_MONTH]) mask.add(WEEK_OF_MONTH);
          else mask.add(DAY_OF_WEEK_IN_MONTH);
        } else if (best === womStamp) mask.add(WEEK_OF_MONTH);
        else if (s[DAY_OF_WEEK_IN_MONTH] !== UNSET) mask.add(DAY_OF_WEEK_IN_MONTH);
      }
    } else if (best === doyStamp) {
      mask.add(DAY_OF_YEAR);
    } else {
      if (dowStamp !== UNSET) mask.add(DAY_OF_WEEK);
      mask.add(WEEK_OF_YEAR);
    }
    const hodStamp = s[HOUR_OF_DAY];
    const hourStamp = aggregateStamp(s[HOUR], s[AM_PM]);
    let bestH = hourStamp > hodStamp ? hourStamp : hodStamp;
    if (bestH === UNSET) bestH = Math.max(s[HOUR], s[AM_PM]);
    if (bestH !== UNSET) {
      if (bestH === hodStamp) mask.add(HOUR_OF_DAY);
      else {
        mask.add(HOUR);
        if (s[AM_PM] !== UNSET) mask.add(AM_PM);
      }
    }
    if (s[MINUTE] !== UNSET) mask.add(MINUTE);
    if (s[SECOND] !== UNSET) mask.add(SECOND);
    if (s[MILLISECOND] !== UNSET) mask.add(MILLISECOND);
    if (s[ZONE_OFFSET] >= MIN_USER_STAMP) mask.add(ZONE_OFFSET);
    if (s[DST_OFFSET] >= MIN_USER_STAMP) mask.add(DST_OFFSET);
    return mask;
  }

  protected computeTime(): void {
    const f = this.$fields;
    const s = this.$stamp;
    const original = [...f];
    if (!this.$lenient) {
      for (let i = 0; i < FIELD_COUNT; i++) {
        if (s[i] >= MIN_USER_STAMP && (f[i] < MIN_VALUES[i] || f[i] > MAX_VALUES[i])) throw new IllegalArgumentException(FIELD_NAMES[i]);
      }
    }
    const mask = this.selectFields();
    let year = s[YEAR] !== UNSET ? f[YEAR] : 1970;
    if (mask.has(ERA) && f[ERA] === 0) year = 1 - year;
    let month = mask.has(MONTH) ? f[MONTH] : 0;
    year += floorDiv(month, 12);
    month = floorMod(month, 12);
    let fixed: number;
    if (mask.has(MONTH)) {
      fixed = epochDayOf(year, month + 1, 1);
      if (mask.has(DAY_OF_MONTH)) {
        fixed += (s[DAY_OF_MONTH] !== UNSET ? f[DAY_OF_MONTH] : 1) - 1;
      } else if (mask.has(WEEK_OF_MONTH)) {
        let fdw = dowOnOrBefore(fixed + 6, this.$firstDayOfWeek);
        if (fdw - fixed >= this.$minimalDays) fdw -= 7;
        if (mask.has(DAY_OF_WEEK)) fdw = dowOnOrBefore(fdw + 6, f[DAY_OF_WEEK]);
        fixed = fdw + 7 * (f[WEEK_OF_MONTH] - 1);
      } else {
        const dow = mask.has(DAY_OF_WEEK) ? f[DAY_OF_WEEK] : this.$firstDayOfWeek;
        const dowim = mask.has(DAY_OF_WEEK_IN_MONTH) ? f[DAY_OF_WEEK_IN_MONTH] : 1;
        if (dowim >= 0) fixed = dowOnOrBefore(fixed + 7 * dowim - 1, dow);
        else {
          const lastDate = monthLength(year, month + 1) + 7 * (dowim + 1);
          fixed = dowOnOrBefore(fixed + lastDate - 1, dow);
        }
      }
    } else {
      fixed = epochDayOf(year, 1, 1);
      if (mask.has(DAY_OF_YEAR)) {
        fixed += f[DAY_OF_YEAR] - 1;
      } else {
        let fdw = dowOnOrBefore(fixed + 6, this.$firstDayOfWeek);
        if (fdw - fixed >= this.$minimalDays) fdw -= 7;
        if (mask.has(DAY_OF_WEEK) && f[DAY_OF_WEEK] !== this.$firstDayOfWeek) fdw = dowOnOrBefore(fdw + 6, f[DAY_OF_WEEK]);
        fixed = fdw + 7 * (f[WEEK_OF_YEAR] - 1);
      }
    }
    let tod = 0;
    if (mask.has(HOUR_OF_DAY)) tod += f[HOUR_OF_DAY];
    else {
      tod += f[HOUR];
      if (mask.has(AM_PM)) tod += 12 * f[AM_PM];
    }
    tod = tod * 60 + f[MINUTE];
    tod = tod * 60 + f[SECOND];
    tod = tod * 1000 + f[MILLISECOND];
    fixed += floorDiv(tod, MS_PER_DAY);
    tod = floorMod(tod, MS_PER_DAY);
    const local = fixed * MS_PER_DAY + tod;
    let millis: number;
    if (mask.has(ZONE_OFFSET) || mask.has(DST_OFFSET)) {
      const ruleOff = this.$tz.$zone.$resolveOffset(local) * 1000;
      const raw = this.$tz.getRawOffset();
      const zo = mask.has(ZONE_OFFSET) ? f[ZONE_OFFSET] : raw;
      const dst = mask.has(DST_OFFSET) ? f[DST_OFFSET] : ruleOff - raw;
      millis = local - zo - dst;
    } else {
      millis = local - this.$tz.$zone.$resolveOffset(local) * 1000;
    }
    this.$time = millis;
    const userMask = s.map((st) => st >= MIN_USER_STAMP);
    this.computeFields();
    this.$areFieldsSet = true;
    if (!this.$lenient) {
      for (let i = 0; i < FIELD_COUNT; i++) {
        if (!userMask[i] || i === ZONE_OFFSET || i === DST_OFFSET) continue;
        if (original[i] !== this.$fields[i]) {
          const msg = FIELD_NAMES[i] + ': ' + original[i] + ' -> ' + this.$fields[i];
          // restore so later reads see what the caller set
          this.$fields = original;
          this.$isTimeSet = false;
          this.$areFieldsSet = false;
          throw new IllegalArgumentException(msg);
        }
      }
    }
  }

  add(field: number, amount: number): void {
    if (amount === 0) return;
    this.complete();
    const f = this.$fields;
    if (field === YEAR) {
      let year = f[YEAR];
      if (f[ERA] === 1) {
        year += amount;
        if (year > 0) this.set(YEAR, year);
        else {
          this.set(YEAR, 1 - year);
          this.set(ERA, 0);
        }
      } else {
        year -= amount;
        if (year > 0) this.set(YEAR, year);
        else {
          this.set(YEAR, 1 - year);
          this.set(ERA, 1);
        }
      }
      this.pinDayOfMonth();
    } else if (field === MONTH) {
      let month = f[MONTH] + amount;
      let year = f[YEAR];
      const yAmount = month >= 0 ? Math.floor(month / 12) : Math.trunc((month + 1) / 12) - 1;
      if (yAmount !== 0) {
        if (f[ERA] === 1) {
          year += yAmount;
          if (year > 0) this.set(YEAR, year);
          else {
            this.set(YEAR, 1 - year);
            this.set(ERA, 0);
          }
        } else {
          year -= yAmount;
          if (year > 0) this.set(YEAR, year);
          else {
            this.set(YEAR, 1 - year);
            this.set(ERA, 1);
          }
        }
      }
      month = floorMod(month, 12);
      this.set(MONTH, month);
      this.pinDayOfMonth();
    } else if (field === ERA) {
      const era = f[ERA] + amount;
      this.set(ERA, era < 0 ? 0 : era > 1 ? 1 : era);
    } else {
      let delta = amount;
      let timeOfDay = 0;
      switch (field) {
        case HOUR:
        case HOUR_OF_DAY:
          delta *= 3_600_000;
          break;
        case MINUTE:
          delta *= 60_000;
          break;
        case SECOND:
          delta *= 1000;
          break;
        case MILLISECOND:
          break;
        case WEEK_OF_YEAR:
        case WEEK_OF_MONTH:
        case DAY_OF_WEEK_IN_MONTH:
          delta *= 7;
          break;
        case DAY_OF_MONTH:
        case DAY_OF_YEAR:
        case DAY_OF_WEEK:
          break;
        case AM_PM:
          delta = Math.trunc(amount / 2);
          timeOfDay = 12 * (amount % 2);
          break;
        default:
          throw new IllegalArgumentException();
      }
      if (field >= HOUR) {
        this.setTimeInMillis(this.$time + delta);
        return;
      }
      let fd = this.currentFixedDate();
      timeOfDay += f[HOUR_OF_DAY];
      timeOfDay = timeOfDay * 60 + f[MINUTE];
      timeOfDay = timeOfDay * 60 + f[SECOND];
      timeOfDay = timeOfDay * 1000 + f[MILLISECOND];
      if (timeOfDay >= MS_PER_DAY) {
        fd++;
        timeOfDay -= MS_PER_DAY;
      } else if (timeOfDay < 0) {
        fd--;
        timeOfDay += MS_PER_DAY;
      }
      fd += delta;
      let zoneOffset = f[ZONE_OFFSET] + f[DST_OFFSET];
      this.setTimeInMillis(fd * MS_PER_DAY + timeOfDay - zoneOffset);
      zoneOffset -= this.$fields[ZONE_OFFSET] + this.$fields[DST_OFFSET];
      if (zoneOffset !== 0) {
        this.setTimeInMillis(this.$time + zoneOffset);
        if (this.currentFixedDate() !== fd) this.setTimeInMillis(this.$time - zoneOffset);
      }
    }
  }

  private currentFixedDate(): number {
    const f = this.$fields;
    const y = f[ERA] === 1 ? f[YEAR] : 1 - f[YEAR];
    return epochDayOf(y, f[MONTH] + 1, f[DAY_OF_MONTH]);
  }

  private pinDayOfMonth(): void {
    const f = this.$fields;
    let y = f[ERA] === 1 ? f[YEAR] : 1 - f[YEAR];
    let m = f[MONTH];
    y += floorDiv(m, 12);
    m = floorMod(m, 12);
    const len = monthLength(y, m + 1);
    if (f[DAY_OF_MONTH] > len) this.set(DAY_OF_MONTH, len);
  }

  roll(field: number, amount: any): void {
    if (typeof amount === 'boolean') amount = amount ? 1 : -1;
    if (amount === 0) return;
    this.complete();
    const f = this.$fields;
    const wrap = (v: number, min: number, max: number) => min + floorMod(v - min, max - min + 1);
    switch (field) {
      case MONTH: {
        this.set(MONTH, wrap(f[MONTH] + amount, 0, 11));
        this.pinDayOfMonth();
        return;
      }
      case DAY_OF_MONTH:
        this.set(DAY_OF_MONTH, wrap(f[DAY_OF_MONTH] + amount, 1, this.getActualMaximum(DAY_OF_MONTH)));
        return;
      case DAY_OF_YEAR:
        this.set(DAY_OF_YEAR, wrap(f[DAY_OF_YEAR] + amount, 1, this.getActualMaximum(DAY_OF_YEAR)));
        return;
      case HOUR_OF_DAY:
        this.set(HOUR_OF_DAY, wrap(f[HOUR_OF_DAY] + amount, 0, 23));
        return;
      case HOUR:
        this.set(HOUR, wrap(f[HOUR] + amount, 0, 11));
        return;
      case MINUTE:
      case SECOND:
        this.set(field, wrap(f[field] + amount, 0, 59));
        return;
      case MILLISECOND:
        this.set(field, wrap(f[field] + amount, 0, 999));
        return;
      case AM_PM:
        this.set(AM_PM, wrap(f[AM_PM] + amount, 0, 1));
        return;
      case DAY_OF_WEEK: {
        const cur = floorMod(f[DAY_OF_WEEK] - this.$firstDayOfWeek, 7);
        const next = floorMod(cur + amount, 7);
        this.add(DAY_OF_MONTH, next - cur);
        return;
      }
      default:
        this.add(field, amount);
    }
  }

  getActualMaximum(field: number): number {
    this.complete();
    const f = this.$fields;
    const y = f[ERA] === 1 ? f[YEAR] : 1 - f[YEAR];
    switch (field) {
      case DAY_OF_MONTH:
        return monthLength(y, f[MONTH] + 1);
      case DAY_OF_YEAR:
        return isLeap(y) ? 366 : 365;
      case WEEK_OF_YEAR: {
        const sow = isoFromCalendarDow(this.$firstDayOfWeek);
        const dec31 = epochDayOf(y, 12, 31);
        const w = weekOfWeekBasedYear(dec31, sow, this.$minimalDays);
        return w === 1 ? weekOfWeekBasedYear(dec31 - 7, sow, this.$minimalDays) : w;
      }
      case WEEK_OF_MONTH: {
        const sow = isoFromCalendarDow(this.$firstDayOfWeek);
        return weekOfMonth(epochDayOf(y, f[MONTH] + 1, monthLength(y, f[MONTH] + 1)), sow, this.$minimalDays);
      }
      case DAY_OF_WEEK_IN_MONTH:
        return Math.floor((monthLength(y, f[MONTH] + 1) - 1) / 7) + 1;
      default:
        return MAX_VALUES[field];
    }
  }
  getActualMinimum(field: number): number {
    return MIN_VALUES[field];
  }
  getMaximum(field: number): number {
    return MAX_VALUES[field];
  }
  getMinimum(field: number): number {
    return MIN_VALUES[field];
  }
  getLeastMaximum(field: number): number {
    return LEAST_MAX_VALUES[field];
  }
  getGreatestMinimum(field: number): number {
    return MIN_VALUES[field];
  }

  getDisplayName(field: number, style: number, locale: Locale): string | null {
    const s = symbolsFor(locale);
    const v = this.get(field);
    const long = (style & 3) === Calendar.LONG;
    const standalone = (style & 0x8000) !== 0;
    switch (field) {
      case MONTH:
        return long ? (standalone ? s.monthsFullStandalone : s.monthsFull)[v] : (standalone ? s.monthsShortStandalone : s.monthsShort)[v];
      case DAY_OF_WEEK:
        return (long ? s.daysFull : s.daysShort)[(v + 5) % 7];
      case AM_PM:
        return s.ampm[v];
      case ERA:
        return (long ? s.erasFull : s.erasShort)[v];
      default:
        return null;
    }
  }

  get weekYear(): number {
    this.complete();
    const sow = isoFromCalendarDow(this.$firstDayOfWeek);
    const y = this.$fields[ERA] === 1 ? this.$fields[YEAR] : 1 - this.$fields[YEAR];
    const day = epochDayOf(y, this.$fields[MONTH] + 1, this.$fields[DAY_OF_MONTH]);
    const w = weekOfWeekBasedYear(day, sow, this.$minimalDays);
    if (w === 1 && this.$fields[MONTH] === 11) return y + 1;
    if (w >= 52 && this.$fields[MONTH] === 0) return y - 1;
    return y;
  }
  getWeekYear(): number {
    return this.weekYear;
  }
  isWeekDateSupported(): boolean {
    return true;
  }

  before(o: any): boolean {
    return o instanceof Calendar && this.getTimeInMillis() < o.getTimeInMillis();
  }
  after(o: any): boolean {
    return o instanceof Calendar && this.getTimeInMillis() > o.getTimeInMillis();
  }
  compareTo(o: Calendar): number {
    const a = this.getTimeInMillis();
    const b = o.getTimeInMillis();
    return a < b ? -1 : a > b ? 1 : 0;
  }
  equals(o: any): boolean {
    return o instanceof Calendar && o.getTimeInMillis() === this.getTimeInMillis() && o.$tz.equals(this.$tz) && o.$lenient === this.$lenient;
  }
  hashCode(): number {
    return (this.getTimeInMillis() | 0) ^ this.$tz.hashCode();
  }
  clone(): Calendar {
    const c = new GregorianCalendar(this.$tz, this.$locale);
    c.$fields = [...this.$fields];
    c.$stamp = [...this.$stamp];
    c.$nextStamp = this.$nextStamp;
    c.$time = this.$time;
    c.$isTimeSet = this.$isTimeSet;
    c.$areFieldsSet = this.$areFieldsSet;
    c.$firstDayOfWeek = this.$firstDayOfWeek;
    c.$minimalDays = this.$minimalDays;
    c.$lenient = this.$lenient;
    return c;
  }
  toString(): string {
    return `java.util.GregorianCalendar[time=${this.$isTimeSet ? this.$time : '?'},zone=${this.$tz.id}]`;
  }
}

export class GregorianCalendar extends Calendar {
  static BC = 0;
  static AD = 1;
  constructor(a?: any, b?: any, c?: any, d?: any, e?: any, f?: any) {
    if (typeof a === 'number') {
      super();
      this.clear();
      this.set(a, b, c, d ?? 0, e ?? 0, f ?? 0);
      return;
    }
    let tz: TimeZone | undefined;
    let loc: Locale | undefined;
    for (const x of [a, b]) {
      if (x instanceof TimeZone) tz = x;
      else if (x instanceof Locale) loc = x;
    }
    super(tz, loc);
    this.setTimeInMillis(Date.now());
  }
  isLeapYear(year: number): boolean {
    return isLeap(year);
  }
}

// ---------- ParsePosition ----------

export class ParsePosition {
  index: number;
  errorIndex = -1;
  constructor(index: number = 0) {
    this.index = index;
  }
  getIndex(): number {
    return this.index;
  }
  setIndex(i: number): void {
    this.index = i;
  }
  getErrorIndex(): number {
    return this.errorIndex;
  }
  setErrorIndex(i: number): void {
    this.errorIndex = i;
  }
  equals(o: any): boolean {
    return o instanceof ParsePosition && o.index === this.index && o.errorIndex === this.errorIndex;
  }
  hashCode(): number {
    return (this.errorIndex << 16) | this.index;
  }
  toString(): string {
    return `java.text.ParsePosition[index=${this.index},errorIndex=${this.errorIndex}]`;
  }
}

// ---------- SimpleDateFormat ----------

const PATTERN_CHARS = 'GyMdkHmsSEDFwWahKzZYuXL';
const P_ERA = 0;
const P_YEAR = 1;
const P_MONTH = 2;
const P_DAY_OF_MONTH = 3;
const P_HOUR_OF_DAY1 = 4;
const P_HOUR_OF_DAY0 = 5;
const P_MINUTE = 6;
const P_SECOND = 7;
const P_MILLISECOND = 8;
const P_DAY_OF_WEEK = 9;
const P_DAY_OF_YEAR = 10;
const P_DAY_OF_WEEK_IN_MONTH = 11;
const P_WEEK_OF_YEAR = 12;
const P_WEEK_OF_MONTH = 13;
const P_AM_PM = 14;
const P_HOUR1 = 15;
const P_HOUR0 = 16;
const P_ZONE_NAME = 17;
const P_ZONE_VALUE = 18;
const P_WEEK_YEAR = 19;
const P_ISO_DAY_OF_WEEK = 20;
const P_ISO_ZONE = 21;
const P_MONTH_STANDALONE = 22;

const PATTERN_TO_FIELD = [ERA, YEAR, MONTH, DAY_OF_MONTH, HOUR_OF_DAY, HOUR_OF_DAY, MINUTE, SECOND, MILLISECOND, DAY_OF_WEEK, DAY_OF_YEAR, DAY_OF_WEEK_IN_MONTH, WEEK_OF_YEAR, WEEK_OF_MONTH, AM_PM, HOUR, HOUR, ZONE_OFFSET, ZONE_OFFSET, YEAR, DAY_OF_WEEK, ZONE_OFFSET, MONTH];

type SdfEl = { lit: string } | { p: number; count: number };

function compileSdf(pattern: string): SdfEl[] {
  const out: SdfEl[] = [];
  let lit = '';
  let i = 0;
  let inQuote = false;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "'") {
      if (i + 1 < pattern.length && pattern[i + 1] === "'") {
        lit += "'";
        i += 2;
        continue;
      }
      inQuote = !inQuote;
      i++;
      continue;
    }
    if (inQuote) {
      lit += c;
      i++;
      continue;
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
      const p = PATTERN_CHARS.indexOf(c);
      if (p < 0) throw new IllegalArgumentException(`Illegal pattern character '${c}'`);
      let j = i + 1;
      while (j < pattern.length && pattern[j] === c) j++;
      if (lit) {
        out.push({ lit });
        lit = '';
      }
      out.push({ p, count: j - i });
      i = j;
      continue;
    }
    lit += c;
    i++;
  }
  if (inQuote) throw new IllegalArgumentException('Unterminated quote');
  if (lit) out.push({ lit });
  return out;
}

function shouldObeyCount(p: number, count: number): boolean {
  switch (p) {
    case P_MONTH:
    case P_MONTH_STANDALONE:
      return count <= 2;
    case P_YEAR:
    case P_DAY_OF_MONTH:
    case P_HOUR_OF_DAY1:
    case P_HOUR_OF_DAY0:
    case P_MINUTE:
    case P_SECOND:
    case P_MILLISECOND:
    case P_DAY_OF_YEAR:
    case P_DAY_OF_WEEK_IN_MONTH:
    case P_WEEK_OF_YEAR:
    case P_WEEK_OF_MONTH:
    case P_HOUR1:
    case P_HOUR0:
    case P_WEEK_YEAR:
    case P_ISO_DAY_OF_WEEK:
      return true;
    default:
      return false;
  }
}

/** DecimalFormat.parse with parseIntegerOnly: optional '-', then ASCII digits. */
function parseNumber(text: string, pos: ParsePosition, limit: number): number | null {
  let i = pos.index;
  let neg = false;
  if (i < limit && text[i] === '-') {
    neg = true;
    i++;
  }
  const startDigits = i;
  let v = 0;
  while (i < limit && isDigit(text[i])) {
    v = v * 10 + (text.charCodeAt(i) - 48);
    i++;
  }
  if (i === startDigits) {
    pos.errorIndex = pos.index;
    return null;
  }
  pos.index = i;
  return neg ? -v : v;
}

/** Ordered (field, value) sets; establish() replays them on a cleared calendar (CalendarBuilder). */
class CalBuilder {
  sets: [number, number][] = [];
  set(field: number, value: number): this {
    this.sets.push([field, value]);
    return this;
  }
  establish(cal: Calendar): Calendar {
    cal.clear();
    let weekYear: number | null = null;
    for (const [f, v] of this.sets) {
      if (f === -1) weekYear = v;
      else cal.set(f, v);
    }
    if (weekYear !== null) cal.set(YEAR, weekYear);
    return cal;
  }
  addYear(n: number): this {
    for (const e of this.sets) if (e[0] === YEAR) e[1] += n;
    return this;
  }
}

export class SimpleDateFormat {
  private $pattern: string;
  private $compiled: SdfEl[];
  $locale: Locale;
  private $tzValue: TimeZone;
  private $lenient = true;
  private $centuryStart: number;
  private $centuryStartYear: number;

  constructor(pattern?: string, locale?: Locale) {
    if (pattern === null) throw new NullPointerException('pattern');
    this.$locale = locale instanceof Locale ? locale : Locale.getDefault();
    this.$pattern = pattern ?? 'M/d/yy h:mm a';
    this.$compiled = compileSdf(this.$pattern);
    this.$tzValue = defaultTz();
    const cal = Calendar.getInstance(this.$tzValue, this.$locale);
    cal.add(YEAR, -80);
    this.$centuryStart = cal.getTimeInMillis();
    this.$centuryStartYear = cal.get(YEAR);
  }

  // ----- properties -----

  get timeZone(): TimeZone {
    return this.$tzValue;
  }
  set timeZone(tz: TimeZone) {
    this.$tzValue = tz;
  }
  getTimeZone(): TimeZone {
    return this.$tzValue;
  }
  setTimeZone(tz: TimeZone): void {
    this.$tzValue = tz;
  }
  get isLenient(): boolean {
    return this.$lenient;
  }
  set isLenient(v: boolean) {
    this.$lenient = v;
  }
  isLenient$call(): boolean {
    return this.$lenient;
  }
  setLenient(v: boolean): void {
    this.$lenient = v;
  }
  get calendar(): Calendar {
    return this.getCalendar();
  }
  getCalendar(): Calendar {
    const c = Calendar.getInstance(this.$tzValue, this.$locale);
    c.setLenient(this.$lenient);
    return c;
  }
  setCalendar(c: Calendar): void {
    this.$tzValue = c.getTimeZone();
    this.$lenient = c.$lenient;
  }
  set2DigitYearStart(d: JDate): void {
    this.$centuryStart = d.getTime();
    const cal = Calendar.getInstance(this.$tzValue, this.$locale);
    cal.setTimeInMillis(this.$centuryStart);
    this.$centuryStartYear = cal.get(YEAR);
  }
  get2DigitYearStart(): JDate {
    return new JDate(this.$centuryStart);
  }
  applyPattern(p: string): void {
    this.$compiled = compileSdf(p);
    this.$pattern = p;
  }
  applyLocalizedPattern(p: string): void {
    this.applyPattern(p);
  }
  toPattern(): string {
    return this.$pattern;
  }
  toLocalizedPattern(): string {
    return this.$pattern;
  }
  clone(): SimpleDateFormat {
    const c = new SimpleDateFormat(this.$pattern, this.$locale);
    c.$tzValue = this.$tzValue;
    c.$lenient = this.$lenient;
    c.$centuryStart = this.$centuryStart;
    c.$centuryStartYear = this.$centuryStartYear;
    return c;
  }
  equals(o: any): boolean {
    return o instanceof SimpleDateFormat && o.$pattern === this.$pattern && o.$locale.equals(this.$locale);
  }
  hashCode(): number {
    return stringHash(this.$pattern);
  }

  private newCalendar(): Calendar {
    const c = new GregorianCalendar(this.$tzValue, this.$locale);
    c.setLenient(this.$lenient);
    return c;
  }

  // ----- formatting -----

  format(obj: any, toAppendTo?: any, _pos?: any): string {
    let ms: number;
    if (obj instanceof JDate) ms = obj.getTime();
    else if (typeof obj === 'number') ms = obj;
    else if (obj instanceof Calendar) ms = obj.getTimeInMillis();
    else throw new IllegalArgumentException('Cannot format given Object as a Date');
    const cal = this.newCalendar();
    cal.setTimeInMillis(ms);
    const sym = symbolsFor(this.$locale);
    let out = '';
    for (const el of this.$compiled) {
      if ('lit' in el) {
        out += el.lit;
        continue;
      }
      out += this.subFormat(el.p, el.count, cal, sym);
    }
    if (toAppendTo && typeof toAppendTo.append === 'function') toAppendTo.append(out);
    return out;
  }

  private subFormat(p: number, count: number, cal: Calendar, sym: ReturnType<typeof symbolsFor>): string {
    const field = PATTERN_TO_FIELD[p];
    let value = p === P_WEEK_YEAR ? cal.weekYear : cal.get(field);
    switch (p) {
      case P_ERA:
        return sym.erasShort[value];
      case P_WEEK_YEAR:
      case P_YEAR:
        return count !== 2 ? pad(value, count) : pad(value % 100, 2);
      case P_MONTH:
        if (count >= 4) return sym.monthsFull[value];
        if (count === 3) return sym.monthsShort[value];
        return pad(value + 1, count);
      case P_MONTH_STANDALONE:
        if (count >= 4) return sym.monthsFullStandalone[value];
        if (count === 3) return sym.monthsShortStandalone[value];
        return pad(value + 1, count);
      case P_HOUR_OF_DAY1:
        return pad(value === 0 ? 24 : value, count);
      case P_DAY_OF_WEEK:
        return (count >= 4 ? sym.daysFull : sym.daysShort)[(value + 5) % 7];
      case P_AM_PM:
        return sym.ampm[value];
      case P_HOUR1:
        return pad(value === 0 ? 12 : value, count);
      case P_ZONE_NAME: {
        const daylight = cal.get(DST_OFFSET) !== 0;
        return this.$tzValue.getDisplayName(daylight, count < 4 ? TimeZone.SHORT : TimeZone.LONG, this.$locale);
      }
      case P_ZONE_VALUE: {
        value = Math.trunc((cal.get(ZONE_OFFSET) + cal.get(DST_OFFSET)) / 60000);
        let width = 4;
        let s = '';
        if (value >= 0) s = '+';
        else width++;
        const num = Math.trunc(value / 60) * 100 + (value % 60);
        return s + pad(num, width - (num < 0 ? 1 : 0));
      }
      case P_ISO_ZONE: {
        value = Math.trunc((cal.get(ZONE_OFFSET) + cal.get(DST_OFFSET)) / 60000);
        if (value === 0) return 'Z';
        let s = value >= 0 ? '+' : '-';
        value = Math.abs(value);
        s += pad(Math.floor(value / 60), 2);
        if (count === 1) return s;
        if (count === 3) s += ':';
        return s + pad(value % 60, 2);
      }
      case P_ISO_DAY_OF_WEEK:
        return pad(value === 1 ? 7 : value - 1, count);
      default:
        return pad(value, count);
    }
  }

  // ----- parsing -----

  parse(text: string, pos?: ParsePosition): JDate | null {
    if (text === null || text === undefined) throw new NullPointerException('text');
    text = String(text);
    if (pos === undefined) {
      const p = new ParsePosition(0);
      const r = this.parse(text, p);
      if (p.index === 0) {
        const e = new ParseException(`Unparseable date: "${text}"`);
        (e as any).errorOffset = p.errorIndex;
        (e as any).getErrorOffset = () => p.errorIndex;
        throw e;
      }
      return r;
    }
    let start = pos.index;
    const oldStart = start;
    const textLength = text.length;
    const ambiguousYear = [false];
    const calb = new CalBuilder();
    const c = this.$compiled;
    for (let i = 0; i < c.length; i++) {
      const el = c[i];
      if ('lit' in el) {
        for (let k = 0; k < el.lit.length; k++) {
          if (start >= textLength || text[start] !== el.lit[k]) {
            pos.index = oldStart;
            pos.errorIndex = start;
            return null;
          }
          start++;
        }
        continue;
      }
      let obeyCount = false;
      const next = c[i + 1];
      if (next && !('lit' in next)) obeyCount = shouldObeyCount(next.p, next.count);
      start = this.subParse(text, start, el.p, el.count, obeyCount, ambiguousYear, pos, calb);
      if (start < 0) {
        pos.index = oldStart;
        return null;
      }
    }
    pos.index = start;
    try {
      let ms = calb.establish(this.newCalendar()).getTimeInMillis();
      if (ambiguousYear[0] && ms < this.$centuryStart) ms = calb.addYear(100).establish(this.newCalendar()).getTimeInMillis();
      return new JDate(ms);
    } catch (e) {
      if (e instanceof IllegalArgumentException) {
        pos.errorIndex = start;
        pos.index = oldStart;
        return null;
      }
      throw e;
    }
  }

  parseObject(text: string, pos?: ParsePosition): JDate | null {
    return this.parse(text, pos);
  }

  private matchString(text: string, start: number, field: number, data: string[], calb: CalBuilder, base = 0): number {
    let best = -1;
    let bestLen = 0;
    const lower = text.slice(start).toLowerCase();
    for (let i = 0; i < data.length; i++) {
      const n = data[i];
      if (!n || n.length <= bestLen) continue;
      if (lower.startsWith(n.toLowerCase())) {
        best = i;
        bestLen = n.length;
      }
    }
    if (best >= 0) {
      calb.set(field, best + base);
      return start + bestLen;
    }
    return -start;
  }

  private subParse(text: string, start: number, p: number, count: number, obeyCount: boolean, ambiguousYear: boolean[], origPos: ParsePosition, calb: CalBuilder): number {
    let value = 0;
    const pos = new ParsePosition(start);
    const field = PATTERN_TO_FIELD[p];
    const sym = symbolsFor(this.$locale);
    for (;;) {
      if (pos.index >= text.length) {
        origPos.errorIndex = start;
        return -1;
      }
      const ch = text[pos.index];
      if (ch !== ' ' && ch !== '\t') break;
      pos.index++;
    }
    const actualStart = pos.index;
    parsing: {
      if (p === P_HOUR_OF_DAY1 || p === P_HOUR1 || (p === P_MONTH && count <= 2) || (p === P_MONTH_STANDALONE && count <= 2) || p === P_YEAR || p === P_WEEK_YEAR) {
        let n: number | null;
        if (obeyCount) {
          if (start + count > text.length) break parsing;
          n = parseNumber(text, pos, start + count);
        } else {
          n = parseNumber(text, pos, text.length);
        }
        if (n === null) break parsing;
        value = n;
      }
      let idx: number;
      switch (p) {
        case P_ERA:
          if ((idx = this.matchString(text, start, ERA, sym.erasShort, calb)) > 0) return idx;
          break parsing;
        case P_WEEK_YEAR:
        case P_YEAR:
          if (count <= 2 && pos.index - actualStart === 2 && isDigit(text[actualStart]) && isDigit(text[actualStart + 1])) {
            const amb = this.$centuryStartYear % 100;
            ambiguousYear[0] = value === amb;
            value += Math.floor(this.$centuryStartYear / 100) * 100 + (value < amb ? 100 : 0);
          }
          calb.set(p === P_WEEK_YEAR ? -1 : YEAR, value);
          return pos.index;
        case P_MONTH:
        case P_MONTH_STANDALONE: {
          if (count <= 2) {
            calb.set(MONTH, value - 1);
            return pos.index;
          }
          const full = p === P_MONTH ? sym.monthsFull : sym.monthsFullStandalone;
          const short = p === P_MONTH ? sym.monthsShort : sym.monthsShortStandalone;
          if ((idx = this.matchString(text, start, MONTH, full, calb)) > 0) return idx;
          if ((idx = this.matchString(text, start, MONTH, short, calb)) > 0) return idx;
          break parsing;
        }
        case P_HOUR_OF_DAY1:
          if (!this.$lenient && (value < 1 || value > 24)) break parsing;
          if (value === 24) value = 0;
          calb.set(HOUR_OF_DAY, value);
          return pos.index;
        case P_DAY_OF_WEEK: {
          // Calendar DAY_OF_WEEK: 1 = Sunday; symbols are Monday-first.
          const toCal = (arr: string[]) => [arr[6], ...arr.slice(0, 6)];
          if ((idx = this.matchString(text, start, DAY_OF_WEEK, toCal(sym.daysFull), calb, 1)) > 0) return idx;
          if ((idx = this.matchString(text, start, DAY_OF_WEEK, toCal(sym.daysShort), calb, 1)) > 0) return idx;
          break parsing;
        }
        case P_AM_PM:
          if ((idx = this.matchString(text, start, AM_PM, sym.ampm, calb)) > 0) return idx;
          break parsing;
        case P_HOUR1:
          if (!this.$lenient && (value < 1 || value > 12)) break parsing;
          if (value === 12) value = 0;
          calb.set(HOUR, value);
          return pos.index;
        case P_ZONE_NAME:
        case P_ZONE_VALUE: {
          let sign = 0;
          const ch = text[pos.index];
          if (ch === '+') sign = 1;
          else if (ch === '-') sign = -1;
          if (sign === 0) {
            if ((ch === 'G' || ch === 'g') && text.length - start >= 3 && text.substr(start, 3).toUpperCase() === 'GMT') {
              pos.index = start + 3;
              if (text.length - pos.index > 0) {
                const c2 = text[pos.index];
                if (c2 === '+') sign = 1;
                else if (c2 === '-') sign = -1;
              }
              if (sign === 0) {
                calb.set(ZONE_OFFSET, 0).set(DST_OFFSET, 0);
                return pos.index;
              }
              const i = subParseNumericZone(text, ++pos.index, sign, 0, true, calb);
              if (i > 0) return i;
              pos.index = -i;
            } else {
              const i = this.subParseZoneString(text, pos.index, calb);
              if (i > 0) return i;
              pos.index = -i;
            }
          } else {
            const i = subParseNumericZone(text, ++pos.index, sign, 0, false, calb);
            if (i > 0) return i;
            pos.index = -i;
          }
          break parsing;
        }
        case P_ISO_ZONE: {
          if (text.length - pos.index <= 0) break parsing;
          const ch = text[pos.index];
          if (ch === 'Z') {
            calb.set(ZONE_OFFSET, 0).set(DST_OFFSET, 0);
            return ++pos.index;
          }
          let sign: number;
          if (ch === '+') sign = 1;
          else if (ch === '-') sign = -1;
          else {
            ++pos.index;
            break parsing;
          }
          const i = subParseNumericZone(text, ++pos.index, sign, count, count === 3, calb);
          if (i > 0) return i;
          pos.index = -i;
          break parsing;
        }
        default: {
          let n: number | null;
          if (obeyCount) {
            if (start + count > text.length) break parsing;
            n = parseNumber(text, pos, start + count);
          } else {
            n = parseNumber(text, pos, text.length);
          }
          if (n !== null) {
            if (p === P_ISO_DAY_OF_WEEK) calb.set(DAY_OF_WEEK, (n % 7) + 1);
            else calb.set(field, n);
            return pos.index;
          }
          break parsing;
        }
      }
    }
    origPos.errorIndex = pos.index;
    return -1;
  }

  private subParseZoneString(text: string, start: number, calb: CalBuilder): number {
    // Zone abbreviations ("PST", "WIB", "UTC") and the formatter zone's own display names.
    const candidates: [string, number, number][] = [];
    for (const abbr of Object.keys(ZONE_ABBREVIATIONS)) {
      const off = abbreviationOffset(abbr, Date.now());
      if (off !== null) candidates.push([abbr, off * 1000, ZONE_ABBREVIATIONS[abbr].dst ? 1 : 0]);
    }
    const tz = this.$tzValue;
    for (const daylight of [false, true]) {
      for (const style of [TimeZone.SHORT, TimeZone.LONG]) {
        const n = tz.getDisplayName(daylight, style, this.$locale);
        if (n) candidates.push([n, tz.getRawOffset() + (daylight ? tz.getDSTSavings() : 0), 2]);
      }
    }
    let best: [string, number, number] | null = null;
    const upper = text.slice(start).toUpperCase();
    for (const c of candidates) {
      if (upper.startsWith(c[0].toUpperCase()) && (!best || c[0].length > best[0].length)) best = c;
    }
    if (!best) return -start;
    calb.set(ZONE_OFFSET, best[1]).set(DST_OFFSET, 0);
    return start + best[0].length;
  }
}

/** SimpleDateFormat.subParseNumericZone; returns the new index, or a non-positive failure index. */
function subParseNumericZone(text: string, start: number, sign: number, count: number, colon: boolean, calb: CalBuilder): number {
  let index = start;
  const at = (i: number) => {
    if (i >= text.length) throw RangeError('eot');
    return text[i];
  };
  try {
    let c = at(index++);
    if (!isDigit(c)) return 1 - index;
    let hours = c.charCodeAt(0) - 48;
    c = at(index++);
    if (isDigit(c)) hours = hours * 10 + (c.charCodeAt(0) - 48);
    else {
      if (count > 0 || !colon) return 1 - index;
      --index;
    }
    if (hours > 23) return 1 - index;
    let minutes = 0;
    if (count !== 1) {
      c = at(index++);
      if (colon) {
        if (c !== ':') return 1 - index;
        c = at(index++);
      }
      if (!isDigit(c)) return 1 - index;
      minutes = c.charCodeAt(0) - 48;
      c = at(index++);
      if (!isDigit(c)) return 1 - index;
      minutes = minutes * 10 + (c.charCodeAt(0) - 48);
      if (minutes > 59) return 1 - index;
    }
    minutes += hours * 60;
    calb.set(ZONE_OFFSET, minutes * 60000 * sign).set(DST_OFFSET, 0);
    return index;
  } catch (e) {
    if (e instanceof RangeError) return 1 - index;
    throw e;
  }
}

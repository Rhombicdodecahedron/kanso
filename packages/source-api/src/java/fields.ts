// java.time enums: ChronoUnit, ChronoField, DayOfWeek, Month, TextStyle, SignStyle, ...

import { DateTimeException, defEnum } from '../kotlin/core';
import { Locale, symbolsFor } from './locale';
import { floorMod, isLeap } from './util';

export class UnsupportedTemporalTypeException extends DateTimeException {}

export class ValueRange {
  constructor(
    readonly minimum: number,
    readonly maximum: number,
  ) {}
  getMinimum(): number {
    return this.minimum;
  }
  getMaximum(): number {
    return this.maximum;
  }
  isValidValue(v: number): boolean {
    return v >= this.minimum && v <= this.maximum;
  }
  isValidIntValue(v: number): boolean {
    return this.isValidValue(v);
  }
  toString(): string {
    return `${this.minimum} - ${this.maximum}`;
  }
}

// ---------- ChronoUnit ----------

export class ChronoUnit {
  declare readonly name: string;
  declare readonly ordinal: number;
  declare static NANOS: ChronoUnit;
  declare static MICROS: ChronoUnit;
  declare static MILLIS: ChronoUnit;
  declare static SECONDS: ChronoUnit;
  declare static MINUTES: ChronoUnit;
  declare static HOURS: ChronoUnit;
  declare static HALF_DAYS: ChronoUnit;
  declare static DAYS: ChronoUnit;
  declare static WEEKS: ChronoUnit;
  declare static MONTHS: ChronoUnit;
  declare static YEARS: ChronoUnit;
  declare static DECADES: ChronoUnit;
  declare static CENTURIES: ChronoUnit;
  declare static MILLENNIA: ChronoUnit;
  declare static ERAS: ChronoUnit;
  declare static FOREVER: ChronoUnit;
  declare static values: () => ChronoUnit[];
  declare static valueOf: (n: string) => ChronoUnit;

  /** Hook set by temporal.ts so `unit.duration` can return a java.time.Duration. */
  static $durationFactory: ((secs: number, nanos: number) => any) | null = null;

  constructor(
    readonly displayName: string,
    /** Estimated duration in seconds (exact for time units). */
    readonly seconds: number,
    readonly nanos: number,
  ) {}

  /** Exact length in nanoseconds for time-based units (and DAYS). */
  get $nanos(): number {
    return this.seconds * 1e9 + this.nanos;
  }

  get duration(): any {
    return ChronoUnit.$durationFactory ? ChronoUnit.$durationFactory(this.seconds, this.nanos) : this.seconds;
  }
  getDuration(): any {
    return this.duration;
  }
  isDateBased(): boolean {
    return this.ordinal >= ChronoUnit.DAYS.ordinal && this !== ChronoUnit.FOREVER;
  }
  isTimeBased(): boolean {
    return this.ordinal < ChronoUnit.DAYS.ordinal;
  }
  isDurationEstimated(): boolean {
    return this.ordinal >= ChronoUnit.DAYS.ordinal;
  }
  between(a: any, b: any): number {
    return a.until(b, this);
  }
  addTo(temporal: any, amount: number): any {
    return temporal.plus(amount, this);
  }
  toString(): string {
    return this.displayName;
  }
}
defEnum(ChronoUnit, [
  ['NANOS', ['Nanos', 0, 1]],
  ['MICROS', ['Micros', 0, 1000]],
  ['MILLIS', ['Millis', 0, 1_000_000]],
  ['SECONDS', ['Seconds', 1, 0]],
  ['MINUTES', ['Minutes', 60, 0]],
  ['HOURS', ['Hours', 3600, 0]],
  ['HALF_DAYS', ['HalfDays', 43200, 0]],
  ['DAYS', ['Days', 86400, 0]],
  ['WEEKS', ['Weeks', 7 * 86400, 0]],
  ['MONTHS', ['Months', 31556952 / 12, 0]],
  ['YEARS', ['Years', 31556952, 0]],
  ['DECADES', ['Decades', 31556952 * 10, 0]],
  ['CENTURIES', ['Centuries', 31556952 * 100, 0]],
  ['MILLENNIA', ['Millennia', 31556952 * 1000, 0]],
  ['ERAS', ['Eras', 31556952 * 1e9, 0]],
  ['FOREVER', ['Forever', Number.MAX_SAFE_INTEGER, 999_999_999]],
]);

// ---------- ChronoField ----------

export class ChronoField {
  declare readonly name: string;
  declare readonly ordinal: number;
  declare static NANO_OF_SECOND: ChronoField;
  declare static NANO_OF_DAY: ChronoField;
  declare static MICRO_OF_SECOND: ChronoField;
  declare static MICRO_OF_DAY: ChronoField;
  declare static MILLI_OF_SECOND: ChronoField;
  declare static MILLI_OF_DAY: ChronoField;
  declare static SECOND_OF_MINUTE: ChronoField;
  declare static SECOND_OF_DAY: ChronoField;
  declare static MINUTE_OF_HOUR: ChronoField;
  declare static MINUTE_OF_DAY: ChronoField;
  declare static HOUR_OF_AMPM: ChronoField;
  declare static CLOCK_HOUR_OF_AMPM: ChronoField;
  declare static HOUR_OF_DAY: ChronoField;
  declare static CLOCK_HOUR_OF_DAY: ChronoField;
  declare static AMPM_OF_DAY: ChronoField;
  declare static DAY_OF_WEEK: ChronoField;
  declare static ALIGNED_DAY_OF_WEEK_IN_MONTH: ChronoField;
  declare static ALIGNED_DAY_OF_WEEK_IN_YEAR: ChronoField;
  declare static DAY_OF_MONTH: ChronoField;
  declare static DAY_OF_YEAR: ChronoField;
  declare static EPOCH_DAY: ChronoField;
  declare static ALIGNED_WEEK_OF_MONTH: ChronoField;
  declare static ALIGNED_WEEK_OF_YEAR: ChronoField;
  declare static MONTH_OF_YEAR: ChronoField;
  declare static PROLEPTIC_MONTH: ChronoField;
  declare static YEAR_OF_ERA: ChronoField;
  declare static YEAR: ChronoField;
  declare static ERA: ChronoField;
  declare static INSTANT_SECONDS: ChronoField;
  declare static OFFSET_SECONDS: ChronoField;
  declare static values: () => ChronoField[];
  declare static valueOf: (n: string) => ChronoField;

  readonly $range: ValueRange;

  constructor(
    readonly displayName: string,
    min: number,
    max: number,
    readonly dateBased: boolean,
    readonly timeBased: boolean,
  ) {
    this.$range = new ValueRange(min, max);
  }

  range(): ValueRange {
    return this.$range;
  }
  isDateBased(): boolean {
    return this.dateBased;
  }
  isTimeBased(): boolean {
    return this.timeBased;
  }
  checkValidValue(v: number): number {
    if (!Number.isFinite(v) || !this.$range.isValidValue(v)) {
      throw new DateTimeException(`Invalid value for ${this.displayName} (valid values ${this.$range}): ${v}`);
    }
    return v;
  }
  checkValidIntValue(v: number): number {
    return this.checkValidValue(v);
  }
  getFrom(temporal: any): number {
    return temporal.getLong(this);
  }
  isSupportedBy(temporal: any): boolean {
    return temporal.isSupported(this);
  }
  toString(): string {
    return this.displayName;
  }
}
const BIG = 9_007_199_254_740_991;
defEnum(ChronoField, [
  ['NANO_OF_SECOND', ['NanoOfSecond', 0, 999_999_999, false, true]],
  ['NANO_OF_DAY', ['NanoOfDay', 0, 86400 * 1e9 - 1, false, true]],
  ['MICRO_OF_SECOND', ['MicroOfSecond', 0, 999_999, false, true]],
  ['MICRO_OF_DAY', ['MicroOfDay', 0, 86400 * 1e6 - 1, false, true]],
  ['MILLI_OF_SECOND', ['MilliOfSecond', 0, 999, false, true]],
  ['MILLI_OF_DAY', ['MilliOfDay', 0, 86400 * 1000 - 1, false, true]],
  ['SECOND_OF_MINUTE', ['SecondOfMinute', 0, 59, false, true]],
  ['SECOND_OF_DAY', ['SecondOfDay', 0, 86399, false, true]],
  ['MINUTE_OF_HOUR', ['MinuteOfHour', 0, 59, false, true]],
  ['MINUTE_OF_DAY', ['MinuteOfDay', 0, 1439, false, true]],
  ['HOUR_OF_AMPM', ['HourOfAmPm', 0, 11, false, true]],
  ['CLOCK_HOUR_OF_AMPM', ['ClockHourOfAmPm', 1, 12, false, true]],
  ['HOUR_OF_DAY', ['HourOfDay', 0, 23, false, true]],
  ['CLOCK_HOUR_OF_DAY', ['ClockHourOfDay', 1, 24, false, true]],
  ['AMPM_OF_DAY', ['AmPmOfDay', 0, 1, false, true]],
  ['DAY_OF_WEEK', ['DayOfWeek', 1, 7, true, false]],
  ['ALIGNED_DAY_OF_WEEK_IN_MONTH', ['AlignedDayOfWeekInMonth', 1, 7, true, false]],
  ['ALIGNED_DAY_OF_WEEK_IN_YEAR', ['AlignedDayOfWeekInYear', 1, 7, true, false]],
  ['DAY_OF_MONTH', ['DayOfMonth', 1, 31, true, false]],
  ['DAY_OF_YEAR', ['DayOfYear', 1, 366, true, false]],
  ['EPOCH_DAY', ['EpochDay', -365243219162, 365241780471, true, false]],
  ['ALIGNED_WEEK_OF_MONTH', ['AlignedWeekOfMonth', 1, 5, true, false]],
  ['ALIGNED_WEEK_OF_YEAR', ['AlignedWeekOfYear', 1, 53, true, false]],
  ['MONTH_OF_YEAR', ['MonthOfYear', 1, 12, true, false]],
  ['PROLEPTIC_MONTH', ['ProlepticMonth', -999999999 * 12, 999999999 * 12 + 11, true, false]],
  ['YEAR_OF_ERA', ['YearOfEra', 1, 1_000_000_000, true, false]],
  ['YEAR', ['Year', -999_999_999, 999_999_999, true, false]],
  ['ERA', ['Era', 0, 1, true, false]],
  ['INSTANT_SECONDS', ['InstantSeconds', -BIG, BIG, false, false]],
  ['OFFSET_SECONDS', ['OffsetSeconds', -64800, 64800, false, false]],
]);

// ---------- TextStyle / SignStyle / ResolverStyle / FormatStyle ----------

export class TextStyle {
  declare readonly name: string;
  declare readonly ordinal: number;
  declare static FULL: TextStyle;
  declare static FULL_STANDALONE: TextStyle;
  declare static SHORT: TextStyle;
  declare static SHORT_STANDALONE: TextStyle;
  declare static NARROW: TextStyle;
  declare static NARROW_STANDALONE: TextStyle;
  isStandalone(): boolean {
    return (this.ordinal & 1) === 1;
  }
  asStandalone(): TextStyle {
    return TextStyle.values()[this.ordinal | 1];
  }
  asNormal(): TextStyle {
    return TextStyle.values()[this.ordinal & ~1];
  }
  declare static values: () => TextStyle[];
}
defEnum(TextStyle, [
  ['FULL', []],
  ['FULL_STANDALONE', []],
  ['SHORT', []],
  ['SHORT_STANDALONE', []],
  ['NARROW', []],
  ['NARROW_STANDALONE', []],
]);

export class SignStyle {
  declare readonly name: string;
  declare readonly ordinal: number;
  declare static NORMAL: SignStyle;
  declare static ALWAYS: SignStyle;
  declare static NEVER: SignStyle;
  declare static NOT_NEGATIVE: SignStyle;
  declare static EXCEEDS_PAD: SignStyle;
  /** JDK SignStyle.parse: whether a sign is acceptable while parsing. */
  $parse(positive: boolean, strict: boolean, fixedWidth: boolean): boolean {
    switch (this.ordinal) {
      case 0:
        return !positive || !strict;
      case 1:
      case 4:
        return true;
      default:
        return !strict && !fixedWidth;
    }
  }
}
defEnum(SignStyle, [
  ['NORMAL', []],
  ['ALWAYS', []],
  ['NEVER', []],
  ['NOT_NEGATIVE', []],
  ['EXCEEDS_PAD', []],
]);

export class ResolverStyle {
  declare readonly name: string;
  declare static STRICT: ResolverStyle;
  declare static SMART: ResolverStyle;
  declare static LENIENT: ResolverStyle;
}
defEnum(ResolverStyle, [
  ['STRICT', []],
  ['SMART', []],
  ['LENIENT', []],
]);

export class FormatStyle {
  declare readonly name: string;
  declare static FULL: FormatStyle;
  declare static LONG: FormatStyle;
  declare static MEDIUM: FormatStyle;
  declare static SHORT: FormatStyle;
}
defEnum(FormatStyle, [
  ['FULL', []],
  ['LONG', []],
  ['MEDIUM', []],
  ['SHORT', []],
]);

/** Names of a text field (month, day-of-week, am/pm, era) for a style, keyed by field value. */
export function textNames(field: ChronoField, style: TextStyle, locale: Locale | null): string[] | null {
  const s = symbolsFor(locale);
  const st = style.name.replace('_STANDALONE', '');
  const alone = style.isStandalone();
  switch (field) {
    case ChronoField.MONTH_OF_YEAR:
      if (st === 'FULL') return alone ? s.monthsFullStandalone : s.monthsFull;
      if (st === 'SHORT') return alone ? s.monthsShortStandalone : s.monthsShort;
      return s.monthsNarrow;
    case ChronoField.DAY_OF_WEEK:
      return st === 'FULL' ? s.daysFull : st === 'SHORT' ? s.daysShort : s.daysNarrow;
    case ChronoField.AMPM_OF_DAY:
      return s.ampm;
    case ChronoField.ERA:
      return st === 'FULL' ? s.erasFull : st === 'SHORT' ? s.erasShort : s.erasNarrow;
    default:
      return null;
  }
}

/** First valid value of a text field (array index 0 maps to this value). */
export function textBase(field: ChronoField): number {
  return field === ChronoField.MONTH_OF_YEAR || field === ChronoField.DAY_OF_WEEK ? 1 : 0;
}

// ---------- DayOfWeek / Month ----------

export class DayOfWeek {
  declare readonly name: string;
  declare readonly ordinal: number;
  declare static MONDAY: DayOfWeek;
  declare static TUESDAY: DayOfWeek;
  declare static WEDNESDAY: DayOfWeek;
  declare static THURSDAY: DayOfWeek;
  declare static FRIDAY: DayOfWeek;
  declare static SATURDAY: DayOfWeek;
  declare static SUNDAY: DayOfWeek;
  declare static values: () => DayOfWeek[];
  declare static valueOf: (n: string) => DayOfWeek;

  get value(): number {
    return this.ordinal + 1;
  }
  getValue(): number {
    return this.value;
  }
  getDisplayName(style: TextStyle, locale: Locale): string {
    return textNames(ChronoField.DAY_OF_WEEK, style, locale)![this.ordinal];
  }
  plus(days: number): DayOfWeek {
    return DayOfWeek.values()[floorMod(this.ordinal + days, 7)];
  }
  minus(days: number): DayOfWeek {
    return this.plus(-days);
  }
  get(field: ChronoField): number {
    if (field === ChronoField.DAY_OF_WEEK) return this.value;
    throw new UnsupportedTemporalTypeException(`Unsupported field: ${field}`);
  }
  getLong(field: ChronoField): number {
    return this.get(field);
  }
  static of(n: number): DayOfWeek {
    if (n < 1 || n > 7) throw new DateTimeException(`Invalid value for DayOfWeek: ${n}`);
    return DayOfWeek.values()[n - 1];
  }
  static from(t: any): DayOfWeek {
    if (t instanceof DayOfWeek) return t;
    return DayOfWeek.of(t.get(ChronoField.DAY_OF_WEEK));
  }
}
defEnum(DayOfWeek, [
  ['MONDAY', []],
  ['TUESDAY', []],
  ['WEDNESDAY', []],
  ['THURSDAY', []],
  ['FRIDAY', []],
  ['SATURDAY', []],
  ['SUNDAY', []],
]);

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export class Month {
  declare readonly name: string;
  declare readonly ordinal: number;
  declare static JANUARY: Month;
  declare static FEBRUARY: Month;
  declare static MARCH: Month;
  declare static APRIL: Month;
  declare static MAY: Month;
  declare static JUNE: Month;
  declare static JULY: Month;
  declare static AUGUST: Month;
  declare static SEPTEMBER: Month;
  declare static OCTOBER: Month;
  declare static NOVEMBER: Month;
  declare static DECEMBER: Month;
  declare static values: () => Month[];
  declare static valueOf: (n: string) => Month;

  get value(): number {
    return this.ordinal + 1;
  }
  getValue(): number {
    return this.value;
  }
  getDisplayName(style: TextStyle, locale: Locale): string {
    return textNames(ChronoField.MONTH_OF_YEAR, style, locale)![this.ordinal];
  }
  plus(months: number): Month {
    return Month.values()[floorMod(this.ordinal + months, 12)];
  }
  minus(months: number): Month {
    return this.plus(-months);
  }
  length(leapYear: boolean): number {
    return this.ordinal === 1 && leapYear ? 29 : MONTH_DAYS[this.ordinal];
  }
  minLength(): number {
    return MONTH_DAYS[this.ordinal];
  }
  maxLength(): number {
    return this.ordinal === 1 ? 29 : MONTH_DAYS[this.ordinal];
  }
  firstDayOfYear(leapYear: boolean): number {
    let d = 1;
    for (let i = 0; i < this.ordinal; i++) d += i === 1 && leapYear ? 29 : MONTH_DAYS[i];
    return d;
  }
  get(field: ChronoField): number {
    if (field === ChronoField.MONTH_OF_YEAR) return this.value;
    throw new UnsupportedTemporalTypeException(`Unsupported field: ${field}`);
  }
  getLong(field: ChronoField): number {
    return this.get(field);
  }
  static of(n: number): Month {
    if (n < 1 || n > 12) throw new DateTimeException(`Invalid value for MonthOfYear: ${n}`);
    return Month.values()[n - 1];
  }
  static from(t: any): Month {
    if (t instanceof Month) return t;
    return Month.of(t.get(ChronoField.MONTH_OF_YEAR));
  }
}
defEnum(Month, [
  ['JANUARY', []],
  ['FEBRUARY', []],
  ['MARCH', []],
  ['APRIL', []],
  ['MAY', []],
  ['JUNE', []],
  ['JULY', []],
  ['AUGUST', []],
  ['SEPTEMBER', []],
  ['OCTOBER', []],
  ['NOVEMBER', []],
  ['DECEMBER', []],
]);

export { isLeap };

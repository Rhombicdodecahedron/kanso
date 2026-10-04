// Entry point for the date/time runtime: java.util.{Locale,TimeZone,Date,Calendar}, java.text
// date formatting, java.time, kotlin.time and keiyoushi.utils date helpers (core/.../Date.kt).

import { DateTimeException, DateTimeParseException, type ExtDef, ParseException } from '../kotlin/core';
import { ext } from '../kotlin/hof';
import { ChronoField, ChronoUnit, DayOfWeek, FormatStyle, Month, ResolverStyle, SignStyle, TextStyle, UnsupportedTemporalTypeException, ValueRange } from './fields';
import { DateTimeFormatter, DateTimeFormatterBuilder } from './formatter';
import {
  Clock,
  Duration as KDuration,
  durationExtensions,
  DurationUnit,
  Instant as KInstant,
  toDuration,
  toJavaDuration,
  toJavaInstant,
  toKotlinDuration,
  toKotlinInstant,
} from './ktime';
import { Calendar, GregorianCalendar, JDate, ParsePosition, SimpleDateFormat, TimeZone } from './legacy';
import { Locale } from './locale';
import { Duration, Instant, LocalDate, LocalDateTime, LocalTime, OffsetDateTime, WeekFields, Year, ZonedDateTime, ZoneId, ZoneOffset } from './temporal';
import { callable } from './util';
import { ZoneRulesException } from './zone';

export {
  Calendar,
  ChronoField,
  ChronoUnit,
  Clock,
  DateTimeFormatter,
  DateTimeFormatterBuilder,
  DayOfWeek,
  Duration,
  DurationUnit,
  durationExtensions,
  FormatStyle,
  GregorianCalendar,
  Instant,
  JDate,
  KDuration,
  KInstant,
  LocalDate,
  LocalDateTime,
  LocalTime,
  Locale,
  Month,
  OffsetDateTime,
  ParsePosition,
  ResolverStyle,
  SignStyle,
  SimpleDateFormat,
  TextStyle,
  TimeZone,
  UnsupportedTemporalTypeException,
  ValueRange,
  WeekFields,
  Year,
  ZonedDateTime,
  ZoneId,
  ZoneOffset,
  ZoneRulesException,
};

// ---------- keiyoushi.utils (core/src/main/kotlin/keiyoushi/utils/Date.kt) ----------

/** `runCatching { ... }.getOrDefault(0L)` */
function orZero(f: () => number): number {
  try {
    return f();
  } catch {
    return 0;
  }
}

const isFormatter = (x: any) => x instanceof DateTimeFormatter;

/** `SimpleDateFormat.tryParse(date: String?): Long` (deprecated upstream, still widely used). */
export const sdfTryParse: ExtDef = ext('tryParse', (x) => x instanceof SimpleDateFormat, (fmt: SimpleDateFormat, date: string | null | undefined) => {
  if (date === null || date === undefined) return 0;
  return fmt.parse(date, new ParsePosition(0))?.time ?? 0;
});

/** `Instant.Companion.tryParse(date: String?): Long` for kotlin.time.Instant. */
export const instantTryParse: ExtDef = ext('tryParse', (x) => x === KInstant, (_companion: unknown, date: string | null | undefined) => {
  if (date === null || date === undefined) return 0;
  return KInstant.parseOrNull(date)?.toEpochMilliseconds() ?? 0;
});

/** `DateTimeFormatter.tryParseDate(date: String?, zone: ZoneId? = null): Long` */
export const tryParseDate: ExtDef = ext('tryParseDate', isFormatter, (fmt: DateTimeFormatter, date: string | null | undefined, zone?: ZoneId | null) => {
  if (date === null || date === undefined) return 0;
  return orZero(() =>
    LocalDate.parse(date, fmt)
      .atStartOfDay(zone ?? fmt.zone ?? ZoneId.systemDefault())
      .toInstant()
      .toEpochMilli(),
  );
});

/** `DateTimeFormatter.tryParseDateTime(date: String?, zone: ZoneId? = null): Long` */
export const tryParseDateTime: ExtDef = ext('tryParseDateTime', isFormatter, (fmt: DateTimeFormatter, date: string | null | undefined, zone?: ZoneId | null) => {
  if (date === null || date === undefined) return 0;
  return orZero(() =>
    LocalDateTime.parse(date, fmt)
      .atZone(zone ?? fmt.zone ?? ZoneId.systemDefault())
      .toInstant()
      .toEpochMilli(),
  );
});

/** `DateTimeFormatter.tryParseZonedDateTime(date: String?): Long` */
export const tryParseZonedDateTime: ExtDef = ext('tryParseZonedDateTime', isFormatter, (fmt: DateTimeFormatter, date: string | null | undefined) => {
  if (date === null || date === undefined) return 0;
  return orZero(() => ZonedDateTime.parse(date, fmt).toInstant().toEpochMilli());
});

export const keiyoushiDateExtensions: Record<string, ExtDef[]> = {
  tryParse: [sdfTryParse, instantTryParse],
  tryParseDate: [tryParseDate],
  tryParseDateTime: [tryParseDateTime],
  tryParseZonedDateTime: [tryParseZonedDateTime],
};

// ---------- module map ----------

/** Kotlin/Java fully qualified names -> runtime values for the translator's import resolution. */
export const timeModules: Record<string, unknown> = {
  // java.util
  'java.util.Locale': callable(Locale),
  'java.util.TimeZone': TimeZone,
  'java.util.Date': callable(JDate),
  'java.util.Calendar': Calendar,
  'java.util.GregorianCalendar': callable(GregorianCalendar),

  // java.text
  'java.text.SimpleDateFormat': callable(SimpleDateFormat),
  'java.text.ParsePosition': callable(ParsePosition),
  'java.text.ParseException': ParseException,

  // java.time
  'java.time.Instant': Instant,
  'java.time.LocalDate': LocalDate,
  'java.time.LocalTime': LocalTime,
  'java.time.LocalDateTime': LocalDateTime,
  'java.time.ZonedDateTime': ZonedDateTime,
  'java.time.OffsetDateTime': OffsetDateTime,
  'java.time.ZoneId': ZoneId,
  'java.time.ZoneOffset': ZoneOffset,
  'java.time.Duration': Duration,
  'java.time.Year': Year,
  'java.time.DayOfWeek': DayOfWeek,
  'java.time.Month': Month,
  'java.time.DateTimeException': DateTimeException,
  'java.time.format.DateTimeFormatter': DateTimeFormatter,
  'java.time.format.DateTimeFormatterBuilder': callable(DateTimeFormatterBuilder),
  'java.time.format.DateTimeParseException': DateTimeParseException,
  'java.time.format.TextStyle': TextStyle,
  'java.time.format.SignStyle': SignStyle,
  'java.time.format.FormatStyle': FormatStyle,
  'java.time.format.ResolverStyle': ResolverStyle,
  'java.time.temporal.ChronoUnit': ChronoUnit,
  'java.time.temporal.ChronoField': ChronoField,
  'java.time.temporal.WeekFields': WeekFields,
  'java.time.temporal.ValueRange': ValueRange,
  'java.time.temporal.UnsupportedTemporalTypeException': UnsupportedTemporalTypeException,
  'java.time.zone.ZoneRulesException': ZoneRulesException,

  // kotlin.time
  'kotlin.time.Duration': KDuration,
  'kotlin.time.DurationUnit': DurationUnit,
  'kotlin.time.Instant': KInstant,
  'kotlin.time.Clock': Clock,
  'kotlin.time.Clock.System': Clock.System,
  'kotlin.time.Duration.Companion.nanoseconds': durationExtensions.nanoseconds,
  'kotlin.time.Duration.Companion.microseconds': durationExtensions.microseconds,
  'kotlin.time.Duration.Companion.milliseconds': durationExtensions.milliseconds,
  'kotlin.time.Duration.Companion.seconds': durationExtensions.seconds,
  'kotlin.time.Duration.Companion.minutes': durationExtensions.minutes,
  'kotlin.time.Duration.Companion.hours': durationExtensions.hours,
  'kotlin.time.Duration.Companion.days': durationExtensions.days,
  'kotlin.time.toDuration': toDuration,
  'kotlin.time.toJavaInstant': toJavaInstant,
  'kotlin.time.toKotlinInstant': toKotlinInstant,
  'kotlin.time.toJavaDuration': toJavaDuration,
  'kotlin.time.toKotlinDuration': toKotlinDuration,

  // keiyoushi.utils (Date.kt)
  'keiyoushi.utils.tryParse': keiyoushiDateExtensions.tryParse,
  'keiyoushi.utils.tryParseDate': tryParseDate,
  'keiyoushi.utils.tryParseDateTime': tryParseDateTime,
  'keiyoushi.utils.tryParseZonedDateTime': tryParseZonedDateTime,
};

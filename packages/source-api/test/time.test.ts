import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, compare, DateTimeException, DateTimeParseException, icall, IllegalArgumentException, isCatch, minus, ParseException, plus, prop, setProp, times } from '../src/kotlin/core';
import {
  Calendar,
  ChronoField,
  ChronoUnit,
  Clock,
  DateTimeFormatter,
  DateTimeFormatterBuilder,
  DayOfWeek,
  Duration,
  durationExtensions,
  DurationUnit,
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
  SimpleDateFormat,
  TextStyle,
  timeModules,
  TimeZone,
  UnsupportedTemporalTypeException,
  WeekFields,
  Year,
  ZonedDateTime,
  ZoneId,
  ZoneOffset,
  ZoneRulesException,
} from '../src/java/time';

const DAY = 86_400_000;
const UTC = () => TimeZone.getTimeZone('UTC');
const JAKARTA = () => ZoneId.of('Asia/Jakarta');
const ES = new Locale('es');
const PT_BR = new Locale('pt', 'BR');
const ID = new Locale('id');

/** Epoch millis of a UTC date-time (months 1-based, years < 100 allowed). */
function utc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number {
  return LocalDateTime.of(y, mo, d, h, mi, s, ms * 1e6).toInstant(ZoneOffset.UTC).toEpochMilli();
}

function sdf(pattern: string, locale: Locale = Locale.ENGLISH, tz: TimeZone = UTC()): SimpleDateFormat {
  const f = new SimpleDateFormat(pattern, locale);
  f.timeZone = tz;
  return f;
}

const ext = (name: string) => {
  const v = timeModules[`keiyoushi.utils.${name}`] as any;
  return Array.isArray(v) ? v : [v];
};
const tryParse = (recv: any, ...args: any[]) => call(recv, 'tryParse', ext('tryParse'), args);
const tryParseDate = (f: DateTimeFormatter, ...args: any[]) => call(f, 'tryParseDate', ext('tryParseDate'), args);
const tryParseDateTime = (f: DateTimeFormatter, ...args: any[]) => call(f, 'tryParseDateTime', ext('tryParseDateTime'), args);
const tryParseZonedDateTime = (f: DateTimeFormatter, ...args: any[]) => call(f, 'tryParseZonedDateTime', ext('tryParseZonedDateTime'), args);
const kd = (n: number, unit: keyof typeof durationExtensions) => prop(n, unit, [durationExtensions[unit]]);

let savedTz: TimeZone;
let savedLocale: Locale;
beforeAll(() => {
  savedTz = TimeZone.getDefault();
  savedLocale = Locale.getDefault();
  TimeZone.setDefault(TimeZone.getTimeZone('UTC'));
  Locale.setDefault(Locale.US);
});
afterAll(() => {
  TimeZone.setDefault(savedTz);
  Locale.setDefault(savedLocale);
});

// ---------------------------------------------------------------------------

describe('java.util.Locale', () => {
  it('constants and accessors', () => {
    expect(Locale.ENGLISH.language).toBe('en');
    expect(Locale.US.country).toBe('US');
    expect(Locale.US.toString()).toBe('en_US');
    expect(Locale.US.toLanguageTag()).toBe('en-US');
    expect(Locale.ROOT.toLanguageTag()).toBe('und');
    expect(Locale.ROOT.toString()).toBe('');
    expect(Locale.UK.toLanguageTag()).toBe('en-GB');
    expect(Locale.CANADA.toString()).toBe('en_CA');
    expect([Locale.FRENCH, Locale.GERMAN, Locale.JAPANESE, Locale.KOREAN, Locale.CHINESE, Locale.ITALIAN].map((l) => l.language)).toEqual(['fr', 'de', 'ja', 'ko', 'zh', 'it']);
    expect(Locale.TRADITIONAL_CHINESE.toString()).toBe('zh_TW');
  });
  it('constructor callable without new and normalises case', () => {
    const L = timeModules['java.util.Locale'] as any;
    const l = L('PT', 'br');
    expect(l).toBeInstanceOf(Locale);
    expect(l instanceof L).toBe(true);
    expect(l.toLanguageTag()).toBe('pt-BR');
    expect(new L('es').equals(new Locale('es'))).toBe(true);
    expect(L.ENGLISH).toBe(Locale.ENGLISH);
    expect(new Locale('in').language).toBe('id');
  });
  it('forLanguageTag', () => {
    expect(Locale.forLanguageTag('pt-BR').equals(PT_BR)).toBe(true);
    expect(Locale.forLanguageTag('es-419').country).toBe('419');
    const zh = Locale.forLanguageTag('zh-Hant-TW');
    expect([zh.language, zh.script, zh.country]).toEqual(['zh', 'Hant', 'TW']);
    expect(Locale.forLanguageTag('und').equals(Locale.ROOT)).toBe(true);
    expect(Locale.forLanguageTag('tr').toLanguageTag()).toBe('tr');
  });
  it('getDefault/setDefault', () => {
    expect(Locale.getDefault()).toBe(Locale.US);
  });
});

describe('java.util.TimeZone', () => {
  it('ids and offsets', () => {
    expect(TimeZone.getTimeZone('UTC').id).toBe('UTC');
    expect(TimeZone.getTimeZone('UTC').getOffset(0)).toBe(0);
    const jkt = TimeZone.getTimeZone('Asia/Jakarta');
    expect(jkt.getID()).toBe('Asia/Jakarta');
    expect(jkt.rawOffset).toBe(7 * 3600_000);
    expect(jkt.getOffset(Date.now())).toBe(7 * 3600_000);
    expect(TimeZone.getTimeZone('GMT+7').id).toBe('GMT+07:00');
    expect(TimeZone.getTimeZone('GMT-0530').getRawOffset()).toBe(-5.5 * 3600_000);
    // Unknown ids fall back to GMT, like the JDK.
    expect(TimeZone.getTimeZone('Not/AZone').id).toBe('GMT');
    expect(TimeZone.getTimeZone(ZoneId.of('Asia/Seoul')).id).toBe('Asia/Seoul');
    expect(TimeZone.getTimeZone('Asia/Seoul').toZoneId().equals(ZoneId.of('Asia/Seoul'))).toBe(true);
  });
  it('daylight time', () => {
    const ny = TimeZone.getTimeZone('America/New_York');
    expect(ny.getRawOffset()).toBe(-5 * 3600_000);
    expect(ny.getOffset(utc(2024, 7, 1))).toBe(-4 * 3600_000);
    expect(ny.inDaylightTime(new JDate(utc(2024, 7, 1)))).toBe(true);
    expect(ny.inDaylightTime(new JDate(utc(2024, 1, 1)))).toBe(false);
    expect(ny.useDaylightTime()).toBe(true);
  });
  it('default zone drives ZoneId.systemDefault()', () => {
    expect(TimeZone.getDefault().id).toBe('UTC');
    expect(ZoneId.systemDefault().id).toBe('UTC');
  });
});

describe('java.util.Date', () => {
  it('time property and getter', () => {
    const D = timeModules['java.util.Date'] as any;
    const d = D(1_700_000_000_123);
    expect(d.time).toBe(1_700_000_000_123);
    expect(d.getTime()).toBe(1_700_000_000_123);
    d.time = 5;
    expect(d.getTime()).toBe(5);
    expect(Math.abs(new JDate().time - Date.now())).toBeLessThan(1000);
    expect(new JDate(1).before(new JDate(2))).toBe(true);
    expect(new JDate(3).equals(new JDate(3))).toBe(true);
    expect(new JDate(utc(2024, 3, 5, 10, 15, 30)).toString()).toBe('Tue Mar 05 10:15:30 UTC 2024');
    expect(new JDate(0).toInstant().toString()).toBe('1970-01-01T00:00:00Z');
  });
});

describe('java.util.Calendar', () => {
  const at = (ms: number, tz = UTC()) => {
    const c = Calendar.getInstance(tz);
    c.timeInMillis = ms;
    return c;
  };

  it('getInstance() is "now"', () => {
    expect(Math.abs(Calendar.getInstance().timeInMillis - Date.now())).toBeLessThan(1000);
    expect(Math.abs(Calendar.getInstance().time.time - Date.now())).toBeLessThan(1000);
  });

  it('get fields', () => {
    const c = at(utc(2024, 3, 5, 14, 7, 9, 321));
    expect(c.get(Calendar.YEAR)).toBe(2024);
    expect(c.get(Calendar.MONTH)).toBe(Calendar.MARCH);
    expect(c.get(Calendar.DAY_OF_MONTH)).toBe(5);
    expect(c.get(Calendar.DATE)).toBe(5);
    expect(c.get(Calendar.HOUR_OF_DAY)).toBe(14);
    expect(c.get(Calendar.HOUR)).toBe(2);
    expect(c.get(Calendar.AM_PM)).toBe(Calendar.PM);
    expect(c.get(Calendar.MINUTE)).toBe(7);
    expect(c.get(Calendar.SECOND)).toBe(9);
    expect(c.get(Calendar.MILLISECOND)).toBe(321);
    expect(c.get(Calendar.DAY_OF_WEEK)).toBe(Calendar.TUESDAY);
    expect(c.get(Calendar.DAY_OF_YEAR)).toBe(65);
    expect(c.get(Calendar.WEEK_OF_YEAR)).toBe(10); // en_US: Sunday start, 1 minimal day
  });

  it('relative-date arithmetic used by sources (apply { add(...) }.timeInMillis)', () => {
    const base = utc(2024, 3, 5, 10, 0);
    const minusDays = (field: number, n: number) => {
      const cal = at(base);
      // `Calendar.getInstance().apply { add(field, -n) }.timeInMillis`
      icall([cal], 'add', [], [field, -n]);
      return prop(cal, 'timeInMillis', []);
    };
    expect(minusDays(Calendar.SECOND, 30)).toBe(base - 30_000);
    expect(minusDays(Calendar.MINUTE, 5)).toBe(base - 5 * 60_000);
    expect(minusDays(Calendar.HOUR, 3)).toBe(base - 3 * 3600_000);
    expect(minusDays(Calendar.HOUR_OF_DAY, 3)).toBe(base - 3 * 3600_000);
    expect(minusDays(Calendar.DAY_OF_MONTH, 2)).toBe(base - 2 * DAY);
    expect(minusDays(Calendar.DATE, 1)).toBe(base - DAY);
    expect(minusDays(Calendar.DAY_OF_YEAR, 10)).toBe(base - 10 * DAY);
    expect(minusDays(Calendar.WEEK_OF_YEAR, 2)).toBe(base - 14 * DAY);
    expect(minusDays(Calendar.WEEK_OF_MONTH, 1)).toBe(base - 7 * DAY);
    expect(minusDays(Calendar.MONTH, 1)).toBe(utc(2024, 2, 5, 10, 0));
    expect(minusDays(Calendar.YEAR, 1)).toBe(utc(2023, 3, 5, 10, 0));
    expect(minusDays(Calendar.MILLISECOND, 1)).toBe(base - 1);
  });

  it('month/year arithmetic pins the day of month', () => {
    const c = at(utc(2024, 1, 31));
    c.add(Calendar.MONTH, 1);
    expect([c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH)]).toEqual([1, 29]);
    const d = at(utc(2024, 2, 29));
    d.add(Calendar.YEAR, -1);
    expect(d.timeInMillis).toBe(utc(2023, 2, 28));
    const e = at(utc(2024, 3, 5));
    e.add(Calendar.MONTH, -14);
    expect(e.timeInMillis).toBe(utc(2023, 1, 5));
  });

  it('set() is lenient and lazy like the JVM', () => {
    const c = Calendar.getInstance(UTC());
    c.clear();
    c.set(2024, 1, 30);
    expect(c.timeInMillis).toBe(utc(2024, 3, 1));
    const d = at(utc(2024, 1, 31, 15, 30));
    d.set(Calendar.MONTH, Calendar.FEBRUARY);
    d.set(Calendar.DAY_OF_MONTH, 10); // set after MONTH, before recomputation: Feb 10
    expect(d.timeInMillis).toBe(utc(2024, 2, 10, 15, 30));
    const e = at(utc(2024, 3, 5, 15, 30, 12, 5));
    e.set(Calendar.HOUR_OF_DAY, 0);
    e.set(Calendar.MINUTE, 0);
    e.set(Calendar.SECOND, 0);
    e.set(Calendar.MILLISECOND, 0);
    expect(e.timeInMillis).toBe(utc(2024, 3, 5));
    const f = at(utc(2024, 3, 5, 10));
    f.set(Calendar.HOUR_OF_DAY, 30);
    expect(f.timeInMillis).toBe(utc(2024, 3, 6, 6));
    const g = Calendar.getInstance(UTC());
    g.clear();
    expect(g.timeInMillis).toBe(0);
    g.set(Calendar.YEAR, 2020);
    expect(g.timeInMillis).toBe(utc(2020, 1, 1));
  });

  it('DAY_OF_WEEK set moves within the current week', () => {
    const c = at(utc(2024, 3, 6)); // Wednesday
    c.set(Calendar.DAY_OF_WEEK, Calendar.MONDAY);
    expect(c.timeInMillis).toBe(utc(2024, 3, 4));
  });

  it('non-lenient calendar rejects invalid fields', () => {
    const c = Calendar.getInstance(UTC());
    c.isLenient = false;
    c.clear();
    c.set(2023, 1, 30);
    expect(() => c.timeInMillis).toThrow(IllegalArgumentException);
  });

  it('time / timeZone properties and zone-aware fields', () => {
    const c = Calendar.getInstance(TimeZone.getTimeZone('Asia/Jakarta'));
    c.time = new JDate(utc(2024, 3, 5, 20));
    expect(c.get(Calendar.DAY_OF_MONTH)).toBe(6);
    expect(c.get(Calendar.HOUR_OF_DAY)).toBe(3);
    expect(c.get(Calendar.ZONE_OFFSET)).toBe(7 * 3600_000);
    setProp(c, 'timeZone', [], UTC());
    expect(c.get(Calendar.HOUR_OF_DAY)).toBe(20);
    expect(c.timeZone.id).toBe('UTC');
  });

  it('day arithmetic keeps wall-clock time across DST', () => {
    const ny = TimeZone.getTimeZone('America/New_York');
    const c = Calendar.getInstance(ny);
    c.clear();
    c.set(2024, Calendar.MARCH, 9, 12, 0);
    c.add(Calendar.DATE, 1);
    expect(c.get(Calendar.HOUR_OF_DAY)).toBe(12);
    expect(c.timeInMillis).toBe(utc(2024, 3, 10, 16));
    const h = Calendar.getInstance(ny);
    h.clear();
    h.set(2024, Calendar.MARCH, 9, 12, 0);
    h.add(Calendar.HOUR_OF_DAY, 24);
    expect(h.get(Calendar.HOUR_OF_DAY)).toBe(13);
    // 02:30 does not exist on 2024-03-10 in New York: lenient calendars move it forward.
    const g = Calendar.getInstance(ny);
    g.clear();
    g.set(2024, Calendar.MARCH, 10, 2, 30);
    expect(g.get(Calendar.HOUR_OF_DAY)).toBe(3);
  });

  it('getActualMaximum and display names', () => {
    const c = at(utc(2024, 2, 10));
    expect(c.getActualMaximum(Calendar.DAY_OF_MONTH)).toBe(29);
    expect(c.getActualMaximum(Calendar.DAY_OF_YEAR)).toBe(366);
    expect(c.getDisplayName(Calendar.MONTH, Calendar.LONG, Locale.ENGLISH)).toBe('February');
    expect(c.getDisplayName(Calendar.DAY_OF_WEEK, Calendar.SHORT, Locale.ENGLISH)).toBe('Sat');
  });

  it('GregorianCalendar constructor and clone', () => {
    const G = timeModules['java.util.GregorianCalendar'] as any;
    const g = G(2024, Calendar.MARCH, 5);
    expect(g.get(Calendar.DAY_OF_MONTH)).toBe(5);
    expect(g.timeInMillis).toBe(utc(2024, 3, 5));
    const cl = g.clone();
    cl.add(Calendar.DATE, 1);
    expect(g.get(Calendar.DAY_OF_MONTH)).toBe(5);
    expect(cl.after(g)).toBe(true);
  });
});

describe('java.text.SimpleDateFormat', () => {
  it('ISO-like patterns', () => {
    expect(sdf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").parse('2024-03-05T10:15:30.123Z')!.time).toBe(utc(2024, 3, 5, 10, 15, 30, 123));
    expect(sdf("yyyy-MM-dd'T'HH:mm:ss").parse('2024-03-05T10:15:30.123Z')!.time).toBe(utc(2024, 3, 5, 10, 15, 30));
    expect(sdf('yyyy-MM-dd HH:mm:ss').parse('2024-03-05 10:15:30')!.time).toBe(utc(2024, 3, 5, 10, 15, 30));
    expect(sdf('yyyy-MM-dd').parse('2024-3-5')!.time).toBe(utc(2024, 3, 5));
    expect(sdf('yyyy/MM/dd').parse('2024/03/05')!.time).toBe(utc(2024, 3, 5));
    expect(sdf('dd.MM.yyyy').parse('05.03.2024')!.time).toBe(utc(2024, 3, 5));
    expect(sdf('yyyy-MM-dd+HH:mm:ss').parse('2024-03-05+10:15:30')!.time).toBe(utc(2024, 3, 5, 10, 15, 30));
    expect(sdf('HH:mm dd-MM-yyyy').parse('23:59 31-12-2023')!.time).toBe(utc(2023, 12, 31, 23, 59));
  });

  it('S is a millisecond count, not a fraction (JVM quirk)', () => {
    expect(sdf("yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'").parse('2024-03-05T10:15:30.123456Z')!.time).toBe(utc(2024, 3, 5, 10, 15, 30) + 123456);
    expect(sdf('yyyy-MM-dd HH:mm:ss.SSSSSS').parse('2024-03-05 10:15:30.000001')!.time).toBe(utc(2024, 3, 5, 10, 15, 30) + 1);
  });

  it('abutting numeric fields obey the pattern width', () => {
    expect(sdf('yyyyMMdd').parse('20240305')!.time).toBe(utc(2024, 3, 5));
    expect(sdf('yyyyMMddHHmm').parse('202403051015')!.time).toBe(utc(2024, 3, 5, 10, 15));
  });

  it('English month and day names, case-insensitive, long or short', () => {
    expect(sdf('MMMM d, yyyy').parse('January 5, 2024')!.time).toBe(utc(2024, 1, 5));
    expect(sdf('MMMM d, yyyy').parse('january 5, 2024')!.time).toBe(utc(2024, 1, 5));
    expect(sdf('MMMM dd, yyyy').parse('Sep 05, 2024')!.time).toBe(utc(2024, 9, 5));
    expect(sdf('MMM dd, yyyy').parse('September 05, 2024')!.time).toBe(utc(2024, 9, 5));
    expect(sdf('MMM dd, yyyy').parse('Mar  5, 2024')!.time).toBe(utc(2024, 3, 5)); // spaces before a number are skipped
    expect(sdf('dd MMM yyyy').parse('05 DEC 2023')!.time).toBe(utc(2023, 12, 5));
    expect(sdf('MMM d yy').parse('Mar 5 24')!.time).toBe(utc(2024, 3, 5));
    expect(sdf('EEEE, d MMM yyyy HH:mm').parse('Tuesday, 5 Mar 2024 10:00')!.time).toBe(utc(2024, 3, 5, 10));
    // A wrong weekday is ignored by the lenient calendar (DAY_OF_MONTH wins).
    expect(sdf('EEE, d MMM yyyy').parse('Fri, 5 Mar 2024')!.time).toBe(utc(2024, 3, 5));
  });

  it('localized month names (French, Spanish, Portuguese, Indonesian, Turkish)', () => {
    expect(sdf('dd MMMM yyyy', Locale.FRENCH).parse('05 mars 2024')!.time).toBe(utc(2024, 3, 5));
    expect(sdf('dd MMM yyyy', Locale.FRENCH).parse('05 janv. 2024')!.time).toBe(utc(2024, 1, 5));
    expect(sdf('dd MMMM yyyy', Locale.FRENCH).parse('14 février 2024')!.time).toBe(utc(2024, 2, 14));
    expect(sdf('dd MMMM yyyy', ES).parse('05 enero 2024')!.time).toBe(utc(2024, 1, 5));
    expect(sdf("dd 'de' MMMM 'de' yyyy", PT_BR).parse('05 de março de 2024')!.time).toBe(utc(2024, 3, 5));
    expect(sdf('dd MMMM yyyy', ID).parse('17 Agustus 2024')!.time).toBe(utc(2024, 8, 17));
    expect(sdf('dd MMMM yyyy', Locale.forLanguageTag('tr')).parse('05 Mart 2024')!.time).toBe(utc(2024, 3, 5));
  });

  it('two-digit years use the 80/20 century window; yyyy is literal', () => {
    expect(sdf('dd/MM/yy').parse('05/03/24')!.time).toBe(utc(2024, 3, 5));
    expect(sdf('dd/MM/yy').parse('05/03/99')!.time).toBe(utc(1999, 3, 5));
    expect(sdf('dd/MM/yy').parse('05/03/30')!.time).toBe(utc(2030, 3, 5));
    expect(sdf('dd/MM/yyyy').parse('05/03/24')!.time).toBe(utc(24, 3, 5));
    expect(sdf('dd/MM/yy').parse('05/03/2024')!.time).toBe(utc(2024, 3, 5));
  });

  it('time zones: default, timeZone property, Z, X and z', () => {
    const jkt = sdf('yyyy-MM-dd HH:mm', Locale.ENGLISH, TimeZone.getTimeZone('Asia/Jakarta'));
    expect(jkt.parse('2024-03-05 10:00')!.time).toBe(utc(2024, 3, 5, 3));
    expect(new SimpleDateFormat('yyyy-MM-dd', Locale.US).parse('2024-03-05')!.time).toBe(utc(2024, 3, 5)); // default tz = UTC here
    expect(sdf("yyyy-MM-dd'T'HH:mm:ssZ").parse('2024-03-05T10:15:30+0700')!.time).toBe(utc(2024, 3, 5, 3, 15, 30));
    expect(sdf("yyyy-MM-dd'T'HH:mm:ss.SSSZ").parse('2024-03-05T10:15:30.000-0530')!.time).toBe(utc(2024, 3, 5, 15, 45, 30));
    // RFC 822 'Z' does not accept a colon on the JVM.
    expect(sdf("yyyy-MM-dd'T'HH:mm:ssZ").parse('2024-03-05T10:15:30+07:00', new ParsePosition(0))).toBeNull();
    expect(sdf("yyyy-MM-dd'T'HH:mm:ssZZZZZ").parse('2024-03-05T10:15:30+0700')!.time).toBe(utc(2024, 3, 5, 3, 15, 30));
    expect(sdf("yyyy-MM-dd'T'HH:mm:ssX").parse('2024-03-05T10:15:30+07')!.time).toBe(utc(2024, 3, 5, 3, 15, 30));
    expect(sdf("yyyy-MM-dd'T'HH:mm:ssX").parse('2024-03-05T10:15:30Z')!.time).toBe(utc(2024, 3, 5, 10, 15, 30));
    expect(sdf("yyyy-MM-dd'T'HH:mm:ssXXX").parse('2024-03-05T10:15:30+07:00')!.time).toBe(utc(2024, 3, 5, 3, 15, 30));
    expect(sdf('yyyy-MM-dd HH:mm z').parse('2024-03-05 10:00 GMT+07:00')!.time).toBe(utc(2024, 3, 5, 3));
    expect(sdf('yyyy-MM-dd HH:mm z').parse('2024-03-05 10:00 PST')!.time).toBe(utc(2024, 3, 5, 18));
    expect(sdf('EEEE, d MMM yyyy HH:mm (z)').parse('Tuesday, 5 Mar 2024 10:00 (UTC)')!.time).toBe(utc(2024, 3, 5, 10));
  });

  it('12-hour clock with AM/PM', () => {
    expect(sdf('yyyy-MM-dd hh:mm a').parse('2024-03-05 12:30 AM')!.time).toBe(utc(2024, 3, 5, 0, 30));
    expect(sdf('yyyy-MM-dd hh:mm a').parse('2024-03-05 03:30 pm')!.time).toBe(utc(2024, 3, 5, 15, 30));
    expect(sdf('yyyy-MM-dd hh:mm:ss').parse('2024-03-05 03:30:00')!.time).toBe(utc(2024, 3, 5, 3, 30));
  });

  it('parse(text, ParsePosition) semantics', () => {
    const pos = new ParsePosition(0);
    expect(sdf('yyyy-MM-dd').parse('2024-03-05 trailing', pos)!.time).toBe(utc(2024, 3, 5));
    expect(pos.index).toBe(10);
    const bad = new ParsePosition(0);
    expect(sdf('yyyy-MM-dd').parse('abc', bad)).toBeNull();
    expect(bad.index).toBe(0);
    expect(bad.errorIndex).toBe(0);
    const PP = timeModules['java.text.ParsePosition'] as any;
    const p2 = PP(5);
    expect(sdf('yyyy').parse('date:2024', p2)!.time).toBe(utc(2024, 1, 1));
    expect(p2.index).toBe(9);
  });

  it('parse(text) throws ParseException', () => {
    let err: unknown;
    try {
      sdf('yyyy-MM-dd').parse('garbage');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ParseException);
    expect((err as Error).message).toBe('Unparseable date: "garbage"');
    expect((err as any).errorOffset).toBe(0);
  });

  it('lenient by default; isLenient = false rejects out-of-range fields', () => {
    expect(sdf('yyyy-MM-dd').parse('2023-02-30')!.time).toBe(utc(2023, 3, 2));
    expect(sdf('yyyy-MM-dd').parse('2023-13-01')!.time).toBe(utc(2024, 1, 1));
    const strict = sdf('yyyy-MM-dd');
    setProp(strict, 'isLenient', [], false);
    expect(strict.isLenient).toBe(false);
    expect(strict.parse('2023-02-30', new ParsePosition(0))).toBeNull();
    expect(strict.parse('2023-02-28', new ParsePosition(0))!.time).toBe(utc(2023, 2, 28));
  });

  it('format', () => {
    const ms = utc(2024, 3, 5, 14, 7, 9, 45);
    expect(sdf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").format(new JDate(ms))).toBe('2024-03-05T14:07:09.045Z');
    expect(sdf('EEE, d MMM yyyy hh:mm a').format(ms)).toBe('Tue, 5 Mar 2024 02:07 PM');
    expect(sdf('EEEE dd MMMM yy').format(ms)).toBe('Tuesday 05 March 24');
    expect(sdf('dd MMMM yyyy', Locale.FRENCH).format(ms)).toBe('05 mars 2024');
    expect(sdf('yyyy-MM-dd HH:mm Z', Locale.ENGLISH, TimeZone.getTimeZone('Asia/Kolkata')).format(ms)).toBe('2024-03-05 19:37 +0530');
    expect(sdf('XXX', Locale.ENGLISH, TimeZone.getTimeZone('America/New_York')).format(ms)).toBe('-05:00');
    expect(sdf('X').format(ms)).toBe('Z');
    expect(sdf('z').format(ms)).toBe('UTC');
    expect(sdf('k K h H').format(utc(2024, 1, 1, 0))).toBe('24 0 12 0');
    expect(sdf("'quoted ''text''' D w u").format(ms)).toBe("quoted 'text' 65 10 2");
  });

  it('invalid pattern letters throw', () => {
    expect(() => new SimpleDateFormat('yyyy-MM-ddTHH', Locale.US)).toThrow(IllegalArgumentException);
  });

  it('callable constructor and default pattern', () => {
    const S = timeModules['java.text.SimpleDateFormat'] as any;
    const f = S('yyyy', Locale.US);
    expect(f).toBeInstanceOf(SimpleDateFormat);
    expect(new SimpleDateFormat().toPattern()).toBe('M/d/yy h:mm a');
  });
});

describe('java.time.format.DateTimeFormatter', () => {
  const p = (pattern: string, locale: Locale = Locale.ENGLISH) => DateTimeFormatter.ofPattern(pattern, locale);

  it('common source patterns (English)', () => {
    expect(LocalDate.parse('January 5, 2024', p('MMMM d, yyyy')).toString()).toBe('2024-01-05');
    expect(LocalDate.parse('December 25, 2023', p('MMMM dd, yyyy')).toString()).toBe('2023-12-25');
    expect(LocalDate.parse('Mar 05, 2024', p('MMM dd, yyyy')).toString()).toBe('2024-03-05');
    expect(LocalDate.parse('Sep 5, 2024', p('MMM d, yyyy')).toString()).toBe('2024-09-05');
    expect(LocalDate.parse('05/03/2024', p('dd/MM/yyyy')).toString()).toBe('2024-03-05');
    expect(LocalDate.parse('3/5/2024', p('M/d/yyyy')).toString()).toBe('2024-03-05');
    expect(LocalDate.parse('2024.3.5', p('yyyy.M.d')).toString()).toBe('2024-03-05');
    expect(LocalDate.parse('5 Mar. 2024', p('d MMM. yyyy')).toString()).toBe('2024-03-05');
    expect(LocalDate.parse('Mar 5, 2024', p('MMM d, uuuu')).toString()).toBe('2024-03-05');
    expect(LocalDate.parse('2024年3月5日', p('yyyy年M月d日', Locale.ROOT)).toString()).toBe('2024-03-05');
    expect(LocalDate.parse('2024.03.05更新', p("yyyy.MM.dd'更新'")).toString()).toBe('2024-03-05');
    expect(LocalDateTime.parse('2024-03-05 10:15:30', p('yyyy-MM-dd HH:mm:ss')).toString()).toBe('2024-03-05T10:15:30');
    expect(LocalDateTime.parse('2024-03-05 at 10:15:30', p("yyyy-MM-dd 'at' HH:mm:ss")).toString()).toBe('2024-03-05T10:15:30');
    expect(LocalDateTime.parse('January 5, 2024 3:07 PM', p('MMMM d, yyyy h:mm a')).toString()).toBe('2024-01-05T15:07');
  });

  it('text matching is case-sensitive unless parseCaseInsensitive()', () => {
    expect(() => LocalDate.parse('january 5, 2024', p('MMMM d, yyyy'))).toThrow(DateTimeParseException);
    expect(() => LocalDate.parse('September 5, 2024', p('MMM d, yyyy'))).toThrow(DateTimeParseException);
    const B = timeModules['java.time.format.DateTimeFormatterBuilder'] as any;
    const ci = B().parseCaseInsensitive().appendPattern('MMMM d, yyyy').toFormatter(Locale.ENGLISH);
    expect(LocalDate.parse('JANUARY 5, 2024', ci).toString()).toBe('2024-01-05');
  });

  it('localized names (French, Spanish, Portuguese, Indonesian, Russian, Turkish)', () => {
    expect(LocalDate.parse('5 mars 2024', p('d MMMM yyyy', Locale.FRENCH)).toString()).toBe('2024-03-05');
    expect(LocalDate.parse('14 févr. 2024', p('d MMM yyyy', Locale.FRENCH)).toString()).toBe('2024-02-14');
    expect(LocalDate.parse('05 enero 2024', p('dd MMMM yyyy', ES)).toString()).toBe('2024-01-05');
    expect(LocalDate.parse('05 de enero de 2024', p("dd 'de' MMMM 'de' yyyy", ES)).toString()).toBe('2024-01-05');
    expect(LocalDate.parse('5 de março de 2024', p("d 'de' MMMM 'de' yyyy", PT_BR)).toString()).toBe('2024-03-05');
    expect(LocalDate.parse('17 Agustus 2024', p('dd MMMM yyyy', ID)).toString()).toBe('2024-08-17');
    expect(LocalDate.parse('5 марта 2024', p('d MMMM yyyy', new Locale('ru'))).toString()).toBe('2024-03-05');
    expect(LocalDate.parse('5 Mart 2024', p('d MMMM yyyy', Locale.forLanguageTag('tr'))).toString()).toBe('2024-03-05');
    expect(p('d MMMM yyyy', Locale.FRENCH).format(LocalDate.of(2024, 8, 1))).toBe('1 août 2024');
    expect(p('EEEE d MMMM', ES).format(LocalDate.of(2024, 3, 5))).toBe('martes 5 marzo');
  });

  it('optional sections', () => {
    const f = p('[MMMM][MMM] d, yyyy');
    expect(LocalDate.parse('March 5, 2024', f).toString()).toBe('2024-03-05');
    expect(LocalDate.parse('Mar 5, 2024', f).toString()).toBe('2024-03-05');
    const g = p('yyyy-MM-dd[ HH:mm[:ss]]');
    expect(LocalDate.parse('2024-03-05', g).toString()).toBe('2024-03-05');
    expect(LocalDateTime.parse('2024-03-05 10:15', g).toString()).toBe('2024-03-05T10:15');
    expect(LocalDateTime.parse('2024-03-05 10:15:30', g).toString()).toBe('2024-03-05T10:15:30');
    expect(g.format(LocalDate.of(2024, 3, 5))).toBe('2024-03-05');
    expect(g.format(LocalDateTime.of(2024, 3, 5, 10, 15))).toBe('2024-03-05 10:15:00');
    const h = p("yyyy-MM-dd'T'HH:mm:ss[XXX][XX]");
    expect(OffsetDateTime.parse('2024-03-05T10:15:30+0700', h).toString()).toBe('2024-03-05T10:15:30+07:00');
  });

  it('strict widths and SMART resolution', () => {
    expect(() => LocalDate.parse('2024-1-5', p('yyyy-MM-dd'))).toThrow(DateTimeParseException);
    expect(() => LocalDate.parse('24-01-05', p('yyyy-MM-dd'))).toThrow('could not be parsed at index 0');
    expect(LocalDate.parse('2024-1-5', p('yyyy-M-d')).toString()).toBe('2024-01-05');
    expect(LocalDate.parse('20240305', p('yyyyMMdd')).toString()).toBe('2024-03-05');
    expect(LocalDateTime.parse('2024030510', p('yyyyMMddHH')).toString()).toBe('2024-03-05T10:00');
    expect(LocalDate.parse('05/03/24', p('dd/MM/yy')).toString()).toBe('2024-03-05');
    expect(LocalDate.parse('05/03/99', p('dd/MM/yy')).toString()).toBe('2099-03-05'); // base year 2000
    expect(LocalDate.parse('2023-02-30', p('yyyy-MM-dd')).toString()).toBe('2023-02-28'); // SMART clamps
    expect(() => LocalDate.parse('2023-02-30', DateTimeFormatter.ISO_LOCAL_DATE)).toThrow(DateTimeParseException); // STRICT
    expect(() => LocalDate.parse('2023-02-32', p('yyyy-MM-dd'))).toThrow('DayOfMonth');
    expect(() => LocalDate.parse('2024-03-05x', p('yyyy-MM-dd'))).toThrow("Text '2024-03-05x' could not be parsed, unparsed text found at index 10");
    expect(() => LocalDate.parse('2024-03', p('yyyy-MM'))).toThrow('Unable to obtain LocalDate');
    expect(() => LocalDateTime.parse('2024-01-05 3:07', p('yyyy-MM-dd h:mm'))).toThrow('Unable to obtain LocalDateTime');
    expect(() => LocalDate.parse('Tuesday, 5 Feb 2024', p('EEEE, d MMM yyyy'))).toThrow('Conflict found');
    expect(LocalDate.parse('Monday, 5 Feb 2024', p('EEEE, d MMM yyyy')).toString()).toBe('2024-02-05');
  });

  it('parse errors are DateTimeParseException (a DateTimeException)', () => {
    let err: unknown;
    try {
      LocalDate.parse('abc', p('yyyy-MM-dd'));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DateTimeParseException);
    expect(isCatch(err, DateTimeException)).toBe(true);
    expect((err as Error).message).toBe("Text 'abc' could not be parsed at index 0");
  });

  it('parseDefaulting fills missing fields', () => {
    const f = new DateTimeFormatterBuilder().appendPattern('d MMMM').parseDefaulting(ChronoField.YEAR, 2024).toFormatter(Locale.ENGLISH);
    expect(LocalDate.parse('5 March', f).toString()).toBe('2024-03-05');
    const g = new DateTimeFormatterBuilder()
      .appendPattern('yyyy-MM-dd')
      .parseDefaulting(ChronoField.HOUR_OF_DAY, 0)
      .parseDefaulting(ChronoField.MINUTE_OF_HOUR, 0)
      .toFormatter(Locale.ROOT);
    expect(LocalDateTime.parse('2024-03-05', g).toString()).toBe('2024-03-05T00:00');
  });

  it('builder: appendValue / appendText with a map / appendLiteral', () => {
    const months = new Map<number, string>([
      [1, 'январь'],
      [2, 'февраль'],
      [3, 'март'],
    ]);
    const f = new DateTimeFormatterBuilder()
      .appendValue(ChronoField.DAY_OF_MONTH, 1, 2, (timeModules['java.time.format.SignStyle'] as any).NOT_NEGATIVE)
      .appendLiteral(' ')
      .appendText(ChronoField.MONTH_OF_YEAR, months)
      .appendLiteral(' ')
      .appendValue(ChronoField.YEAR, 4)
      .toFormatter();
    expect(LocalDate.parse('5 март 2024', f).toString()).toBe('2024-03-05');
    expect(f.format(LocalDate.of(2024, 2, 9))).toBe('9 февраль 2024');
    const frac = new DateTimeFormatterBuilder().appendPattern('yyyy-MM-dd HH:mm:ss').appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true).toFormatter();
    expect(LocalDateTime.parse('2024-03-05 10:15:30.5', frac).nano).toBe(500_000_000);
    expect(LocalDateTime.parse('2024-03-05 10:15:30', frac).nano).toBe(0);
  });

  it('ISO constants', () => {
    expect(LocalDateTime.parse('2024-03-05T10:15:30', DateTimeFormatter.ISO_LOCAL_DATE_TIME).toString()).toBe('2024-03-05T10:15:30');
    expect(LocalDateTime.parse('2024-03-05t10:15', DateTimeFormatter.ISO_LOCAL_DATE_TIME).toString()).toBe('2024-03-05T10:15');
    expect(LocalDate.parse('2024-03-05', DateTimeFormatter.ISO_LOCAL_DATE).toString()).toBe('2024-03-05');
    expect(OffsetDateTime.parse('2024-03-05T10:15:30.123456789+07:00', DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant().toString()).toBe('2024-03-05T03:15:30.123456789Z');
    expect(OffsetDateTime.parse('2024-03-05T10:15:30+07').toString()).toBe('2024-03-05T10:15:30+07:00');
    // The JDK's lenient offset parser keeps the colon style of "+HH:MM:ss", so "+0700" is rejected.
    expect(() => OffsetDateTime.parse('2024-03-05T10:15:30+0700')).toThrow('unparsed text found at index 22');
    expect(OffsetDateTime.parse('2024-03-05T10:15:30Z').offset).toBe(ZoneOffset.UTC);
    expect(ZonedDateTime.parse('2024-03-05T10:15:30+07:00[Asia/Jakarta]').zone.id).toBe('Asia/Jakarta');
    expect(ZonedDateTime.parse('2024-03-05T10:15:30', DateTimeFormatter.ISO_DATE_TIME.withZone(JAKARTA())).toString()).toBe('2024-03-05T10:15:30+07:00[Asia/Jakarta]');
    expect(LocalDateTime.parse('2024-03-05T10:15:30+07:00', DateTimeFormatter.ISO_DATE_TIME).toString()).toBe('2024-03-05T10:15:30');
    expect(Instant.from(DateTimeFormatter.ISO_INSTANT.parse('2024-03-05T10:15:30.5Z')).toEpochMilli()).toBe(utc(2024, 3, 5, 10, 15, 30, 500));
    expect(DateTimeFormatter.ISO_LOCAL_DATE_TIME.format(LocalDateTime.of(2024, 3, 5, 10, 15))).toBe('2024-03-05T10:15:00');
    expect(DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(ZonedDateTime.of(LocalDateTime.of(2024, 3, 5, 10, 0), JAKARTA()))).toBe('2024-03-05T10:00:00+07:00');
    expect(DateTimeFormatter.ISO_ZONED_DATE_TIME.format(ZonedDateTime.of(LocalDateTime.of(2024, 3, 5, 10, 0), JAKARTA()))).toBe('2024-03-05T10:00:00+07:00[Asia/Jakarta]');
    expect(DateTimeFormatter.ISO_INSTANT.format(Instant.ofEpochMilli(1_700_000_000_120))).toBe('2023-11-14T22:13:20.120Z');
    expect(DateTimeFormatter.BASIC_ISO_DATE.format(LocalDate.of(2024, 3, 5))).toBe('20240305');
    expect(ZonedDateTime.parse('Tue, 5 Mar 2024 10:15:30 GMT', DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()).toBe(utc(2024, 3, 5, 10, 15, 30));
  });

  it('offset pattern letters: XXX, X, Z, x, O', () => {
    const f = p("yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
    const z = ZonedDateTime.parse('2024-03-05T10:15:30.123+07:00', f);
    expect(z.toInstant().toEpochMilli()).toBe(utc(2024, 3, 5, 3, 15, 30, 123));
    expect(ZonedDateTime.parse('2024-03-05T10:15:30.123Z', f).toInstant().toEpochMilli()).toBe(utc(2024, 3, 5, 10, 15, 30, 123));
    expect(() => ZonedDateTime.parse('2024-03-05T10:15:30.123+0700', f)).toThrow(DateTimeParseException);
    expect(ZonedDateTime.parse('2024-03-05T10:15:30+0700', p("yyyy-MM-dd'T'HH:mm:ssZ")).offset.totalSeconds).toBe(25200);
    expect(ZonedDateTime.parse('2024-03-05T10:15:30+07', p("yyyy-MM-dd'T'HH:mm:ssX")).offset.totalSeconds).toBe(25200);
    expect(ZonedDateTime.parse('2024-03-05T10:15:30GMT+7', p("yyyy-MM-dd'T'HH:mm:ssO")).offset.totalSeconds).toBe(25200);
    const zdt = ZonedDateTime.of(LocalDateTime.of(2024, 3, 5, 10, 0), ZoneId.of('Asia/Kolkata'));
    expect(p('XXX X xx Z ZZZZ ZZZZZ O').format(zdt)).toBe('+05:30 +0530 +0530 +0530 GMT+05:30 +05:30 GMT+5:30');
    expect(p('XXX x Z').format(ZonedDateTime.of(LocalDateTime.of(2024, 3, 5, 10, 0), ZoneOffset.UTC))).toBe('Z +00 +0000');
  });

  it('zone names and ids (z, VV)', () => {
    const f = p('EEEE, d MMM yyyy HH:mm (z)');
    expect(ZonedDateTime.parse('Tuesday, 5 Mar 2024 10:00 (WIB)', f).toInstant().toEpochMilli()).toBe(utc(2024, 3, 5, 3));
    expect(ZonedDateTime.parse('Tuesday, 5 Mar 2024 10:00 (UTC)', f).toInstant().toEpochMilli()).toBe(utc(2024, 3, 5, 10));
    expect(f.format(ZonedDateTime.of(LocalDateTime.of(2024, 3, 5, 10, 0), ZoneOffset.UTC))).toBe('Tuesday, 5 Mar 2024 10:00 (Z)');
    expect(f.format(ZonedDateTime.of(LocalDateTime.of(2024, 3, 5, 10, 0), ZoneId.of('UTC')))).toBe('Tuesday, 5 Mar 2024 10:00 (UTC)');
    expect(f.format(ZonedDateTime.of(LocalDateTime.of(2024, 1, 5, 10, 0), ZoneId.of('America/Los_Angeles')))).toBe('Friday, 5 Jan 2024 10:00 (PST)');
    const v = p("yyyy-MM-dd'T'HH:mm'['VV']'");
    expect(ZonedDateTime.parse('2024-03-05T10:00[Asia/Jakarta]', v).zone.id).toBe('Asia/Jakarta');
    expect(v.format(ZonedDateTime.of(LocalDateTime.of(2024, 3, 5, 10, 0), JAKARTA()))).toBe('2024-03-05T10:00[Asia/Jakarta]');
  });

  it('withZone / withLocale / zone property', () => {
    const f = p('yyyy-MM-dd HH:mm');
    expect(f.zone).toBeNull();
    const fz = f.withZone(JAKARTA());
    expect(fz.zone!.id).toBe('Asia/Jakarta');
    expect(fz.format(Instant.ofEpochMilli(utc(2024, 3, 5, 3)))).toBe('2024-03-05 10:00');
    expect(() => f.format(Instant.ofEpochMilli(0))).toThrow(UnsupportedTemporalTypeException);
    expect(ZonedDateTime.parse('2024-03-05 10:00', fz).toInstant().toEpochMilli()).toBe(utc(2024, 3, 5, 3));
    expect(p('MMMM').withLocale(Locale.FRENCH).format(LocalDate.of(2024, 2, 1))).toBe('février');
    expect(p('MMMM').withLocale(Locale.FRENCH).locale).toBe(Locale.FRENCH);
  });

  it('format of local types', () => {
    const d = LocalDate.of(2024, 3, 5);
    expect(p('dd MMM yyyy').format(d)).toBe('05 Mar 2024');
    expect(d.format(p('EEE, MMM d, yy'))).toBe('Tue, Mar 5, 24');
    expect(p('h:mm a').format(LocalTime.of(0, 5))).toBe('12:05 AM');
    expect(p('HH:mm:ss.SSS').format(LocalTime.of(10, 15, 30, 123_456_789))).toBe('10:15:30.123');
    expect(() => p('HH:mm').format(d)).toThrow('Unsupported field: HourOfDay');
    expect(p('D w W e c Y').format(LocalDate.of(2024, 12, 31))).toBe('366 1 5 3 3 2025');
  });

  it('pattern validation', () => {
    expect(() => DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH")).not.toThrow();
    expect(() => DateTimeFormatter.ofPattern('yyyy-MM-ddTHH')).toThrow('Unknown pattern letter: T');
    expect(() => DateTimeFormatter.ofPattern('ddd')).toThrow('Too many pattern letters: d');
    expect(() => DateTimeFormatter.ofPattern("yyyy 'x")).toThrow(IllegalArgumentException);
  });
});

describe('java.time types', () => {
  it('Instant', () => {
    const i = Instant.parse('2024-03-05T10:15:30Z');
    expect(i.toEpochMilli()).toBe(utc(2024, 3, 5, 10, 15, 30));
    expect(i.epochSecond).toBe(utc(2024, 3, 5, 10, 15, 30) / 1000);
    expect(i.getEpochSecond()).toBe(i.epochSecond);
    expect(Instant.parse('2024-03-05T10:15:30+01:00').toString()).toBe('2024-03-05T09:15:30Z');
    expect(Instant.parse('2024-03-05T10:15:30.120Z').toString()).toBe('2024-03-05T10:15:30.120Z');
    expect(() => Instant.parse('2024-03-05')).toThrow(DateTimeParseException);
    expect(Instant.ofEpochMilli(-1).toString()).toBe('1969-12-31T23:59:59.999Z');
    expect(Instant.ofEpochSecond(10).toEpochMilli()).toBe(10_000);
    expect(i.minus(3, ChronoUnit.DAYS).toString()).toBe('2024-03-02T10:15:30Z');
    expect(i.minus(90, ChronoUnit.MINUTES).toString()).toBe('2024-03-05T08:45:30Z');
    expect(i.plus(Duration.ofHours(2)).toString()).toBe('2024-03-05T12:15:30Z');
    expect(i.plusSeconds(30).plusMillis(5).toString()).toBe('2024-03-05T10:16:00.005Z');
    expect(() => i.minus(1, ChronoUnit.MONTHS)).toThrow('Unsupported unit: Months');
    expect(i.truncatedTo(ChronoUnit.HOURS).toString()).toBe('2024-03-05T10:00:00Z');
    expect(i.isBefore(i.plusNanos(1))).toBe(true);
    expect(compare(i, i.plusNanos(1))).toBeLessThan(0);
    expect(Math.abs(Instant.now().toEpochMilli() - Date.now())).toBeLessThan(1000);
    expect(ChronoUnit.HOURS.between(i, i.plusSeconds(7200 + 59))).toBe(2);
    expect(i.atZone(JAKARTA()).toLocalDateTime().toString()).toBe('2024-03-05T17:15:30');
  });

  it('LocalDate', () => {
    const d = LocalDate.of(2024, 3, 31);
    expect([d.year, d.monthValue, d.dayOfMonth, d.dayOfYear]).toEqual([2024, 3, 31, 91]);
    expect(d.month).toBe(Month.MARCH);
    expect(d.dayOfWeek).toBe(DayOfWeek.SUNDAY);
    expect(d.dayOfWeek.value).toBe(7);
    expect(d.minusDays(31).toString()).toBe('2024-02-29');
    expect(d.minusWeeks(1).toString()).toBe('2024-03-24');
    expect(d.minusMonths(1).toString()).toBe('2024-02-29');
    expect(LocalDate.of(2024, 2, 29).minusYears(1).toString()).toBe('2023-02-28');
    expect(d.plusDays(1).toString()).toBe('2024-04-01');
    expect(d.plus(1, ChronoUnit.MONTHS).toString()).toBe('2024-04-30');
    expect(d.withDayOfMonth(1).toString()).toBe('2024-03-01');
    expect(prop(d, 'isLeapYear', [])).toBe(true);
    expect(d.lengthOfMonth()).toBe(31);
    expect(d.atStartOfDay(JAKARTA()).toInstant().toEpochMilli()).toBe(utc(2024, 3, 30, 17));
    expect(d.atStartOfDay().toString()).toBe('2024-03-31T00:00');
    expect(d.atTime(10, 30).toString()).toBe('2024-03-31T10:30');
    expect(d.atTime(LocalTime.NOON).toString()).toBe('2024-03-31T12:00');
    expect(LocalDate.parse('2024-03-05').toEpochDay()).toBe(19787);
    expect(() => LocalDate.of(2023, 2, 29)).toThrow("Invalid date 'February 29' as '2023' is not a leap year");
    expect(() => LocalDate.of(2024, 4, 31)).toThrow("Invalid date 'APRIL 31'");
    expect(ChronoUnit.DAYS.between(LocalDate.of(2024, 1, 1), LocalDate.of(2024, 3, 1))).toBe(60);
    expect(LocalDate.of(2024, 1, 31).until(LocalDate.of(2024, 2, 29), ChronoUnit.MONTHS)).toBe(0);
    expect(LocalDate.of(2024, 3, 5).isAfter(LocalDate.of(2024, 3, 4))).toBe(true);
    expect(LocalDate.of(2024, 3, 5).equals(LocalDate.parse('2024-03-05'))).toBe(true);
    expect(LocalDate.of(2024, 3, 5).get(ChronoField.DAY_OF_WEEK)).toBe(2);
    expect(LocalDate.of(2024, 3, 5).get(WeekFields.SUNDAY_START.dayOfWeek())).toBe(3);
  });

  it('LocalDate.now(zone) uses the zone', () => {
    const expected = LocalDate.ofEpochDay(Math.floor((Date.now() + 7 * 3600_000) / DAY));
    expect(LocalDate.now(JAKARTA()).equals(expected)).toBe(true);
    expect(LocalDate.now().equals(LocalDate.ofEpochDay(Math.floor(Date.now() / DAY)))).toBe(true);
  });

  it('LocalDateTime', () => {
    const t = LocalDateTime.parse('2024-03-05T23:30:15');
    expect([t.hour, t.minute, t.second]).toEqual([23, 30, 15]);
    expect(t.plusHours(1).toString()).toBe('2024-03-06T00:30:15');
    expect(t.toLocalDate().toString()).toBe('2024-03-05');
    expect(t.atZone(JAKARTA()).toInstant().toEpochMilli()).toBe(utc(2024, 3, 5, 16, 30, 15));
    expect(t.atOffset(ZoneOffset.ofHours(-3)).toInstant().toString()).toBe('2024-03-06T02:30:15Z');
    expect(t.toEpochSecond(ZoneOffset.UTC)).toBe(utc(2024, 3, 5, 23, 30, 15) / 1000);
    expect(t.truncatedTo(ChronoUnit.DAYS).toString()).toBe('2024-03-05T00:00');
    expect(LocalDateTime.of(2024, 3, 5, 10, 0).until(LocalDateTime.of(2024, 3, 7, 9, 0), ChronoUnit.DAYS)).toBe(1);
    expect(LocalDateTime.of(2024, 3, 5, 10, 0, 0, 500_000_000).toString()).toBe('2024-03-05T10:00:00.500');
  });

  it('ZonedDateTime with ZoneId.of("Asia/Jakarta")', () => {
    const z = ZonedDateTime.of(LocalDateTime.of(2024, 3, 5, 10, 0), JAKARTA());
    expect(z.toString()).toBe('2024-03-05T10:00+07:00[Asia/Jakarta]');
    expect(z.offset.id).toBe('+07:00');
    expect(z.toEpochSecond()).toBe(utc(2024, 3, 5, 3) / 1000);
    expect(z.withZoneSameInstant(ZoneOffset.UTC).toString()).toBe('2024-03-05T03:00Z');
    expect(z.withZoneSameInstant(ZoneId.of('Asia/Tokyo')).toLocalDateTime().toString()).toBe('2024-03-05T12:00');
    expect(z.minus(2, ChronoUnit.WEEKS).toLocalDate().toString()).toBe('2024-02-20');
    expect(z.minusMonths(1).toString()).toBe('2024-02-05T10:00+07:00[Asia/Jakarta]');
    expect(z.minusYears(1).year).toBe(2023);
    const now = ZonedDateTime.now(JAKARTA());
    expect(now.zone.id).toBe('Asia/Jakarta');
    expect(Math.abs(now.minus(5, ChronoUnit.DAYS).toInstant().toEpochMilli() - (Date.now() - 5 * DAY))).toBeLessThan(1000);
    expect(now.truncatedTo(ChronoUnit.HOURS).minute).toBe(0);
  });

  it('ZonedDateTime DST gaps and overlaps (America/New_York)', () => {
    const ny = ZoneId.of('America/New_York');
    expect(LocalDateTime.of(2024, 3, 10, 2, 30).atZone(ny).toString()).toBe('2024-03-10T03:30-04:00[America/New_York]');
    expect(LocalDateTime.of(2024, 11, 3, 1, 30).atZone(ny).toString()).toBe('2024-11-03T01:30-04:00[America/New_York]');
    const base = ZonedDateTime.of(LocalDateTime.of(2024, 3, 9, 12, 0), ny);
    expect(base.plusDays(1).toString()).toBe('2024-03-10T12:00-04:00[America/New_York]');
    expect(base.plus(24, ChronoUnit.HOURS).toString()).toBe('2024-03-10T13:00-04:00[America/New_York]');
    expect(LocalDate.of(2024, 3, 10).atStartOfDay(ny).toString()).toBe('2024-03-10T00:00-05:00[America/New_York]');
  });

  it('ZoneId / ZoneOffset', () => {
    expect(ZoneId.of('Asia/Jakarta').id).toBe('Asia/Jakarta');
    expect(ZoneId.of('UTC').id).toBe('UTC');
    expect(ZoneId.of('Z')).toBe(ZoneOffset.UTC);
    expect(ZoneId.of('+07:00')).toBeInstanceOf(ZoneOffset);
    expect(ZoneId.of('GMT+7').id).toBe('GMT+07:00');
    expect(ZoneId.of('UTC+09:00').rules.getOffset(Instant.now()).totalSeconds).toBe(9 * 3600);
    expect(() => ZoneId.of('Mars/Olympus')).toThrow(ZoneRulesException);
    expect(() => ZoneId.of('asia/jakarta')).toThrow(ZoneRulesException);
    expect(ZoneOffset.UTC.id).toBe('Z');
    expect(ZoneOffset.of('+07:00').totalSeconds).toBe(25200);
    expect(ZoneOffset.of('-0330').id).toBe('-03:30');
    expect(ZoneOffset.ofHours(9).id).toBe('+09:00');
    expect(() => ZoneOffset.of('+7:00')).toThrow(DateTimeException);
    expect(ZoneId.systemDefault().id).toBe('UTC');
    expect(ZoneId.of('Asia/Jakarta').equals(JAKARTA())).toBe(true);
  });

  it('OffsetDateTime', () => {
    const o = OffsetDateTime.parse('2024-03-05T10:15:30+07:00');
    expect(o.toInstant().toEpochMilli()).toBe(utc(2024, 3, 5, 3, 15, 30));
    expect(o.toEpochSecond()).toBe(utc(2024, 3, 5, 3, 15, 30) / 1000);
    expect(o.withOffsetSameInstant(ZoneOffset.UTC).toString()).toBe('2024-03-05T03:15:30Z');
    expect(OffsetDateTime.of(2024, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC).toInstant().toEpochMilli()).toBe(utc(2024, 1, 1));
  });

  it('java.time.Duration, Year, enums', () => {
    expect(Duration.ofMinutes(90).toString()).toBe('PT1H30M');
    expect(Duration.ofMillis(1500).toString()).toBe('PT1.5S');
    expect(Duration.ofSeconds(-1, 500_000_000).toString()).toBe('PT-0.5S');
    expect(Duration.ZERO.toString()).toBe('PT0S');
    expect(Duration.ofDays(2).toHours()).toBe(48);
    expect(Duration.between(Instant.ofEpochSecond(0), Instant.ofEpochSecond(3600, 5)).toMillis()).toBe(3_600_000);
    expect(prop(Duration.ofSeconds(-5), 'isNegative', [])).toBe(true);
    expect(prop(Year.of(2024), 'isLeap', [])).toBe(true);
    expect(Year.now().value).toBe(new Date().getUTCFullYear());
    expect(ChronoUnit.DAYS.toString()).toBe('Days');
    expect(ChronoUnit.valueOf('HOURS')).toBe(ChronoUnit.HOURS);
    expect(ChronoField.YEAR.toString()).toBe('Year');
    expect(DayOfWeek.MONDAY.getDisplayName(TextStyle.SHORT, Locale.ENGLISH)).toBe('Mon');
    expect(DayOfWeek.SUNDAY.plus(1)).toBe(DayOfWeek.MONDAY);
    expect(Month.FEBRUARY.getDisplayName(TextStyle.FULL, Locale.FRENCH)).toBe('février');
    expect(Month.FEBRUARY.length(true)).toBe(29);
  });
});

describe('kotlin.time', () => {
  it('Duration extension properties and toString', () => {
    expect(String(kd(90, 'seconds'))).toBe('1m 30s');
    expect(String(kd(1.5, 'seconds'))).toBe('1.5s');
    expect(String(kd(500, 'milliseconds'))).toBe('500ms');
    expect(String(kd(1, 'hours'))).toBe('1h');
    expect(String(kd(30, 'minutes'))).toBe('30m');
    expect(String(kd(2, 'days'))).toBe('2d');
    expect(String(kd(1, 'days').plus(kd(1, 'seconds')))).toBe('1d 0h 0m 1s');
    expect(String(kd(1500, 'microseconds'))).toBe('1.5ms');
    expect(String(kd(1.0001, 'seconds'))).toBe('1.000100s');
    expect(String(kd(12, 'nanoseconds'))).toBe('12ns');
    expect(String(kd(1, 'days').plus(kd(2, 'hours')).unaryMinus())).toBe('-(1d 2h)');
    expect(String(kd(-5, 'seconds'))).toBe('-5s');
    expect(String(KDuration.ZERO)).toBe('0s');
    expect(String(KDuration.INFINITE)).toBe('Infinity');
    expect(kd(90, 'minutes').toIsoString()).toBe('PT1H30M');
  });

  it('inWhole* and arithmetic', () => {
    expect(kd(30, 'seconds').inWholeMilliseconds).toBe(30_000);
    expect(kd(50, 'minutes').inWholeMilliseconds).toBe(3_000_000);
    expect(kd(2147483647, 'seconds').inWholeMilliseconds).toBe(2_147_483_647_000);
    expect(kd(1.5, 'milliseconds').inWholeNanoseconds).toBe(1_500_000);
    expect(kd(-1.5, 'milliseconds').inWholeMilliseconds).toBe(-1);
    expect(kd(3, 'days').inWholeHours).toBe(72);
    expect(kd(100, 'hours').inWholeDays).toBe(4);
    expect(kd(90, 'seconds').inWholeMinutes).toBe(1);
    expect(kd(1, 'seconds').plus(kd(500, 'milliseconds')).inWholeMilliseconds).toBe(1500);
    expect(minus(kd(1, 'seconds'), kd(1500, 'milliseconds')).inWholeMilliseconds).toBe(-500);
    expect(times(3, kd(2, 'seconds')).inWholeSeconds).toBe(6);
    expect(times(kd(2, 'seconds'), 1.5).inWholeMilliseconds).toBe(3000);
    expect(kd(10, 'seconds').div(4).inWholeMilliseconds).toBe(2500);
    expect(kd(10, 'seconds').div(kd(4, 'seconds'))).toBe(2.5);
    expect(compare(kd(1, 'minutes'), kd(59, 'seconds'))).toBeGreaterThan(0);
    expect(kd(60, 'seconds').equals(kd(1, 'minutes'))).toBe(true);
    expect(kd(1, 'hours').toDouble(DurationUnit.MINUTES)).toBe(60);
    expect(call(5, 'toDuration', [timeModules['kotlin.time.toDuration'] as any], [DurationUnit.SECONDS]).inWholeMilliseconds).toBe(5000);
    expect(KDuration.parse('1h 30m').inWholeMinutes).toBe(90);
    expect(KDuration.parse('PT1H30M').inWholeMinutes).toBe(90);
    expect(kd(1, 'hours').toComponents((h: number, m: number, s: number, ns: number) => [h, m, s, ns])).toEqual([1, 0, 0, 0]);
  });

  it('Instant and Clock', () => {
    expect(KInstant.parse('1999-03-22T05:06:07.000Z').toEpochMilliseconds()).toBe(922_079_167_000);
    expect(KInstant.parse('1999-03-22T05:06:07+01:00').toEpochMilliseconds()).toBe(922_079_167_000 - 3600_000);
    expect(KInstant.parse('2020-08-30T18:43:00.50Z').toString()).toBe('2020-08-30T18:43:00.500Z');
    expect(KInstant.parseOrNull('2024-03-05')).toBeNull();
    expect(KInstant.parseOrNull('2024-02-30T00:00:00Z')).toBeNull();
    expect(() => KInstant.parse('nope')).toThrow(IllegalArgumentException);
    const i = KInstant.fromEpochMilliseconds(1_700_000_000_123);
    expect(i.epochSeconds).toBe(1_700_000_000);
    expect(i.nanosecondsOfSecond).toBe(123_000_000);
    expect(i.toString()).toBe('2023-11-14T22:13:20.123Z');
    expect(KInstant.fromEpochSeconds(10).toEpochMilliseconds()).toBe(10_000);
    const now = (timeModules['kotlin.time.Clock'] as any).System.now();
    expect(Math.abs(now.toEpochMilliseconds() - Date.now())).toBeLessThan(1000);
    // `Clock.System.now() - 1.days`
    const yesterday = minus(now, kd(1, 'days'));
    expect(now.toEpochMilliseconds() - yesterday.toEpochMilliseconds()).toBe(DAY);
    expect(plus(now, kd(1, 'seconds')).toEpochMilliseconds() - now.toEpochMilliseconds()).toBe(1000);
    expect(minus(now, yesterday).inWholeHours).toBe(24);
    expect(compare(yesterday, now)).toBeLessThan(0);
    expect(Clock.System).toBe(timeModules['kotlin.time.Clock.System']);
  });

  it('java interop', () => {
    const k = KInstant.fromEpochMilliseconds(1234);
    const j = call(k, 'toJavaInstant', [timeModules['kotlin.time.toJavaInstant'] as any], []);
    expect(j).toBeInstanceOf(Instant);
    expect(j.toEpochMilli()).toBe(1234);
    expect(call(j, 'toKotlinInstant', [timeModules['kotlin.time.toKotlinInstant'] as any], []).equals(k)).toBe(true);
    expect(call(kd(90, 'seconds'), 'toJavaDuration', [timeModules['kotlin.time.toJavaDuration'] as any], []).toString()).toBe('PT1M30S');
  });
});

describe('keiyoushi.utils Date.kt', () => {
  it('SimpleDateFormat.tryParse', () => {
    const f = sdf('MMM dd, yyyy');
    expect(tryParse(f, 'Mar 05, 2024')).toBe(utc(2024, 3, 5));
    expect(tryParse(f, null)).toBe(0);
    expect(tryParse(f, 'not a date')).toBe(0);
  });

  it('Instant.Companion.tryParse (kotlin.time.Instant)', () => {
    const I = timeModules['kotlin.time.Instant'];
    expect(tryParse(I, '1999-03-22T05:06:07.000Z')).toBe(922_079_167_000);
    expect(tryParse(I, '1999-03-22T05:06:07+01:00')).toBe(922_079_167_000 - 3600_000);
    expect(tryParse(I, null)).toBe(0);
    expect(tryParse(I, 'garbage')).toBe(0);
  });

  it('DateTimeFormatter.tryParseDate', () => {
    const f = DateTimeFormatter.ofPattern('dd MMMM yyyy', ID);
    expect(tryParseDate(f, '17 Agustus 2024', JAKARTA())).toBe(utc(2024, 8, 16, 17));
    expect(tryParseDate(f, '17 Agustus 2024')).toBe(utc(2024, 8, 17)); // system default = UTC
    expect(tryParseDate(f.withZone(JAKARTA()), '17 Agustus 2024')).toBe(utc(2024, 8, 16, 17));
    expect(tryParseDate(DateTimeFormatter.ofPattern('yyyy-MM-dd', Locale.ROOT), '2024-03-05T10:00:00')).toBe(0);
    expect(tryParseDate(f, null)).toBe(0);
    expect(tryParseDate(f, 'nope')).toBe(0);
    // Offsets in the text are ignored: only date fields are used.
    expect(tryParseDate(DateTimeFormatter.ISO_DATE, '2024-03-05+07:00')).toBe(utc(2024, 3, 5));
  });

  it('DateTimeFormatter.tryParseDateTime', () => {
    const f = DateTimeFormatter.ofPattern('yyyy-MM-dd HH:mm:ss', Locale.ROOT);
    expect(tryParseDateTime(f, '2024-03-05 10:00:00', JAKARTA())).toBe(utc(2024, 3, 5, 3));
    expect(tryParseDateTime(f, '2024-03-05 10:00:00')).toBe(utc(2024, 3, 5, 10));
    expect(tryParseDateTime(f.withZone(ZoneId.of('Asia/Seoul')), '2024-03-05 10:00:00')).toBe(utc(2024, 3, 5, 1));
    // The zone argument wins over an offset in the text.
    expect(tryParseDateTime(DateTimeFormatter.ISO_OFFSET_DATE_TIME, '2024-03-05T10:00:00+07:00', ZoneOffset.UTC)).toBe(utc(2024, 3, 5, 10));
    expect(tryParseDateTime(f, '2024-03-05')).toBe(0);
    expect(tryParseDateTime(f, null)).toBe(0);
  });

  it('DateTimeFormatter.tryParseZonedDateTime', () => {
    expect(tryParseZonedDateTime(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.ROOT), '2024-03-05T10:15:30.123+07:00')).toBe(utc(2024, 3, 5, 3, 15, 30, 123));
    expect(tryParseZonedDateTime(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.ROOT), '2024-03-05T10:15:30Z')).toBe(utc(2024, 3, 5, 10, 15, 30));
    expect(tryParseZonedDateTime(DateTimeFormatter.ISO_ZONED_DATE_TIME, '2024-03-05T10:15:30+09:00[Asia/Tokyo]')).toBe(utc(2024, 3, 5, 1, 15, 30));
    // Needs an offset or zone in the pattern.
    expect(tryParseZonedDateTime(DateTimeFormatter.ofPattern('yyyy-MM-dd HH:mm:ss', Locale.ROOT), '2024-03-05 10:15:30')).toBe(0);
    expect(tryParseZonedDateTime(DateTimeFormatter.ISO_OFFSET_DATE_TIME, null)).toBe(0);
  });
});

describe('timeModules', () => {
  it('exposes the imported FQNs', () => {
    for (const fqn of [
      'java.util.Locale',
      'java.util.TimeZone',
      'java.util.Date',
      'java.util.Calendar',
      'java.text.SimpleDateFormat',
      'java.text.ParsePosition',
      'java.text.ParseException',
      'java.time.Instant',
      'java.time.LocalDate',
      'java.time.LocalDateTime',
      'java.time.LocalTime',
      'java.time.ZonedDateTime',
      'java.time.OffsetDateTime',
      'java.time.ZoneId',
      'java.time.ZoneOffset',
      'java.time.Year',
      'java.time.DayOfWeek',
      'java.time.DateTimeException',
      'java.time.format.DateTimeFormatter',
      'java.time.format.DateTimeFormatterBuilder',
      'java.time.format.DateTimeParseException',
      'java.time.format.TextStyle',
      'java.time.format.SignStyle',
      'java.time.format.FormatStyle',
      'java.time.temporal.ChronoUnit',
      'java.time.temporal.ChronoField',
      'java.time.temporal.WeekFields',
      'kotlin.time.Duration',
      'kotlin.time.Instant',
      'kotlin.time.Clock',
      'kotlin.time.Duration.Companion.seconds',
      'kotlin.time.Duration.Companion.minutes',
      'kotlin.time.Duration.Companion.hours',
      'kotlin.time.Duration.Companion.days',
      'kotlin.time.Duration.Companion.milliseconds',
      'kotlin.time.toJavaInstant',
      'keiyoushi.utils.tryParse',
      'keiyoushi.utils.tryParseDate',
      'keiyoushi.utils.tryParseDateTime',
      'keiyoushi.utils.tryParseZonedDateTime',
    ]) {
      expect(timeModules[fqn], fqn).toBeDefined();
    }
    expect(Array.isArray(timeModules['keiyoushi.utils.tryParse'])).toBe(true);
    expect((timeModules['kotlin.time.Duration.Companion.seconds'] as any).prop).toBe(true);
  });
});

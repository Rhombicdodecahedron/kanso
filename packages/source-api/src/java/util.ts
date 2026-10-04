// Calendar arithmetic shared by java.util and java.time (proleptic Gregorian, like the JVM's ISO
// chronology; GregorianCalendar's Julian cutover in 1582 is deliberately not modelled).

import { DateTimeException } from '../kotlin/core';

export const MS_PER_DAY = 86_400_000;
export const SECS_PER_DAY = 86_400;
export const NANOS_PER_SECOND = 1_000_000_000;
export const NANOS_PER_DAY = 86_400 * NANOS_PER_SECOND;

export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function floorMod(a: number, b: number): number {
  const m = a % b;
  return m !== 0 && (m < 0) !== (b < 0) ? m + b : m === 0 ? 0 : m;
}

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function monthLength(y: number, m: number): number {
  return m === 2 && isLeap(y) ? 29 : MONTH_DAYS[m - 1];
}

/** Days since 1970-01-01 for a (year, month 1-12, day 1-31) date. */
export function epochDayOf(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of epochDayOf. */
export function civil(epochDay: number): [number, number, number] {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [era * 400 + yoe + (m <= 2 ? 1 : 0), m, d];
}

/** ISO day of week, 1 = Monday ... 7 = Sunday. */
export function isoDow(epochDay: number): number {
  return floorMod(epochDay + 3, 7) + 1;
}

export function dayOfYear(y: number, m: number, d: number): number {
  return epochDayOf(y, m, d) - epochDayOf(y, 1, 1) + 1;
}

export function pad(n: number, width: number): string {
  const neg = n < 0;
  let s = String(Math.abs(n));
  while (s.length < width) s = '0' + s;
  return neg ? '-' + s : s;
}

export function checkRange(name: string, v: number, min: number, max: number): number {
  if (!Number.isFinite(v) || v < min || v > max || !Number.isInteger(v)) {
    throw new DateTimeException(`Invalid value for ${name} (valid values ${min} - ${max}): ${v}`);
  }
  return v;
}

/** Wraps a class so it can also be called without `new` (Kotlin constructor calls). */
export function callable<T extends abstract new (...args: any) => any>(C: T): T & ((...args: ConstructorParameters<T>) => InstanceType<T>) {
  if (typeof Proxy === 'undefined') return C as any;
  return new Proxy(C as any, {
    apply(target, _this, args) {
      return new target(...args);
    },
  });
}

export function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9';
}

/** Week-of-year rules (java.util.Calendar firstDayOfWeek/minimalDaysInFirstWeek) by country. */
const SUNDAY_START = new Set(['US', 'CA', 'JP', 'BR', 'MX', 'IL', 'KR', 'TW', 'HK', 'PH', 'ZA', 'IN', 'SA', 'AU', 'CN', 'TH', 'ID', 'PE', 'CO', 'VE', 'AR', 'GT', 'HN', 'PA', 'DO', 'SV', 'NI', 'PR', 'MO', 'SG', 'KH', 'LA', 'BD', 'PK', 'KE', 'ZW', 'BW', 'BZ', 'JM', 'TT', 'BS', 'AE', 'QA', 'KW', 'OM', 'BH', 'YE', 'JO', 'EG', 'IQ', 'SY', 'LB', 'AF', 'IR', 'DZ', 'LY', 'SD']);
const ISO_MIN4 = new Set(['', 'GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'IE', 'PL', 'CZ', 'SK', 'HU', 'BG', 'EE', 'LT', 'LU', 'IS', 'FO', 'GG', 'IM', 'JE', 'RU', 'GI', 'AD', 'MC', 'SM', 'VA', 'LI']);

export interface WeekRules {
  firstDayOfWeek: number; // Calendar constant: 1 = Sunday ... 7 = Saturday
  minimalDays: number;
}

const LANG_COUNTRY: Record<string, string> = { en: 'US', ja: 'JP', ko: 'KR', zh: 'CN', pt: 'PT', es: 'ES', id: 'ID', th: 'TH', ar: 'SA', he: 'IL', hi: 'IN' };

export function weekRulesFor(language: string, country: string): WeekRules {
  const c = country || LANG_COUNTRY[language] || '';
  if (SUNDAY_START.has(c)) return { firstDayOfWeek: 1, minimalDays: 1 };
  if (!language && !country) return { firstDayOfWeek: 2, minimalDays: 1 }; // Locale.ROOT
  if (ISO_MIN4.has(c) || /^(fr|de|it|nl|sv|da|nb|no|fi|pl|cs|sk|hu|bg|et|lt|ru|is)$/.test(language)) return { firstDayOfWeek: 2, minimalDays: 4 };
  return { firstDayOfWeek: 2, minimalDays: 1 };
}

// Port of java.time.temporal.WeekFields.ComputedDayOfField. `sow` is the ISO day-of-week that
// starts the week (1 = Monday, 7 = Sunday).

/** Calendar firstDayOfWeek constant (1 = Sunday) to ISO day-of-week. */
export function isoFromCalendarDow(c: number): number {
  return c === 1 ? 7 : c - 1;
}

export function localizedDow(epochDay: number, sow: number): number {
  return floorMod(isoDow(epochDay) - sow, 7) + 1;
}

function startOfWeekOffset(day: number, dow: number, minDays: number): number {
  const weekStart = floorMod(day - dow, 7);
  let offset = -weekStart;
  if (weekStart + 1 > minDays) offset = 7 - weekStart;
  return offset;
}

function computeWeek(offset: number, day: number): number {
  return Math.floor((7 + offset + (day - 1)) / 7);
}

export function weekOfMonth(epochDay: number, sow: number, minDays: number): number {
  const [, , d] = civil(epochDay);
  return computeWeek(startOfWeekOffset(d, localizedDow(epochDay, sow), minDays), d);
}

export function weekOfYearPlain(epochDay: number, sow: number, minDays: number): number {
  const [y, m, d] = civil(epochDay);
  const doy = dayOfYear(y, m, d);
  return computeWeek(startOfWeekOffset(doy, localizedDow(epochDay, sow), minDays), doy);
}

export function weekOfWeekBasedYear(epochDay: number, sow: number, minDays: number): number {
  const [y, m, d] = civil(epochDay);
  const doy = dayOfYear(y, m, d);
  const offset = startOfWeekOffset(doy, localizedDow(epochDay, sow), minDays);
  let week = computeWeek(offset, doy);
  if (week === 0) return weekOfWeekBasedYear(epochDay - doy, sow, minDays);
  if (week > 50) {
    const yearLen = isLeap(y) ? 366 : 365;
    const newYearWeek = computeWeek(offset, yearLen + minDays);
    if (week >= newYearWeek) week = week - newYearWeek + 1;
  }
  return week;
}

export function weekBasedYear(epochDay: number, sow: number, minDays: number): number {
  const [y, m, d] = civil(epochDay);
  const doy = dayOfYear(y, m, d);
  const offset = startOfWeekOffset(doy, localizedDow(epochDay, sow), minDays);
  const week = computeWeek(offset, doy);
  if (week === 0) return y - 1;
  const yearLen = isLeap(y) ? 366 : 365;
  if (week >= computeWeek(offset, yearLen + minDays)) return y + 1;
  return y;
}

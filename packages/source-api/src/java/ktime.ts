// kotlin.time: Duration (with Int/Long/Double extension properties), DurationUnit, Instant, Clock.

import { defEnum, type ExtDef, IllegalArgumentException, isNum } from '../kotlin/core';
import { ext, extProp } from '../kotlin/hof';
import { Duration as JavaDuration, Instant as JavaInstant } from './temporal';
import { isoYear } from './temporal';
import { civil, epochDayOf, floorDiv, floorMod, monthLength, pad } from './util';

// ---------- DurationUnit ----------

export class DurationUnit {
  readonly name!: string;
  readonly ordinal!: number;
  static NANOSECONDS: DurationUnit;
  static MICROSECONDS: DurationUnit;
  static MILLISECONDS: DurationUnit;
  static SECONDS: DurationUnit;
  static MINUTES: DurationUnit;
  static HOURS: DurationUnit;
  static DAYS: DurationUnit;
  static values: () => DurationUnit[];
  constructor(
    /** Length in nanoseconds. */
    readonly $ns: number,
    readonly $short: string,
  ) {}
}
defEnum(DurationUnit, [
  ['NANOSECONDS', [1, 'ns']],
  ['MICROSECONDS', [1e3, 'us']],
  ['MILLISECONDS', [1e6, 'ms']],
  ['SECONDS', [1e9, 's']],
  ['MINUTES', [60e9, 'm']],
  ['HOURS', [3600e9, 'h']],
  ['DAYS', [86400e9, 'd']],
]);

// ---------- Duration ----------

/**
 * kotlin.time.Duration. Stored as whole milliseconds plus a nanosecond remainder in [0, 1e6), so
 * second/minute/day durations stay exact well beyond 2^53 nanoseconds. ±Infinity milliseconds
 * represent INFINITE.
 */
export class Duration {
  constructor(
    readonly $ms: number,
    readonly $ns: number,
  ) {}

  static $of(value: number, unit: DurationUnit): Duration {
    if (Number.isNaN(value)) throw new IllegalArgumentException('Duration value cannot be NaN.');
    if (!Number.isFinite(value)) return value > 0 ? Duration.INFINITE : Duration.NEG_INFINITE;
    if (unit.$ns >= 1e6) {
      const k = unit.$ns / 1e6;
      const ms = value * k;
      if (Number.isInteger(ms)) return ms === 0 ? Duration.ZERO : new Duration(ms, 0);
      return Duration.$fromMsFloat(ms);
    }
    const totalNs = Math.round(value * unit.$ns);
    const ms = Math.floor(totalNs / 1e6);
    return new Duration(ms, totalNs - ms * 1e6);
  }

  static $fromMsFloat(ms: number): Duration {
    if (!Number.isFinite(ms)) return ms > 0 ? Duration.INFINITE : Duration.NEG_INFINITE;
    let whole = Math.floor(ms);
    let ns = Math.round((ms - whole) * 1e6);
    if (ns >= 1e6) {
      whole += 1;
      ns -= 1e6;
    }
    return new Duration(whole, ns);
  }

  static $plus(ms: number, ns: number): Duration {
    const carry = floorDiv(ns, 1e6);
    return new Duration(ms + carry, ns - carry * 1e6);
  }

  static ZERO: Duration;
  static INFINITE: Duration;
  static NEG_INFINITE: Duration;

  static parse(value: string): Duration {
    const d = Duration.parseOrNull(value);
    if (d === null) throw new IllegalArgumentException(`Invalid duration string format: '${value}'.`);
    return d;
  }
  static parseOrNull(value: string): Duration | null {
    return parseIso(value) ?? parseDefault(value);
  }
  static parseIsoString(value: string): Duration {
    const d = parseIso(value);
    if (d === null) throw new IllegalArgumentException(`Invalid ISO duration string format: '${value}'.`);
    return d;
  }
  static parseIsoStringOrNull(value: string): Duration | null {
    return parseIso(value);
  }
  static convert(value: number, from: DurationUnit, to: DurationUnit): number {
    return (value * from.$ns) / to.$ns;
  }

  isInfinite(): boolean {
    return !Number.isFinite(this.$ms);
  }
  isFinite(): boolean {
    return Number.isFinite(this.$ms);
  }
  isNegative(): boolean {
    return this.$ms < 0;
  }
  isPositive(): boolean {
    return this.$ms > 0 || (this.$ms === 0 && this.$ns > 0);
  }
  get absoluteValue(): Duration {
    return this.isNegative() ? this.unaryMinus() : this;
  }

  /** Whole amount of a unit, truncated toward zero (Long.MAX/MIN for infinite durations). */
  $whole(unitNs: number): number {
    if (!Number.isFinite(this.$ms)) return this.$ms > 0 ? 9223372036854775807 : -9223372036854775808;
    if (unitNs >= 1e6) {
      const k = unitNs / 1e6;
      if (this.$ns === 0 || this.$ms >= 0) return Math.trunc(this.$ms / k) + 0;
      return -Math.floor((-this.$ms - 1) / k) + 0;
    }
    return Math.trunc(this.$ms * (1e6 / unitNs) + this.$ns / unitNs) + 0;
  }
  get inWholeNanoseconds(): number {
    return this.$whole(1);
  }
  get inWholeMicroseconds(): number {
    return this.$whole(1e3);
  }
  get inWholeMilliseconds(): number {
    return this.$whole(1e6);
  }
  get inWholeSeconds(): number {
    return this.$whole(1e9);
  }
  get inWholeMinutes(): number {
    return this.$whole(60e9);
  }
  get inWholeHours(): number {
    return this.$whole(3600e9);
  }
  get inWholeDays(): number {
    return this.$whole(86400e9);
  }
  toDouble(unit: DurationUnit): number {
    if (!Number.isFinite(this.$ms)) return this.$ms;
    return (this.$ms * 1e6 + this.$ns) / unit.$ns;
  }
  toLong(unit: DurationUnit): number {
    return this.$whole(unit.$ns);
  }
  toInt(unit: DurationUnit): number {
    const v = this.$whole(unit.$ns);
    return Math.max(-2147483648, Math.min(2147483647, v));
  }

  plus(o: Duration): Duration {
    if (this.isInfinite()) {
      if (o.isInfinite() && o.$ms !== this.$ms) throw new IllegalArgumentException('Summing infinite durations of different signs yields an undefined result.');
      return this;
    }
    if (o.isInfinite()) return o;
    return Duration.$plus(this.$ms + o.$ms, this.$ns + o.$ns);
  }
  minus(o: Duration): Duration {
    return this.plus(o.unaryMinus());
  }
  unaryMinus(): Duration {
    if (this.isInfinite()) return this.$ms > 0 ? Duration.NEG_INFINITE : Duration.INFINITE;
    if (this.$ns === 0) return new Duration(-this.$ms + 0, 0);
    return new Duration(-this.$ms - 1, 1e6 - this.$ns);
  }
  times(scale: number): Duration {
    if (this.isInfinite()) {
      if (scale === 0) throw new IllegalArgumentException('Multiplying infinite duration by zero yields an undefined result.');
      return scale > 0 ? this : this.unaryMinus();
    }
    if (scale === 0) return Duration.ZERO;
    if (Number.isInteger(scale) && this.$ns === 0) return new Duration(this.$ms * scale, 0);
    if (Number.isInteger(scale)) return Duration.$plus(this.$ms * scale, this.$ns * scale);
    return Duration.$fromMsFloat((this.$ms + this.$ns / 1e6) * scale);
  }
  div(x: number | Duration): any {
    if (x instanceof Duration) {
      const a = this.toDouble(DurationUnit.NANOSECONDS);
      const b = x.toDouble(DurationUnit.NANOSECONDS);
      return a / b;
    }
    if (x === 0) {
      if (this.isPositive()) return Duration.INFINITE;
      if (this.isNegative()) return Duration.NEG_INFINITE;
      throw new IllegalArgumentException('Dividing zero duration by zero yields an undefined result.');
    }
    if (this.isInfinite()) return x > 0 ? this : this.unaryMinus();
    if (Number.isInteger(x)) {
      // exact integer division of the nanosecond total, truncated toward zero
      const neg = this.isNegative() !== x < 0;
      const a = this.absoluteValue;
      const ax = Math.abs(x);
      const msq = Math.floor(a.$ms / ax);
      const rem = (a.$ms - msq * ax) * 1e6 + a.$ns;
      const r = new Duration(msq, Math.floor(rem / ax));
      return neg ? r.unaryMinus() : r;
    }
    return Duration.$fromMsFloat((this.$ms + this.$ns / 1e6) / x);
  }
  compareTo(o: Duration): number {
    if (this.$ms !== o.$ms) return this.$ms < o.$ms ? -1 : 1;
    return this.$ns - o.$ns;
  }
  equals(o: any): boolean {
    return o instanceof Duration && o.$ms === this.$ms && o.$ns === this.$ns;
  }
  hashCode(): number {
    return (this.$ms | 0) ^ this.$ns;
  }

  /** Calls `action(days, hours, minutes, seconds, nanoseconds)` (or fewer components). */
  toComponents(action: (...xs: number[]) => any): any {
    const a = this.absoluteValue;
    const sign = this.isNegative() ? -1 : 1;
    const totalSecs = a.$whole(1e9);
    const nanos = (a.$ms % 1000) * 1e6 + a.$ns;
    const n = action.length;
    const s = (v: number) => (v === 0 ? 0 : v * sign);
    if (n >= 5) return action(s(Math.floor(totalSecs / 86400)), s(Math.floor(totalSecs / 3600) % 24), s(Math.floor(totalSecs / 60) % 60), s(totalSecs % 60), s(nanos));
    if (n === 4) return action(s(Math.floor(totalSecs / 3600)), s(Math.floor(totalSecs / 60) % 60), s(totalSecs % 60), s(nanos));
    if (n === 3) return action(s(Math.floor(totalSecs / 60)), s(totalSecs % 60), s(nanos));
    return action(s(totalSecs), s(nanos));
  }

  toString(): string {
    if (this.$ms === 0 && this.$ns === 0) return '0s';
    if (this.$ms === Infinity) return 'Infinity';
    if (this.$ms === -Infinity) return '-Infinity';
    const neg = this.isNegative();
    const a = this.absoluteValue;
    const totalSecs = Math.floor(a.$ms / 1000);
    const nanos = (a.$ms % 1000) * 1e6 + a.$ns;
    const days = Math.floor(totalSecs / 86400);
    const hours = Math.floor(totalSecs / 3600) % 24;
    const minutes = Math.floor(totalSecs / 60) % 60;
    const seconds = totalSecs % 60;
    const hasDays = days !== 0;
    const hasHours = hours !== 0;
    const hasMinutes = minutes !== 0;
    const hasSeconds = seconds !== 0 || nanos !== 0;
    let out = '';
    let components = 0;
    if (hasDays) {
      out += days + 'd';
      components++;
    }
    if (hasHours || (hasDays && (hasMinutes || hasSeconds))) {
      if (components++ > 0) out += ' ';
      out += hours + 'h';
    }
    if (hasMinutes || (hasSeconds && (hasHours || hasDays))) {
      if (components++ > 0) out += ' ';
      out += minutes + 'm';
    }
    if (hasSeconds) {
      if (components++ > 0) out += ' ';
      if (seconds !== 0 || hasDays || hasHours || hasMinutes) out += fractional(seconds, nanos, 9, 's', false);
      else if (nanos >= 1e6) out += fractional(Math.floor(nanos / 1e6), nanos % 1e6, 6, 'ms', false);
      else if (nanos >= 1e3) out += fractional(Math.floor(nanos / 1e3), nanos % 1e3, 3, 'us', false);
      else out += nanos + 'ns';
    }
    if (neg) return components > 1 ? `-(${out})` : '-' + out;
    return out;
  }

  toIsoString(): string {
    let out = this.isNegative() ? '-PT' : 'PT';
    const a = this.absoluteValue;
    let hours: number;
    let minutes = 0;
    let seconds = 0;
    let nanos = 0;
    if (a.isInfinite()) hours = 9999999999999;
    else {
      const totalSecs = Math.floor(a.$ms / 1000);
      hours = Math.floor(totalSecs / 3600);
      minutes = Math.floor(totalSecs / 60) % 60;
      seconds = totalSecs % 60;
      nanos = (a.$ms % 1000) * 1e6 + a.$ns;
    }
    const hasHours = hours !== 0;
    const hasSeconds = seconds !== 0 || nanos !== 0;
    const hasMinutes = minutes !== 0 || (hasSeconds && hasHours);
    if (hasHours) out += hours + 'H';
    if (hasMinutes) out += minutes + 'M';
    if (hasSeconds || (!hasHours && !hasMinutes)) out += fractional(seconds, nanos, 9, 'S', true);
    return out;
  }

  /** Kotlin's toString(unit, decimals). */
  toString$unit(unit: DurationUnit, decimals: number = 0): string {
    if (this.isInfinite()) return String(this.$ms);
    return this.toDouble(unit).toFixed(Math.min(decimals, 12)) + unit.$short;
  }
}
Duration.ZERO = new Duration(0, 0);
Duration.INFINITE = new Duration(Infinity, 0);
Duration.NEG_INFINITE = new Duration(-Infinity, 0);

function fractional(whole: number, frac: number, size: number, unit: string, isoZeroes: boolean): string {
  let s = String(whole);
  if (frac !== 0) {
    const fs = pad(frac, size);
    let nonZero = fs.length;
    while (nonZero > 0 && fs[nonZero - 1] === '0') nonZero--;
    s += '.' + (!isoZeroes && nonZero < 3 ? fs.slice(0, nonZero) : fs.slice(0, Math.floor((nonZero + 2) / 3) * 3));
  }
  return s + unit;
}

const UNIT_BY_SHORT: Record<string, DurationUnit> = {};
for (const u of DurationUnit.values()) UNIT_BY_SHORT[u.$short] = u;

function parseDefault(s: string): Duration | null {
  if (s === 'Infinity') return Duration.INFINITE;
  if (s === '-Infinity') return Duration.NEG_INFINITE;
  let str = s;
  let neg = false;
  if (str.startsWith('-')) {
    neg = true;
    str = str.slice(1);
    if (str.startsWith('(') && str.endsWith(')')) str = str.slice(1, -1);
  } else if (str.startsWith('+')) str = str.slice(1);
  if (!str) return null;
  const parts = str.split(' ');
  let total = Duration.ZERO;
  let lastOrder = 99;
  for (const p of parts) {
    const m = /^(\d+)(?:\.(\d+))?(ns|us|ms|s|m|h|d)$/.exec(p);
    if (!m) return null;
    const unit = UNIT_BY_SHORT[m[3]];
    if (unit.ordinal >= lastOrder) return null;
    lastOrder = unit.ordinal;
    total = total.plus(Duration.$of(parseFloat(m[1] + (m[2] ? '.' + m[2] : '')), unit));
  }
  return neg ? total.unaryMinus() : total;
}

function parseIso(s: string): Duration | null {
  const m = /^([+-])?P(?:([+-]?\d+)D)?(?:T(?:([+-]?\d+)H)?(?:([+-]?\d+)M)?(?:([+-]?\d+(?:\.\d+)?)S)?)?$/.exec(s);
  if (!m || (!m[2] && !m[3] && !m[4] && !m[5])) return null;
  if (s.endsWith('T')) return null;
  let d = Duration.ZERO;
  if (m[2]) d = d.plus(Duration.$of(+m[2], DurationUnit.DAYS));
  if (m[3]) d = d.plus(Duration.$of(+m[3], DurationUnit.HOURS));
  if (m[4]) d = d.plus(Duration.$of(+m[4], DurationUnit.MINUTES));
  if (m[5]) d = d.plus(Duration.$of(parseFloat(m[5]), DurationUnit.SECONDS));
  return m[1] === '-' ? d.unaryMinus() : d;
}

// ---------- Instant ----------

const MIN_SECOND = -31557014167219200;
const MAX_SECOND = 31556889864403199;

export class Instant {
  constructor(
    readonly epochSeconds: number,
    readonly nanosecondsOfSecond: number,
  ) {}

  static fromEpochMilliseconds(ms: number): Instant {
    return new Instant(floorDiv(ms, 1000), floorMod(ms, 1000) * 1e6);
  }
  static fromEpochSeconds(sec: number, nanos: number = 0): Instant {
    const s = sec + floorDiv(nanos, 1e9);
    if (s < MIN_SECOND) return Instant.MIN;
    if (s > MAX_SECOND) return Instant.MAX;
    return new Instant(s, floorMod(nanos, 1e9));
  }
  static parse(input: string): Instant {
    const r = parseInstant(String(input));
    if (typeof r === 'string') throw new IllegalArgumentException(`${r} when parsing an Instant from "${input}"`);
    return r;
  }
  static parseOrNull(input: string): Instant | null {
    const r = parseInstant(String(input));
    return typeof r === 'string' ? null : r;
  }
  static DISTANT_PAST: Instant;
  static DISTANT_FUTURE: Instant;
  static MIN: Instant;
  static MAX: Instant;

  toEpochMilliseconds(): number {
    return this.epochSeconds * 1000 + Math.floor(this.nanosecondsOfSecond / 1e6);
  }
  get isDistantPast(): boolean {
    return this.compareTo(Instant.DISTANT_PAST) <= 0;
  }
  get isDistantFuture(): boolean {
    return this.compareTo(Instant.DISTANT_FUTURE) >= 0;
  }

  plus(d: Duration): Instant {
    if (d.isInfinite()) return d.isPositive() ? Instant.MAX : Instant.MIN;
    const totalNs = this.nanosecondsOfSecond + (floorMod(d.$ms, 1000) * 1e6 + d.$ns);
    return Instant.fromEpochSeconds(this.epochSeconds + floorDiv(d.$ms, 1000) + floorDiv(totalNs, 1e9), floorMod(totalNs, 1e9));
  }
  minus(o: Duration | Instant): any {
    if (o instanceof Instant) {
      const secs = this.epochSeconds - o.epochSeconds;
      const ns = this.nanosecondsOfSecond - o.nanosecondsOfSecond;
      return Duration.$of(secs, DurationUnit.SECONDS).plus(Duration.$of(ns, DurationUnit.NANOSECONDS));
    }
    return this.plus(o.unaryMinus());
  }
  compareTo(o: Instant): number {
    if (this.epochSeconds !== o.epochSeconds) return this.epochSeconds < o.epochSeconds ? -1 : 1;
    return this.nanosecondsOfSecond - o.nanosecondsOfSecond;
  }
  equals(o: any): boolean {
    return o instanceof Instant && o.epochSeconds === this.epochSeconds && o.nanosecondsOfSecond === this.nanosecondsOfSecond;
  }
  hashCode(): number {
    return (this.epochSeconds | 0) ^ (Math.floor(this.epochSeconds / 2 ** 32) | 0) ^ (51 * this.nanosecondsOfSecond);
  }
  toString(): string {
    const day = floorDiv(this.epochSeconds, 86400);
    const sod = floorMod(this.epochSeconds, 86400);
    const [y, mo, d] = civil(day);
    let s = isoYear(y) + '-' + pad(mo, 2) + '-' + pad(d, 2);
    s += 'T' + pad(Math.floor(sod / 3600), 2) + ':' + pad(Math.floor(sod / 60) % 60, 2) + ':' + pad(sod % 60, 2);
    const n = this.nanosecondsOfSecond;
    if (n !== 0) {
      if (n % 1e6 === 0) s += '.' + pad(n / 1e6, 3);
      else if (n % 1e3 === 0) s += '.' + pad(n / 1e3, 6);
      else s += '.' + pad(n, 9);
    }
    return s + 'Z';
  }
}
Instant.DISTANT_PAST = new Instant(-3217862419201, 999_999_999);
Instant.DISTANT_FUTURE = new Instant(3093527980800, 0);
Instant.MIN = new Instant(MIN_SECOND, 0);
Instant.MAX = new Instant(MAX_SECOND, 999_999_999);


/** ISO 8601 instant: date 'T' hh:mm[:ss[.f{1,9}]] (Z | ±hh[[:]mm[[:]ss]]). Returns an error string on failure. */
function parseInstant(s: string): Instant | string {
  const m = /^([+-]?\d{4,})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(?:([Zz])|([+-])(\d{2})(?::?(\d{2})(?::?(\d{2}))?)?)$/.exec(s);
  if (!m) return 'Invalid format';
  const ys = m[1];
  if (/^\d{5,}$/.test(ys)) return 'Expected a sign for a year with more than four digits';
  const y = parseInt(ys, 10);
  const mo = +m[2];
  const d = +m[3];
  const h = +m[4];
  const mi = +m[5];
  const se = m[6] ? +m[6] : 0;
  if (mo < 1 || mo > 12) return `Invalid month ${mo}`;
  if (d < 1 || d > monthLength(y, mo)) return `Invalid day of month ${d}`;
  if (h > 23 || mi > 59 || se > 59) return 'Invalid time';
  const nanos = m[7] ? +(m[7] + '00000000').slice(0, 9) : 0;
  let off = 0;
  if (m[9]) {
    const oh = +m[10];
    const om = m[11] ? +m[11] : 0;
    const os = m[12] ? +m[12] : 0;
    if (oh > 18 || om > 59 || os > 59) return 'Invalid offset';
    off = (oh * 3600 + om * 60 + os) * (m[9] === '-' ? -1 : 1);
    if (Math.abs(off) > 18 * 3600) return 'Invalid offset';
  }
  const secs = epochDayOf(y, mo, d) * 86400 + h * 3600 + mi * 60 + se - off;
  if (secs < MIN_SECOND || secs > MAX_SECOND) return 'Instant out of range';
  return new Instant(secs, nanos);
}

// ---------- Clock ----------

export class Clock {
  static $interface = true;
  now(): Instant {
    return Instant.fromEpochMilliseconds(Date.now());
  }
  static System: Clock = new Clock();
}

// ---------- extensions ----------

const unitProp = (name: string, unit: DurationUnit): ExtDef => extProp(name, isNum, (n: number) => Duration.$of(n, unit));

export const durationExtensions: Record<string, ExtDef> = {
  nanoseconds: unitProp('nanoseconds', DurationUnit.NANOSECONDS),
  microseconds: unitProp('microseconds', DurationUnit.MICROSECONDS),
  milliseconds: unitProp('milliseconds', DurationUnit.MILLISECONDS),
  seconds: unitProp('seconds', DurationUnit.SECONDS),
  minutes: unitProp('minutes', DurationUnit.MINUTES),
  hours: unitProp('hours', DurationUnit.HOURS),
  days: unitProp('days', DurationUnit.DAYS),
};

export const toDuration: ExtDef = ext('toDuration', isNum, (n: number, unit: DurationUnit) => Duration.$of(n, unit));

export const toJavaInstant: ExtDef = ext('toJavaInstant', (x) => x instanceof Instant, (i: Instant) => JavaInstant.ofEpochSecond(i.epochSeconds, i.nanosecondsOfSecond));
export const toKotlinInstant: ExtDef = ext('toKotlinInstant', (x) => x instanceof JavaInstant, (i: JavaInstant) => Instant.fromEpochSeconds(i.epochSecond, i.nano));
export const toJavaDuration: ExtDef = ext('toJavaDuration', (x) => x instanceof Duration, (d: Duration) => {
  if (d.isInfinite()) return d.isPositive() ? JavaDuration.ofSeconds(9223372036854775807) : JavaDuration.ofSeconds(-9223372036854775808);
  return JavaDuration.ofSeconds(floorDiv(d.$ms, 1000), floorMod(d.$ms, 1000) * 1e6 + d.$ns);
});
export const toKotlinDuration: ExtDef = ext('toKotlinDuration', (x) => x instanceof JavaDuration, (d: JavaDuration) =>
  Duration.$of(d.seconds, DurationUnit.SECONDS).plus(Duration.$of(d.nano, DurationUnit.NANOSECONDS)),
);

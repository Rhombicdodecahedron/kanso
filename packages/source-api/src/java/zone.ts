// Time-zone rules: offsets for IANA zones come from Intl.DateTimeFormat (formatToParts with a
// timeZone option). Without Intl, every named zone behaves like UTC.

import { DateTimeException } from '../kotlin/core';
import { MS_PER_DAY, pad } from './util';

export class ZoneRulesException extends DateTimeException {}

const HAS_INTL = typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function';

const fmtCache = new Map<string, Intl.DateTimeFormat | null>();

function zoneFormatter(id: string): Intl.DateTimeFormat | null {
  let f = fmtCache.get(id);
  if (f !== undefined) return f;
  f = null;
  if (HAS_INTL) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: id,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        era: 'short',
      } as Intl.DateTimeFormatOptions);
      if (typeof f.formatToParts !== 'function') f = null;
    } catch {
      f = null;
    }
  }
  fmtCache.set(id, f);
  return f;
}

/** Canonical IANA id for a region id, or null when the id is unknown to this runtime. */
export function canonicalZone(id: string): string | null {
  if (id === 'UTC' || id === 'GMT' || id === 'UT') return id;
  if (!HAS_INTL) return null;
  try {
    // Intl validates and canonicalises the case ("asia/jakarta" -> "Asia/Jakarta").
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: id }).resolvedOptions().timeZone;
    if (!resolved) return null;
    // Keep the caller's id when it only differs by alias (e.g. Asia/Calcutta vs Asia/Kolkata).
    return resolved.toLowerCase() === id.toLowerCase() ? resolved : id;
  } catch {
    return null;
  }
}

const offsetCache = new Map<string, number>();

/** Offset in seconds of zone `id` at the instant `epochMs`. */
export function zoneOffsetSeconds(id: string, epochMs: number): number {
  if (id === 'UTC' || id === 'GMT' || id === 'UT' || id === 'Etc/UTC' || id === 'Etc/GMT') return 0;
  const f = zoneFormatter(id);
  if (!f || !Number.isFinite(epochMs)) return 0;
  // Offsets change on quarter-hour boundaries for all modern zone rules: cache per 15 minutes.
  const key = id + '@' + Math.floor(epochMs / 900_000);
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;
  // Intl only handles years 1..275759; clamp extreme instants to the nearest representable year.
  const t = Math.max(-62_135_596_800_000, Math.min(8_640_000_000_000_000, epochMs));
  const whole = Math.floor(t / 1000) * 1000;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = f.formatToParts(new Date(whole));
  } catch {
    return 0;
  }
  let y = 0;
  let mo = 1;
  let d = 1;
  let h = 0;
  let mi = 0;
  let s = 0;
  let bc = false;
  for (const p of parts) {
    switch (p.type) {
      case 'year':
        y = parseInt(p.value, 10);
        break;
      case 'month':
        mo = parseInt(p.value, 10);
        break;
      case 'day':
        d = parseInt(p.value, 10);
        break;
      case 'hour':
        h = parseInt(p.value, 10) % 24;
        break;
      case 'minute':
        mi = parseInt(p.value, 10);
        break;
      case 'second':
        s = parseInt(p.value, 10);
        break;
      case 'era':
        bc = /^B/i.test(p.value);
        break;
    }
  }
  if (bc) y = 1 - y;
  // Date.UTC maps years 0..99 to the 1900s; fix the year with setUTCFullYear.
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(h, mi, s, 0);
  const off = Math.round((dt.getTime() - whole) / 1000);
  // Only cache "round" offsets; historic LMT offsets with seconds can change mid-bucket.
  if (off % 900 === 0) {
    if (offsetCache.size > 5000) offsetCache.clear();
    offsetCache.set(key, off);
  }
  return off;
}

/**
 * Epoch milliseconds for a local wall-clock time (expressed as ms since the epoch as if the zone
 * were UTC). Gaps resolve like ZonedDateTime.ofLocal (shifted later by the gap length) and
 * overlaps pick the earlier offset, unless `preferredOffset` (seconds) is one of the valid ones.
 */
export function localToEpochMs(id: string, localMs: number, preferredOffset?: number): number {
  return localMs - resolveOffset(id, localMs, preferredOffset) * 1000;
}

export function resolveOffset(id: string, localMs: number, preferredOffset?: number): number {
  const before = zoneOffsetSeconds(id, localMs - MS_PER_DAY);
  const after = zoneOffsetSeconds(id, localMs + MS_PER_DAY);
  if (before === after) {
    // Usually no transition nearby, but double check (transitions closer than a day apart).
    const o = zoneOffsetSeconds(id, localMs - before * 1000);
    if (o === before) return before;
    const o2 = zoneOffsetSeconds(id, localMs - o * 1000);
    return o2 === o ? o : before;
  }
  const okBefore = zoneOffsetSeconds(id, localMs - before * 1000) === before;
  const okAfter = zoneOffsetSeconds(id, localMs - after * 1000) === after;
  if (okBefore && okAfter) {
    if (preferredOffset === after) return after;
    return before; // overlap: earlier offset
  }
  if (okBefore) return before;
  if (okAfter) return after;
  return before; // gap: local time is moved later by the gap length
}

// ---------- system default ----------

let systemZone: string | null = null;

export function systemZoneId(): string {
  if (systemZone) return systemZone;
  let id = 'UTC';
  if (HAS_INTL) {
    try {
      id = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      id = 'UTC';
    }
  }
  if (typeof process !== 'undefined' && (process as any).env?.TZ) {
    const tz = (process as any).env.TZ as string;
    if (canonicalZone(tz)) id = tz;
  }
  systemZone = id;
  return id;
}

export function setSystemZoneId(id: string | null): void {
  systemZone = id;
}

// ---------- offset ids ----------

/** Normalised id for a fixed offset in seconds ("Z", "+07:00", "-03:30:15"). */
export function offsetId(totalSeconds: number): string {
  if (totalSeconds === 0) return 'Z';
  const abs = Math.abs(totalSeconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return (totalSeconds < 0 ? '-' : '+') + pad(h, 2) + ':' + pad(m, 2) + (s ? ':' + pad(s, 2) : '');
}

/** Parses "+h", "+hh", "+hh:mm", "+hhmm", "+hh:mm:ss", "+hhmmss" (ZoneOffset.of). Null on failure. */
export function parseOffsetId(s: string): number | null {
  if (s === 'Z' || s === 'z') return 0;
  const m = /^([+-])(\d{1,2})(?::?(\d{2})(?::?(\d{2}))?)?$/.exec(s);
  if (!m) return null;
  const colons = s.includes(':');
  // ZoneOffset.of requires consistent use of colons.
  if (colons && /^[+-]\d{2}\d{2}/.test(s)) return null;
  if (m[2].length === 1 && m[3]) return null;
  const h = +m[2];
  const mi = m[3] ? +m[3] : 0;
  const se = m[4] ? +m[4] : 0;
  if (h > 18 || mi > 59 || se > 59) return null;
  const total = (h * 3600 + mi * 60 + se) * (m[1] === '-' ? -1 : 1);
  if (Math.abs(total) > 18 * 3600) return null;
  return total;
}

// ---------- display names ----------

const nameCache = new Map<string, string | null>();

/** Localised zone name (short "PST"/"GMT+7" or long "Pacific Standard Time"), or null. */
export function intlZoneName(id: string, epochMs: number, long: boolean, locale: string): string | null {
  if (!HAS_INTL) return null;
  const key = `${id}|${long}|${locale}|${Math.floor(epochMs / 86_400_000 / 30)}`;
  if (nameCache.has(key)) return nameCache.get(key)!;
  let out: string | null = null;
  try {
    const f = new Intl.DateTimeFormat(locale || 'en', { timeZone: id, timeZoneName: long ? 'long' : 'short' });
    const p = f.formatToParts(new Date(epochMs)).find((x) => x.type === 'timeZoneName');
    out = p ? p.value : null;
  } catch {
    out = null;
  }
  nameCache.set(key, out);
  return out;
}

/** "GMT+07:00" style custom id (java.util.TimeZone / SimpleDateFormat). */
export function gmtId(totalSeconds: number): string {
  if (totalSeconds === 0) return 'GMT';
  const abs = Math.abs(totalSeconds);
  return 'GMT' + (totalSeconds < 0 ? '-' : '+') + pad(Math.floor(abs / 3600), 2) + ':' + pad(Math.floor((abs % 3600) / 60), 2);
}

/** Java-style short zone name for formatting: Intl's "GMT+7" becomes "GMT+07:00". */
export function shortZoneName(id: string, epochMs: number, locale: string): string {
  const off = zoneOffsetSeconds(id, epochMs);
  if (id === 'UTC' || id === 'Etc/UTC') return 'UTC';
  if (id === 'GMT' || id === 'Etc/GMT') return 'GMT';
  const n = intlZoneName(id, epochMs, false, locale.startsWith('en') || !locale ? 'en-US' : locale);
  if (!n || /^(GMT|UTC)([+-−]|$)/.test(n)) return gmtId(off);
  return n;
}

export function longZoneName(id: string, epochMs: number, locale: string): string {
  const n = intlZoneName(id, epochMs, true, locale || 'en-US');
  if (!n || /^(GMT|UTC)[+-−]/.test(n)) return gmtId(zoneOffsetSeconds(id, epochMs));
  return n;
}

/** Common zone abbreviations accepted when parsing 'z'. Offsets in seconds. */
export const ZONE_ABBREVIATIONS: Record<string, { id: string; dst?: boolean }> = {
  UTC: { id: 'UTC' },
  GMT: { id: 'GMT' },
  UT: { id: 'UTC' },
  Z: { id: 'UTC' },
  PST: { id: 'America/Los_Angeles' },
  PDT: { id: 'America/Los_Angeles', dst: true },
  MST: { id: 'America/Denver' },
  MDT: { id: 'America/Denver', dst: true },
  CST: { id: 'America/Chicago' },
  CDT: { id: 'America/Chicago', dst: true },
  EST: { id: 'America/New_York' },
  EDT: { id: 'America/New_York', dst: true },
  AKST: { id: 'America/Anchorage' },
  AKDT: { id: 'America/Anchorage', dst: true },
  HST: { id: 'Pacific/Honolulu' },
  BST: { id: 'Europe/London', dst: true },
  IST: { id: 'Asia/Kolkata' },
  CET: { id: 'Europe/Paris' },
  CEST: { id: 'Europe/Paris', dst: true },
  EET: { id: 'Europe/Athens' },
  EEST: { id: 'Europe/Athens', dst: true },
  WET: { id: 'Europe/Lisbon' },
  WEST: { id: 'Europe/Lisbon', dst: true },
  MSK: { id: 'Europe/Moscow' },
  JST: { id: 'Asia/Tokyo' },
  KST: { id: 'Asia/Seoul' },
  HKT: { id: 'Asia/Hong_Kong' },
  SGT: { id: 'Asia/Singapore' },
  PHT: { id: 'Asia/Manila' },
  PHST: { id: 'Asia/Manila' },
  WIB: { id: 'Asia/Jakarta' },
  WITA: { id: 'Asia/Makassar' },
  WIT: { id: 'Asia/Jayapura' },
  ICT: { id: 'Asia/Bangkok' },
  AEST: { id: 'Australia/Sydney' },
  AEDT: { id: 'Australia/Sydney', dst: true },
  BRT: { id: 'America/Sao_Paulo' },
  ART: { id: 'America/Argentina/Buenos_Aires' },
};

/** Fixed offset (seconds) for an abbreviation, honouring the DST flavour. */
export function abbreviationOffset(abbr: string, epochMsHint: number): number | null {
  const e = ZONE_ABBREVIATIONS[abbr.toUpperCase()];
  if (!e) return null;
  if (e.id === 'UTC' || e.id === 'GMT') return 0;
  // Standard offset = smaller of January/July offsets; DST = larger.
  const y = new Date(epochMsHint).getUTCFullYear();
  const jan = zoneOffsetSeconds(e.id, Date.UTC(y, 0, 1));
  const jul = zoneOffsetSeconds(e.id, Date.UTC(y, 6, 1));
  return e.dst ? Math.max(jan, jul) : Math.min(jan, jul);
}

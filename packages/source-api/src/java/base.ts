// Shared TemporalAccessor behaviour for java.time types (kept separate to avoid import cycles).

import { NullPointerException } from '../kotlin/core';
import { ChronoField, ChronoUnit, UnsupportedTemporalTypeException, ValueRange } from './fields';

// ---------- base ----------

export abstract class TemporalBase {
  abstract $get(f: ChronoField): number | undefined;
  $date(): any {
    return null;
  }
  $time(): any {
    return null;
  }
  $zone(): any {
    return null;
  }
  $offset(): number | null {
    return null;
  }
  /** [epochSecond, nanoOfSecond] when the temporal represents an instant. */
  $instant(): [number, number] | null {
    return null;
  }
  $supportsUnit(_u: ChronoUnit): boolean {
    return false;
  }
  get(f: any): number {
    if (f && typeof f.$getFrom === 'function') return f.$getFrom(this);
    const v = this.$get(f);
    if (v === undefined) throw new UnsupportedTemporalTypeException(`Unsupported field: ${f}`);
    return v;
  }
  getLong(f: any): number {
    return this.get(f);
  }
  isSupported(x: any): boolean {
    if (x instanceof ChronoUnit) return this.$supportsUnit(x);
    if (x instanceof ChronoField) return this.$get(x) !== undefined;
    if (x && typeof x.$getFrom === 'function') return this.$date() !== null;
    return false;
  }
  range(f: ChronoField): ValueRange {
    if (f === ChronoField.DAY_OF_MONTH) {
      const d = this.$date();
      if (d) return new ValueRange(1, d.lengthOfMonth());
    }
    if (f === ChronoField.DAY_OF_YEAR) {
      const d = this.$date();
      if (d) return new ValueRange(1, d.lengthOfYear());
    }
    return f.range();
  }
  query(q: any): any {
    if (typeof q === 'function') return q(this);
    if (q && typeof q.queryFrom === 'function') return q.queryFrom(this);
    throw new NullPointerException('query');
  }
}


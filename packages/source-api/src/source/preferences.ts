// android.content.SharedPreferences + androidx.preference.* widgets, exposed to the host as a
// declarative schema it can render.

import { str } from '../kotlin/core';
import { host } from './index';

export interface PrefStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  keys(): string[];
}

export class MemoryPrefStore implements PrefStore {
  private m = new Map<string, unknown>();
  get(k: string) {
    return this.m.get(k);
  }
  set(k: string, v: unknown) {
    this.m.set(k, v);
  }
  remove(k: string) {
    this.m.delete(k);
  }
  keys() {
    return [...this.m.keys()];
  }
}

const cache = new Map<string, SharedPreferences>();

export class SharedPreferences {
  constructor(readonly store: PrefStore) {}
  static forSource(id: string): SharedPreferences {
    let p = cache.get(id);
    if (!p) {
      p = new SharedPreferences(host().prefs(id));
      cache.set(id, p);
    }
    return p;
  }
  private read(key: string, def: any, check: (v: unknown) => boolean): any {
    const v = this.store.get(key);
    return v !== undefined && v !== null && check(v) ? v : def;
  }
  getString(key: string, def: string | null = null): string | null {
    return this.read(key, def, (v) => typeof v === 'string');
  }
  getBoolean(key: string, def = false): boolean {
    return this.read(key, def, (v) => typeof v === 'boolean');
  }
  getInt(key: string, def = 0): number {
    return this.read(key, def, (v) => typeof v === 'number');
  }
  getLong(key: string, def = 0): number {
    return this.read(key, def, (v) => typeof v === 'number');
  }
  getFloat(key: string, def = 0): number {
    return this.read(key, def, (v) => typeof v === 'number');
  }
  getStringSet(key: string, def: Set<string> | null = null): Set<string> | null {
    const v = this.store.get(key);
    return Array.isArray(v) ? new Set(v as string[]) : def;
  }
  contains(key: string): boolean {
    return this.store.get(key) !== undefined;
  }
  get all(): Map<string, unknown> {
    return new Map(this.store.keys().map((k) => [k, this.store.get(k)]));
  }
  getAll(): Map<string, unknown> {
    return this.all;
  }
  edit(): Editor {
    return new Editor(this.store);
  }
  registerOnSharedPreferenceChangeListener(_l: any): void {}
  unregisterOnSharedPreferenceChangeListener(_l: any): void {}
}

export class Editor {
  private ops: (() => void)[] = [];
  constructor(private readonly store: PrefStore) {}
  private put(key: string, v: unknown): this {
    this.ops.push(() => this.store.set(key, v));
    return this;
  }
  putString(k: string, v: string | null): this {
    return v === null ? this.remove(k) : this.put(k, v);
  }
  putBoolean(k: string, v: boolean): this {
    return this.put(k, v);
  }
  putInt(k: string, v: number): this {
    return this.put(k, v);
  }
  putLong(k: string, v: number): this {
    return this.put(k, v);
  }
  putFloat(k: string, v: number): this {
    return this.put(k, v);
  }
  putStringSet(k: string, v: Set<string> | null): this {
    return v === null ? this.remove(k) : this.put(k, [...v]);
  }
  remove(k: string): this {
    this.ops.push(() => this.store.remove(k));
    return this;
  }
  clear(): this {
    this.ops.push(() => {
      for (const k of this.store.keys()) this.store.remove(k);
    });
    return this;
  }
  apply(): void {
    for (const op of this.ops) op();
    this.ops = [];
  }
  commit(): boolean {
    this.apply();
    return true;
  }
}

// ---------- preference widgets ----------

export class Context {
  getSharedPreferences(name: string, _mode: number): SharedPreferences {
    return SharedPreferences.forSource(name.replace(/^source_/, ''));
  }
  get applicationContext(): Context {
    return this;
  }
  get packageName(): string {
    return 'app.kanso';
  }
  getString(_id: number): string {
    return '';
  }
}
export const appContext = new Context();

export class Preference {
  key: string = null as any;
  title: any = null;
  summary: any = null;
  isVisible = true;
  isEnabled = true;
  dialogTitle: any = null;
  dialogMessage: any = null;
  $default: unknown = null;
  $changeListener: ((p: Preference, v: unknown) => boolean) | null = null;
  $clickListener: ((p: Preference) => boolean) | null = null;
  constructor(readonly context: Context = appContext) {}
  get $kind(): string {
    return 'info';
  }
  setDefaultValue(v: unknown): void {
    this.$default = v;
  }
  setOnPreferenceChangeListener(l: any): void {
    this.$changeListener = typeof l === 'function' ? l : (p, v) => l.onPreferenceChange(p, v);
  }
  setOnPreferenceClickListener(l: any): void {
    this.$clickListener = typeof l === 'function' ? l : (p) => l.onPreferenceClick(p);
  }
  setEnabled(b: boolean): void {
    this.isEnabled = b;
  }
  setVisible(b: boolean): void {
    this.isVisible = b;
  }
  setTitle(t: any): void {
    this.title = t;
  }
  setSummary(s: any): void {
    this.summary = s;
  }
  setKey(k: string): void {
    this.key = k;
  }
  get sharedPreferences(): SharedPreferences | null {
    return this.$prefs;
  }
  $prefs: SharedPreferences | null = null;
  getPersistedString(def: string | null): string | null {
    return this.$prefs?.getString(this.key, def) ?? def;
  }
  getPersistedBoolean(def: boolean): boolean {
    return this.$prefs?.getBoolean(this.key, def) ?? def;
  }
  /** Declarative description for the host UI. */
  $describe(): Record<string, unknown> {
    return {
      kind: this.$kind,
      key: this.key,
      title: this.title === null ? null : str(this.title),
      summary: this.summary === null ? null : str(this.summary),
      default: this.$default,
      visible: this.isVisible,
      enabled: this.isEnabled,
    };
  }
}

export class SwitchPreferenceCompat extends Preference {
  get $kind() {
    return 'switch';
  }
  get isChecked(): boolean {
    return this.getPersistedBoolean((this.$default as boolean) ?? false);
  }
  set isChecked(v: boolean) {
    this.$prefs?.edit().putBoolean(this.key, v).apply();
  }
  setChecked(v: boolean): void {
    this.isChecked = v;
  }
}
export class CheckBoxPreference extends SwitchPreferenceCompat {
  get $kind() {
    return 'checkbox';
  }
}
export class SwitchPreference extends SwitchPreferenceCompat {}
export class TwoStatePreference extends SwitchPreferenceCompat {}

export class EditTextPreference extends Preference {
  get $kind() {
    return 'text';
  }
  get text(): string | null {
    return this.getPersistedString((this.$default as string) ?? null);
  }
  set text(v: string | null) {
    this.$prefs?.edit().putString(this.key, v).apply();
  }
  setText(v: string | null): void {
    this.text = v;
  }
  setOnBindEditTextListener(_l: any): void {}
}

export class ListPreference extends Preference {
  entries: any[] = [];
  entryValues: any[] = [];
  get $kind() {
    return 'list';
  }
  get value(): string | null {
    return this.getPersistedString((this.$default as string) ?? null);
  }
  set value(v: string | null) {
    this.$prefs?.edit().putString(this.key, v).apply();
  }
  setValue(v: string): void {
    this.value = v;
  }
  setValueIndex(i: number): void {
    this.value = str(this.entryValues[i]);
  }
  findIndexOfValue(v: string): number {
    return this.entryValues.findIndex((x) => str(x) === v);
  }
  setEntries(e: any[]): void {
    this.entries = e;
  }
  setEntryValues(e: any[]): void {
    this.entryValues = e;
  }
  get entry(): string | null {
    const i = this.findIndexOfValue(this.value ?? '');
    return i >= 0 ? str(this.entries[i]) : null;
  }
  $describe(): Record<string, unknown> {
    return { ...super.$describe(), entries: this.entries.map(str), entryValues: this.entryValues.map(str) };
  }
}

export class MultiSelectListPreference extends Preference {
  entries: any[] = [];
  entryValues: any[] = [];
  get $kind() {
    return 'multiselect';
  }
  get values(): Set<string> {
    return this.$prefs?.getStringSet(this.key, (this.$default as Set<string>) ?? new Set()) ?? new Set();
  }
  set values(v: Set<string>) {
    this.$prefs?.edit().putStringSet(this.key, v).apply();
  }
  setEntries(e: any[]): void {
    this.entries = e;
  }
  setEntryValues(e: any[]): void {
    this.entryValues = e;
  }
  $describe(): Record<string, unknown> {
    const d = this.$default;
    return {
      ...super.$describe(),
      default: d instanceof Set ? [...d] : d,
      entries: this.entries.map(str),
      entryValues: this.entryValues.map(str),
    };
  }
}

export class PreferenceCategory extends Preference {
  get $kind() {
    return 'category';
  }
}

export class PreferenceScreen extends Preference {
  readonly prefs: Preference[] = [];
  constructor(
    context: Context = appContext,
    private readonly target: SharedPreferences | null = null,
  ) {
    super(context);
  }
  get $kind() {
    return 'screen';
  }
  addPreference(p: Preference): boolean {
    p.$prefs = this.target;
    this.prefs.push(p);
    return true;
  }
  get preferenceCount(): number {
    return this.prefs.length;
  }
  getPreference(i: number): Preference {
    return this.prefs[i];
  }
  findPreference(key: string): Preference | null {
    return this.prefs.find((p) => p.key === key) ?? null;
  }
  removePreference(p: Preference): boolean {
    const i = this.prefs.indexOf(p);
    if (i >= 0) this.prefs.splice(i, 1);
    return i >= 0;
  }
  get preferenceManager(): any {
    return { context: this.context, sharedPreferences: this.target };
  }
}

/** Apply a value chosen in the host UI: runs the source's change listener, then persists. */
export function applyPreferenceChange(p: Preference, value: unknown): boolean {
  const v = p instanceof MultiSelectListPreference && Array.isArray(value) ? new Set(value as string[]) : value;
  if (p.$changeListener && p.$changeListener(p, v) === false) return false;
  const e = p.$prefs?.edit();
  if (!e) return true;
  if (typeof v === 'boolean') e.putBoolean(p.key, v);
  else if (v instanceof Set) e.putStringSet(p.key, v as Set<string>);
  else if (typeof v === 'number') e.putInt(p.key, v);
  else e.putString(p.key, v === null ? null : str(v));
  e.apply();
  return true;
}

// Must run before anything decodes bytes.
import './polyfills';
// The `$rt` object translated bundles receive, plus bundle loading.

import * as core from './kotlin/core';
import { iter, stdlibExts } from './kotlin/stdlib';
import { named, construct, Named } from './kotlin/named';
import { hofAsync, hofSync } from './kotlin/builders';
import { IntRange, Pair, rangeTo, until, downTo, step } from './kotlin/types';
import { modules, defaultImports, registerModules } from './modules';
import { T, setPairCtor } from './serialization/json';
import { BundleClassLoader } from './lib/i18n';
import { cryptoModules, cryptoExts } from './java/cryptoModules';
import { timeModules } from './java/time';
import { extraKeiyoushiModules } from './keiyoushi/extra';
import { getPreferencesFor } from './source';
import { ListPreference, EditTextPreference } from './source/preferences';

setPairCtor(Pair);
registerModules(cryptoModules);
registerModules(timeModules);
registerModules(extraKeiyoushiModules);
// kotlin.text.* names usable without imports
(defaultImports as any).Charsets = cryptoModules['kotlin.text.Charsets'];
// Byte/charset-aware extensions take precedence over the generic stdlib ones.
for (const e of cryptoExts) {
  const list = (stdlibExts[e.name] ??= []);
  if (!list.includes(e)) list.unshift(e);
}

// ---------- helpers referenced by generated code ----------

const interfaceBases = new WeakMap<any, any>();

/** `class X : S()` - interfaces translate to classes, but we never `extends` an interface. */
function base(S: any): any {
  if (typeof S !== 'function') return class {};
  if (S.$interface && !S.$classLike) {
    let b = interfaceBases.get(S);
    if (!b) {
      b = class {};
      interfaceBases.set(S, b);
    }
    return b;
  }
  if (S.$fn) return class {};
  return S;
}

function lazyStatic(C: any, name: string, f: () => any): void {
  let made = false;
  let v: any;
  Object.defineProperty(C, name, {
    configurable: true,
    get() {
      if (!made) {
        v = f();
        made = true;
      }
      return v;
    },
  });
}

function defStatic(C: any, name: string, v: any): void {
  Object.defineProperty(C, name, { configurable: true, writable: true, value: v });
}

function serial(C: any, f: () => any): void {
  let info: any;
  Object.defineProperty(C, '$serial', {
    configurable: true,
    get() {
      return (info ??= f());
    },
  });
}

function delegated(d: any): any {
  if (d === null || d === undefined) return d;
  if (d instanceof core.Lazy) return d.value;
  if (typeof d.getValue === 'function') return d.getValue();
  if ('value' in d) return d.value;
  return d;
}

function delegateProp(C: any, name: string, init: () => any, mutable: boolean): void {
  const key = `$del_${C.name}_${name}`;
  Object.defineProperty(C.prototype, name, {
    configurable: true,
    get() {
      if (!Object.prototype.hasOwnProperty.call(this, key)) Object.defineProperty(this, key, { value: init.call(this), writable: true });
      return delegated(this[key]);
    },
    set: mutable
      ? function (this: any, v: any) {
          const d = this[key];
          if (d && typeof d.setValue === 'function') d.setValue(v);
          else Object.defineProperty(this, key, { value: { value: v }, writable: true });
        }
      : undefined,
  });
}

function mutableTop(f: () => any): { value: any } {
  let made = false;
  let v: any;
  return {
    get value() {
      if (!made) {
        v = f();
        made = true;
      }
      return v;
    },
    set value(x: any) {
      v = x;
      made = true;
    },
  };
}

const MIRROR_KEY = 'kanso_mirror';
const CUSTOM_KEY = 'kanso_custom_base_url';

function mirrorBaseUrl(src: any, mirrors: { label: string | null; url: string }[]): string {
  try {
    const v = getPreferencesFor(src).getString(MIRROR_KEY, mirrors[0].url);
    return mirrors.some((m) => m.url === v) ? (v as string) : mirrors[0].url;
  } catch {
    return mirrors[0].url;
  }
}

function customBaseUrl(src: any, def: string): string {
  try {
    const v = getPreferencesFor(src).getString(CUSTOM_KEY, def);
    return v && /^https?:\/\//.test(v) ? v.replace(/\/+$/, '') : def;
  } catch {
    return def;
  }
}

/** Preferences the generated source adds for mirror / custom base URLs. */
export function baseUrlPreferences(meta: { mirrors: { label: string | null; url: string }[] | null; customBaseUrl: string | null }): any[] {
  if (meta.mirrors) {
    const p = new ListPreference();
    p.key = MIRROR_KEY;
    p.title = 'Preferred mirror';
    p.entries = meta.mirrors.map((m) => m.label ?? m.url.replace(/^https?:\/\//, ''));
    p.entryValues = meta.mirrors.map((m) => m.url);
    p.setDefaultValue(meta.mirrors[0].url);
    p.summary = '%s';
    return [p];
  }
  if (meta.customBaseUrl) {
    const p = new EditTextPreference();
    p.key = CUSTOM_KEY;
    p.title = 'Custom base URL';
    p.summary = `Default: ${meta.customBaseUrl}`;
    p.setDefaultValue(meta.customBaseUrl);
    return [p];
  }
  return [];
}

function kclass(x: any, loader: BundleClassLoader): any {
  const C = typeof x === 'function' ? x : x?.constructor;
  const simpleName = (C?.name ?? 'Object').replace(/^C_[a-z0-9]*_/, '').replace(/\$cls$/, '').split('$').pop();
  const java = { classLoader: loader, simpleName, name: simpleName, getSimpleName: () => simpleName, getClassLoader: () => loader };
  return { simpleName, qualifiedName: simpleName, java, isInstance: (o: any) => core.is(o, C), equals: (o: any) => o?.java?.simpleName === simpleName };
}

function plusAssign(target: any, v: any): void {
  if (Array.isArray(target)) {
    if (Array.isArray(v) || v instanceof Set) target.push(...v);
    else target.push(v);
  } else if (target instanceof Set) {
    if (Array.isArray(v) || v instanceof Set) for (const x of v) target.add(x);
    else target.add(v);
  } else if (target instanceof Map) {
    if (v instanceof Map) for (const [k, x] of v) target.set(k, x);
    else if (Array.isArray(v)) for (const p of v) target.set(p.first, p.second);
    else target.set(v.first, v.second);
  } else if (target && typeof target.plusAssign === 'function') target.plusAssign(v);
  else if (target && typeof target.add === 'function') target.add(v);
  else throw new core.UnsupportedOperationException('+= on immutable value');
}

function minusAssign(target: any, v: any): void {
  const rm = Array.isArray(v) || v instanceof Set ? [...v] : [v];
  if (Array.isArray(target)) {
    for (const x of rm) {
      const i = target.findIndex((y) => core.eq(y, x));
      if (i >= 0) target.splice(i, 1);
    }
  } else if (target instanceof Set || target instanceof Map) for (const x of rm) target.delete(x);
  else if (target && typeof target.minusAssign === 'function') target.minusAssign(v);
}

function boolOrBits(op: 'and' | 'or' | 'xor') {
  return (a: any, b: any) => {
    if (typeof a === 'boolean') return op === 'and' ? a && b : op === 'or' ? a || b : a !== b;
    if (typeof a === 'number') return op === 'and' ? a & b : op === 'or' ? a | b : a ^ b;
    return a[op](b);
  };
}

export const k = {
  ...core,
  iter,
  named,
  construct,
  Named,
  base,
  lazyStatic,
  defStatic,
  serial,
  delegated,
  delegateProp,
  mutableTop,
  mirrorBaseUrl,
  customBaseUrl,
  kclass,
  plusAssign,
  minusAssign,
  plusOrAssign: core.plus,
  minusOrAssign: core.minus,
  pair: (a: any, b: any) => new Pair(a, b),
  rangeTo,
  until,
  downTo,
  step,
  IntRange,
  and: boolOrBits('and'),
  or: boolOrBits('or'),
  xor: boolOrBits('xor'),
  /** Class/type from a reified descriptor (for `is T` inside inline reified functions). */
  descClass: (d: any) => (d?.k === 'cls' || d?.k === 'enum' ? d.cls : d?.k === 'str' ? core.KTypes.String : d?.k === 'list' ? core.KTypes.List : core.KTypes.Any),
  throwIt: (e: any): never => {
    throw e;
  },
};

export const rt = {
  k,
  m: modules,
  D: defaultImports,
  S: stdlibExts,
  T,
  HS: hofSync,
  HA: hofAsync,
  loader: (assets: Record<string, string>) => new BundleClassLoader(assets),
};

export interface LoadedBundle {
  sources: {
    name: string;
    lang: string;
    baseUrl: string;
    versionId: number;
    id: string | null;
    mirrors: { label: string | null; url: string }[] | null;
    customBaseUrl: string | null;
    create: () => any;
  }[];
}

/** Evaluate a translated bundle (the text produced by the translator). */
export function loadBundle(code: string): LoadedBundle {
  // eslint-disable-next-line no-new-func
  const factory = new Function(`return ${code}`)();
  return factory(rt) as LoadedBundle;
}

// Placeholder for names the translator could not resolve in lenient (debug) mode.
(k as any).missing = (name: string): any =>
  new Proxy(function () {}, {
    get: (_t, p) => {
      if (p === Symbol.toPrimitive || p === 'toString') return () => `<missing ${name}>`;
      throw new core.UnsupportedOperationException(`Missing runtime API: ${name}.${String(p)}`);
    },
    apply: () => {
      throw new core.UnsupportedOperationException(`Missing runtime API: ${name}()`);
    },
    construct: () => {
      throw new core.UnsupportedOperationException(`Missing runtime API: new ${name}()`);
    },
  });

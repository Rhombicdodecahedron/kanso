// What the runtime provides, read directly from @kanso/source-api so translator and runtime
// can never disagree about available APIs.

import '@kanso/source-api/src/runtime';
import { defaultExts, defaultImports, modules, ANNOTATION } from '@kanso/source-api/src/modules';
import { SUSPEND_MEMBERS, INFECTING_MEMBERS } from '@kanso/source-api/src/kotlin/coroutines';
import { hofSync } from '@kanso/source-api/src/kotlin/builders';

export interface ExtLike {
  name: string;
  recv: (x: any) => boolean;
  fn: (...a: any[]) => any;
  async?: (...a: any[]) => any;
  prop?: boolean;
  suspend?: boolean;
  suspendLambda?: boolean;
  inline?: boolean;
  infect?: boolean;
  params?: string[];
  reified?: 'desc' | 'class';
  recvLambda?: boolean;
}

export function isExtList(v: unknown): v is ExtLike[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && typeof x.name === 'string' && typeof x.recv === 'function');
}

export function isRuntimeClass(v: unknown): boolean {
  if (typeof v !== 'function') return false;
  if ((v as any).$fn) return false;
  return /^class\b/.test(Function.prototype.toString.call(v));
}

export function isAnnotation(v: unknown): boolean {
  return v === ANNOTATION;
}

export class RuntimeInfo {
  readonly fqns = new Set(Object.keys(modules).filter((k) => modules[k] !== undefined));
  readonly suspendMembers = SUSPEND_MEMBERS;
  readonly infectingMembers = INFECTING_MEMBERS;

  has(fqn: string): boolean {
    return this.fqns.has(fqn);
  }
  value(fqn: string): unknown {
    return modules[fqn];
  }
  withPrefix(prefix: string): string[] {
    return [...this.fqns].filter((f) => f.startsWith(prefix + '.') && !f.slice(prefix.length + 1).includes('.'));
  }
  hasDefault(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(defaultImports, name);
  }
  defaultValue(name: string): unknown {
    return defaultImports[name];
  }
  defaultExts(name: string): ExtLike[] {
    return (defaultExts[name] as ExtLike[] | undefined) ?? [];
  }
  hasDefaultExt(name: string): boolean {
    return !!defaultExts[name]?.length;
  }
  /** Stdlib top-level higher-order builders (buildList, with, run, repeat...) */
  isHofBuilder(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(hofSync, name);
  }

  /** Member names visible on instances of a runtime class (methods, getters, fields). */
  private memberCache = new Map<any, Set<string>>();
  members(cls: any): Set<string> {
    const cached = this.memberCache.get(cls);
    if (cached) return cached;
    const r = this.computeMembers(cls);
    this.memberCache.set(cls, r);
    return r;
  }
  private computeMembers(cls: any): Set<string> {
    const out = new Set<string>();
    if (typeof cls !== 'function') return out;
    let p = cls.prototype;
    while (p && p !== Object.prototype && p !== Array.prototype && p !== Map.prototype) {
      for (const k of Object.getOwnPropertyNames(p)) if (k !== 'constructor') out.add(k);
      p = Object.getPrototypeOf(p);
    }
    for (const args of [[], new Array(cls.length).fill(undefined), new Array(cls.length).fill('x'), new Array(cls.length).fill(0)]) {
      try {
        const inst = new cls(...args);
        for (const k of Object.keys(inst)) out.add(k);
        break;
      } catch {
        // try next argument shape
      }
    }
    if (cls.$fields) for (const f of cls.$fields) out.add(f);
    return out;
  }
  statics(v: any): Set<string> {
    const out = new Set<string>();
    if (!v || (typeof v !== 'function' && typeof v !== 'object')) return out;
    let p = v;
    while (p && p !== Function.prototype && p !== Object.prototype) {
      for (const k of Object.getOwnPropertyNames(p)) out.add(k);
      p = Object.getPrototypeOf(p);
    }
    return out;
  }
}

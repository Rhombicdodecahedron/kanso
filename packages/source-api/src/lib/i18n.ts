// keiyoushi.lib.i18n.Intl - reads `i18n/messages_<lang>.properties` from the bundle's assets.

import { str } from '../kotlin/core';
import { Named, positional } from '../kotlin/named';
import { format } from '../kotlin/stdlib';

/** Per-bundle resource access (what `this::class.java.classLoader` becomes). */
export class BundleClassLoader {
  constructor(readonly assets: Record<string, string>) {}
  getResourceAsStream(name: string): { text: string } | null {
    const t = this.assets[name.replace(/^\//, '')];
    return t === undefined ? null : { text: t };
  }
  getResource(name: string): { readText: () => string } | null {
    const r = this.getResourceAsStream(name);
    return r ? { readText: () => r.text } : null;
  }
}

export function parseProperties(text: string): Map<string, string> {
  const m = new Map<string, string>();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^\s+/, '');
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i].replace(/^\s+/, '');
    const sep = /^((?:\\.|[^=:\s\\])*)\s*[=:\s]\s*(.*)$/.exec(line);
    const key = unescape(sep ? sep[1] : line);
    const value = sep ? unescape(sep[2]) : '';
    m.set(key, value);
  }
  return m;
}

function unescape(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_m, c: string) => {
    if (c[0] === 'u' && c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16));
    return c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c;
  });
}

export function createDefaultMessageFileName(lang: string): string {
  const fileSuffix = lang.replace('-', '_').toLowerCase();
  return `i18n/messages_${fileSuffix}.properties`;
}

export class Intl {
  static $params = ['language', 'availableLanguages', 'baseLanguage', 'classLoader', 'createMessageFileName'];
  static Companion = { createDefaultMessageFileName };
  static createDefaultMessageFileName = createDefaultMessageFileName;

  readonly chosenLanguage: string;
  private readonly baseLanguage: string;
  private readonly loader: BundleClassLoader | null;
  private readonly fileName: (l: string) => string;
  private base?: Map<string, string>;
  private chosen?: Map<string, string>;

  constructor(...raw: any[]) {
    const [language, availableLanguages, baseLanguage, classLoader, createMessageFileName] =
      raw[raw.length - 1] instanceof Named ? positional(Intl.$params, raw, 'Intl') : raw;
    const langs: Set<string> = availableLanguages instanceof Set ? availableLanguages : new Set(availableLanguages ?? []);
    this.chosenLanguage = langs.has(language) ? language : baseLanguage;
    this.baseLanguage = baseLanguage;
    this.loader = classLoader instanceof BundleClassLoader ? classLoader : null;
    this.fileName = typeof createMessageFileName === 'function' ? createMessageFileName : createDefaultMessageFileName;
  }

  private bundle(lang: string): Map<string, string> {
    const r = this.loader?.getResourceAsStream(this.fileName(lang));
    return r ? parseProperties(r.text) : new Map();
  }

  get(key: string): string {
    this.base ??= this.bundle(this.baseLanguage);
    this.chosen ??= this.chosenLanguage === this.baseLanguage ? this.base : this.bundle(this.chosenLanguage);
    return this.chosen.get(key) ?? this.base.get(key) ?? `[${key}]`;
  }

  format(key: string, ...args: any[]): string {
    return format(this.get(key), args);
  }

  languageDisplayName(code: string): string {
    try {
      const dn = new (globalThis as any).Intl.DisplayNames([this.chosenLanguage], { type: 'language' });
      const n: string = dn.of(code) ?? code;
      return n.charAt(0).toUpperCase() + n.slice(1);
    } catch {
      return str(code);
    }
  }
}

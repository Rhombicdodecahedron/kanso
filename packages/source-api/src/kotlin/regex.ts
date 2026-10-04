import { IllegalArgumentException, str } from './core';
import { IntRange } from './types';

// java.util.regex / kotlin.text.Regex on top of JS RegExp.

export const RegexOption = {
  IGNORE_CASE: { flag: 'i', name: 'IGNORE_CASE' },
  MULTILINE: { flag: 'm', name: 'MULTILINE' },
  DOT_MATCHES_ALL: { flag: 's', name: 'DOT_MATCHES_ALL' },
  LITERAL: { flag: '', name: 'LITERAL' },
  COMMENTS: { flag: '', name: 'COMMENTS' },
  UNIX_LINES: { flag: '', name: 'UNIX_LINES' },
  CANON_EQ: { flag: '', name: 'CANON_EQ' },
};

/** Translate Java regex syntax into a JS (unicode-mode) pattern + flags. */
export function javaToJs(pattern: string, flags: string): { source: string; flags: string } {
  let src = pattern;
  let f = flags;
  // Leading inline flags: (?i), (?is), (?ims)...
  const inline = /^\(\?([imsux]+)\)/.exec(src);
  if (inline) {
    for (const c of inline[1]) if ('ims'.includes(c) && !f.includes(c)) f += c;
    src = src.slice(inline[0].length);
  }
  // \Q...\E quoting
  src = src.replace(/\\Q([\s\S]*?)(\\E|$)/g, (_m, lit: string) => escapeRegex(lit));
  // Possessive quantifiers and atomic groups have no JS equivalent; greedy is the closest.
  src = src.replace(/([*+?}])\+/g, '$1').replace(/\(\?>/g, '(?:');
  // Java allows `\h` (horizontal whitespace) and `\z`/`\Z`.
  src = src.replace(/\\h/g, '[ \\t\\u00A0]').replace(/\\[zZ]/g, '$');
  // Java POSIX classes.
  src = src
    .replace(/\\p\{Alpha\}/g, '[a-zA-Z]')
    .replace(/\\p\{Digit\}/g, '[0-9]')
    .replace(/\\p\{Alnum\}/g, '[a-zA-Z0-9]')
    .replace(/\\p\{Punct\}/g, '[!-\\/:-@\\[-`{-~]')
    .replace(/\\p\{Upper\}/g, '[A-Z]')
    .replace(/\\p\{Lower\}/g, '[a-z]')
    .replace(/\\p\{Space\}/g, '\\s')
    .replace(/\\p\{IsAlphabetic\}/g, '\\p{Alphabetic}')
    .replace(/\\p\{javaLetter\}/g, '\\p{L}')
    .replace(/\\p\{InCJK[A-Za-z_]*\}/g, '\\p{Script=Han}')
    .replace(/\\p\{Is(Han|Hiragana|Katakana|Hangul|Latin|Cyrillic|Arabic|Thai)\}/g, '\\p{Script=$1}');
  if (!f.includes('u') && needsUnicode(src)) f += 'u';
  if (f.includes('u')) src = fixForUnicodeMode(src);
  return { source: src, flags: f };
}

function needsUnicode(src: string): boolean {
  return /\\p\{|\\P\{|\\x\{/.test(src);
}

// Unicode-mode JS regexes reject escapes Java tolerates (e.g. `\-` outside classes, `\/`, `\'`).
function fixForUnicodeMode(src: string): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      const n = src[i + 1];
      if (n === 'x' && src[i + 2] === '{') {
        const end = src.indexOf('}', i);
        out += '\\u{' + src.slice(i + 3, end) + '}';
        i = end;
        continue;
      }
      if (/[A-Za-z0-9^$\\.*+?()[\]{}|/]/.test(n) || (inClass && n === '-')) {
        out += c + n;
      } else {
        out += n; // identity escape of a char that needs none
      }
      i++;
      continue;
    }
    if (c === '[' && !inClass) inClass = true;
    else if (c === ']' && inClass) inClass = false;
    out += c;
  }
  return out;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/** Kotlin/Java replacement string ($1, ${name}, \$) -> JS replacement. */
export function javaReplacement(rep: string): string {
  let out = '';
  for (let i = 0; i < rep.length; i++) {
    const c = rep[i];
    if (c === '\\' && i + 1 < rep.length) {
      const n = rep[++i];
      out += n === '$' ? '$$' : n;
    } else if (c === '$' && rep[i + 1] === '{') {
      const end = rep.indexOf('}', i);
      out += '$<' + rep.slice(i + 2, end) + '>';
      i = end;
    } else {
      out += c;
    }
  }
  return out;
}

export class MatchGroup {
  constructor(
    readonly value: string,
    readonly range: IntRange,
  ) {}
  component1(): string {
    return this.value;
  }
}

export class MatchResult {
  private readonly m: RegExpExecArray;
  constructor(
    m: RegExpExecArray,
    private readonly regex: Regex,
    private readonly input: string,
  ) {
    this.m = m;
  }
  get value(): string {
    return this.m[0];
  }
  get range(): IntRange {
    return new IntRange(this.m.index, this.m.index + this.m[0].length - 1);
  }
  get groupValues(): string[] {
    return Array.from(this.m, (g) => g ?? '');
  }
  get groups(): MatchGroupCollection {
    return new MatchGroupCollection(this.m);
  }
  get destructured(): Destructured {
    return new Destructured(this.groupValues);
  }
  next(): MatchResult | null {
    const start = this.m.index + Math.max(this.m[0].length, 1);
    if (start > this.input.length) return null;
    return this.regex.find(this.input, start);
  }
}

export class Destructured {
  constructor(private readonly values: string[]) {}
  toList(): string[] {
    return this.values.slice(1);
  }
}
for (let i = 1; i <= 10; i++) {
  (Destructured.prototype as any)[`component${i}`] = function (this: any) {
    return this.values[i] ?? '';
  };
}

export class MatchGroupCollection {
  constructor(private readonly m: RegExpExecArray) {}
  get(key: number | string): MatchGroup | null {
    let v: string | undefined;
    let idx = -1;
    if (typeof key === 'number') {
      v = this.m[key];
      if (v !== undefined && (this.m as any).indices) idx = (this.m as any).indices[key][0];
    } else {
      v = this.m.groups?.[key];
      if (v !== undefined && (this.m as any).indices?.groups) idx = (this.m as any).indices.groups[key][0];
    }
    if (v === undefined) return null;
    return new MatchGroup(v, new IntRange(idx, idx + v.length - 1));
  }
  get size(): number {
    return this.m.length;
  }
}

export class Regex {
  readonly js: RegExp;
  readonly pattern: string;
  readonly options: Set<any>;
  constructor(pattern: string | RegExp, option?: any) {
    if (pattern instanceof RegExp) {
      this.js = pattern;
      this.pattern = pattern.source;
      this.options = new Set();
      return;
    }
    const opts: any[] = option === undefined || option === null ? [] : option instanceof Set ? [...option] : Array.isArray(option) ? option : [option];
    this.options = new Set(opts);
    this.pattern = pattern;
    let flags = '';
    for (const o of opts) if (o?.flag && !flags.includes(o.flag)) flags += o.flag;
    const literal = opts.includes(RegexOption.LITERAL);
    const conv = literal ? { source: escapeRegex(pattern), flags } : javaToJs(pattern, flags);
    try {
      this.js = new RegExp(conv.source, conv.flags + (hasIndices ? 'd' : ''));
    } catch (e) {
      try {
        // Retry without unicode mode in case only that was the problem.
        this.js = new RegExp(conv.source, conv.flags.replace('u', '') + (hasIndices ? 'd' : ''));
      } catch {
        throw new IllegalArgumentException(`Invalid regex ${pattern}: ${(e as Error).message}`);
      }
    }
  }

  private g(): RegExp {
    return new RegExp(this.js.source, this.js.flags.includes('g') ? this.js.flags : this.js.flags + 'g');
  }

  static escape(s: string): string {
    return escapeRegex(s);
  }
  static escapeReplacement(s: string): string {
    return s.replace(/[\\$]/g, '\\$&');
  }
  static fromLiteral(s: string): Regex {
    return new Regex(s, RegexOption.LITERAL);
  }

  find(input: string, startIndex = 0): MatchResult | null {
    const re = this.g();
    re.lastIndex = startIndex;
    const m = re.exec(input);
    return m ? new MatchResult(m, this, input) : null;
  }
  findAll(input: string, startIndex = 0): MatchResult[] {
    const out: MatchResult[] = [];
    const re = this.g();
    re.lastIndex = startIndex;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input))) {
      out.push(new MatchResult(m, this, input));
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  }
  matchEntire(input: string): MatchResult | null {
    const re = new RegExp('^(?:' + this.js.source + ')$', this.js.flags.replace('g', '').replace('m', ''));
    const m = re.exec(input);
    return m ? new MatchResult(m, this, input) : null;
  }
  matchAt(input: string, index: number): MatchResult | null {
    const re = new RegExp(this.js.source, this.js.flags.replace('g', '') + 'y');
    re.lastIndex = index;
    const m = re.exec(input);
    return m ? new MatchResult(m, this, input) : null;
  }
  matches(input: string): boolean {
    return this.matchEntire(input) !== null;
  }
  containsMatchIn(input: string): boolean {
    return new RegExp(this.js.source, this.js.flags.replace('g', '')).test(input);
  }
  replace(input: string, replacement: any): string {
    if (typeof replacement === 'function') {
      return input.replace(this.g(), (...args: any[]) => {
        const m = buildExec(args, input);
        return str(replacement(new MatchResult(m, this, input)));
      });
    }
    return input.replace(this.g(), javaReplacement(str(replacement)));
  }
  replaceFirst(input: string, replacement: string): string {
    return input.replace(new RegExp(this.js.source, this.js.flags.replace('g', '')), javaReplacement(replacement));
  }
  split(input: string, limit = 0): string[] {
    const parts = input.split(this.g());
    // JS includes capture groups in split output; Java doesn't. Drop them.
    const groups = new RegExp(this.js.source + '|').exec('')!.length - 1;
    const clean = groups > 0 ? parts.filter((_, i) => i % (groups + 1) === 0) : parts;
    if (limit > 0 && clean.length > limit) {
      return [...clean.slice(0, limit - 1), splitRemainder(input, this, limit - 1)];
    }
    return clean;
  }
  toPattern(): Pattern {
    return new Pattern(this);
  }
  toString(): string {
    return this.pattern;
  }
}

function splitRemainder(input: string, r: Regex, n: number): string {
  let m = r.find(input);
  for (let i = 1; i < n && m; i++) m = m.next();
  return m ? input.slice(m.range.last + 1) : '';
}

const hasIndices = (() => {
  try {
    new RegExp('a', 'd');
    return true;
  } catch {
    return false;
  }
})();

function buildExec(args: any[], input: string): RegExpExecArray {
  const hasGroups = typeof args[args.length - 1] === 'object';
  const groups = hasGroups ? args[args.length - 1] : undefined;
  const offsetPos = hasGroups ? args.length - 3 : args.length - 2;
  const m: any = args.slice(0, offsetPos);
  m.index = args[offsetPos];
  m.input = input;
  m.groups = groups;
  return m as RegExpExecArray;
}

// java.util.regex.Pattern / Matcher, used by a handful of sources.
export class Pattern {
  constructor(readonly regex: Regex) {}
  static compile(p: string, flags = 0): Pattern {
    const opts: any[] = [];
    if (flags & 2) opts.push(RegexOption.IGNORE_CASE);
    if (flags & 8) opts.push(RegexOption.MULTILINE);
    if (flags & 32) opts.push(RegexOption.DOT_MATCHES_ALL);
    return new Pattern(new Regex(p, opts));
  }
  static CASE_INSENSITIVE = 2;
  static MULTILINE = 8;
  static DOTALL = 32;
  static quote(s: string): string {
    return escapeRegex(s);
  }
  static matches(p: string, input: string): boolean {
    return new Regex(p).matches(input);
  }
  matcher(input: string): Matcher {
    return new Matcher(this.regex, input);
  }
  pattern(): string {
    return this.regex.pattern;
  }
  split(input: string): string[] {
    return this.regex.split(input);
  }
  toRegex(): Regex {
    return this.regex;
  }
}

export class Matcher {
  private current: MatchResult | null = null;
  private pos = 0;
  constructor(
    private readonly regex: Regex,
    private readonly input: string,
  ) {}
  find(start?: number): boolean {
    if (start !== undefined) this.pos = start;
    this.current = this.regex.find(this.input, this.pos);
    if (this.current) this.pos = this.current.range.last + 1 + (this.current.value.length === 0 ? 1 : 0);
    return this.current !== null;
  }
  matches(): boolean {
    this.current = this.regex.matchEntire(this.input);
    return this.current !== null;
  }
  lookingAt(): boolean {
    this.current = this.regex.matchAt(this.input, 0);
    return this.current !== null;
  }
  group(i: number | string = 0): string | null {
    if (!this.current) throw new IllegalArgumentException('No match found');
    return this.current.groups.get(i)?.value ?? null;
  }
  groupCount(): number {
    return this.current ? this.current.groupValues.length - 1 : 0;
  }
  start(): number {
    return this.current!.range.first;
  }
  end(): number {
    return this.current!.range.last + 1;
  }
  replaceAll(rep: string): string {
    return this.regex.replace(this.input, rep);
  }
  replaceFirst(rep: string): string {
    return this.regex.replaceFirst(this.input, rep);
  }
}

import { describe, expect, it } from 'vitest';
import { call, prop, eq, div, str } from '../src/kotlin/core';
import { stdlibExts as S } from '../src/kotlin/stdlib';
import { Regex } from '../src/kotlin/regex';

const c = (recv: any, name: string, ...args: any[]) => call(recv, name, S[name] ?? [], args);

describe('stdlib', () => {
  it('string ops use Kotlin semantics', () => {
    expect(c('a.b.c', 'replace', '.', '-')).toBe('a-b-c');
    expect(c('/manga/slug/', 'trimEnd', '/')).toBe('/manga/slug');
    expect(c('a/b/c', 'substringAfterLast', '/')).toBe('c');
    expect(c('abc', 'substringAfter', 'x')).toBe('abc');
    expect(c('Chapter 12.5', 'substringAfter', ' ')).toBe('12.5');
    expect(c('12', 'toIntOrNull')).toBe(12);
    expect(c('12a', 'toIntOrNull')).toBeNull();
    expect(c('a, b,c', 'split', ',').map((s: string) => s.trim())).toEqual(['a', 'b', 'c']);
    expect(c(' ', 'isBlank')).toBe(true);
    expect(c('Hello', 'contains', 'ell')).toBe(true);
    expect(c('Hello', 'contains', 'ELL', true)).toBe(true);
  });
  it('collections', () => {
    expect(c([3, 1, 2], 'sorted')).toEqual([1, 2, 3]);
    expect(c([1, 2, 3, 4], 'mapNotNull', (x: number) => (x % 2 ? null : x * 10))).toEqual([20, 40]);
    expect(c([], 'firstOrNull')).toBeNull();
    expect(prop([1, 2], 'size', S.size)).toBe(2);
    expect(c(['a', 'b'], 'joinToString', ', ')).toBe('a, b');
    expect(c([{ s: 'x' }, { s: 'x' }, { s: 'y' }], 'distinctBy', (o: any) => o.s).length).toBe(2);
    expect(c(['b', 'a'], 'sortedBy', (x: string) => x)).toEqual(['a', 'b']);
  });
  it('async hof variant', async () => {
    const ext = S.map.find((e) => e.recv([]))!;
    const out = await ext.async!([1, 2], async (x: number) => x * 2);
    expect(out).toEqual([2, 4]);
  });
  it('regex', () => {
    const r = new Regex('(?i)chapter\\s*(\\d+)');
    expect(r.find('CHAPTER 12')!.groupValues[1]).toBe('12');
    expect(new Regex('\\d+').replace('a1b22', '#')).toBe('a#b#');
    expect(new Regex('(\\w)(\\d)').replace('a1', '$2$1')).toBe('1a');
  });
  it('operators', () => {
    expect(div(7, 2)).toBe(3);
    expect(div(7.5, 2)).toBe(3.75);
    expect(eq([1, 2], [1, 2])).toBe(true);
    expect(str(null)).toBe('null');
  });
});

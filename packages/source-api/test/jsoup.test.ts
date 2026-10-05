import { describe, expect, it } from 'vitest';
import { Jsoup } from '../src/jsoup';

const html = `<html><head><base href="/sub/"><title>T</title></head><body>
<table><tr><td>a</td><td>b</td></tr></table>
<div class="post-title"><h3>  Hello <b>World</b>&amp;co </h3><a href="manga/one">One</a></div>
<div class="summary-heading">Status</div><div>Ongoing</div>
<ul><li>1</li><li>2</li><li>3</li></ul>
<p>line1<br>line2</p>
<img data-src="//cdn.x.com/a.jpg" src="data:x">
<script>var x = {"a":1};</script>
</body></html>`;

describe('jsoup shim', () => {
  const doc = Jsoup.parse(html, 'https://site.com/manga/');
  it('parses like HTML5 (implied tbody)', () => {
    expect(doc.select('table > tbody > tr > td').length).toBe(2);
  });
  it('normalizes text', () => {
    expect(doc.selectFirst('div.post-title h3')!.text()).toBe('Hello World&co');
    expect(doc.selectFirst('p')!.text()).toBe('line1 line2');
    expect(doc.selectFirst('p')!.wholeText()).toBe('line1\nline2');
  });
  it('resolves abs urls with <base>', () => {
    expect(doc.selectFirst('.post-title a')!.attr('abs:href')).toBe('https://site.com/sub/manga/one');
    expect(doc.selectFirst('img')!.absUrl('data-src')).toBe('https://cdn.x.com/a.jpg');
    expect(doc.location()).toBe('https://site.com/manga/');
  });
  it('absUrl keeps raw characters like java.net.URL (srcset)', () => {
    const d = Jsoup.parse('<img srcset="/a.webp 386w, /b.webp 772w">', 'https://x.com/m/');
    expect(d.selectFirst('img')!.attr('abs:srcset')).toBe('https://x.com/a.webp 386w, /b.webp 772w');
  });
  it('supports jsoup pseudos', () => {
    expect(doc.select('div.summary-heading:contains(status) + div').text()).toBe('Ongoing');
    expect(doc.select('li:eq(1)').text()).toBe('2');
    expect(doc.select('li:lt(2)').length).toBe(2);
    expect(doc.select('li:gt(0)').length).toBe(2);
    expect(doc.select('img[data-src~=\\.jpg$]').length).toBe(1);
    expect(doc.select('li:matches(^[23]$)').length).toBe(2);
    expect(doc.select('div:has(> h3)').length).toBe(1);
    expect(doc.select('[^data-]').length).toBe(1);
  });
  it('script data', () => {
    expect(doc.selectFirst('script')!.data()).toBe('var x = {"a":1};');
  });
  it('elements helpers', () => {
    const lis = doc.select('li');
    expect(lis.text()).toBe('1 2 3');
    expect(lis.first()!.text()).toBe('1');
    expect(lis.eachText()).toEqual(['1', '2', '3']);
    expect(doc.select('nothing').first()).toBeNull();
  });
  it('wrappers are stable', () => {
    expect(doc.selectFirst('li')).toBe(doc.select('li')[0]);
  });
});

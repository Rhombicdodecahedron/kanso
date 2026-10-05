import { describe, expect, it } from 'vitest';
import '../src/runtime';
import { call, IllegalStateException } from '../src/kotlin/core';
import { stdlibExts } from '../src/kotlin/stdlib';
import { modules } from '../src/modules';

const QuickJs = modules['app.cash.quickjs.QuickJs'] as any;
const QuickJsException = modules['app.cash.quickjs.QuickJsException'] as any;

// Dean Edwards packer output, as served by mangahere/doodmanga (the extension strips "eval").
const PACKED = String.raw`eval(function(p,a,c,k,e,d){e=function(c){return c.toString(36)};if(!''.replace(/^/,String)){while(c--){d[c.toString(a)]=k[c]||c.toString(a)}k=[function(e){return d[e]}];e=function(){return'\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c])}}return p}('0 1="2://3.4/5/6.7";0 8="/9/a.b";',12,12,'var|pix|https|zjcdn|mangahere|store|manga|org|pvalue|1|001|jpg'.split('|'),0,{}))`;

describe('QuickJs shim', () => {
  it('unpacks packer-obfuscated scripts', () => {
    const out = call(QuickJs.create(), 'use', stdlibExts.use, [(it: any) => it.evaluate(PACKED.replace(/^eval/, '')).toString()]);
    expect(out).toBe('var pix="https://zjcdn.mangahere/store/manga.org";var pvalue="/1/001.jpg";');
  });

  it('converts results like QuickJs', () => {
    const js = QuickJs.create();
    expect(js.evaluate('1 + 1')).toBe(2);
    expect(js.evaluate('"a" + "b";')).toBe('ab');
    expect(js.evaluate('3 > 2')).toBe(true);
    expect(js.evaluate('var x = 1;')).toBeNull();
    expect(js.evaluate('undefined')).toBeNull();
    expect(js.evaluate('({a: 1})')).toBeNull();
    expect(js.evaluate('[1, "two", [true]]')).toEqual([1, 'two', [true]]);
    js.close();
  });

  it('keeps top-level declarations between evaluations (kuaikanmanhua __NUXT__)', () => {
    const js = QuickJs.create();
    js.evaluate('var window = {};');
    js.evaluate('window.__NUXT__=(function(a,b){return {data:[{title:a,count:b}]}}("Comic",3));');
    expect(js.evaluate('JSON.stringify(window.__NUXT__)')).toBe('{"data":[{"title":"Comic","count":3}]}');
    // mangago order: the helper exists before the function that uses it is defined
    js.evaluate('function replacePos(s, pos, t) { return s.substr(0, pos) + t + s.substring(pos + 1); }');
    js.evaluate('function getKey(url) { var key = url.split("/").pop(); return replacePos(key, 0, "X"); }');
    expect(js.evaluate('getKey("https://cdn/abc");')).toBe('Xbc');
    js.close();
  });

  it('isolates instances and the host global scope', () => {
    // readcomiconline declares `let` in two separate instances
    const a = QuickJs.create();
    expect(a.evaluate('let _encryptedString = "x";let _useServer2 = false;JSON.stringify([_encryptedString + "1"])')).toBe('["x1"]');
    a.close();
    const b = QuickJs.create();
    expect(b.evaluate('let _encryptedString = "y";_encryptedString')).toBe('y');
    b.close();
    // synchrony replaces console through globalThis; sucuri assigns an undeclared global
    const c = QuickJs.create();
    c.evaluate('globalThis.console = { log: () => {} };');
    c.evaluate('leaked = 42;');
    expect(c.evaluate('typeof console.warn + ":" + leaked')).toBe('undefined:42');
    expect((globalThis as any).leaked).toBeUndefined();
    expect(typeof console.warn).toBe('function');
    expect('_encryptedString' in globalThis).toBe(false);
  });

  it('provides minimal browser globals (onfmangas cookie challenge)', () => {
    const script = `
      var window = { location: {} };
      var document = { cookie: null };
      var location = window.location;
      var setTimeout = function(fn, _) { fn(); };

      (function(){ var t = atob("Y2hhbGxlbmdlPW9r"); setTimeout(function(){ document.cookie = t + "; path=/"; location.href = "/"; }, 100); })();

      document.cookie;`;
    expect(QuickJs.create().evaluate(script)).toBe('challenge=ok; path=/');
    const js = QuickJs.create();
    expect(js.evaluate('btoa("hello") + "|" + typeof document.getElementById + "|" + (window === self)')).toBe('aGVsbG8=|function|true');
  });

  it('sucuri-style two-step evaluation', () => {
    const js = QuickJs.create();
    const step1 = js.evaluate("r='coo'+'kie=\"sucuri_cloudproxy_uuid_1=abc;path=/;max-age=86400\";location.reload();';r=r.replace('document.cookie','cookie');");
    const step2 = js.evaluate(step1.replace('location.', '').replace('reload();', ''));
    expect(step2).toBe('sucuri_cloudproxy_uuid_1=abc;path=/;max-age=86400');
  });

  it('builds arrays from loops (comicabc)', () => {
    const r = QuickJs.create().evaluate(`
      var urls = [];
      var ps = 3;
      for (var j = 1; j <= ps; j++) {
          var s = 'https:' + unescape('//img%2Ecdn/' + j + '.jpg');
          urls.push(s);
      }
      urls;`);
    expect(r).toEqual(['https://img.cdn/1.jpg', 'https://img.cdn/2.jpg', 'https://img.cdn/3.jpg']);
  });

  it('handles regex literals, templates and comments when finding the result', () => {
    const js = QuickJs.create();
    expect(js.evaluate('const re = /;\\/}/g; // trailing ; comment }\n`a${"}"};` + "b".replace(re, "")')).toBe('a};b');
    expect(js.evaluate('var o = {a: 1}\nvar f = function() { return 2 }\no.a + f()\n/* done */')).toBe(3);
  });

  it('compile + execute (mangago bytecode)', () => {
    const code = QuickJs.create().compile('function replacePos(strObj, pos, t) { return strObj.substr(0, pos) + t + strObj.substring(pos + 1, strObj.length); }', '?');
    expect(code).toBeInstanceOf(Int8Array);
    const js = QuickJs.create();
    js.execute(code);
    expect(js.evaluate('replacePos("abcd", 1, "Z")')).toBe('aZcd');
  });

  it('nested eval runs in the same context', () => {
    const js = QuickJs.create();
    js.evaluate('var x = 20;');
    expect(js.evaluate('eval("x + 1")')).toBe(21);
    expect(js.evaluate('eval(function(p){return p}("var y = 5; y * 2"))')).toBe(10);
  });

  it('raises QuickJsException and refuses use after close', () => {
    const js = QuickJs.create();
    expect(() => js.evaluate('throw new Error("nope")')).toThrow(QuickJsException);
    expect(() => js.evaluate('missingFn()')).toThrow(/is not (defined|a function)/);
    expect(() => js.evaluate('var = ;')).toThrow(QuickJsException);
    js.close();
    expect(() => js.evaluate('1')).toThrow(IllegalStateException);
  });
});

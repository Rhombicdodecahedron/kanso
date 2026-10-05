// app.cash.quickjs.QuickJs on top of the host engine's `new Function` (Hermes / V8).
//
// Each QuickJs instance is a sandbox: a global object `G` (whose prototype is the real global, so
// built-ins resolve) that also backs `window`/`self`/`globalThis`, plus minimal `document`,
// `location`, `navigator`, `atob`/`btoa`, `console` and `eval`. A script runs as a sloppy-mode
// function body: free identifiers it uses that are not real built-ins are declared as locals
// initialised from `G` and written back afterwards, so top-level declarations persist between
// `evaluate` calls without leaking into the host's global scope. Top-level `let`/`const` become
// `var` for that. `evaluate` returns the completion value of the script's last expression
// statement, converted like QuickJs does (String, Number, Boolean, arrays, else null).
//
// Limitations (no `with` on Hermes): a function binds the sandbox names it references when its
// script runs, so it does not see names first defined, or reassigned, by a later `evaluate`; and
// a nested `eval(code)` sees the caller script's top-level variables only from earlier calls.

import { IllegalStateException, RuntimeException } from '../kotlin/core';

export class QuickJsException extends RuntimeException {
  static $params = ['message'];
}

// ---------- tokenizer ----------

interface Tok {
  t: 'id' | 'num' | 'str' | 'tpl' | 're' | 'p';
  v: string;
  s: number;
  e: number;
  /** bracket nesting level the token sits at (brackets themselves count at the outer level) */
  d: number;
  /** a line terminator precedes this token */
  nl: boolean;
}

const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];
const REGEX_AFTER_KEYWORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const ID_START = /[A-Za-z_$\u0080-￿]/;
const ID_PART = /[\w$\u0080-￿]/;

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const tplDepths: number[] = [];
  let i = 0;
  let depth = 0;
  let nl = false;
  const push = (t: Tok['t'], s: number, e: number, d = depth) => {
    toks.push({ t, v: src.slice(s, e), s, e, d, nl });
    nl = false;
  };
  const regexAllowed = () => {
    const p = toks[toks.length - 1];
    if (!p) return true;
    if (p.t === 'p') return !(p.v === ')' || p.v === ']' || p.v === '++' || p.v === '--');
    if (p.t === 'id') return REGEX_AFTER_KEYWORD.has(p.v);
    return false;
  };
  /** Reads template characters from i until '`' (end) or '${' (substitution). */
  const readTemplate = (start: number) => {
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') i += 2;
      else if (c === '`') {
        i++;
        push('tpl', start, i);
        return;
      } else if (c === '$' && src[i + 1] === '{') {
        i += 2;
        push('tpl', start, i);
        tplDepths.push(depth);
        depth++;
        return;
      } else i++;
    }
    push('tpl', start, i);
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') {
      nl = true;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v' || c === '\u00a0' || c === '\ufeff') {
      i++;
      continue;
    }
    const start = i;
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      if (/[\n\r\u2028\u2029]/.test(src.slice(i, stop))) nl = true;
      i = stop;
      continue;
    }
    if (ID_START.test(c) || c === '\\') {
      i++;
      while (i < src.length && (ID_PART.test(src[i]) || src[i] === '\\')) i++;
      push('id', start, i);
      continue;
    }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      const hex = c === '0' && /[xX]/.test(src[i + 1] ?? '');
      i++;
      while (i < src.length && (/[\w.]/.test(src[i]) || (!hex && (src[i] === '+' || src[i] === '-') && /[eE]/.test(src[i - 1])))) i++;
      push('num', start, i);
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      push('str', start, i);
      continue;
    }
    if (c === '`') {
      i++;
      readTemplate(start);
      continue;
    }
    if (c === '}' && tplDepths.length && tplDepths[tplDepths.length - 1] === depth - 1) {
      tplDepths.pop();
      depth--;
      i++;
      readTemplate(start);
      continue;
    }
    if (c === '/' && regexAllowed()) {
      i++;
      let inClass = false;
      while (i < src.length) {
        const ch = src[i];
        if (ch === '\\') i++;
        else if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        else if (ch === '\n') break;
        i++;
      }
      i++;
      while (i < src.length && ID_PART.test(src[i])) i++;
      push('re', start, i);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      i++;
      push('p', start, i);
      depth++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth = Math.max(0, depth - 1);
      i++;
      push('p', start, i);
      continue;
    }
    const p = PUNCT.find((x) => src.startsWith(x, i));
    i += p ? p.length : 1;
    push('p', start, i);
  }
  return toks;
}

// ---------- script analysis ----------

const KEYWORDS = new Set(
  'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof new return super switch this throw try typeof var void while with yield let static enum await implements package protected interface private public null true false undefined NaN Infinity arguments async of get set'.split(' '),
);
const DECL_START = new Set(['var', 'let', 'const', 'function', 'class', 'async']);
const STMT_START = new Set(['if', 'for', 'while', 'do', 'switch', 'try', 'return', 'throw', 'break', 'continue', 'import', 'export', 'with', 'debugger']);
const SHADOWED = ['window', 'self', 'globalThis', 'global', 'top', 'parent', 'frames', 'document', 'location', 'navigator', 'atob', 'btoa', 'console', 'eval'];
const RESULT = '$$qjs_r';
const SANDBOX = '$$qjs_G';
const SETTER = '$$qjs_set';

/** Sandbox writes always create own properties (the real global may have accessor-only ones). */
function setOwn(g: any, key: string, value: any): void {
  Object.defineProperty(g, key, { value, writable: true, enumerable: true, configurable: true });
}

function isExpression(text: string): boolean {
  try {
    // eslint-disable-next-line no-new-func
    new Function(`return (${text}\n)`);
    return true;
  } catch {
    return false;
  }
}

function trimTail(s: string): string {
  return s.replace(/[\s;]+$/, '');
}

interface Prepared {
  code: string;
  /** names to bind from the sandbox before running and write back afterwards */
  names: string[];
  /** top-level function declarations: written back but not initialised (hoisting wins) */
  functions: Set<string>;
}

function prepare(src: string, sandbox: Record<string, any>, realGlobal: any): Prepared {
  const toks = tokenize(src);
  let code = src;
  const functions = new Set<string>();
  const classes = new Set<string>();
  const referenced = new Set<string>();
  toks.forEach((tk, k) => {
    const prev = toks[k - 1];
    const next = toks[k + 1];
    if (tk.t !== 'id') return;
    // top-level let/const -> var (same length edits keep token offsets valid)
    if (tk.d === 0 && (tk.v === 'let' || tk.v === 'const') && next && (next.t === 'id' || next.v === '[' || next.v === '{')) {
      code = code.slice(0, tk.s) + 'var' + ' '.repeat(tk.v.length - 3) + code.slice(tk.e);
      return;
    }
    if (tk.d === 0 && tk.v === 'function' && next?.t === 'id' && (!prev || prev.v === ';' || prev.v === '}' || (tk.nl && (prev.t !== 'p' || prev.v === ')' || prev.v === ']')))) {
      functions.add(next.v);
    }
    if (tk.d === 0 && tk.v === 'class' && next?.t === 'id' && (!prev || prev.v === ';' || prev.v === '}' || tk.nl)) classes.add(next.v);
    if (prev && (prev.v === '.' || prev.v === '?.')) return;
    if (next?.v === ':' && prev && (prev.v === '{' || prev.v === ',')) return;
    if (KEYWORDS.has(tk.v) || tk.v.includes('\\')) return;
    referenced.add(tk.v);
  });
  const names = [...referenced].filter((n) => !classes.has(n)).filter((n) => SHADOWED.includes(n) || Object.prototype.hasOwnProperty.call(sandbox, n) || functions.has(n) || !(n in realGlobal));
  return { code: withCompletion(code, toks), names, functions };
}

/** Rewrites `code` so the last expression statement's value lands in RESULT. */
function withCompletion(code: string, toks: Tok[]): string {
  const cands = new Set<number>([0]);
  const at = new Map<number, Tok>();
  toks.forEach((tk, k) => {
    at.set(tk.s, tk);
    if (tk.d !== 0) return;
    if (tk.nl) cands.add(tk.s);
    if (tk.t === 'p' && (tk.v === ';' || tk.v === '}') && toks[k + 1]) cands.add(toks[k + 1].s);
  });
  const sorted = [...cands].filter((p) => at.has(p)).sort((a, b) => a - b);
  let end = code.length;
  let best = -1;
  let misses = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    const tail = trimTail(code.slice(p, end));
    if (!tail) continue;
    const first = at.get(p)!;
    if (best < 0 && first.t === 'id' && DECL_START.has(first.v)) {
      end = p;
      continue;
    }
    if (best < 0 && ((first.t === 'id' && STMT_START.has(first.v)) || first.v === '{')) break;
    if (isExpression(tail)) {
      best = p;
      continue;
    }
    if (best >= 0 || ++misses > 32) break;
  }
  if (best < 0) return code;
  return `${code.slice(0, best)}\n;${RESULT} = (${trimTail(code.slice(best, end))}\n);\n${code.slice(end)}`;
}

function compileScript(p: Prepared): (g: any) => any {
  const key = (n: string) => JSON.stringify(n);
  const init = p.names.filter((n) => !p.functions.has(n)).map((n) => `${n} = ${SANDBOX}[${key(n)}]`);
  const back = p.names.map((n) => `if (${n} !== undefined || Object.prototype.hasOwnProperty.call(${SANDBOX}, ${key(n)})) ${SETTER}(${SANDBOX}, ${key(n)}, ${n});`);
  const body = `${init.length ? `var ${init.join(', ')};\n` : ''}var ${RESULT};\n${p.code}\n;${back.join('\n')}\nreturn ${RESULT};`;
  // eslint-disable-next-line no-new-func
  const fn = new Function(SANDBOX, SETTER, body);
  return (g: any) => fn(g, setOwn);
}

// ---------- browser-ish globals ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function btoa(input: any): string {
  const s = String(input);
  let out = '';
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i);
    const b = s.charCodeAt(i + 1);
    const c = s.charCodeAt(i + 2);
    if (a > 255 || b > 255 || c > 255) throw new Error('Invalid character');
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < s.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < s.length ? B64[n & 63] : '=');
  }
  return out;
}

function atob(input: any): string {
  const s = String(input).replace(/[\s=]+/g, '');
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('Invalid character');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  return out;
}

function makeSandbox(ctx: QuickJs): Record<string, any> {
  const realGlobal: any = globalThis;
  const G: Record<string, any> = Object.create(realGlobal);
  const noop = () => {};
  const location = { href: '', host: '', hostname: '', origin: '', protocol: 'https:', pathname: '/', search: '', hash: '', port: '', reload: noop, replace: noop, assign: noop };
  const element = () => ({ style: {}, setAttribute: noop, getAttribute: () => null, appendChild: noop, removeChild: noop, addEventListener: noop, children: [], innerHTML: '', textContent: '' });
  const globals: Record<string, any> = {
    window: G,
    self: G,
    globalThis: G,
    global: G,
    top: G,
    parent: G,
    frames: G,
    location,
    navigator: { userAgent: 'Mozilla/5.0', language: 'en-US', languages: ['en-US'], platform: '', cookieEnabled: true },
    document: {
      cookie: '',
      referrer: '',
      location,
      readyState: 'complete',
      getElementById: () => null,
      getElementsByTagName: () => [],
      getElementsByClassName: () => [],
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: element,
      addEventListener: noop,
      body: element(),
      head: element(),
      documentElement: element(),
    },
    atob,
    btoa,
    console: { log: noop, info: noop, warn: noop, error: noop, debug: noop, trace: noop },
    eval: (code: any) => (typeof code === 'string' ? ctx.$run(code) : code),
  };
  for (const [k, v] of Object.entries(globals)) setOwn(G, k, v);
  return G;
}

// ---------- QuickJs ----------

function convert(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(convert);
  if (v instanceof Int8Array || v instanceof Uint8Array) return Int8Array.from(v);
  return null;
}

const BYTECODE_MAGIC = '\u0000kanso-qjs\u0000';

export class QuickJs {
  private closed = false;
  private readonly sandbox: Record<string, any>;

  private constructor() {
    this.sandbox = makeSandbox(this);
  }

  static create(): QuickJs {
    return new QuickJs();
  }

  /** Runs a script in this context and returns its completion value (unconverted). */
  $run(script: string): any {
    if (this.closed) throw new IllegalStateException('QuickJs instance was closed');
    let fn: (g: any) => any;
    try {
      fn = compileScript(prepare(script, this.sandbox, globalThis));
    } catch (e: any) {
      throw new QuickJsException(`SyntaxError: ${e?.message ?? e}`);
    }
    try {
      return fn(this.sandbox);
    } catch (e: any) {
      if (e instanceof QuickJsException) throw e;
      throw new QuickJsException(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  }

  evaluate(script: string, _fileName?: string): any {
    return convert(this.$run(String(script)));
  }

  /** Real QuickJs returns bytecode; here the "bytecode" is the tagged UTF-8 source. */
  compile(script: string, _fileName?: string): Int8Array {
    const b = new TextEncoder().encode(BYTECODE_MAGIC + String(script));
    return new Int8Array(b.buffer, b.byteOffset, b.byteLength);
  }

  execute(bytecode: Int8Array | Uint8Array): any {
    const u = bytecode instanceof Uint8Array ? bytecode : new Uint8Array(bytecode.buffer, bytecode.byteOffset, bytecode.byteLength);
    const text = new TextDecoder().decode(u);
    if (!text.startsWith(BYTECODE_MAGIC)) throw new QuickJsException('Invalid bytecode');
    return convert(this.$run(text.slice(BYTECODE_MAGIC.length)));
  }

  /** `set(name, Interface::class.java, obj)`: exposes a host object to scripts. */
  set(name: string, _type: any, obj: any): void {
    setOwn(this.sandbox, name, obj);
  }

  /** `get(name, Interface::class.java)`: a proxy whose methods call the script object's functions. */
  get(name: string, _type?: any): any {
    const target = this.sandbox[name];
    if (target === null || target === undefined) throw new QuickJsException(`A global JavaScript object called ${name} was not found`);
    return target;
  }

  close(): void {
    this.closed = true;
  }
}
(QuickJs as any).Companion = { create: QuickJs.create };

export const quickJsModules: Record<string, unknown> = {
  'app.cash.quickjs.QuickJs': QuickJs,
  'app.cash.quickjs.QuickJsException': QuickJsException,
};

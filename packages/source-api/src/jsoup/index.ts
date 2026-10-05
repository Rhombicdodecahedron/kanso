// org.jsoup.* on top of parse5 (HTML5 tree building like Jsoup) + css-select.

import { selectAll, selectOne, is as cssIs } from 'css-select';
import { Element as DomElement, Document as DomDocument, Text as DomText, DataNode, type AnyNode, type ParentNode, Comment as DomComment, CDATA } from 'domhandler';
import { parse as parse5Parse, parseFragment as parse5ParseFragment } from 'parse5';
import { adapter } from 'parse5-htmlparser2-tree-adapter';
import { parseDocument as htmlparser2Parse } from 'htmlparser2';
import render from 'dom-serializer';
import { IllegalArgumentException, str } from '../kotlin/core';
import { Regex } from '../kotlin/regex';
import { resolveUrl, resolveUrlRaw } from '../okhttp/url';

// ---------- selector dialect ----------

const RAW_PSEUDOS = [
  'containsWholeOwnText',
  'containsWholeText',
  'matchesWholeOwnText',
  'matchesWholeText',
  'containsOwn',
  'containsData',
  'matchesOwn',
  'matchText',
  'matches',
  'contains',
];

/** Rewrites Jsoup-only selector syntax into css-select compatible custom pseudos. */
export function translateSelector(sel: string): string {
  let out = '';
  let i = 0;
  while (i < sel.length) {
    const c = sel[i];
    if (c === '"' || c === "'") {
      const end = findQuoteEnd(sel, i);
      out += sel.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (c === '[') {
      const end = findBracketEnd(sel, i);
      const inner = sel.slice(i + 1, end);
      const m = /^\s*([^\s~|^$*!=\]]+)\s*~=\s*(.*?)\s*$/s.exec(inner);
      if (m) {
        out += `:k-attr-regex(${encodeArg(m[1] + '\u0000' + unquote(m[2]))})`;
      } else if (/^\s*\^/.test(inner)) {
        out += `:k-attr-prefix(${encodeArg(inner.trim().slice(1))})`;
      } else {
        out += '[' + inner + ']';
      }
      i = end + 1;
      continue;
    }
    if (c === ':') {
      const rest = sel.slice(i + 1);
      const name = RAW_PSEUDOS.find((p) => rest.startsWith(p + '('));
      if (name) {
        const open = i + 1 + name.length;
        const close = findParenEnd(sel, open);
        const arg = sel.slice(open + 1, close);
        out += `:k-${name.toLowerCase()}(${encodeArg(unquote(arg.trim()))})`;
        i = close + 1;
        continue;
      }
      const pos = /^(eq|lt|gt)\(\s*(-?\d+)\s*\)/.exec(rest);
      if (pos) {
        out += `:k-${pos[1]}(${pos[2]})`;
        i += 1 + pos[0].length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

function encodeArg(s: string): string {
  // css-what passes pseudo args through as raw text; hex-encode so parens/quotes survive.
  let h = '';
  for (const ch of s) h += ch.codePointAt(0)!.toString(16).padStart(4, '0') + '.';
  return h;
}
function decodeArg(h: string): string {
  return h
    .split('.')
    .filter(Boolean)
    .map((x) => String.fromCodePoint(parseInt(x, 16)))
    .join('');
}
function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}
function findQuoteEnd(s: string, i: number): number {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') j++;
    else if (s[j] === q) return j;
  }
  return s.length - 1;
}
function findBracketEnd(s: string, i: number): number {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '"' || s[j] === "'") j = findQuoteEnd(s, j);
    else if (s[j] === ']') return j;
  }
  return s.length - 1;
}
function findParenEnd(s: string, open: number): number {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    const ch = s[j];
    if (ch === '\\') {
      j++;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return s.length - 1;
}

const regexCache = new Map<string, RegExp>();
function jre(src: string): RegExp {
  let r = regexCache.get(src);
  if (!r) {
    const kr = new Regex(src);
    r = new RegExp(kr.js.source, kr.js.flags.replace('g', '').replace('d', ''));
    regexCache.set(src, r);
  }
  return r;
}

const pseudos: Record<string, (el: DomElement, arg?: string | null) => boolean> = {
  'k-contains': (el, a) => normText(textOf(el)).toLowerCase().includes(normText(decodeArg(a!)).toLowerCase()),
  'k-containsown': (el, a) => normText(ownTextOf(el)).toLowerCase().includes(normText(decodeArg(a!)).toLowerCase()),
  'k-containswholetext': (el, a) => wholeTextOf(el).includes(decodeArg(a!)),
  'k-containswholeowntext': (el, a) => wholeOwnTextOf(el).includes(decodeArg(a!)),
  'k-containsdata': (el, a) => dataOf(el).toLowerCase().includes(decodeArg(a!).toLowerCase()),
  'k-matches': (el, a) => jre(decodeArg(a!)).test(normText(textOf(el))),
  'k-matchesown': (el, a) => jre(decodeArg(a!)).test(normText(ownTextOf(el))),
  'k-matcheswholetext': (el, a) => jre(decodeArg(a!)).test(wholeTextOf(el)),
  'k-matcheswholeowntext': (el, a) => jre(decodeArg(a!)).test(wholeOwnTextOf(el)),
  'k-matchtext': () => true,
  'k-attr-regex': (el, a) => {
    const [name, re] = decodeArg(a!).split('\u0000');
    const v = el.attribs?.[name.toLowerCase()] ?? el.attribs?.[name];
    return v !== undefined && jre(re).test(v);
  },
  'k-attr-prefix': (el, a) => {
    const p = decodeArg(a!).toLowerCase();
    return Object.keys(el.attribs ?? {}).some((k) => k.toLowerCase().startsWith(p));
  },
  'k-eq': (el, a) => elementIndex(el) === parseInt(a!, 10),
  'k-lt': (el, a) => elementIndex(el) < parseInt(a!, 10),
  'k-gt': (el, a) => elementIndex(el) > parseInt(a!, 10),
};

function elementIndex(el: DomElement): number {
  const p = el.parent as ParentNode | null;
  if (!p) return 0;
  let i = 0;
  for (const c of p.children) {
    if (c === el) return i;
    if (c.type === 'tag' || c.type === 'script' || c.type === 'style') i++;
  }
  return i;
}

const compiledSelectors = new Map<string, string>();
function sel(selector: string): string {
  let s = compiledSelectors.get(selector);
  if (s === undefined) {
    s = translateSelector(selector);
    compiledSelectors.set(selector, s);
  }
  return s;
}

const cssOptions = { pseudos, xmlMode: false, lowerCaseTags: true, lowerCaseAttributeNames: true } as any;

function runSelect(selector: string, roots: DomElement[] | DomElement | DomDocument): AnyNode[] {
  if (!selector.trim()) throw new SelectorParseException('String must not be empty');
  try {
    return selectAll(sel(selector), roots as any, cssOptions) as AnyNode[];
  } catch (e) {
    throw new SelectorParseException(`Could not parse query '${selector}': ${(e as Error).message}`);
  }
}

export class SelectorParseException extends IllegalArgumentException {}

// ---------- text extraction (Jsoup semantics) ----------

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'center', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr',
  'html', 'legend', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'title', 'tr', 'ul', 'option', 'caption', 'head', 'meta', 'link', 'noscript', 'iframe', 'frameset',
]);

function isEl(n: AnyNode): n is DomElement {
  return n.type === 'tag' || n.type === 'script' || n.type === 'style';
}

function normText(s: string): string {
  return s.replace(/[ \t\n\r\f ]+/g, (m) => (m.includes(' ') && m.length === 1 ? ' ' : ' ')).trim();
}

function textOf(n: AnyNode): string {
  const parts: string[] = [];
  const walk = (x: AnyNode) => {
    if (x.type === 'text') {
      appendNormalized(parts, (x as DomText).data, preserveWs(x));
    } else if (isEl(x)) {
      if (x.name === 'br') ensureSpace(parts);
      else if (BLOCK.has(x.name)) ensureSpace(parts);
      if (x.type !== 'script' && x.type !== 'style') for (const c of x.children) walk(c);
      if (BLOCK.has(x.name)) ensureSpace(parts);
    } else if (x.type === 'root') {
      for (const c of (x as DomDocument).children) walk(c);
    } else if (x.type === 'cdata') {
      for (const c of (x as CDATA).children) walk(c);
    }
  };
  walk(n);
  return parts.join('').trim();
}

function ownTextOf(el: AnyNode): string {
  const parts: string[] = [];
  if (!('children' in el)) return '';
  for (const c of (el as ParentNode).children) {
    if (c.type === 'text') appendNormalized(parts, (c as DomText).data, preserveWs(c));
    else if (isEl(c) && c.name === 'br') ensureSpace(parts);
  }
  return parts.join('').trim();
}

function wholeTextOf(n: AnyNode): string {
  if (n.type === 'text') return (n as DomText).data;
  if (isEl(n) && n.name === 'br') return '\n';
  if ('children' in n) return (n as ParentNode).children.map(wholeTextOf).join('');
  return '';
}

function wholeOwnTextOf(n: AnyNode): string {
  if (!('children' in n)) return '';
  return (n as ParentNode).children
    .map((c) => (c.type === 'text' ? (c as DomText).data : isEl(c) && c.name === 'br' ? '\n' : ''))
    .join('');
}

function dataOf(n: AnyNode): string {
  if (!('children' in n)) return '';
  let out = '';
  for (const c of (n as ParentNode).children) {
    if (c.type === 'text' && n.type !== 'tag') out += (c as DomText).data;
    else if (c.type === 'text' && isEl(n) && (n.name === 'script' || n.name === 'style')) out += (c as DomText).data;
    else if (c.type === 'comment') out += (c as DomComment).data;
    else if (isEl(c) && (c.name === 'script' || c.name === 'style')) out += dataOf(c);
  }
  return out;
}

function preserveWs(n: AnyNode): boolean {
  let p = n.parent as AnyNode | null;
  for (let d = 0; p && d < 6; d++, p = p.parent as AnyNode | null) {
    if (isEl(p) && (p.name === 'pre' || p.name === 'textarea')) return true;
  }
  return false;
}

function appendNormalized(parts: string[], text: string, preserve: boolean): void {
  if (preserve) {
    parts.push(text);
    return;
  }
  const t = text.replace(/[ \t\n\r\f]+/g, ' ');
  if (t.startsWith(' ') && endsWithSpace(parts)) parts.push(t.slice(1));
  else parts.push(t);
}

function endsWithSpace(parts: string[]): boolean {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].length) return parts[i].endsWith(' ');
  }
  return true;
}

function ensureSpace(parts: string[]): void {
  if (!endsWithSpace(parts)) parts.push(' ');
}

// ---------- wrappers ----------

const WRAP = Symbol('kansoWrap');

export function wrap(n: AnyNode): Node {
  const cached = (n as any)[WRAP];
  if (cached) return cached;
  let w: Node;
  if (n.type === 'root') w = new Document(n as DomDocument, (n as any).$baseUri ?? '');
  else if (isEl(n)) w = new Element(n);
  else if (n.type === 'text') w = new TextNode(n as DomText);
  else if (n.type === 'comment') w = new Comment(n as DomComment);
  else w = new DataNodeW(n as any);
  (n as any)[WRAP] = w;
  return w;
}

function wrapEl(n: AnyNode | null | undefined): Element | null {
  return n && isEl(n) ? (wrap(n) as Element) : null;
}

function rootOf(n: AnyNode): AnyNode {
  let r = n;
  while (r.parent) r = r.parent as AnyNode;
  return r;
}

function baseUriOf(n: AnyNode): string {
  const root = rootOf(n) as any;
  return root.$baseUri ?? '';
}

export class Attribute {
  constructor(
    readonly key: string,
    readonly value: string,
  ) {}
  getKey(): string {
    return this.key;
  }
  getValue(): string {
    return this.value;
  }
  component1(): string {
    return this.key;
  }
  component2(): string {
    return this.value;
  }
  html(): string {
    return `${this.key}="${escapeAttr(this.value)}"`;
  }
  toString(): string {
    return this.html();
  }
}

export class Attributes {
  constructor(private readonly el: DomElement) {}
  get(key: string): string {
    return this.el.attribs[key.toLowerCase()] ?? '';
  }
  hasKey(key: string): boolean {
    return key.toLowerCase() in this.el.attribs;
  }
  size(): number {
    return Object.keys(this.el.attribs).length;
  }
  asList(): Attribute[] {
    return Object.entries(this.el.attribs).map(([k, v]) => new Attribute(k, v));
  }
  dataset(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(this.el.attribs)) if (k.startsWith('data-')) m.set(k.slice(5), v);
    return m;
  }
  *[Symbol.iterator](): Iterator<Attribute> {
    yield* this.asList();
  }
  html(): string {
    return this.asList()
      .map((a) => ' ' + a.html())
      .join('');
  }
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export class Node {
  constructor(readonly node: AnyNode) {}

  nodeName(): string {
    return isEl(this.node) ? this.node.name : '#' + this.node.type;
  }
  parent(): Element | null {
    return wrapEl(this.node.parent as AnyNode | null);
  }
  parentNode(): Node | null {
    return this.node.parent ? wrap(this.node.parent as AnyNode) : null;
  }
  childNodes(): Node[] {
    return 'children' in this.node ? (this.node as ParentNode).children.map(wrap) : [];
  }
  childNodeSize(): number {
    return 'children' in this.node ? (this.node as ParentNode).children.length : 0;
  }
  childNode(i: number): Node {
    return this.childNodes()[i];
  }
  nextSibling(): Node | null {
    return this.node.next ? wrap(this.node.next) : null;
  }
  previousSibling(): Node | null {
    return this.node.prev ? wrap(this.node.prev) : null;
  }
  siblingIndex(): number {
    const p = this.node.parent as ParentNode | null;
    return p ? p.children.indexOf(this.node as any) : 0;
  }
  siblingNodes(): Node[] {
    const p = this.node.parent as ParentNode | null;
    return p ? p.children.filter((c) => c !== this.node).map(wrap) : [];
  }
  attr(key: string, value?: string): any {
    if (value !== undefined) {
      if (isEl(this.node)) this.node.attribs[key.toLowerCase()] = str(value);
      return this;
    }
    if (!isEl(this.node)) return '';
    if (key.startsWith('abs:')) return this.absUrl(key.slice(4));
    return this.node.attribs[key.toLowerCase()] ?? this.node.attribs[key] ?? '';
  }
  hasAttr(key: string): boolean {
    if (!isEl(this.node)) return false;
    if (key.startsWith('abs:')) {
      const k = key.slice(4).toLowerCase();
      return k in this.node.attribs && this.absUrl(k) !== '';
    }
    return key.toLowerCase() in this.node.attribs;
  }
  removeAttr(key: string): this {
    if (isEl(this.node)) delete this.node.attribs[key.toLowerCase()];
    return this;
  }
  attributes(): Attributes {
    return new Attributes(this.node as DomElement);
  }
  absUrl(key: string): string {
    if (!isEl(this.node)) return '';
    const v = this.node.attribs[key.toLowerCase()];
    if (v === undefined) return '';
    const r = resolveUrlRaw(this.baseUri(), v.trim());
    return r ?? (/^[a-z][a-z0-9+.-]*:/i.test(v.trim()) ? v.trim() : '');
  }
  baseUri(): string {
    return baseUriOf(this.node);
  }
  setBaseUri(uri: string): void {
    (rootOf(this.node) as any).$baseUri = uri;
  }
  ownerDocument(): Document | null {
    const r = rootOf(this.node);
    return r.type === 'root' ? (wrap(r) as Document) : null;
  }
  remove(): void {
    const p = this.node.parent as ParentNode | null;
    if (!p) return;
    const i = p.children.indexOf(this.node as any);
    if (i >= 0) p.children.splice(i, 1);
    if (this.node.prev) this.node.prev.next = this.node.next;
    if (this.node.next) this.node.next.prev = this.node.prev;
    this.node.parent = null;
    this.node.prev = null;
    this.node.next = null;
  }
  before(html: any): this {
    insertSiblings(this.node, parseNodes(html, this), false);
    return this;
  }
  after(html: any): this {
    insertSiblings(this.node, parseNodes(html, this), true);
    return this;
  }
  replaceWith(n: Node): void {
    insertSiblings(this.node, [n.node], false);
    this.remove();
  }
  unwrap(): Node | null {
    const kids = 'children' in this.node ? [...(this.node as ParentNode).children] : [];
    insertSiblings(this.node, kids, false);
    this.remove();
    return kids.length ? wrap(kids[0]) : null;
  }
  outerHtml(): string {
    return render(this.node as any, { decodeEntities: false, encodeEntities: 'utf8', selfClosingTags: false } as any);
  }
  hasParent(): boolean {
    return this.node.parent !== null;
  }
  clone(): this {
    return wrap(cloneNode(this.node)) as this;
  }
  toString(): string {
    return this.outerHtml();
  }
  equals(o: any): boolean {
    return this === o;
  }
  hashCode(): number {
    return 0;
  }
}

function cloneNode(n: AnyNode): AnyNode {
  return (n as any).cloneNode(true);
}

function parseNodes(html: any, ctx: Node): AnyNode[] {
  if (html instanceof Node) return [html.node];
  const doc = parseFragmentNodes(str(html), ctx.baseUri());
  return [...doc];
}

function insertSiblings(ref: AnyNode, nodes: AnyNode[], after: boolean): void {
  const p = ref.parent as ParentNode | null;
  if (!p) return;
  for (const n of nodes) detach(n);
  let idx = p.children.indexOf(ref as any) + (after ? 1 : 0);
  for (const n of nodes) {
    p.children.splice(idx++, 0, n as any);
    n.parent = p;
  }
  relink(p);
}

function detach(n: AnyNode): void {
  const p = n.parent as ParentNode | null;
  if (!p) return;
  const i = p.children.indexOf(n as any);
  if (i >= 0) p.children.splice(i, 1);
  relink(p);
  n.parent = null;
}

function relink(p: ParentNode): void {
  const kids = p.children;
  for (let i = 0; i < kids.length; i++) {
    kids[i].parent = p;
    kids[i].prev = kids[i - 1] ?? null;
    kids[i].next = kids[i + 1] ?? null;
  }
}

export class TextNode extends Node {
  constructor(node: DomText) {
    super(node);
  }
  text(value?: string): any {
    if (value !== undefined) {
      (this.node as DomText).data = value;
      return this;
    }
    return normText((this.node as DomText).data);
  }
  wholeText(): string {
    return (this.node as DomText).data;
  }
  getWholeText(): string {
    return this.wholeText();
  }
  isBlank(): boolean {
    return (this.node as DomText).data.trim() === '';
  }
  text$set(v: string): this {
    (this.node as DomText).data = v;
    return this;
  }
  splitText(offset: number): TextNode {
    const t = this.node as DomText;
    const tail = new DomText(t.data.slice(offset));
    t.data = t.data.slice(0, offset);
    insertSiblings(t, [tail], true);
    return wrap(tail) as TextNode;
  }
  toString(): string {
    return this.outerHtml();
  }
}

export class DataNodeW extends Node {
  getWholeData(): string {
    return (this.node as any).data ?? '';
  }
  wholeData(): string {
    return this.getWholeData();
  }
}

export class Comment extends Node {
  getData(): string {
    return (this.node as DomComment).data;
  }
}

export class Element extends Node {
  constructor(node: DomElement) {
    super(node);
  }
  get el(): DomElement {
    return this.node as DomElement;
  }

  tagName(value?: string): any {
    if (value !== undefined) {
      this.el.name = value;
      return this;
    }
    return this.el.name;
  }
  normalName(): string {
    return this.el.name.toLowerCase();
  }
  tag(): { getName: () => string; name: string; toString(): string } {
    const name = this.el.name;
    return { getName: () => name, name, toString: () => name };
  }
  nameIs(n: string): boolean {
    return this.el.name === n.toLowerCase();
  }
  id(): string {
    return this.el.attribs.id ?? '';
  }
  className(): string {
    return (this.el.attribs.class ?? '').trim();
  }
  classNames(): Set<string> {
    return new Set(this.className().split(/\s+/).filter(Boolean));
  }
  hasClass(c: string): boolean {
    return this.className()
      .toLowerCase()
      .split(/\s+/)
      .includes(c.toLowerCase());
  }
  addClass(c: string): this {
    const s = this.classNames();
    s.add(c);
    this.el.attribs.class = [...s].join(' ');
    return this;
  }
  removeClass(c: string): this {
    const s = this.classNames();
    s.delete(c);
    this.el.attribs.class = [...s].join(' ');
    return this;
  }
  text(value?: string): any {
    if (value !== undefined) {
      this.el.children = [];
      const t = new DomText(str(value));
      t.parent = this.el;
      this.el.children.push(t);
      return this;
    }
    return textOf(this.el);
  }
  ownText(): string {
    return ownTextOf(this.el);
  }
  wholeText(): string {
    return wholeTextOf(this.el);
  }
  wholeOwnText(): string {
    return wholeOwnTextOf(this.el);
  }
  hasText(): boolean {
    return textOf(this.el) !== '';
  }
  data(): string {
    return dataOf(this.el);
  }
  val(value?: string): any {
    if (value !== undefined) {
      this.el.attribs.value = value;
      return this;
    }
    if (this.el.name === 'textarea') return this.text();
    return this.el.attribs.value ?? '';
  }
  html(value?: string): any {
    if (value !== undefined) {
      this.el.children = [];
      this.append(value);
      return this;
    }
    return this.el.children.map((c) => render(c as any, { decodeEntities: false, encodeEntities: 'utf8' } as any)).join('').trim();
  }
  outerHtml(): string {
    return render(this.el as any, { decodeEntities: false, encodeEntities: 'utf8' } as any);
  }

  select(query: string): Elements {
    return Elements.list(runSelect(query, this.el).map((n) => wrap(n) as Element));
  }
  selectFirst(query: string): Element | null {
    if (!query.trim()) throw new SelectorParseException('String must not be empty');
    try {
      return wrapEl(selectOne(sel(query), this.el as any, cssOptions) as AnyNode | null);
    } catch (e) {
      throw new SelectorParseException(`Could not parse query '${query}': ${(e as Error).message}`);
    }
  }
  expectFirst(query: string): Element {
    const e = this.selectFirst(query);
    if (!e) throw new IllegalArgumentException(`No elements matched the query '${query}' in the document.`);
    return e;
  }
  selectXpath(): Elements {
    throw new IllegalArgumentException('XPath selection is not supported');
  }
  is(query: string): boolean {
    try {
      return cssIs(this.el as any, sel(query), cssOptions);
    } catch (e) {
      throw new SelectorParseException(`Could not parse query '${query}': ${(e as Error).message}`);
    }
  }
  closest(query: string): Element | null {
    let cur: AnyNode | null = this.el;
    while (cur && isEl(cur)) {
      if (cssIs(cur as any, sel(query), cssOptions)) return wrapEl(cur);
      cur = cur.parent as AnyNode | null;
    }
    return null;
  }

  getElementsByTag(tag: string): Elements {
    return this.select(tag);
  }
  getElementById(id: string): Element | null {
    return this.selectFirst('#' + cssEscape(id));
  }
  getElementsByClass(c: string): Elements {
    return this.select('.' + cssEscape(c));
  }
  getElementsByAttribute(a: string): Elements {
    return this.select(`[${a}]`);
  }
  getElementsByAttributeValue(a: string, v: string): Elements {
    return this.select(`[${a}="${v.replace(/"/g, '\\"')}"]`);
  }
  getElementsByAttributeValueContaining(a: string, v: string): Elements {
    return this.select(`[${a}*="${v.replace(/"/g, '\\"')}"]`);
  }
  getElementsContainingOwnText(t: string): Elements {
    return Elements.list(this.getAllElements().filter((e) => e.ownText().toLowerCase().includes(t.toLowerCase())));
  }
  getElementsContainingText(t: string): Elements {
    return Elements.list(this.getAllElements().filter((e) => e.text().toLowerCase().includes(t.toLowerCase())));
  }
  getElementsMatchingOwnText(r: any): Elements {
    const re = r instanceof Regex ? r : new Regex(str(r));
    return Elements.list(this.getAllElements().filter((e) => re.containsMatchIn(e.ownText())));
  }
  getAllElements(): Elements {
    const out: Element[] = [];
    const walk = (n: AnyNode) => {
      if (isEl(n)) out.push(wrap(n) as Element);
      if ('children' in n) for (const c of (n as ParentNode).children) walk(c);
    };
    walk(this.el);
    return Elements.list(out);
  }

  children(): Elements {
    return Elements.list(this.el.children.filter(isEl).map((n) => wrap(n) as Element));
  }
  childrenSize(): number {
    return this.el.children.filter(isEl).length;
  }
  child(i: number): Element {
    const kids = this.children();
    if (i < 0 || i >= kids.length) throw new IllegalArgumentException(`Index ${i} out of bounds`);
    return kids[i];
  }
  firstElementChild(): Element | null {
    return wrapEl(this.el.children.find(isEl));
  }
  lastElementChild(): Element | null {
    const kids = this.el.children.filter(isEl);
    return wrapEl(kids[kids.length - 1]);
  }
  textNodes(): TextNode[] {
    return this.el.children.filter((c) => c.type === 'text').map((c) => wrap(c) as TextNode);
  }
  dataNodes(): DataNodeW[] {
    if (this.el.name === 'script' || this.el.name === 'style') return this.el.children.filter((c) => c.type === 'text').map((c) => new DataNodeW(c as any));
    return [];
  }
  nextElementSibling(): Element | null {
    let n = this.el.next;
    while (n && !isEl(n)) n = n.next;
    return wrapEl(n);
  }
  previousElementSibling(): Element | null {
    let n = this.el.prev;
    while (n && !isEl(n)) n = n.prev;
    return wrapEl(n);
  }
  nextElementSiblings(): Elements {
    const out: Element[] = [];
    for (let n = this.el.next; n; n = n.next) if (isEl(n)) out.push(wrap(n) as Element);
    return Elements.list(out);
  }
  previousElementSiblings(): Elements {
    const out: Element[] = [];
    for (let n = this.el.prev; n; n = n.prev) if (isEl(n)) out.push(wrap(n) as Element);
    return Elements.list(out);
  }
  firstElementSibling(): Element | null {
    const p = this.el.parent as ParentNode | null;
    return p ? wrapEl(p.children.find(isEl)) : this;
  }
  lastElementSibling(): Element | null {
    const p = this.el.parent as ParentNode | null;
    if (!p) return this;
    const kids = p.children.filter(isEl);
    return wrapEl(kids[kids.length - 1]);
  }
  siblingElements(): Elements {
    const p = this.el.parent as ParentNode | null;
    if (!p) return Elements.list([]);
    return Elements.list(p.children.filter((c) => isEl(c) && c !== this.el).map((n) => wrap(n) as Element));
  }
  elementSiblingIndex(): number {
    return elementIndex(this.el);
  }
  parents(): Elements {
    const out: Element[] = [];
    let p = this.el.parent as AnyNode | null;
    while (p && isEl(p)) {
      out.push(wrap(p) as Element);
      p = p.parent as AnyNode | null;
    }
    return Elements.list(out);
  }

  append(html: any): this {
    const nodes = html instanceof Node ? [html.node] : parseFragmentNodes(str(html), this.baseUri());
    for (const n of nodes) {
      detach(n);
      this.el.children.push(n as any);
    }
    relink(this.el);
    return this;
  }
  prepend(html: any): this {
    const nodes = html instanceof Node ? [html.node] : parseFragmentNodes(str(html), this.baseUri());
    for (const n of nodes) detach(n);
    this.el.children.unshift(...(nodes as any[]));
    relink(this.el);
    return this;
  }
  appendText(t: string): this {
    this.el.children.push(new DomText(t) as any);
    relink(this.el);
    return this;
  }
  prependText(t: string): this {
    this.el.children.unshift(new DomText(t) as any);
    relink(this.el);
    return this;
  }
  appendChild(n: Node): this {
    return this.append(n);
  }
  appendElement(tag: string): Element {
    const e = new DomElement(tag, {});
    this.el.children.push(e);
    relink(this.el);
    return wrap(e) as Element;
  }
  empty(): this {
    this.el.children = [];
    return this;
  }
  wrap(html: string): this {
    const nodes = parseFragmentNodes(html, this.baseUri());
    const outer = nodes.find(isEl) as DomElement | undefined;
    if (!outer) return this;
    let inner: DomElement = outer;
    while (true) {
      const next = inner.children.find(isEl) as DomElement | undefined;
      if (!next) break;
      inner = next;
    }
    insertSiblings(this.el, [outer], false);
    detach(this.el);
    inner.children.push(this.el);
    relink(inner);
    return this;
  }
  tagName$set(t: string): this {
    this.el.name = t;
    return this;
  }
  cssSelector(): string {
    if (this.id()) return '#' + this.id();
    const parts: string[] = [];
    for (let e: Element | null = this; e; e = e.parent()) {
      parts.unshift(`${e.tagName()}:nth-child(${e.elementSiblingIndex() + 1})`);
      if (e.id()) break;
    }
    return parts.join(' > ');
  }
  dataset(): Map<string, string> {
    return this.attributes().dataset();
  }
  firstChild(): Node | null {
    return this.el.children[0] ? wrap(this.el.children[0]) : null;
  }
  lastChild(): Node | null {
    const k = this.el.children;
    return k.length ? wrap(k[k.length - 1]) : null;
  }
}

function cssEscape(s: string): string {
  return s.replace(/([^\w-])/g, '\\$1');
}

export class Document extends Element {
  private locationUrl: string;
  constructor(node: DomDocument, baseUri: string) {
    super(node as any);
    this.locationUrl = baseUri;
    (node as any).$baseUri = baseUri;
  }
  location(): string {
    return this.locationUrl;
  }
  setLocation(l: string): void {
    this.locationUrl = l;
  }
  tagName(): string {
    return '#root';
  }
  nodeName(): string {
    return '#document';
  }
  title(): string {
    return this.selectFirst('title')?.text() ?? '';
  }
  body(): Element {
    return this.selectFirst('body') ?? this;
  }
  head(): Element {
    return this.selectFirst('head') ?? this;
  }
  documentElement(): Element {
    return this.firstElementChild() ?? this;
  }
  html(value?: string): any {
    if (value !== undefined) return super.html(value);
    return (this.node as DomDocument).children.map((c) => render(c as any, { decodeEntities: false, encodeEntities: 'utf8' } as any)).join('').trim();
  }
  outerHtml(): string {
    return this.html();
  }
  text(value?: string): any {
    if (value !== undefined) return super.text(value);
    return textOf(this.node);
  }
  outputSettings(): OutputSettings {
    return new OutputSettings();
  }
  charset(): { name: () => string } {
    return { name: () => 'UTF-8' };
  }
  createElement(tag: string): Element {
    return wrap(new DomElement(tag, {})) as Element;
  }
  parent(): Element | null {
    return null;
  }
}

/** Jsoup output settings are accepted and ignored: output is never pretty-printed. */
export class OutputSettings {
  prettyPrint(_b?: boolean): this {
    return this;
  }
  indentAmount(_n?: number): this {
    return this;
  }
  outline(_b?: boolean): this {
    return this;
  }
  charset(_c?: any): this {
    return this;
  }
  escapeMode(_m?: any): this {
    return this;
  }
}

/** Elements is a `List<Element>` with extra bulk methods. */
export class Elements extends Array<Element> {
  static list(xs: Element[]): Elements {
    const e = new Elements();
    for (const x of xs) e.push(x);
    return e;
  }
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }
  select(query: string): Elements {
    const roots = this.map((e) => e.el);
    if (!roots.length) return Elements.list([]);
    const found = runSelect(query, roots as any);
    // css-select over several roots can return dupes and document order; keep unique.
    const seen = new Set<AnyNode>();
    const out: Element[] = [];
    for (const n of found) if (!seen.has(n)) {
      seen.add(n);
      out.push(wrap(n) as Element);
    }
    return Elements.list(out);
  }
  selectFirst(query: string): Element | null {
    for (const e of this) {
      const f = e.selectFirst(query);
      if (f) return f;
    }
    return null;
  }
  text(): string {
    return this.map((e) => e.text())
      .filter((t) => t.length)
      .join(' ');
  }
  eachText(): string[] {
    return this.map((e) => e.text()).filter((t) => t.length);
  }
  html(): string {
    return this.map((e) => e.html()).join('\n');
  }
  outerHtml(): string {
    return this.map((e) => e.outerHtml()).join('\n');
  }
  attr(key: string, value?: string): any {
    if (value !== undefined) {
      for (const e of this) e.attr(key, value);
      return this;
    }
    for (const e of this) if (e.hasAttr(key)) return e.attr(key);
    return '';
  }
  hasAttr(key: string): boolean {
    return this.some((e) => e.hasAttr(key));
  }
  eachAttr(key: string): string[] {
    return this.filter((e) => e.hasAttr(key)).map((e) => e.attr(key));
  }
  removeAttr(key: string): this {
    for (const e of this) e.removeAttr(key);
    return this;
  }
  hasClass(c: string): boolean {
    return this.some((e) => e.hasClass(c));
  }
  addClass(c: string): this {
    for (const e of this) e.addClass(c);
    return this;
  }
  removeClass(c: string): this {
    for (const e of this) e.removeClass(c);
    return this;
  }
  val(): string {
    return this.length ? this[0].val() : '';
  }
  hasText(): boolean {
    return this.some((e) => e.hasText());
  }
  first(): Element | null {
    return this.length ? this[0] : null;
  }
  last(): Element | null {
    return this.length ? this[this.length - 1] : null;
  }
  eq(i: number): Elements {
    return Elements.list(this.length > i ? [this[i]] : []);
  }
  is(query: string): boolean {
    return this.some((e) => e.is(query));
  }
  not(query: string): Elements {
    return Elements.list(this.filter((e) => !e.is(query)));
  }
  next(query?: string): Elements {
    return Elements.list(this.map((e) => e.nextElementSibling()).filter((e): e is Element => !!e && (!query || e.is(query))));
  }
  prev(query?: string): Elements {
    return Elements.list(this.map((e) => e.previousElementSibling()).filter((e): e is Element => !!e && (!query || e.is(query))));
  }
  nextAll(): Elements {
    return Elements.list(this.flatMap((e) => [...e.nextElementSiblings()]));
  }
  parents(): Elements {
    const set = new Set<Element>();
    for (const e of this) for (const p of e.parents()) set.add(p);
    return Elements.list([...set]);
  }
  remove(): this {
    for (const e of this) e.remove();
    return this;
  }
  empty(): this {
    for (const e of this) e.empty();
    return this;
  }
  unwrap(): this {
    for (const e of this) e.unwrap();
    return this;
  }
  textNodes(): TextNode[] {
    return this.flatMap((e) => e.textNodes());
  }
  append(html: string): this {
    for (const e of this) e.append(html);
    return this;
  }
  prepend(html: string): this {
    for (const e of this) e.prepend(html);
    return this;
  }
  before(html: string): this {
    for (const e of this) e.before(html);
    return this;
  }
  after(html: string): this {
    for (const e of this) e.after(html);
    return this;
  }
  wrap(html: string): this {
    for (const e of this) e.wrap(html);
    return this;
  }
  tagName(t: string): this {
    for (const e of this) e.tagName$set(t);
    return this;
  }
  toString(): string {
    return this.outerHtml();
  }
  clone(): Elements {
    return Elements.list(this.map((e) => e.clone()));
  }
}

// ---------- parsing ----------

function parseFragmentNodes(html: string, baseUri: string): AnyNode[] {
  const frag = parse5ParseFragment(html, { treeAdapter: adapter }) as unknown as DomDocument;
  const kids = [...frag.children];
  for (const k of kids) k.parent = null;
  void baseUri;
  return kids;
}

function applyBaseTag(doc: DomDocument, baseUri: string): string {
  const base = selectOne('base[href]', doc as any) as DomElement | null;
  if (base) {
    const r = resolveUrl(baseUri, base.attribs.href);
    if (r) return r;
  }
  return baseUri;
}

export class Parser {
  constructor(readonly xml: boolean) {}
  static htmlParser(): Parser {
    return new Parser(false);
  }
  static xmlParser(): Parser {
    return new Parser(true);
  }
  static unescapeEntities(s: string, _inAttribute = false): string {
    return decodeEntitiesStr(s);
  }
  static parse(html: string, baseUri: string): Document {
    return Jsoup.parse(html, baseUri);
  }
  static parseBodyFragment(html: string, baseUri: string): Document {
    return Jsoup.parseBodyFragment(html, baseUri);
  }
  parseInput(html: string, baseUri: string): Document {
    return this.xml ? parseXml(html, baseUri) : Jsoup.parse(html, baseUri);
  }
  settings(_s: any): this {
    return this;
  }
  static ParseSettings = { preserveCase: {}, htmlDefault: {} };
}

function decodeEntitiesStr(s: string): string {
  const doc = htmlparser2Parse(`<x>${s}</x>`, { decodeEntities: true });
  return textOf(doc);
}

function parseXml(xml: string, baseUri: string): Document {
  const doc = htmlparser2Parse(xml, { xmlMode: true, decodeEntities: true });
  (doc as any).$baseUri = baseUri;
  return wrap(doc) as Document;
}

export const Jsoup = {
  parse(html: any, baseUri?: any, parser?: Parser): Document {
    const text = str(html ?? '');
    if (baseUri instanceof Parser) return baseUri.parseInput(text, '');
    const base = typeof baseUri === 'string' ? baseUri : '';
    if (parser?.xml) return parseXml(text, base);
    const doc = parse5Parse(text, { treeAdapter: adapter }) as unknown as DomDocument;
    const effective = applyBaseTag(doc, base);
    (doc as any).$baseUri = effective;
    const d = new Document(doc, effective);
    d.setLocation(base);
    (doc as any)[WRAP] = d;
    return d;
  },
  parseBodyFragment(html: string, baseUri = ''): Document {
    return Jsoup.parse(`<body>${str(html)}</body>`, baseUri);
  },
  clean(html: string, ...args: any[]): string {
    // Safelist cleaning: keep only text and simple formatting; good enough for descriptions.
    const doc = Jsoup.parseBodyFragment(html, typeof args[0] === 'string' ? args[0] : '');
    const allowed: Set<string> | null = args.find((a) => a instanceof Safelist)?.tags ?? null;
    if (allowed) {
      for (const e of doc.body().getAllElements().slice(1)) if (!allowed.has(e.tagName())) e.unwrap();
    }
    return doc.body().html();
  },
  isValid(_html: string, _safelist: any): boolean {
    return true;
  },
};

export class Safelist {
  constructor(readonly tags: Set<string>) {}
  static none(): Safelist {
    return new Safelist(new Set());
  }
  static basic(): Safelist {
    return new Safelist(new Set(['a', 'b', 'blockquote', 'br', 'cite', 'code', 'dd', 'dl', 'dt', 'em', 'i', 'li', 'ol', 'p', 'pre', 'q', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'u', 'ul']));
  }
  static simpleText(): Safelist {
    return new Safelist(new Set(['b', 'em', 'i', 'strong', 'u']));
  }
  static relaxed(): Safelist {
    return Safelist.basic().addTags('h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'div', 'table', 'tr', 'td', 'th');
  }
  addTags(...t: string[]): this {
    for (const x of t) this.tags.add(x);
    return this;
  }
  addAttributes(): this {
    return this;
  }
  preserveRelativeLinks(): this {
    return this;
  }
}

export const Entities = {
  unescape: (s: string) => decodeEntitiesStr(s),
  escape: (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
};

/** org.jsoup.select.Evaluator - only used for `is Evaluator` checks / custom selectors. */
export class Evaluator {}

export { DomElement, DomText };

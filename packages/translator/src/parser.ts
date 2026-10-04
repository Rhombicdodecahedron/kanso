import { createRequire } from 'node:module';
import { Language, Parser, type Node } from 'web-tree-sitter';

export type { Node };

let parser: Parser | null = null;

export async function initParser(): Promise<Parser> {
  if (parser) return parser;
  await Parser.init();
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm');
  const Kotlin = await Language.load(wasm);
  parser = new Parser();
  parser.setLanguage(Kotlin);
  return parser;
}

export function parseKotlin(src: string): Node {
  if (!parser) throw new Error('initParser() first');
  const tree = parser.parse(src);
  if (!tree) throw new Error('parse failed');
  return tree.rootNode;
}

// ---------- node helpers ----------

export const named = (n: Node): Node[] => n.namedChildren.filter((c): c is Node => !!c && c.type !== 'line_comment' && c.type !== 'block_comment');

export function child(n: Node, type: string): Node | null {
  return named(n).find((c) => c.type === type) ?? null;
}

export function children(n: Node, type: string): Node[] {
  return named(n).filter((c) => c.type === type);
}

export function field(n: Node, name: string): Node | null {
  return n.childForFieldName(name);
}

export function fields(n: Node, name: string): Node[] {
  return n.childrenForFieldName(name).filter((c): c is Node => !!c);
}

/** All children (named and anonymous) as [fieldName, node]. */
export function allChildren(n: Node): { f: string | null; n: Node }[] {
  const out: { f: string | null; n: Node }[] = [];
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (!c || c.type === 'line_comment' || c.type === 'block_comment') continue;
    out.push({ f: n.fieldNameForChild(i), n: c });
  }
  return out;
}

export function hasToken(n: Node, tok: string): boolean {
  for (let i = 0; i < n.childCount; i++) if (n.child(i)?.type === tok) return true;
  return false;
}

export function modifiersOf(n: Node): Set<string> {
  const m = child(n, 'modifiers');
  const out = new Set<string>();
  if (!m) return out;
  for (const c of named(m)) {
    if (c.type === 'annotation') {
      const name = annotationName(c);
      if (name) out.add('@' + name);
    } else out.add(c.text.trim());
  }
  return out;
}

export function annotations(n: Node): Node[] {
  const m = child(n, 'modifiers');
  return m ? children(m, 'annotation') : [];
}

export function annotationName(a: Node): string | null {
  const ut = a.descendantsOfType('user_type')[0] ?? null;
  if (!ut) return null;
  const ids = ut.namedChildren.filter((c) => c?.type === 'identifier').map((c) => c!.text);
  return ids[ids.length - 1] ?? null;
}

/** First string argument of an annotation like @SerialName("x"). */
export function annotationStringArgs(a: Node): string[] {
  return a.descendantsOfType('string_literal').map((s) => (s ? stringLiteralValue(s) : '')).filter((s) => s !== null) as string[];
}

export function stringLiteralValue(s: Node): string | null {
  // Only constant strings (no interpolation).
  let out = '';
  for (const c of named(s)) {
    if (c.type === 'string_content') out += c.text;
    else if (c.type === 'escape_sequence') out += unescapeKotlin(c.text);
    else return null;
  }
  return out;
}

export function unescapeKotlin(e: string): string {
  switch (e) {
    case '\\n':
      return '\n';
    case '\\t':
      return '\t';
    case '\\r':
      return '\r';
    case '\\b':
      return '\b';
    case '\\\\':
      return '\\';
    case '\\"':
      return '"';
    case "\\'":
      return "'";
    case '\\$':
      return '$';
  }
  if (e.startsWith('\\u')) return String.fromCharCode(parseInt(e.slice(2), 16));
  return e.slice(1);
}

export function identOf(n: Node | null): string | null {
  if (!n) return null;
  if (n.type === 'identifier') return n.text.replace(/^`|`$/g, '');
  return null;
}

export function pos(n: Node): string {
  return `${n.startPosition.row + 1}:${n.startPosition.column + 1}`;
}

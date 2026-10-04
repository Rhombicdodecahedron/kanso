// Extracts extension metadata from build.gradle.kts by evaluating the small Kotlin subset the
// `keiyoushi { ... }` DSL uses (assignments, listOf/mapOf/to, forEach loops, if, templates).

import { named, parseKotlin, stringLiteralValue, unescapeKotlin, type Node } from './parser';

export interface SourceDecl {
  name: string | null;
  lang: string;
  baseUrl: string | null;
  mirrors: { label: string | null; url: string }[] | null;
  customBaseUrl: string | null;
  id: string | null;
  versionId: number;
}

export interface ExtensionMeta {
  name: string;
  versionCode: number;
  libVersion: string;
  contentWarning: 'SAFE' | 'MIXED' | 'NSFW';
  theme: string | null;
  pkgName: string | null;
  sources: SourceDecl[];
  /** project(":lib:x") / project(":lib-multisrc:x") dependencies */
  deps: string[];
  baseVersionCode: number | null;
}

type V = string | number | boolean | null | V[] | { pair: [V, V] } | Map<V, V> | undefined;

class Env {
  vars = new Map<string, V>();
  constructor(readonly parent: Env | null = null) {}
  get(n: string): V {
    if (this.vars.has(n)) return this.vars.get(n);
    return this.parent ? this.parent.get(n) : undefined;
  }
}

export function parseGradle(src: string): ExtensionMeta {
  const root = parseKotlin(src);
  const meta: ExtensionMeta = {
    name: '',
    versionCode: 0,
    libVersion: '1.4',
    contentWarning: 'SAFE',
    theme: null,
    pkgName: null,
    sources: [],
    deps: [],
    baseVersionCode: null,
  };
  for (const m of src.matchAll(/project\(\s*"(:[^"]+)"\s*\)/g)) meta.deps.push(m[1]);
  const top = new Env();
  for (const st of named(root)) {
    if (st.type === 'property_declaration') declare(st, top);
    if (st.type === 'call_expression' && calleeName(st) === 'keiyoushi') {
      const lambda = lambdaOf(st);
      if (lambda) runBlock(named(lambda), new Env(top), { kind: 'ext', meta });
    }
  }
  return meta;
}

type Target = { kind: 'ext'; meta: ExtensionMeta } | { kind: 'source'; s: SourceDecl } | { kind: 'baseUrl'; s: SourceDecl } | { kind: 'other' };

function runBlock(stmts: Node[], env: Env, t: Target): void {
  for (const st of stmts) run(st, env, t);
}

function run(st: Node, env: Env, t: Target): void {
  switch (st.type) {
    case 'property_declaration':
      declare(st, env);
      return;
    case 'assignment': {
      const key = st.childForFieldName('left')?.text ?? '';
      const v = evalExpr(st.childForFieldName('right'), env);
      assign(t, key, v, st.childForFieldName('right'));
      return;
    }
    case 'if_expression': {
      const cond = evalExpr(st.childForFieldName('condition'), env);
      const condId = st.childForFieldName('condition')?.id;
      const branches = named(st).filter((c) => c.id !== condId);
      const body = cond ? branches[0] : branches[1];
      if (body) runBranch(body, env, t);
      return;
    }
    case 'for_statement': {
      const parts = named(st);
      const varNode = parts.find((p) => p.type === 'variable_declaration' || p.type === 'multi_variable_declaration');
      const iter = evalExpr(parts.find((p) => p.id !== varNode?.id && p.type !== 'block' && p.id !== parts[parts.length - 1].id) ?? null, env);
      const body = parts[parts.length - 1];
      for (const item of asList(iter)) {
        const e = new Env(env);
        bindParam(varNode ?? null, item, e);
        runBranch(body, e, t);
      }
      return;
    }
    case 'call_expression': {
      const name = calleeName(st);
      if (name === 'source' && t.kind === 'ext') {
        const s: SourceDecl = { name: null, lang: '', baseUrl: null, mirrors: null, customBaseUrl: null, id: null, versionId: 1 };
        const lambda = lambdaOf(st);
        if (lambda) runBlock(named(lambda), new Env(env), { kind: 'source', s });
        t.meta.sources.push(s);
        return;
      }
      if (name === 'baseUrl' && t.kind === 'source') {
        const lambda = lambdaOf(st);
        if (lambda) runBlock(named(lambda), new Env(env), { kind: 'baseUrl', s: t.s });
        return;
      }
      if ((name === 'mirrors' || name === 'custom') && t.kind === 'baseUrl') {
        const args = argsOf(st).map((a) => evalExpr(a, env));
        if (name === 'custom') {
          t.s.customBaseUrl = String(args[0]);
          t.s.baseUrl = t.s.customBaseUrl;
        } else {
          const flat = args.length === 1 && Array.isArray(args[0]) ? (args[0] as V[]) : args;
          t.s.mirrors = flat.map((a) => (isPair(a) ? { label: String(a.pair[0]), url: String(a.pair[1]) } : { label: null, url: String(a) }));
          t.s.baseUrl = t.s.mirrors[0]?.url ?? null;
        }
        return;
      }
      // receiver.forEach { ... }
      const nav = named(st)[0];
      if (nav?.type === 'navigation_expression') {
        const navParts = named(nav);
        const method = navParts[navParts.length - 1]?.text;
        if (method === 'forEach' || method === 'forEachIndexed') {
          const recv = evalExpr(navParts[0], env);
          const lambda = lambdaOf(st);
          if (!lambda) return;
          const params = named(lambda).find((c) => c.type === 'lambda_parameters');
          const body = named(lambda).filter((c) => c.type !== 'lambda_parameters');
          asList(recv).forEach((item, i) => {
            const e = new Env(env);
            const ps = params ? named(params) : [];
            if (method === 'forEachIndexed') {
              bindParam(ps[0] ?? null, i, e);
              bindParam(ps[1] ?? null, item, e);
            } else if (ps.length) bindParam(ps[0], item, e);
            else e.vars.set('it', item);
            runBlock(body, e, t);
          });
        }
      }
      return;
    }
    default:
      return;
  }
}

function runBranch(body: Node, env: Env, t: Target): void {
  if (body.type === 'block') runBlock(named(body), new Env(env), t);
  else run(body, env, t);
}

function bindParam(p: Node | null, v: V, env: Env): void {
  if (!p) return;
  if (p.type === 'multi_variable_declaration') {
    const vars = named(p).filter((c) => c.type === 'variable_declaration');
    const parts = isPair(v) ? v.pair : Array.isArray(v) ? v : [v];
    vars.forEach((vd, i) => env.vars.set(named(vd)[0]?.text ?? '_', parts[i] as V));
  } else if (p.type === 'variable_declaration') {
    env.vars.set(named(p)[0]?.text ?? '_', v);
  } else if (p.type === 'identifier') env.vars.set(p.text, v);
}

function declare(st: Node, env: Env): void {
  const vd = named(st).find((c) => c.type === 'variable_declaration');
  const init = named(st).find((c, i) => i > 0 && c.type !== 'variable_declaration' && c.type !== 'modifiers');
  if (vd) env.vars.set(named(vd)[0]?.text ?? '_', evalExpr(init ?? null, env));
}

function assign(t: Target, key: string, v: V, node: Node | null): void {
  if (t.kind === 'ext') {
    const m = t.meta;
    if (key === 'name') m.name = String(v ?? '');
    else if (key === 'versionCode') m.versionCode = Number(v ?? 0);
    else if (key === 'baseVersionCode') m.baseVersionCode = Number(v ?? 0);
    else if (key === 'libVersion') m.libVersion = String(v ?? '1.4');
    else if (key === 'theme') m.theme = String(v ?? '');
    else if (key === 'pkgName') m.pkgName = String(v ?? '');
    else if (key === 'contentWarning') m.contentWarning = (node?.text.split('.').pop() ?? 'SAFE') as any;
  } else if (t.kind === 'source') {
    const s = t.s;
    if (key === 'name') s.name = String(v);
    else if (key === 'lang') s.lang = String(v);
    else if (key === 'baseUrl') s.baseUrl = v === null || v === undefined ? null : String(v);
    else if (key === 'id') s.id = String(v).replace(/L$/, '');
    else if (key === 'versionId') s.versionId = Number(v);
  }
}

function isPair(v: V): v is { pair: [V, V] } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map) && 'pair' in v;
}

function asList(v: V): V[] {
  if (Array.isArray(v)) return v;
  if (v instanceof Map) return [...v].map(([a, b]) => ({ pair: [a, b] as [V, V] }));
  return [];
}

function evalExpr(n: Node | null | undefined, env: Env): V {
  if (!n) return null;
  switch (n.type) {
    case 'string_literal':
    case 'multiline_string_literal': {
      const c = stringLiteralValue(n);
      if (c !== null) return c;
      let out = '';
      for (const p of named(n)) {
        if (p.type === 'string_content') out += p.text;
        else if (p.type === 'escape_sequence') out += unescapeKotlin(p.text);
        else if (p.type === 'interpolation') out += String(evalExpr(named(p)[0], env) ?? 'null');
      }
      return out;
    }
    case 'number_literal':
      return Number(n.text.replace(/[_lL]/g, ''));
    case 'identifier':
      if (n.text === 'true' || n.text === 'false') return n.text === 'true';
      if (n.text === 'null') return null;
      return env.get(n.text) ?? null;
    case 'parenthesized_expression':
      return evalExpr(named(n)[0], env);
    case 'infix_expression': {
      const [a, op, b] = named(n);
      if (op?.text === 'to') return { pair: [evalExpr(a, env), evalExpr(b, env)] };
      return null;
    }
    case 'binary_expression': {
      const l = evalExpr(n.childForFieldName('left'), env);
      const r = evalExpr(n.childForFieldName('right'), env);
      const op = n.childForFieldName('operator')?.text;
      if (op === '==') return l === r;
      if (op === '!=') return l !== r;
      if (op === '+') return typeof l === 'string' || typeof r === 'string' ? String(l) + String(r) : Number(l) + Number(r);
      if (op === '&&') return !!l && !!r;
      if (op === '||') return !!l || !!r;
      return null;
    }
    case 'call_expression': {
      const name = calleeName(n);
      const args = argsOf(n).map((a) => evalExpr(a, env));
      if (name === 'listOf' || name === 'arrayOf' || name === 'setOf' || name === 'mutableListOf') return args;
      if (name === 'mapOf' || name === 'mutableMapOf') return new Map(args.filter(isPair).map((p) => p.pair));
      return null;
    }
    default:
      return null;
  }
}

function argsOf(call: Node): Node[] {
  const va = named(call).find((c) => c.type === 'value_arguments');
  if (!va) return [];
  return named(va).map((a) => named(a)[named(a).length - 1]).filter(Boolean) as Node[];
}

function lambdaOf(call: Node): Node | null {
  const al = named(call).find((c) => c.type === 'annotated_lambda');
  return al ? (named(al).find((c) => c.type === 'lambda_literal') ?? null) : null;
}

function calleeName(call: Node): string | null {
  const first = named(call)[0];
  return first?.type === 'identifier' ? first.text : null;
}

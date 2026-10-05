// Kotlin -> JavaScript compiler for one translation unit. Emits code against the runtime in
// @kanso/source-api (see docs/runtime-conventions.md). Anything it cannot translate faithfully
// raises Unsupported, so a bundle is either complete or not produced.

import { allChildren, child, children, field, hasToken, identOf, modifiersOf, named, pos, stringLiteralValue, templateParts, unescapeKotlin, annotations, annotationName, annotationStringArgs, type Node } from './parser';
import { type ClassSym, type FunSym, type KFile, type Param, type PropSym, Program, typeName, Unsupported } from './syms';
import { isAnnotation, isExtList, isRuntimeClass, RuntimeInfo, type ExtLike } from './runtime-info';

// ---------- scopes ----------

interface Local {
  js: string;
  isVal: boolean;
  fun?: FunSym;
  /** local declared with a function type known to be a receiver lambda */
  recvLambda?: boolean;
  /** false when the local is known not to be callable (non-function declared type) */
  invokable?: boolean;
}

class Scope {
  readonly vars = new Map<string, Local>();
  constructor(readonly parent: Scope | null) {}
  lookup(n: string): Local | null {
    return this.vars.get(n) ?? this.parent?.lookup(n) ?? null;
  }
}

interface Receiver {
  js: string;
  kind: 'class' | 'ext' | 'lambda' | 'object';
  cls: ClassSym | null;
  rt: any;
  /** label for this@label */
  label: string | null;
}

interface FnCtx {
  kind: 'fun' | 'lambda' | 'ctor' | 'getter' | 'init' | 'top';
  canAwait: boolean;
  usedAwait: boolean;
  infected: boolean;
  temps: string[];
  label: string | null;
  inline: boolean;
  nlrToken: string | null;
  usedNlr: boolean;
  parent: FnCtx | null;
  fun: FunSym | null;
}

type Resolved =
  | { k: 'local'; local: Local }
  | { k: 'member'; js: string; cls: ClassSym | null; name: string; prop: PropSym | null; funs: FunSym[] | null }
  | { k: 'dyn'; receivers: string[]; name: string; fallback: string | null }
  | { k: 'userClass'; cls: ClassSym }
  | { k: 'rt'; fqn: string; value: unknown; js: string }
  | { k: 'topFun'; funs: FunSym[] }
  | { k: 'topProp'; prop: PropSym }
  | { k: 'companion'; cls: ClassSym; name: string };

const JS_RESERVED = new Set(
  'arguments eval undefined NaN Infinity Object Array Map Set String Number Boolean Math JSON Promise Error Date RegExp Symbol globalThis this super new delete typeof instanceof void function var let const class enum export import extends static yield await async with switch case default debugger implements package private protected public interface in do if else for while return break continue throw try catch finally true false null'.split(
    ' ',
  ),
);

export function jsIdent(n: string): string {
  const clean = n.replace(/[^\w$]/g, '_');
  return JS_RESERVED.has(clean) || /^\d/.test(clean) ? `$_${clean}` : clean;
}

const BUILTIN_TYPES: Record<string, string> = {
  String: 'String',
  CharSequence: 'CharSequence',
  Char: 'Char',
  Int: 'Int',
  Long: 'Long',
  Short: 'Short',
  Byte: 'Byte',
  Double: 'Double',
  Float: 'Float',
  Number: 'Number',
  Boolean: 'Boolean',
  List: 'List',
  MutableList: 'MutableList',
  ArrayList: 'ArrayList',
  Array: 'Array',
  Collection: 'Collection',
  Iterable: 'Iterable',
  Set: 'Set',
  MutableSet: 'MutableSet',
  HashSet: 'HashSet',
  Map: 'Map',
  MutableMap: 'MutableMap',
  HashMap: 'HashMap',
  LinkedHashMap: 'LinkedHashMap',
  ByteArray: 'ByteArray',
  IntArray: 'Array',
  LongArray: 'Array',
  CharArray: 'Array',
  Any: 'Any',
  Function: 'Function',
};

interface BundleSource {
  className: ClassSym;
  name: string;
  lang: string;
  baseUrl: string;
  id: string | null;
  versionId: number;
  mirrors: { label: string | null; url: string }[] | null;
  customBaseUrl: string | null;
}

export interface CompileResult {
  code: string;
  warnings: string[];
}

export class Compiler {
  private hoisted = new Map<string, string>(); // key -> const declaration
  private hoistOrder: string[] = [];
  private hoistNames = new Map<string, string>(); // key -> js name
  private warnings: string[] = [];
  /** user functions that must be async (declared suspend or infected) */
  readonly asyncFuns = new Set<FunSym>();
  private newlyInfected = new Set<FunSym>();
  /** names of user functions/methods that are async, for dynamic call sites */
  private asyncNames = new Set<string>();
  private uid = 0;

  // current state
  private file!: KFile;
  private cls: ClassSym | null = null;
  private fn!: FnCtx;
  private scope!: Scope;
  private receivers: Receiver[] = [];
  private out: string[] = [];
  private outerThis: string | null = null;
  private currentObjectCls: ClassSym | null = null;

  constructor(
    readonly prog: Program,
    readonly rt: RuntimeInfo,
  ) {
    for (const f of prog.allFuns) if (f.isSuspend) this.asyncFuns.add(f);
    this.prepareNames();
  }

  // ======================================================================
  // naming & hoisting
  // ======================================================================

  private prepareNames(): void {
    // Overloads across user class hierarchies: same name & different signature -> name$arity
    for (const c of this.prog.allClasses) {
      for (const [name, list] of c.funs) {
        const plain = list.filter((f) => !f.extReceiver);
        const ext = list.filter((f) => f.extReceiver);
        const inherited = this.inheritedFuns(c, name).filter((f) => !f.extReceiver);
        const all = [...plain, ...inherited];
        const sigs = new Set(all.map((f) => this.sigKey(f)));
        if (sigs.size > 1) for (const f of plain) f.jsName = `${name}$${this.sigKey(f)}`;
        else for (const f of plain) f.jsName = inherited[0]?.jsName ?? name;
        const extSigs = new Set([...ext, ...this.inheritedFuns(c, name).filter((f) => f.extReceiver)].map((f) => `${typeName(f.extReceiver)}/${f.params.length}`));
        for (const f of ext) f.jsName = extSigs.size > 1 ? `${name}$ext$${(typeName(f.extReceiver) ?? 'x').replace(/\W/g, '')}${f.params.length}` : `${name}$ext`;
      }
    }
    for (const p of this.prog.packages.values()) {
      for (const [name, list] of p.funs) {
        list.forEach((f, i) => {
          f.jsName = `F_${(p.name.split('.').pop() ?? 'root').replace(/\W/g, '_')}_${jsIdent(name).replace(/^\$_/, '')}${list.length > 1 ? `$${i}` : ''}${f.extReceiver ? '$ext' : ''}`;
        });
      }
    }
  }

  private sigKey(f: FunSym): string {
    const n = f.params.length;
    return `${n}`;
  }

  private inheritedFuns(c: ClassSym, name: string): FunSym[] {
    const out: FunSym[] = [];
    let s = this.userSuper(c);
    const seen = new Set<ClassSym>();
    while (s && !seen.has(s)) {
      seen.add(s);
      out.push(...(s.funs.get(name) ?? []));
      s = this.userSuper(s);
    }
    for (const i of this.userInterfaces(c)) out.push(...(i.funs.get(name) ?? []));
    return out;
  }

  private hoist(key: string, nameHint: string, init: () => string): string {
    const existing = this.hoistNames.get(key);
    if (existing) return existing;
    const name = `${nameHint.replace(/[^\w$]/g, '_')}$${++this.uid}`;
    this.hoistNames.set(key, name);
    this.hoisted.set(key, `const ${name} = ${init()};`);
    this.hoistOrder.push(key);
    return name;
  }

  rtRef(fqn: string): string {
    const short = fqn.split('.').slice(-2).join('_');
    return this.hoist(`m:${fqn}`, `R_${short}`, () => `$m[${JSON.stringify(fqn)}]`);
  }

  private defaultRef(name: string): string {
    return this.hoist(`d:${name}`, `D_${name}`, () => `$D[${JSON.stringify(name)}]`);
  }

  private hofRef(name: string, async: boolean): string {
    return this.hoist(`h:${name}:${async}`, `H_${name}${async ? '_a' : ''}`, () => `$H${async ? 'A' : 'S'}[${JSON.stringify(name)}]`);
  }

  // ======================================================================
  // diagnostics
  // ======================================================================

  private fail(reason: string, n?: Node | null): never {
    if (process.env.KANSO_TRACE && !this.inFallback) console.log(new Error(reason).stack?.split('\n').slice(1, 9).join('\n'));
    throw new Unsupported(reason, n ? `${this.file?.path ?? '?'}:${pos(n)}` : this.file?.path);
  }

  private warn(msg: string, n?: Node | null): void {
    this.warnings.push(n ? `${msg} (${this.file.path}:${pos(n)})` : msg);
  }

  // ======================================================================
  // type & class resolution
  // ======================================================================

  /** Resolve a (possibly qualified) type name to a user class or runtime value. */
  resolveType(name: string, from: { file: KFile; cls: ClassSym | null }): { user?: ClassSym; rt?: { fqn: string; value: unknown }; builtin?: string } | null {
    const parts = name.split('.');
    // nested lookup for qualified names
    if (parts.length > 1) {
      const head = this.resolveType(parts[0], from);
      if (head?.user) {
        let c: ClassSym | undefined = head.user;
        for (const p of parts.slice(1)) c = c?.nested.get(p) ?? (p === 'Companion' ? (c?.companion ?? undefined) : undefined);
        if (c) return { user: c };
        return null;
      }
      if (head?.rt) {
        const fq = `${head.rt.fqn}.${parts.slice(1).join('.')}`;
        if (this.rt.has(fq)) return { rt: { fqn: fq, value: this.rt.value(fq) } };
        let v: any = head.rt.value;
        for (const p of parts.slice(1)) v = v?.[p];
        if (v !== undefined) return { rt: { fqn: fq, value: v } };
        return null;
      }
      const full = this.prog.classesByFqn.get(name);
      if (full) return { user: full };
      if (this.rt.has(name)) return { rt: { fqn: name, value: this.rt.value(name) } };
      return null;
    }
    const n = parts[0];
    // type parameters / nested classes along the class chain
    for (let c = from.cls; c; c = c.outer) {
      if (c.typeParams.includes(n)) return { builtin: 'Any' };
      const nested = this.findNested(c, n);
      if (nested) return nested;
      const rs = this.rtSuper(c);
      const rv: any = rs?.value;
      if (rv && typeof rv === 'function' && Object.prototype.hasOwnProperty.call(rv, n) && typeof rv[n] === 'function') return { rt: { fqn: `${rs!.fqn}.${n}`, value: rv[n] } };
    }
    const pkg = this.prog.packages.get(from.file.pkg);
    const local = pkg?.classes.get(n);
    if (local) return { user: local };
    const alias = pkg?.typeAliases.get(n);
    if (alias) {
      const tn = typeName(alias);
      if (tn && tn !== n) return this.resolveType(tn, from);
    }
    for (const imp of from.file.imports) {
      if (imp.star) continue;
      const simple = imp.alias ?? imp.fqn.split('.').pop();
      if (simple !== n) continue;
      const u = this.prog.classesByFqn.get(imp.fqn);
      if (u) return { user: u };
      if (this.rt.has(imp.fqn)) return { rt: { fqn: imp.fqn, value: this.rt.value(imp.fqn) } };
    }
    for (const imp of from.file.imports) {
      if (!imp.star) continue;
      const u = this.prog.classesByFqn.get(`${imp.fqn}.${n}`);
      if (u) return { user: u };
      const userPkg = this.prog.packages.get(imp.fqn);
      if (userPkg?.classes.get(n)) return { user: userPkg.classes.get(n)! };
      const fq = `${imp.fqn}.${n}`;
      if (this.rt.has(fq)) return { rt: { fqn: fq, value: this.rt.value(fq) } };
    }
    if (BUILTIN_TYPES[n]) return { builtin: BUILTIN_TYPES[n] };
    if (this.rt.hasDefault(n)) return { rt: { fqn: `$default.${n}`, value: this.rt.defaultValue(n) } };
    return null;
  }

  private findNested(c: ClassSym, n: string): { user: ClassSym } | null {
    const seen = new Set<ClassSym>();
    for (let s: ClassSym | null = c; s && !seen.has(s); s = this.userSuper(s)) {
      seen.add(s);
      const x = s.nested.get(n);
      if (x) return { user: x };
      for (const i of this.userInterfaces(s)) {
        const y = i.nested.get(n);
        if (y) return { user: y };
      }
    }
    return null;
  }

  userSuper(c: ClassSym): ClassSym | null {
    if (!c.superType) return null;
    const r = this.resolveType(typeName(c.superType) ?? '', { file: c.file, cls: c.outer });
    return r?.user ?? null;
  }

  rtSuper(c: ClassSym): { fqn: string; value: unknown } | null {
    let cur: ClassSym | null = c;
    const seen = new Set<ClassSym>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (!cur.superType) return null;
      const r = this.resolveType(typeName(cur.superType) ?? '', { file: cur.file, cls: cur.outer });
      if (r?.rt) return r.rt;
      cur = r?.user ?? null;
    }
    return null;
  }

  userInterfaces(c: ClassSym): ClassSym[] {
    const out: ClassSym[] = [];
    for (const t of c.interfaces) {
      const r = this.resolveType(typeName(t) ?? '', { file: c.file, cls: c.outer });
      if (r?.user) out.push(r.user, ...this.userInterfaces(r.user));
    }
    return out;
  }

  /** JS expression evaluating to the class/type for `is`, `as`, `new`, statics. */
  typeRefJs(t: Node | string, n?: Node | null): string {
    const name = typeof t === 'string' ? t : typeName(t);
    if (!name) {
      if (typeof t !== 'string' && t.type === 'function_type') return `$k.KTypes.Function`;
      this.fail(`unsupported type reference ${typeof t === 'string' ? t : t.text}`, n ?? null);
    }
    for (let f: FnCtx | null = this.fn; f; f = f.parent) if (f.fun?.reified.includes(name)) return `$k.descClass($tp_${name})`;
    const r = this.resolveType(name, { file: this.file, cls: this.cls });
    if (!r && process.env.KANSO_LENIENT && !this.inFallback) {
      this.warn(`unknown type ${name}`, n ?? (typeof t === 'string' ? null : t));
      return `$k.missing(${JSON.stringify(name)})`;
    }
    if (!r) this.fail(`unknown type ${name}`, n ?? (typeof t === 'string' ? null : t));
    if (r.user) return this.classJs(r.user);
    if (r.builtin) return `$k.KTypes.${r.builtin}`;
    if (r.rt) return this.rtValueJs(r.rt.fqn);
    this.fail(`unknown type ${name}`, n ?? null);
  }

  private rtValueJs(fqn: string): string {
    if (fqn.startsWith('$default.')) {
      const [head, ...rest] = fqn.slice(9).split('.');
      return this.defaultRef(head) + rest.map((r) => `.${jsProp(r)}`).join('');
    }
    if (this.rt.has(fqn)) return this.rtRef(fqn);
    // nested member of a runtime value (e.g. okhttp3.FormBody.Builder): parent ref + property path
    const parts = fqn.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const head = parts.slice(0, i).join('.');
      if (this.rt.has(head)) return this.rtRef(head) + parts.slice(i).map((r) => `.${jsProp(r)}`).join('');
    }
    return this.rtRef(fqn);
  }

  classJs(c: ClassSym): string {
    if (c.kind === 'object') return `${c.jsName}()`;
    if (c.kind === 'companion') return `${c.outer!.jsName}.$companion`;
    return c.jsName;
  }

  // ======================================================================
  // type descriptors for reified calls / serialization
  // ======================================================================

  typeDesc(t: Node | null, typeParams: string[] = []): string {
    if (!t) return '$T.any';
    if (t.type === 'nullable_type') return `$T.nullable(${this.typeDesc(named(t)[0] ?? null, typeParams)})`;
    if (t.type === 'parenthesized_type' || t.type === 'non_nullable_type') return this.typeDesc(named(t)[0] ?? null, typeParams);
    if (t.type === 'function_type') return '$T.any';
    if (t.type !== 'user_type') return '$T.any';
    const name = typeName(t)!.replace(/`/g, '');
    if (name.includes('$ser$')) {
      const [, ser] = name.split('$ser$');
      const r = this.resolveType(ser, { file: this.file, cls: this.cls });
      if (!r?.user) this.fail(`custom serializer ${ser} not found`, t);
      return `$T.custom(${this.classJs(r.user)})`;
    }
    const args = this.typeArgs(t).map((a) => this.typeDesc(a, typeParams));
    const ti = typeParams.indexOf(name);
    if (ti >= 0) return `$T.param(${ti})`;
    for (let f: FnCtx | null = this.fn; f; f = f.parent) if (f.fun?.reified.includes(name)) return `$tp_${name}`;
    switch (name) {
      case 'String':
        return '$T.str';
      case 'Int':
      case 'Short':
      case 'Byte':
        return '$T.int';
      case 'Long':
        return '$T.long';
      case 'Double':
        return '$T.double';
      case 'Float':
        return '$T.float';
      case 'Boolean':
        return '$T.bool';
      case 'Char':
        return '$T.char';
      case 'Unit':
        return '$T.unit';
      case 'Any':
        return '$T.any';
      case 'List':
      case 'MutableList':
      case 'ArrayList':
      case 'Collection':
      case 'Iterable':
        return `$T.list(${args[0] ?? '$T.any'})`;
      case 'Array':
        return `$T.arr(${args[0] ?? '$T.any'})`;
      case 'Set':
      case 'MutableSet':
      case 'HashSet':
        return `$T.set(${args[0] ?? '$T.any'})`;
      case 'Map':
      case 'MutableMap':
      case 'HashMap':
      case 'LinkedHashMap':
        return `$T.map(${args[0] ?? '$T.str'}, ${args[1] ?? '$T.any'})`;
      case 'Pair':
        return `$T.pair(${args[0] ?? '$T.any'}, ${args[1] ?? '$T.any'})`;
      case 'JsonElement':
        return '$T.element';
      case 'JsonObject':
        return '$T.object';
      case 'JsonArray':
        return '$T.array';
      case 'JsonPrimitive':
        return '$T.primitive';
      case 'IntArray':
      case 'LongArray':
        return '$T.list($T.int)';
      case 'ByteArray':
        return '$T.bytes';
    }
    const r = this.resolveType(name, { file: this.file, cls: this.cls });
    if (r?.user) return args.length ? `$T.cls(${this.classJs(r.user)}, ${args.join(', ')})` : `$T.cls(${this.classJs(r.user)})`;
    if (r?.rt) {
      // runtime typealiases whose value is itself a descriptor (e.g. ReactFlightDate)
      const v: any = r.rt.value;
      if (v && typeof v === 'object' && typeof v.k === 'string') return this.rtValueJs(r.rt.fqn);
      const tail = r.rt.fqn.split('.').pop();
      if (tail === 'JsonElement') return '$T.element';
      if (tail === 'JsonObject') return '$T.object';
      if (tail === 'JsonArray') return '$T.array';
      if (tail === 'JsonPrimitive') return '$T.primitive';
      return '$T.any';
    }
    if (r?.builtin) return '$T.any';
    this.fail(`unknown type in descriptor: ${name}`, t);
  }

  typeArgs(t: Node): Node[] {
    const ta = child(t, 'type_arguments');
    if (!ta) return [];
    return children(ta, 'type_projection').map((p) => named(p)[0]).filter((x): x is Node => !!x);
  }

  // ======================================================================
  // bundle
  // ======================================================================

  compileBundle(sources: BundleSource[], assets: Record<string, string>): CompileResult {
    // Fixed point over async infection: recompile until no new function becomes async.
    for (let iter = 0; iter < 6; iter++) {
      this.newlyInfected.clear();
      this.resetHoists();
      this.asyncNames = new Set([...this.asyncFuns].map((f) => f.jsName));
      const body = this.emitProgram(sources);
      if (this.newlyInfected.size === 0) {
        const head = this.hoistOrder.map((k) => this.hoisted.get(k)!).join('\n');
        const code = `(function ($rt) {\n"use strict";\nconst $k = $rt.k, $m = $rt.m, $D = $rt.D, $T = $rt.T, $HS = $rt.HS, $HA = $rt.HA, $s = $rt.k.str;\nconst $assets = ${JSON.stringify(assets)};\nconst $loader = $rt.loader($assets);\n${head}\n${body}\n})`;
        return { code, warnings: this.warnings };
      }
      for (const f of this.newlyInfected) this.asyncFuns.add(f);
    }
    this.fail('async inference did not converge');
  }

  private resetHoists(): void {
    this.hoisted.clear();
    this.hoistOrder = [];
    this.hoistNames.clear();
    this.warnings = [];
    this.uid = 0;
  }

  private emitProgram(sources: BundleSource[]): string {
    const lines: string[] = [];
    // classes in dependency order (superclass first)
    const ordered = this.orderClasses(this.prog.allClasses.filter((c) => !c.local));
    for (const c of ordered) lines.push(this.emitClass(c));
    // top-level functions and properties
    for (const p of this.prog.packages.values()) {
      for (const list of p.funs.values()) for (const f of list) lines.push(this.emitTopFun(f));
      for (const prop of p.props.values()) lines.push(this.emitTopProp(prop));
    }
    // nested class links & companions
    lines.push(...this.linkLines);
    this.linkLines = [];
    // sources
    lines.push(this.emitSources(sources));
    return lines.join('\n');
  }

  private linkLines: string[] = [];

  private orderClasses(cs: ClassSym[]): ClassSym[] {
    const out: ClassSym[] = [];
    const seen = new Set<ClassSym>();
    const visit = (c: ClassSym, stack: Set<ClassSym>) => {
      if (seen.has(c)) return;
      if (stack.has(c)) this.fail(`cyclic inheritance at ${c.fqn}`);
      stack.add(c);
      const s = this.userSuper(c);
      if (s) visit(s, stack);
      for (const i of this.userInterfaces(c)) visit(i, stack);
      stack.delete(c);
      seen.add(c);
      out.push(c);
    };
    for (const c of cs) visit(c, new Set());
    return out;
  }

  private emitSources(sources: BundleSource[]): string {
    const out: string[] = ['const $sources = [];'];
    sources.forEach((s, i) => {
      const base = s.className;
      const overrides = (n: string) => this.findProp(base, n) !== null;
      const g = `G$${i}`;
      const members: string[] = [];
      if (!overrides('name')) members.push(`get name() { return ${JSON.stringify(s.name)}; }`);
      members.push(`get lang() { return ${JSON.stringify(s.lang)}; }`);
      members.push(`get versionId() { return ${s.versionId}; }`);
      if (s.id) members.push(`get id() { return ${JSON.stringify(s.id)}; }`);
      if (!overrides('baseUrl')) {
        if (s.mirrors) members.push(`get baseUrl() { return $k.mirrorBaseUrl(this, ${JSON.stringify(s.mirrors)}); }`);
        else if (s.customBaseUrl) members.push(`get baseUrl() { return $k.customBaseUrl(this, ${JSON.stringify(s.customBaseUrl)}); }`);
        else members.push(`get baseUrl() { return ${JSON.stringify(s.baseUrl)}; }`);
      }
      out.push(`class ${g} extends ${base.jsName} { ${members.join(' ')} }`);
      out.push(`$sources.push({ name: ${JSON.stringify(s.name)}, lang: ${JSON.stringify(s.lang)}, baseUrl: ${JSON.stringify(s.baseUrl)}, versionId: ${s.versionId}, id: ${JSON.stringify(s.id)}, mirrors: ${JSON.stringify(s.mirrors)}, customBaseUrl: ${JSON.stringify(s.customBaseUrl)}, create: () => new ${g}() });`);
    });
    out.push('return { sources: $sources };');
    return out.join('\n');
  }

  // ======================================================================
  // classes
  // ======================================================================

  findProp(c: ClassSym, name: string): PropSym | null {
    const seen = new Set<ClassSym>();
    for (let s: ClassSym | null = c; s && !seen.has(s); s = this.userSuper(s)) {
      seen.add(s);
      const p = s.props.get(name);
      if (p) return p;
      for (const i of this.userInterfaces(s)) {
        const q = i.props.get(name);
        if (q) return q;
      }
    }
    return null;
  }

  findFuns(c: ClassSym, name: string): FunSym[] {
    const out: FunSym[] = [];
    const seen = new Set<ClassSym>();
    for (let s: ClassSym | null = c; s && !seen.has(s); s = this.userSuper(s)) {
      seen.add(s);
      out.push(...(s.funs.get(name) ?? []));
      for (const i of this.userInterfaces(s)) out.push(...(i.funs.get(name) ?? []));
    }
    return out;
  }

  /** Member names a runtime superclass provides. */
  private rtMembers(c: ClassSym): Set<string> {
    const rs = this.rtSuper(c);
    if (!rs) return new Set();
    return this.rt.members(rs.value);
  }

  private hasMember(c: ClassSym, name: string): boolean {
    return !!this.findProp(c, name) || this.findFuns(c, name).some((f) => !f.extReceiver) || this.rtMembers(c).has(name);
  }

  private isAccessorProp(p: PropSym): boolean {
    if (!p.owner) return false;
    if (p.mods.has('open') || p.mods.has('override') || p.mods.has('abstract')) return true;
    return p.owner.kind === 'interface';
  }

  private emitClass(c: ClassSym): string {
    const saved = this.saveState();
    this.file = c.file;
    this.cls = c;
    this.receivers = [{ js: 'this', kind: 'class', cls: c, rt: null, label: c.name }];
    try {
      if (c.kind === 'annotation') return '';
      if (c.kind === 'object' || c.kind === 'companion') return this.emitObjectDecl(c);
      return this.emitClassBody(c, c.jsName, false);
    } finally {
      this.restoreState(saved);
    }
  }

  private superJs(c: ClassSym): string | null {
    if (!c.superType) return null;
    return this.typeRefJs(c.superType, c.superType);
  }

  private interfacesJs(c: ClassSym): string[] {
    return c.interfaces.map((t) => this.typeRefJs(t, t));
  }

  /** Emits `class X extends Y { ... }` plus post-definition statements. Returns code. */
  private emitClassBody(c: ClassSym, jsName: string, expression: boolean): string {
    const sup = this.superJs(c);
    const ifaces = this.interfacesJs(c);
    const extendsJs = sup ? ` extends $k.base(${sup})` : c.kind === 'interface' ? '' : '';
    const members: string[] = [];
    const post: string[] = [];

    // ---- constructor ----
    const ctor = this.emitConstructor(c, !!sup);
    if (ctor) members.push(ctor);

    // ---- properties with getters / accessors ----
    for (const p of c.props.values()) {
      if (p.extReceiver) {
        members.push(this.emitExtProp(p));
        continue;
      }
      if (p.getter || p.setter) members.push(...this.emitAccessors(p));
      else if (p.delegate) post.push(this.emitDelegateProp(c, p, jsName));
      else if (this.isAccessorProp(p) && (p.init || p.fromCtor || p.mods.has('lateinit') || !p.mods.has('abstract'))) {
        if (!p.mods.has('abstract')) post.push(`$k.defProp(${jsName}, ${JSON.stringify(p.jsName)}, ${!p.isVal});`);
      }
    }

    // ---- methods ----
    for (const [name, list] of c.funs) {
      for (const f of list) members.push(this.emitMethod(f));
      const plain = list.filter((f) => !f.extReceiver);
      const needsDispatch = plain.some((f) => f.jsName !== name);
      if (needsDispatch) members.push(this.emitDispatcher(c, name));
    }

    // ---- enum ----
    if (c.kind === 'enum') post.push(this.emitEnumEntries(c, jsName));
    if (c.mods.has('data')) post.push(`$k.defData(${jsName}, ${JSON.stringify(c.ctorParams.filter((p) => p.prop).map((p) => p.name))});`);
    if (c.serializable || c.kind === 'enum') post.push(this.emitSerial(c, jsName));
    if (c.kind === 'interface') post.push(`${jsName}.$interface = true;`);
    if (ifaces.length) post.push(`$k.mixin(${jsName}, [${ifaces.join(', ')}]);`);
    // nested classes and companion become statics
    for (const [n, nested] of c.nested) {
      if (nested.kind === 'companion') {
        this.linkLines.push(`$k.lazyStatic(${jsName}, '$companion', () => ${nested.jsName}());`);
        if (nested.name !== 'Companion') this.linkLines.push(`$k.lazyStatic(${jsName}, ${JSON.stringify(nested.name)}, () => ${nested.jsName}());`);
      } else if (nested.kind === 'object') this.linkLines.push(`$k.lazyStatic(${jsName}, ${JSON.stringify(n)}, () => ${nested.jsName}());`);
      else this.linkLines.push(`$k.defStatic(${jsName}, ${JSON.stringify(n)}, ${nested.jsName});`);
    }
    const kw = expression ? 'class' : `class ${jsName}`;
    const cls = `${kw}${extendsJs} {\n${members.map((m) => indent(m)).join('\n')}\n}`;
    if (expression) return cls;
    return [cls, ...post].join('\n');
  }

  private emitConstructor(c: ClassSym, hasSuper: boolean): string | null {
    if (c.secondaryCtors.length && !c.hasPrimaryCtor) {
      if (c.secondaryCtors.length > 1) this.fail('multiple secondary constructors without primary', c.secondaryCtors[1]);
    }
    const fnCtx = this.newFn('ctor', false, null, null);
    return this.inFn(fnCtx, () => {
      this.scope = new Scope(this.scope);
      const body: string[] = [];
      let params: string[] = [];
      this.out = body;
      if (c.hasPrimaryCtor || !c.secondaryCtors.length) {
        params = this.emitParams(c.ctorParams, null);
        if (hasSuper) {
          const args = c.superArgs ? this.callArgs(c.superArgs, null, this.superParamsOf(c), null).join(', ') : '';
          body.unshift(`super(${args});`);
        } else if (c.kind !== 'interface' && this.superJs(c) === null) {
          // no super call needed
        }
        for (const p of c.ctorParams) {
          if (!p.prop) continue;
          const ps = c.props.get(p.name)!;
          const pj = this.scope.lookup(p.name)!.js;
          if (this.isAccessorProp(ps)) body.push(`$k.initProp(this, ${c.jsName}, ${JSON.stringify(ps.jsName)}, ${pj});`);
          else body.push(`this.${ps.jsName} = ${pj};`);
        }
      } else {
        // single secondary constructor: constructor(params) : super(args) { body }
        const sc = c.secondaryCtors[0];
        const fvp = child(sc, 'function_value_parameters');
        const ps = fvp ? children(fvp, 'parameter').map((p) => this.prog_paramOf(p)) : [];
        params = this.emitParams(ps, null);
        const deleg = child(sc, 'constructor_delegation_call');
        if (deleg) {
          const kind = named(deleg)[0]?.text;
          if (kind === 'this') this.fail('this() constructor delegation', deleg);
          const va = child(deleg, 'value_arguments');
          body.push(`super(${va ? this.callArgs(va, null, this.superParamsOf(c), null).join(', ') : ''});`);
        } else if (hasSuper) body.push('super();');
      }
      // property initializers and init blocks in declaration order
      const done = new Set<PropSym>();
      for (const m of c.order) {
        if (m.type === 'anonymous_initializer') {
          const blk = child(m, 'block');
          if (blk) this.stmts(named(blk));
          continue;
        }
        for (const p of c.props.values()) {
          if (p.node.id !== m.id || done.has(p)) continue;
          done.add(p);
          if (p.extReceiver || p.getter || p.delegate || p.fromCtor) continue;
          if (!p.init) {
            if (!this.isAccessorProp(p) && !p.mods.has('abstract')) body.push(`this.${p.jsName} = null;`);
            continue;
          }
          const v = this.expr(p.init, p.type);
          if (this.isAccessorProp(p)) body.push(`$k.initProp(this, ${c.jsName}, ${JSON.stringify(p.jsName)}, ${v});`);
          else body.push(`this.${p.jsName} = ${v};`);
        }
      }
      if (c.secondaryCtors.length && c.hasPrimaryCtor) {
        if (c.secondaryCtors.length) this.fail('secondary constructor alongside primary constructor', c.secondaryCtors[0]);
      }
      if (c.secondaryCtors.length && !c.hasPrimaryCtor) {
        const blk = child(c.secondaryCtors[0], 'block');
        if (blk) this.stmts(named(blk));
      }
      if (this.fn.usedAwait) this.fail('suspend call in constructor', c.node);
      const temps = this.fn.temps.length ? `let ${this.fn.temps.join(', ')};\n` : '';
      if (!body.length && !params.length && !temps) return null;
      if (!hasSuper && body.some((b) => b.startsWith('super('))) body.splice(body.findIndex((b) => b.startsWith('super(')), 1);
      // `super(...)` must come first, temps after it
      const superIdx = body.findIndex((b) => b.startsWith('super('));
      const lines = superIdx >= 0 ? [body[superIdx], temps, ...body.filter((_, i) => i !== superIdx)] : [temps, ...body];
      return `constructor(${params.join(', ')}) {\n${indent(lines.filter(Boolean).join('\n'))}\n}`;
    });
  }

  private prog_paramOf(p: Node): Param {
    const nameNode = named(p).find((x) => x.type === 'identifier') ?? null;
    const type = named(p).find((x) => x !== nameNode && (x.type === 'user_type' || x.type === 'nullable_type' || x.type === 'function_type')) ?? null;
    return { name: identOf(nameNode) ?? '_', type, def: null, vararg: false, prop: null, node: p, annotations: [], mods: new Set() };
  }

  private superParamsOf(c: ClassSym): Param[] | null {
    const s = this.userSuper(c);
    if (s) return s.ctorParams;
    return null;
  }

  private isTypeParamName(n: string | null): boolean {
    if (!n) return false;
    if (this.cls?.typeParams.includes(n)) return true;
    for (let f: FnCtx | null = this.fn; f; f = f.parent) if (f.fun?.typeParams.includes(n)) return true;
    return false;
  }

  private emitParams(ps: Param[], base: Param[] | null): string[] {
    return ps.map((p, i) => {
      const fnType = !!p.type && (p.type.type === 'function_type' || (p.type.type === 'nullable_type' && /\)\s*->/.test(p.type.text)) || p.type.text.trim().startsWith('suspend'));
      const js = this.declareLocal(p.name, true, { invokable: !p.type || fnType || this.isTypeParamName(typeName(p.type)) });
      if (p.vararg) return `...${js}`;
      const def = p.def ?? base?.[i]?.def ?? null;
      if (def) {
        const blk: string[] = [];
        const saved = this.out;
        this.out = blk;
        const v = this.expr(def, p.type);
        this.out = saved;
        if (blk.length) return `${js} = (() => { ${blk.join(' ')} return ${v}; })()`;
        return `${js} = ${v}`;
      }
      return js;
    });
  }

  private emitAccessors(p: PropSym): string[] {
    const out: string[] = [];
    const field = `$f_${p.jsName}`;
    if (p.getter) {
      const g = p.getter;
      const body = child(g, 'function_body') ?? child(g, 'block');
      if (body) {
        const fnCtx = this.newFn('getter', false, null, null);
        out.push(
          this.inFn(fnCtx, () => {
            this.scope = new Scope(this.scope);
            this.scope.vars.set('field', { js: `this.${field}`, isVal: false });
            const code = this.functionBody(body, p.type);
            if (this.fn.usedAwait) this.fail('suspend call in property getter', g);
            return `get ${p.jsName}() {\n${indent(code)}\n}`;
          }),
        );
      } else {
        out.push(`get ${p.jsName}() { return this.${field} === undefined ? null : this.${field}; }`);
      }
    } else {
      out.push(`get ${p.jsName}() { return this.${field} === undefined ? null : this.${field}; }`);
    }
    if (p.setter) {
      const s = p.setter;
      const body = child(s, 'function_body') ?? child(s, 'block');
      const paramNode = s.descendantsOfType('identifier').find((x) => x?.parent?.type === 'parameter' || x?.parent?.type === 'parameter_with_optional_type');
      const pname = paramNode?.text ?? 'value';
      if (body) {
        const fnCtx = this.newFn('getter', false, null, null);
        out.push(
          this.inFn(fnCtx, () => {
            this.scope = new Scope(this.scope);
            this.scope.vars.set('field', { js: `this.${field}`, isVal: false });
            const pj = this.declareLocal(pname, true);
            const code = this.functionBody(body, null, true);
            return `set ${p.jsName}(${pj}) {\n${indent(code)}\n}`;
          }),
        );
      } else out.push(`set ${p.jsName}(v) { this.${field} = v; }`);
    } else if (!p.isVal || !p.getter) {
      out.push(`set ${p.jsName}(v) { this.${field} = v; }`);
    }
    // initializer for a property with custom accessors and a backing field
    if (p.init && p.owner) {
      // handled in constructor via field
    }
    return out;
  }

  private emitExtProp(p: PropSym): string {
    // `val Foo.bar get() = ...` -> method bar$extp($this)
    const g = p.getter;
    if (!g) this.fail('extension property without getter', p.node);
    const body = child(g, 'function_body') ?? child(g, 'block');
    const fnCtx = this.newFn('getter', false, null, null);
    return this.inFn(fnCtx, () => {
      this.scope = new Scope(this.scope);
      const self = '$this';
      this.receivers = [{ js: self, kind: 'ext', cls: this.userTypeOf(p.extReceiver), rt: null, label: null }, ...this.receivers];
      const code = body ? this.functionBody(body, p.type) : 'return null;';
      return `${p.jsName}(${self}) {\n${indent(code)}\n}`;
    });
  }

  private emitDelegateProp(c: ClassSym, p: PropSym, jsName: string): string {
    const d = p.delegate!;
    const e = named(d)[0];
    // by lazy { ... }
    if (e?.type === 'call_expression' && named(e)[0]?.text === 'lazy') {
      const lam = e.descendantsOfType('lambda_literal')[0];
      if (!lam) this.fail('lazy without lambda', e);
      const fnCtx = this.newFn('getter', false, null, null);
      const code = this.inFn(fnCtx, () => {
        this.scope = new Scope(this.scope);
        const body = this.lambdaBodyValue(lam, null);
        if (this.fn.usedAwait) this.fail('suspend call in lazy initializer', lam);
        return body;
      });
      return `$k.lazyProp(${jsName}, ${JSON.stringify(p.jsName)}, function () {\n${indent(code)}\n});`;
    }
    // other delegates: evaluated lazily on first access, read via getValue/.value
    const fnCtx = this.newFn('getter', false, null, null);
    const code = this.inFn(fnCtx, () => {
      this.scope = new Scope(this.scope);
      const body: string[] = [];
      this.out = body;
      const v = this.delegateExpr(e!, p);
      const temps = this.fn.temps.length ? `let ${this.fn.temps.join(', ')};\n` : '';
      return `${temps}${body.join('\n')}\nreturn ${v};`;
    });
    void c;
    return `$k.delegateProp(${jsName}, ${JSON.stringify(p.jsName)}, function () {\n${indent(code)}\n}, ${!p.isVal});`;
  }

  private delegateExpr(e: Node, p: PropSym): string {
    // injectLazy<T>() / getPreferencesLazy() / Delegates.notNull()
    if (e.type === 'call_expression') {
      const callee = named(e)[0];
      if (callee?.type === 'identifier' && callee.text === 'injectLazy') {
        const t = this.typeArgs(e)[0] ?? p.type;
        return `{ value: ${this.rtRef('uy.kohesive.injekt.Injekt')}.get(${t ? this.typeRefJs(t, t) : 'null'}) }`;
      }
    }
    return this.expr(e);
  }

  private emitEnumEntries(c: ClassSym, jsName: string): string {
    const entries: string[] = [];
    const serialNames: Record<string, string> = {};
    for (const e of c.enumEntries) {
      const name = identOf(named(e).find((x) => x.type === 'identifier') ?? null) ?? '_';
      if (child(e, 'class_body')) this.fail('enum entry with body', e);
      for (const a of annotations(e)) if (annotationName(a) === 'SerialName') serialNames[name] = annotationStringArgs(a)[0];
      const va = child(e, 'value_arguments');
      const args = va ? this.inFn(this.newFn('init', false, null, null), () => this.callArgs(va, null, c.ctorParams, null)) : [];
      entries.push(`[${JSON.stringify(name)}, [${args.join(', ')}]]`);
    }
    const sn = Object.keys(serialNames).length ? `\n${jsName}.$serialNames = ${JSON.stringify(serialNames)};` : '';
    return `$k.defEnum(${jsName}, [${entries.join(', ')}]);${sn}`;
  }

  private emitSerial(c: ClassSym, jsName: string): string {
    if (c.kind === 'enum') return `${jsName}.$enum = true;`;
    if (c.customSerializer) {
      const ref = c.customSerializer;
      const tn = named(ref).find((x) => x.type === 'user_type' || x.type === 'identifier');
      const r = tn ? this.resolveType(tn.text, { file: c.file, cls: c }) : null;
      if (!r?.user) this.fail('custom serializer must be a translated class/object', ref);
      return `$k.serial(${jsName}, () => ({ custom: () => ${this.classJs(r.user)}${r.user.kind === 'object' ? '' : '()'} }));`;
    }
    const fields: string[] = [];
    for (const p of c.ctorParams) {
      let json = p.name;
      let alt: string[] = [];
      let transient = false;
      for (const a of p.annotations) {
        const an = annotationName(a);
        if (an === 'SerialName') json = annotationStringArgs(a)[0] ?? json;
        if (an === 'JsonNames') alt = annotationStringArgs(a);
        if (an === 'Transient') transient = true;
      }
      if (transient) {
        fields.push(`{ name: ${JSON.stringify(p.name)}, json: ${JSON.stringify('\u0000' + p.name)}, type: $T.any, optional: true }`);
        continue;
      }
      const desc = this.inFn(this.newFn('init', false, null, null), () => this.typeDesc(p.type, c.typeParams));
      const extra: string[] = [];
      for (const a of p.annotations) {
        const an = annotationName(a);
        const argText = a.text.replace(/^@\w+(\.\w+)*/, '').replace(/[()\s]/g, '');
        if (an === 'ProtoNumber' && /^\d+$/.test(argText)) extra.push(`proto: ${argText}`);
        if (an === 'ProtoType') extra.push(`protoType: ${JSON.stringify(argText.split('.').pop())}`);
        if (an === 'ProtoPacked') extra.push('packed: true');
        if (an === 'ProtoOneOf') extra.push('oneOf: true');
        if (an === 'EncodeDefault') extra.push('encodeDefault: true');
      }
      fields.push(`{ name: ${JSON.stringify(p.name)}, json: ${JSON.stringify(json)}${alt.length ? `, alt: ${JSON.stringify(alt)}` : ''}, type: ${desc}, optional: ${!!p.def}${extra.length ? ', ' + extra.join(', ') : ''} }`);
    }
    const subclasses = c.mods.has('sealed') || c.mods.has('abstract') ? this.sealedSubclasses(c) : null;
    const disc = this.classDiscriminator(c);
    const parts = [`fields: [${fields.join(', ')}]`];
    if (c.serialName) parts.push(`serialName: ${JSON.stringify(c.serialName)}`);
    if (subclasses) parts.push(`subclasses: () => ({ ${subclasses.map((s) => `${JSON.stringify(s.serialName ?? s.fqn)}: ${this.classJs(s)}`).join(', ')} })`);
    if (disc) parts.push(`discriminator: ${JSON.stringify(disc)}`);
    if (c.kind === 'object') parts.push('object: true');
    if (c.mods.has('value') || annotations(c.node).some((a) => annotationName(a) === 'JvmInline')) parts.push('inline: true');
    return `$k.serial(${jsName}, () => ({ ${parts.join(', ')} }));`;
  }

  private sealedSubclasses(c: ClassSym): ClassSym[] {
    return this.prog.allClasses.filter((x) => x !== c && this.userSuper(x) === c && x.serializable);
  }

  private classDiscriminator(c: ClassSym): string | null {
    for (const a of annotations(c.node)) if (annotationName(a) === 'JsonClassDiscriminator') return annotationStringArgs(a)[0] ?? null;
    return null;
  }

  private emitObjectDecl(c: ClassSym): string {
    const inner = `${c.jsName}$cls`;
    const cls = this.emitClassBody(c, inner, false);
    return `${cls}\nconst ${c.jsName} = $k.lazyObject(() => new ${inner}());`;
  }

  private emitDispatcher(c: ClassSym, name: string): string {
    const all = [...(c.funs.get(name) ?? []), ...this.inheritedFuns(c, name)].filter((f) => !f.extReceiver);
    const byArity = new Map<number, FunSym>();
    for (const f of all) if (!byArity.has(f.params.length)) byArity.set(f.params.length, f);
    const cases = [...byArity.entries()].map(([n, f]) => `if (args.length === ${n}) return this.${f.jsName}(...args);`);
    const withDefaults = all.filter((f) => f.params.some((p) => p.def));
    const fallback = withDefaults.length ? `return this.${withDefaults[0].jsName}(...args);` : `throw new Error('No overload of ${name} for ' + args.length + ' arguments');`;
    return `${name}(...args) {\n  ${cases.join('\n  ')}\n  ${fallback}\n}`;
  }

  // ======================================================================
  // functions
  // ======================================================================

  private newFn(kind: FnCtx['kind'], canAwait: boolean, fun: FunSym | null, label: string | null, inline = false): FnCtx {
    return { kind, canAwait, usedAwait: false, infected: false, temps: [], label, inline, nlrToken: null, usedNlr: false, parent: this.fn ?? null, fun };
  }

  private inFn<T>(fnCtx: FnCtx, f: () => T): T {
    const saved = { fn: this.fn, scope: this.scope, out: this.out, receivers: this.receivers };
    this.fn = fnCtx;
    try {
      return f();
    } finally {
      this.fn = saved.fn;
      this.scope = saved.scope;
      this.out = saved.out;
      this.receivers = saved.receivers;
    }
  }

  private isAsyncFun(f: FunSym): boolean {
    return this.asyncFuns.has(f);
  }

  private overriddenBase(f: FunSym): FunSym | null {
    if (!f.owner || !f.mods.has('override')) return null;
    const cands = this.inheritedFuns(f.owner, f.name).filter((g) => g.params.length === f.params.length && !!g.extReceiver === !!f.extReceiver);
    return cands[0] ?? null;
  }

  private emitMethod(f: FunSym): string {
    if (f.mods.has('abstract') || (!f.body && f.owner?.kind === 'interface')) return '';
    if (!f.body) return '';
    const base = this.overriddenBase(f);
    // An override of an async base (or a runtime suspend) must be async too.
    const isAsync = this.isAsyncFun(f) || (!!base && this.isAsyncFun(base)) || this.overridesRuntimeAsync(f);
    if (isAsync) this.asyncFuns.add(f);
    const fnCtx = this.newFn('fun', isAsync, f, f.name);
    const code = this.inFn(fnCtx, () => {
      this.scope = new Scope(this.scope);
      let selfParam = '';
      if (f.extReceiver) {
        selfParam = '$this';
        this.receivers = [{ js: '$this', kind: 'ext', cls: this.userTypeOf(f.extReceiver), rt: this.rtTypeOf(f.extReceiver), label: f.name }, ...this.receivers];
      }
      const params = this.emitParams(f.params, base?.params ?? null);
      const body = this.functionBody(f.body!, f.returnType);
      this.checkInfection(f);
      const allParams = [...(selfParam ? [selfParam] : []), ...params, ...f.reified.map((t) => `$tp_${t}`)];
      return `${this.fn.usedAwait || isAsync ? 'async ' : ''}${f.jsName}(${allParams.join(', ')}) {\n${indent(body)}\n}`;
    });
    return code;
  }

  private overridesRuntimeAsync(f: FunSym): boolean {
    if (!f.owner || !f.mods.has('override')) return false;
    const rs = this.rtSuper(f.owner);
    if (!rs || typeof rs.value !== 'function') return false;
    const proto = (rs.value as any).prototype;
    let p = proto;
    while (p && p !== Object.prototype) {
      const d = Object.getOwnPropertyDescriptor(p, f.jsName);
      if (d && typeof d.value === 'function') return d.value.constructor?.name === 'AsyncFunction';
      p = Object.getPrototypeOf(p);
    }
    return false;
  }

  private checkInfection(f: FunSym): void {
    if (this.fn.usedAwait && !this.asyncFuns.has(f)) {
      this.newlyInfected.add(f);
    }
  }

  private emitTopFun(f: FunSym): string {
    const saved = this.saveState();
    this.file = f.file;
    this.cls = null;
    this.receivers = [];
    try {
      if (!f.body) return '';
      const isAsync = this.isAsyncFun(f);
      const fnCtx = this.newFn('fun', isAsync, f, f.name);
      return this.inFn(fnCtx, () => {
        this.scope = new Scope(null);
        let selfParam = '';
        if (f.extReceiver) {
          selfParam = '$this';
          this.receivers = [{ js: '$this', kind: 'ext', cls: this.userTypeOf(f.extReceiver), rt: this.rtTypeOf(f.extReceiver), label: f.name }];
        }
        const ctx = f.contextParams.map((c) => this.declareLocal(c, true));
        const params = this.emitParams(f.params, null);
        const body = this.functionBody(f.body!, f.returnType);
        this.checkInfection(f);
        const allParams = [...(selfParam ? [selfParam] : []), ...ctx, ...params, ...f.reified.map((t) => `$tp_${t}`)];
        return `${this.fn.usedAwait || isAsync ? 'async ' : ''}function ${f.jsName}(${allParams.join(', ')}) {\n${indent(body)}\n}`;
      });
    } finally {
      this.restoreState(saved);
    }
  }

  private emitTopProp(p: PropSym): string {
    const saved = this.saveState();
    this.file = p.file;
    this.cls = null;
    this.receivers = [];
    try {
      const js = this.topPropJs(p);
      if (p.extReceiver) {
        const g = p.getter;
        if (!g) this.fail('extension property without getter', p.node);
        const body = child(g, 'function_body') ?? child(g, 'block');
        const fnCtx = this.newFn('getter', false, null, null);
        return this.inFn(fnCtx, () => {
          this.scope = new Scope(null);
          this.receivers = [{ js: '$this', kind: 'ext', cls: this.userTypeOf(p.extReceiver), rt: null, label: null }];
          const code = body ? this.functionBody(body, p.type) : 'return null;';
          return `function ${js}($this) {\n${indent(code)}\n}`;
        });
      }
      const fnCtx = this.newFn('getter', false, null, null);
      return this.inFn(fnCtx, () => {
        this.scope = new Scope(null);
        if (p.getter) {
          const body = child(p.getter, 'function_body') ?? child(p.getter, 'block');
          const code = body ? this.functionBody(body, p.type) : 'return null;';
          return `const ${js} = { get value() {\n${indent(code)}\n} };`;
        }
        if (p.delegate) {
          const e = named(p.delegate)[0];
          if (e?.type === 'call_expression' && named(e)[0]?.text === 'lazy') {
            const lam = e.descendantsOfType('lambda_literal')[0]!;
            const code = this.lambdaBodyValue(lam, null);
            return `const ${js} = $k.lazy(() => {\n${indent(code)}\n});`;
          }
          const body: string[] = [];
          this.out = body;
          const v = this.expr(e!);
          return `const ${js} = $k.lazy(() => { ${body.join(' ')} return $k.delegated(${v}); });`;
        }
        const body: string[] = [];
        this.out = body;
        const v = p.init ? this.expr(p.init, p.type) : 'null';
        const temps = this.fn.temps.length ? `let ${this.fn.temps.join(', ')}; ` : '';
        if (p.isVal) return `const ${js} = $k.lazy(() => { ${temps}${body.join(' ')} return ${v}; });`;
        return `const ${js} = $k.mutableTop(() => { ${temps}${body.join(' ')} return ${v}; });`;
      });
    } finally {
      this.restoreState(saved);
    }
  }

  private topPropJs(p: PropSym): string {
    return `P_${(p.pkg.split('.').pop() ?? 'root').replace(/\W/g, '_')}_${p.name}${p.extReceiver ? '$extp' : ''}`;
  }

  private saveState() {
    return { file: this.file, cls: this.cls, fn: this.fn, scope: this.scope, receivers: this.receivers, out: this.out, outerThis: this.outerThis, obj: this.currentObjectCls };
  }
  private restoreState(s: ReturnType<Compiler['saveState']>): void {
    this.file = s.file;
    this.cls = s.cls;
    this.fn = s.fn;
    this.scope = s.scope;
    this.receivers = s.receivers;
    this.out = s.out;
    this.outerThis = s.outerThis;
    this.currentObjectCls = s.obj;
  }

  /** Compile a function body (block or `= expr`) to JS statements. */
  private functionBody(body: Node, returnType: Node | null, isSetter = false): string {
    const lines: string[] = [];
    const saved = this.out;
    this.out = lines;
    const isExprBody = body.type === 'function_body' && hasToken(body, '=');
    if (isExprBody) {
      const e = named(body)[0];
      if (e) {
        if (isSetter) this.stmt(e);
        else {
          const v = this.expr(e, returnType);
          lines.push(`return ${v};`);
        }
      }
    } else {
      const blk = body.type === 'block' ? body : (child(body, 'block') ?? body);
      this.scope = new Scope(this.scope);
      this.stmts(named(blk));
      this.scope = this.scope.parent!;
    }
    this.out = saved;
    let code = lines.join('\n');
    if (this.fn.usedNlr && this.fn.nlrToken) {
      code = `const ${this.fn.nlrToken} = {};\ntry {\n${indent(code)}\n} catch ($e) {\n  if ($e instanceof $k.NonLocalReturn && $e.token === ${this.fn.nlrToken}) return $e.value;\n  throw $e;\n}`;
    }
    if (this.fn.temps.length) code = `let ${this.fn.temps.join(', ')};\n${code}`;
    return code;
  }

  // ======================================================================
  // statements
  // ======================================================================

  private emit(line: string): void {
    this.out.push(line);
  }

  private tmp(): string {
    const t = `$t${++this.uid}`;
    this.fn.temps.push(t);
    return t;
  }

  private declareLocal(name: string, isVal: boolean, extra: Partial<Local> = {}): string {
    let js = jsIdent(name);
    // avoid collisions with outer locals of the same JS name in nested scopes: shadowing is fine in JS blocks
    if (name === '_') js = `$_unused${++this.uid}`;
    this.scope.vars.set(name, { js, isVal, ...extra });
    return js;
  }

  private stmts(list: Node[]): void {
    for (const s of list) this.stmt(s);
  }

  private block(list: Node[]): string {
    const lines: string[] = [];
    const saved = this.out;
    this.out = lines;
    this.scope = new Scope(this.scope);
    this.stmts(list);
    this.scope = this.scope.parent!;
    this.out = saved;
    return lines.join('\n');
  }

  private bodyOf(n: Node | null): Node[] {
    if (!n) return [];
    if (n.type === 'block') return named(n);
    if (n.type === 'control_structure_body') return named(n);
    return [n];
  }

  private stmt(n: Node): void {
    switch (n.type) {
      case 'property_declaration':
        return this.localProp(n);
      case 'function_declaration':
        return this.localFun(n);
      case 'class_declaration':
      case 'object_declaration':
        return this.localClass(n);
      case 'assignment':
        return this.assignment(n);
      case 'for_statement':
        return this.forStmt(n, null);
      case 'while_statement':
        return this.whileStmt(n, null);
      case 'do_while_statement':
        return this.doWhileStmt(n, null);
      case 'labeled_expression': {
        const lbl = named(n)[0]?.text.replace(/@$/, '') ?? '';
        const inner = named(n)[1];
        if (inner?.type === 'for_statement') return this.forStmt(inner, lbl);
        if (inner?.type === 'while_statement') return this.whileStmt(inner, lbl);
        if (inner?.type === 'do_while_statement') return this.doWhileStmt(inner, lbl);
        if (inner) return this.exprStmt(inner);
        return;
      }
      case 'if_expression':
        return this.ifStmt(n);
      case 'when_expression':
        return void this.when(n, false);
      case 'try_expression':
        return void this.tryExpr(n, false);
      case 'return_expression':
        return this.returnStmt(n);
      case 'throw_expression':
        return this.emit(`throw ${this.expr(named(n)[0]!)};`);
      case 'identifier':
        if (n.text === 'break' || n.text === 'continue') return this.jump(n.text, null, n);
        return this.exprStmt(n);
      case 'type_alias':
        return;
      default:
        return this.exprStmt(n);
    }
  }

  private exprStmt(n: Node): void {
    // break@label / continue@label appear as expressions
    const t = n.text.trim();
    const jump = /^(break|continue)(@(\w+))?$/.exec(t);
    if (jump) return this.jump(jump[1], jump[3] ?? null, n);
    const e = this.expr(n);
    if (e && e !== 'undefined' && !/^[\w$.]+$/.test(e)) this.emit(`${e};`);
    else if (e && /\(/.test(e)) this.emit(`${e};`);
  }

  private localProp(n: Node): void {
    const multi = child(n, 'multi_variable_declaration');
    const isVal = /^\s*val\b/.test(n.text);
    const init = this.propInit(n);
    if (child(n, 'property_delegate')) {
      const d = named(child(n, 'property_delegate')!)[0]!;
      const vd = child(n, 'variable_declaration')!;
      const name = identOf(named(vd)[0] ?? null)!;
      if (d.type === 'call_expression' && named(d)[0]?.text === 'lazy') {
        const lam = d.descendantsOfType('lambda_literal')[0]!;
        const fn = this.lambda(lam, { mode: 'plain', recv: false, label: 'lazy' });
        const js = this.declareLocal(name, true);
        this.emit(`const ${js}$lazy = $k.lazy(${fn});`);
        this.scope.vars.set(name, { js: `${js}$lazy.value`, isVal: true });
        return;
      }
      const js = this.declareLocal(name, true);
      this.emit(`const ${js}$d = ${this.expr(d)};`);
      this.scope.vars.set(name, { js: `$k.delegated(${js}$d)`, isVal: true });
      return;
    }
    if (multi) {
      const v = init ? this.expr(init) : 'null';
      const t = this.tmp();
      this.emit(`${t} = ${v};`);
      children(multi, 'variable_declaration').forEach((vd, i) => {
        const name = identOf(named(vd)[0] ?? null) ?? '_';
        if (name === '_') return;
        const js = this.declareLocal(name, isVal);
        this.emit(`${isVal ? 'const' : 'let'} ${js} = $k.component(${t}, ${i + 1});`);
      });
      return;
    }
    const vd = child(n, 'variable_declaration')!;
    const name = identOf(named(vd).find((x) => x.type === 'identifier') ?? null)!;
    const type = named(vd).find((x) => x.type !== 'identifier') ?? null;
    const recvLambda = type?.type === 'function_type' && this.isReceiverFnType(type);
    const v = init ? this.expr(init, type) : null;
    const invokable = type ? type.type === 'function_type' || /->/.test(type.text) : !init || ['lambda_literal', 'callable_reference', 'anonymous_function', 'navigation_expression', 'call_expression', 'identifier'].includes(init.type);
    const js = this.declareLocal(name, isVal, { ...(recvLambda ? { recvLambda } : {}), invokable });
    this.emit(`${isVal && v !== null ? 'const' : 'let'} ${js}${v !== null ? ` = ${v}` : ''};`);
  }

  private isReceiverFnType(t: Node): boolean {
    // `T.() -> R`: a type node before the parameter list
    const first = named(t)[0];
    return !!first && first.type !== 'function_type_parameters';
  }

  private propInit(n: Node): Node | null {
    for (let i = 0; i < n.childCount; i++) {
      if (n.child(i)?.type === '=') {
        for (let j = i + 1; j < n.childCount; j++) {
          const e = n.child(j);
          if (e?.isNamed && e.type !== 'line_comment' && e.type !== 'block_comment') return e;
        }
      }
    }
    return null;
  }

  private localFun(n: Node): void {
    const f = this.prog.collectFun(n, this.file, null);
    const js = this.declareLocal(f.name, true, { fun: f });
    if (f.isSuspend) this.asyncFuns.add(f);
    const fnCtx = this.newFn('fun', f.isSuspend || this.asyncFuns.has(f), f, f.name);
    const code = this.inFn(fnCtx, () => {
      this.scope = new Scope(this.scope);
      let selfParam = '';
      if (f.extReceiver) {
        selfParam = '$this';
        this.receivers = [{ js: '$this', kind: 'ext', cls: this.userTypeOf(f.extReceiver), rt: this.rtTypeOf(f.extReceiver), label: f.name }, ...this.receivers];
      }
      const params = this.emitParams(f.params, null);
      const body = this.functionBody(f.body!, f.returnType);
      if (this.fn.usedAwait && !this.asyncFuns.has(f)) {
        this.asyncFuns.add(f);
      }
      const all = selfParam ? [selfParam, ...params] : params;
      return `${this.fn.usedAwait || this.asyncFuns.has(f) ? 'async ' : ''}(${all.join(', ')}) => {\n${indent(body)}\n}`;
    });
    this.emit(`const ${js} = ${code};`);
  }

  private localClass(n: Node): void {
    const c = this.prog.collectClass(n, this.file, null, true);
    c.jsName = `L_${c.name}$${++this.uid}`;
    this.scope.vars.set(c.name, { js: c.jsName, isVal: true });
    const savedCls = this.cls;
    const savedRecv = this.receivers;
    const savedOuter = this.outerThis;
    const ot = `$outer${++this.uid}`;
    this.emit(`const ${ot} = ${this.thisJs()};`);
    this.outerThis = ot;
    this.cls = c;
    this.receivers = [{ js: 'this', kind: 'class', cls: c, rt: null, label: c.name }, ...savedRecv.map((r) => (r.js === 'this' ? { ...r, js: ot } : r))];
    try {
      const code = c.kind === 'object' ? this.emitObjectDecl(c) : this.emitClassBody(c, c.jsName, false);
      this.emit(code);
      for (const l of this.linkLines.splice(0)) this.emit(l);
    } finally {
      this.cls = savedCls;
      this.receivers = savedRecv;
      this.outerThis = savedOuter;
    }
    this.localClasses.add(c);
  }

  private localClasses = new Set<ClassSym>();

  private thisJs(): string {
    const r = this.receivers.find((x) => x.kind === 'class' || x.kind === 'object');
    return r?.js ?? 'this';
  }

  private ifStmt(n: Node): void {
    const cond = this.cond(field(n, 'condition') ?? named(n)[0]!);
    const branches = this.ifBranches(n);
    const thenCode = this.block(this.bodyOf(branches.then));
    let code = `if (${cond}) {\n${indent(thenCode)}\n}`;
    if (branches.else) {
      if (branches.else.type === 'if_expression') {
        const saved = this.out;
        const lines: string[] = [];
        this.out = lines;
        this.ifStmt(branches.else);
        this.out = saved;
        code += ` else ${lines.join('\n')}`;
      } else code += ` else {\n${indent(this.block(this.bodyOf(branches.else)))}\n}`;
    }
    this.emit(code);
  }

  private ifBranches(n: Node): { then: Node | null; else: Node | null } {
    const cond = field(n, 'condition');
    let then: Node | null = null;
    let els: Node | null = null;
    let sawElse = false;
    for (const { n: c } of allChildren(n)) {
      if (c.type === 'else') {
        sawElse = true;
        continue;
      }
      if (!c.isNamed || c.id === cond?.id) continue;
      if (c.type === 'line_comment' || c.type === 'block_comment') continue;
      if (!sawElse && !then) then = c;
      else if (sawElse && !els) els = c;
    }
    // `if (x) else y` with empty then is rare; tolerate
    if (!then && !sawElse) then = null;
    return { then, else: els };
  }

  private cond(n: Node): string {
    return this.expr(n);
  }

  private returnStmt(n: Node): void {
    const label = field(n, 'label')?.text ?? named(n).find((c) => c.type === 'label')?.text?.replace(/^@|@$/g, '') ?? null;
    const labelId = field(n, 'label')?.id;
    const valueNode = named(n).find((c) => c.type !== 'label' && c.id !== labelId) ?? null;
    const labelName = label ? label.replace(/@/g, '') : null;
    const target = this.returnTarget(labelName);
    const v = valueNode ? this.expr(valueNode, target.fn?.fun?.returnType ?? null) : 'undefined';
    if (target.kind === 'direct') {
      this.emit(valueNode ? `return ${v};` : 'return;');
    } else {
      // non-local return out of inlined lambdas
      const f = target.fn!;
      if (!f.nlrToken) f.nlrToken = `$nlr${++this.uid}`;
      f.usedNlr = true;
      this.emit(`throw new $k.NonLocalReturn(${f.nlrToken}, ${v});`);
    }
  }

  private returnTarget(label: string | null): { kind: 'direct' | 'nonlocal'; fn: FnCtx | null } {
    let f: FnCtx | null = this.fn;
    if (label) {
      // find lambda/function with that label
      let cur: FnCtx | null = this.fn;
      let crossed = false;
      while (cur) {
        if (cur.label === label) return { kind: crossed ? 'nonlocal' : 'direct', fn: cur };
        if (cur.kind === 'lambda' && !cur.inline) break;
        crossed = true;
        cur = cur.parent;
      }
      this.fail(`unknown return label @${label}`);
    }
    // bare return: from the nearest named function, crossing inline lambdas
    let crossed = false;
    while (f && f.kind === 'lambda') {
      if (!f.inline) this.fail('return from non-inline lambda');
      crossed = true;
      f = f.parent;
    }
    return { kind: crossed ? 'nonlocal' : 'direct', fn: f };
  }

  /** break/continue, possibly out of an inline lambda (Kotlin 2.2 non-local jumps). */
  private jump(kind: string, label: string | null, n: Node): void {
    const loop = label ? [...this.loops].reverse().find((l) => l.label === label) : this.loops[this.loops.length - 1];
    if (!loop) this.fail(`${kind} outside of a loop`, n);
    if (kind === 'continue' && loop.noContinue) this.fail('continue in do-while whose condition uses body variables', n);
    if (loop.fn === this.fn) {
      this.emit(`${kind}${label ? ' ' + label : ''};`);
      return;
    }
    loop.token ??= `$loop${++this.uid}`;
    this.emit(`throw new $k.NonLocalJump(${loop.token}, ${JSON.stringify(kind)});`);
  }

  /** Compile a loop body with loop tracking; wraps it when non-local jumps target it. */
  private loopBody(label: string | null, body: Node | null, pre: string[] = []): string {
    const entry = { label, fn: this.fn, token: null as string | null };
    this.loops.push(entry);
    let code: string;
    try {
      code = [...pre, this.block(this.bodyOf(body))].filter(Boolean).join('\n');
    } finally {
      this.loops.pop();
    }
    if (!entry.token) return code;
    const lbl = label ?? `$L${++this.uid}`;
    this.pendingLoopLabel = lbl;
    return `const ${entry.token} = {};\ntry {\n${indent(code)}\n} catch ($j) {\n  if ($j instanceof $k.NonLocalJump && $j.token === ${entry.token}) { if ($j.kind === 'break') break ${lbl}; else continue ${lbl}; }\n  throw $j;\n}`;
  }

  private pendingLoopLabel: string | null = null;

  private loopLabel(label: string | null): string {
    const l = this.pendingLoopLabel ?? label;
    this.pendingLoopLabel = null;
    return l ? `${l}: ` : '';
  }

  private forStmt(n: Node, label: string | null): void {
    const parts = named(n);
    const vars = parts.find((p) => p.type === 'variable_declaration' || p.type === 'multi_variable_declaration');
    const body = parts[parts.length - 1];
    const iterNode = parts.find((p) => p.id !== vars?.id && p.id !== body.id && p.type !== 'annotation')!;
    const lbl = '';
    this.scope = new Scope(this.scope);
    // fast paths for numeric ranges
    const range = this.numericRange(iterNode);
    let head: string;
    if (range && vars?.type === 'variable_declaration') {
      const name = identOf(named(vars)[0] ?? null)!;
      const js = this.declareLocal(name, true);
      const step = range.step ?? '1';
      const endT = this.tmp();
      head = range.down
        ? `${lbl}for (let ${js} = ${range.from}, ${endT}$e = (${endT} = ${range.to}); ${js} ${range.inclusive ? '>=' : '>'} ${endT}; ${js} -= ${step})`
        : `${lbl}for (let ${js} = ${range.from}, ${endT}$e = (${endT} = ${range.to}); ${js} ${range.inclusive ? '<=' : '<'} ${endT}; ${js} += ${step})`;
      head = head.replace(`, ${endT}$e = (${endT} = ${range.to})`, '');
      this.emit(`${endT} = ${range.to};`);
    } else {
      const it = this.expr(iterNode);
      if (vars?.type === 'multi_variable_declaration') {
        const d = `$d${++this.uid}`;
        head = `${lbl}for (const ${d} of $k.iter(${it}))`;
        const pre: string[] = [];
        children(vars, 'variable_declaration').forEach((vd, i) => {
          const name = identOf(named(vd)[0] ?? null)!;
          if (name === '_') return;
          const js = this.declareLocal(name, true);
          pre.push(`const ${js} = $k.component(${d}, ${i + 1});`);
        });
        const code = this.loopBody(label, body, pre);
        this.scope = this.scope.parent!;
        this.emit(`${this.loopLabel(label)}${head} {\n${indent(code)}\n}`);
        return;
      }
      const name = vars ? identOf(named(vars)[0] ?? null)! : '_';
      const js = this.declareLocal(name, true);
      head = `${lbl}for (const ${js} of $k.iter(${it}))`;
    }
    const code = this.loopBody(label, body);
    this.scope = this.scope.parent!;
    this.emit(`${this.loopLabel(label)}${head} {\n${indent(code)}\n}`);
  }

  private numericRange(n: Node): { from: string; to: string; inclusive: boolean; down: boolean; step: string | null } | null {
    let step: string | null = null;
    let e = n;
    if (e.type === 'infix_expression' && named(e)[1]?.text === 'step') {
      step = this.expr(named(e)[2]!);
      e = named(e)[0]!;
      if (e.type === 'parenthesized_expression') e = named(e)[0]!;
    }
    if (e.type === 'range_expression') {
      const [a, b] = named(e);
      return { from: this.expr(a), to: this.expr(b), inclusive: !e.text.includes('..<'), down: false, step };
    }
    if (e.type === 'infix_expression') {
      const [a, op, b] = named(e);
      if (op?.text === 'until') return { from: this.expr(a), to: this.expr(b!), inclusive: false, down: false, step };
      if (op?.text === 'downTo') return { from: this.expr(a), to: this.expr(b!), inclusive: true, down: true, step };
    }
    if (e.type === 'navigation_expression' && named(e)[1]?.text === 'indices' && !step) {
      return { from: '0', to: `$k.prop(${this.expr(named(e)[0]!)}, 'size', ${this.extList('size', null)})`, inclusive: false, down: false, step: null };
    }
    return null;
  }

  private whileStmt(n: Node, label: string | null): void {
    const cond = field(n, 'condition') ?? named(n)[0]!;
    const body = named(n).filter((c) => c.id !== cond.id).pop() ?? null;
    // condition may need statements: evaluate inside loop
    const condLines: string[] = [];
    const saved = this.out;
    this.out = condLines;
    const c = this.expr(cond);
    this.out = saved;
    const code = this.loopBody(label, body);
    const lbl = this.loopLabel(label);
    if (condLines.length) this.emit(`${lbl}while (true) {\n${indent(condLines.join('\n'))}\n  if (!(${c})) break;\n${indent(code)}\n}`);
    else this.emit(`${lbl}while (${c}) {\n${indent(code)}\n}`);
  }

  private doWhileStmt(n: Node, label: string | null): void {
    const cond = field(n, 'condition') ?? named(n)[named(n).length - 1];
    const body = named(n).find((c) => c.id !== cond.id) ?? null;
    const declared = new Set(this.bodyOf(body).filter((x) => x.type === 'property_declaration').flatMap((x) => x.descendantsOfType('variable_declaration').map((v) => identOf(named(v!)[0] ?? null) ?? '')));
    const condUsesBody = cond.descendantsOfType('identifier').some((i) => i && declared.has(i.text)) || (cond.type === 'identifier' && declared.has(cond.text));
    if (condUsesBody) {
      // Kotlin's condition sees body locals: keep body and check in one JS block.
      const entry = { label, fn: this.fn, token: null as string | null, noContinue: true };
      this.loops.push(entry);
      const lines: string[] = [];
      const saved = this.out;
      this.out = lines;
      this.scope = new Scope(this.scope);
      try {
        this.stmts(this.bodyOf(body));
        const c = this.expr(cond);
        lines.push(`if (!(${c})) break;`);
      } finally {
        this.scope = this.scope.parent!;
        this.out = saved;
        this.loops.pop();
      }
      if (entry.token) this.fail('non-local jump into do-while with body-scoped condition', n);
      this.emit(`${label ? `${label}: ` : ''}while (true) {\n${indent(lines.join('\n'))}\n}`);
      return;
    }
    const code = this.loopBody(label, body);
    const savedLbl = this.pendingLoopLabel;
    this.pendingLoopLabel = null;
    const condLines: string[] = [];
    const saved = this.out;
    this.out = condLines;
    const c = this.expr(cond);
    this.out = saved;
    const lbl = savedLbl ?? label ? `${savedLbl ?? label}: ` : '';
    if (condLines.length) this.emit(`${lbl}while (true) {\n${indent(code)}\n${indent(condLines.join('\n'))}\n  if (!(${c})) break;\n}`);
    else this.emit(`${lbl}do {\n${indent(code)}\n} while (${c});`);
  }

  // ---------- assignment ----------

  private assignment(n: Node): void {
    const left = field(n, 'left') ?? named(n)[0]!;
    const op = field(n, 'operator')?.text ?? '=';
    const right = field(n, 'right') ?? named(n)[named(n).length - 1]!;
    if (left.type === 'index_expression') {
      const [arr, ...idx] = named(left);
      const a = this.spill(this.expr(arr));
      const ks = idx.map((i) => this.spill(this.expr(i)));
      if (op === '=') {
        this.emit(`$k.setAt(${a}, ${ks.join(', ')}, ${this.expr(right)});`);
      } else {
        const cur = `$k.getAt(${a}, ${ks.join(', ')})`;
        this.emit(`$k.setAt(${a}, ${ks.join(', ')}, ${this.binop(op.slice(0, -1), cur, this.expr(right), null, right)});`);
      }
      return;
    }
    const target = this.lvalue(left);
    if (op === '=') {
      target.set(this.expr(right));
      return;
    }
    const bop = op.slice(0, -1);
    const rv = this.expr(right);
    if ((bop === '+' || bop === '-') && target.isVal) {
      // val collection += x  -> plusAssign / minusAssign (mutation)
      this.emit(`$k.${bop === '+' ? 'plusAssign' : 'minusAssign'}(${target.get()}, ${rv});`);
      return;
    }
    if (bop === '+' || bop === '-') {
      target.set(`$k.${bop === '+' ? 'plusOrAssign' : 'minusOrAssign'}(${target.get()}, ${rv})`);
      return;
    }
    target.set(this.binop(bop, target.get(), rv, null, right));
  }

  /** Something assignable: returns getter/setter code builders. */
  private lvalue(n: Node): { get: () => string; set: (v: string) => void; isVal: boolean } {
    if (n.type === 'parenthesized_expression') return this.lvalue(named(n)[0]!);
    if (n.type === 'identifier') {
      const name = identOf(n)!;
      const r = this.resolveName(name, n);
      switch (r.k) {
        case 'local':
          return { get: () => r.local.js, set: (v) => this.emit(`${r.local.js} = ${v};`), isVal: r.local.isVal };
        case 'member':
          return { get: () => r.js, set: (v) => this.emit(`${r.js} = ${v};`), isVal: !!r.prop?.isVal };
        case 'dyn': {
          const recvs = `[${r.receivers.join(', ')}]`;
          return {
            get: () => `$k.iprop(${recvs}, ${JSON.stringify(name)}, ${this.extList(name, null, true)}, ${r.fallback ? `() => ${r.fallback}` : 'undefined'}, ${this.selfJs()})`,
            set: (v) => this.emit(`$k.isetProp(${recvs}, ${JSON.stringify(name)}, ${v}${r.fallback ? `, (v) => { ${r.fallback} = v; }` : ''});`),
            isVal: false,
          };
        }
        case 'topProp': {
          const js = this.topPropJs(r.prop);
          return { get: () => `${js}.value`, set: (v) => this.emit(`${js}.value = ${v};`), isVal: r.prop.isVal };
        }
        case 'companion':
          return { get: () => `${this.classJs(r.cls)}.${jsIdent(r.name)}`, set: (v) => this.emit(`${this.classJs(r.cls)}.${jsIdent(r.name)} = ${v};`), isVal: false };
        default:
          this.fail(`cannot assign to ${name}`, n);
      }
    }
    if (n.type === 'navigation_expression') {
      const [recvNode, memberNode] = named(n);
      const safe = hasToken(n, '?.');
      const name = identOf(memberNode) ?? this.fail('assignment target', n);
      const recv = this.spill(this.expr(recvNode));
      const extp = this.extPropCands(name);
      const userProp = this.anyUserProp(name);
      if (safe) {
        return {
          get: () => `(${recv} == null ? null : ${recv}.${name})`,
          set: (v) => this.emit(`if (${recv} != null) ${extp ? `$k.setProp(${recv}, ${JSON.stringify(name)}, ${extp}, ${v})` : `${recv}.${name} = ${v}`};`),
          isVal: !!userProp?.isVal,
        };
      }
      return {
        get: () => (extp ? `$k.prop(${recv}, ${JSON.stringify(name)}, ${extp}, ${this.selfJs()})` : `${recv}.${name}`),
        set: (v) => this.emit(extp ? `$k.setProp(${recv}, ${JSON.stringify(name)}, ${extp}, ${v});` : `${recv}.${name} = ${v};`),
        isVal: !!userProp?.isVal,
      };
    }
    this.fail(`unsupported assignment target ${n.type}`, n);
  }

  private anyUserProp(name: string): PropSym | null {
    for (const c of this.prog.allClasses) {
      const p = c.props.get(name);
      if (p) return p;
    }
    return null;
  }

  /** Evaluate an expression once into a temp if it is not trivially re-evaluable. */
  private spill(e: string): string {
    if (/^[\w$]+$/.test(e) || /^this(\.[\w$]+)?$/.test(e) || /^-?\d/.test(e) || /^"/.test(e)) return e;
    const t = this.tmp();
    this.emit(`${t} = ${e};`);
    return t;
  }

  // ======================================================================
  // expressions
  // ======================================================================

  /** Compile an expression; may emit statements before it. `expected` is a type hint. */
  expr(n: Node, expected: Node | null = null): string {
    const ov = this.override.get(n.id);
    if (ov) return this.expr(ov, expected);
    if (n.type === 'navigation_expression' || n.type === 'call_expression' || n.type === 'index_expression') {
      const head = this.prefixHead(n);
      if (head) {
        const op = head.op;
        if (head.left) {
          // `a + b.f<T>()` parsed as `(a + b.f)<T>()`: apply the chain to the right operand.
          const l = this.expr(head.left);
          this.override.set(head.node.id, head.arg);
          try {
            const inner = this.expr(n, expected);
            return this.binopNodes(op, l, inner, head.left, null);
          } finally {
            this.override.delete(head.node.id);
          }
        }
        this.override.set(head.node.id, head.arg);
        try {
          const inner = this.expr(n, expected);
          if (op === '!') return `!${inner}`;
          if (op === '-') return `$k.unaryMinus(${inner})`;
          if (op === '+') return inner;
          this.fail(`prefix ${op} on call chain`, n);
        } finally {
          this.override.delete(head.node.id);
        }
      }
    }
    switch (n.type) {
      case 'number_literal':
        return numberLit(n.text);
      case 'float_literal':
        return n.text.replace(/[_fFdD]/g, '').replace(/^\./, '0.');
      case 'character_literal':
        return JSON.stringify(charLit(n));
      case 'string_literal':
      case 'multiline_string_literal':
        return this.stringLit(n);
      case 'identifier':
        return this.identExpr(n);
      case 'parenthesized_expression':
        return `(${this.expr(named(n)[0]!, expected)})`;
      case 'this_expression':
        return this.thisExpr(n);
      case 'super_expression':
        return 'super';
      case 'navigation_expression':
        return this.navigation(n);
      case 'call_expression':
        return this.call(n, expected);
      case 'index_expression': {
        const [a, ...ks] = named(n);
        const recv = this.expr(a);
        const keys = ks.map((k) => this.expr(k));
        if (this.importedOperatorGet()) return `$k.call(${recv}, 'get', ${this.extList('get', null)}, [${keys.join(', ')}])`;
        return `$k.getAt(${recv}, ${keys.join(', ')})`;
      }
      case 'binary_expression':
        return this.binary(n);
      case 'unary_expression':
        return this.unary(n);
      case 'infix_expression':
        return this.infix(n);
      case 'range_expression': {
        const [a, b] = named(n);
        return n.text.includes('..<') ? `$k.until(${this.expr(a)}, ${this.expr(b)})` : `$k.rangeTo(${this.expr(a)}, ${this.expr(b)})`;
      }
      case 'is_expression': {
        const left = field(n, 'left') ?? named(n)[0]!;
        const right = field(n, 'right') ?? named(n)[1]!;
        const neg = n.text.includes('!is');
        return `${neg ? '!' : ''}$k.is(${this.expr(left)}, ${this.typeRefJs(right, right)})`;
      }
      case 'as_expression': {
        const left = field(n, 'left') ?? named(n)[0]!;
        const right = field(n, 'right') ?? named(n)[1]!;
        const safe = hasToken(n, 'as?');
        const v = this.expr(left, right);
        const tn = typeName(right);
        // Casts to generic/erased or builtin collection types are unchecked on the JVM too.
        if (!tn || this.cls?.typeParams.includes(tn) || this.fn.fun?.typeParams.includes(tn)) return v;
        if (!safe && BUILTIN_TYPES[tn]) return v;
        return `$k.asType(${v}, ${this.typeRefJs(right, right)}, ${safe})`;
      }
      case 'in_expression': {
        const [a, b] = named(n);
        const neg = n.text.includes('!in');
        return `${neg ? '!' : ''}$k.contains(${this.expr(b)}, ${this.expr(a)})`;
      }
      case 'if_expression':
        return this.ifExpr(n, expected);
      case 'when_expression':
        return this.when(n, true, expected);
      case 'try_expression':
        return this.tryExpr(n, true, expected);
      case 'lambda_literal':
        return this.lambda(n, { mode: 'plain', recv: false, label: null });
      case 'anonymous_function':
        return this.anonFun(n);
      case 'annotated_lambda':
        return this.lambda(named(n).find((x) => x.type === 'lambda_literal')!, { mode: 'plain', recv: false, label: null });
      case 'object_literal':
        return this.objectLiteral(n);
      case 'callable_reference':
        return this.callableRef(n);
      case 'return_expression':
        this.returnStmt(n);
        return 'undefined';
      case 'throw_expression':
        return `$k.throwIt(${this.expr(named(n)[0]!)})`;
      case 'collection_literal':
        return `[${named(n).map((x) => this.expr(x)).join(', ')}]`;
      case 'spread_expression':
        return `...${this.expr(named(n)[0]!)}`;
      case 'annotated_expression':
        return this.expr(named(n).filter((x) => x.type !== 'annotation').pop()!, expected);
      case 'labeled_expression': {
        const inner = named(n)[1];
        return inner ? this.expr(inner, expected) : 'undefined';
      }
      case 'assignment':
        this.assignment(n);
        return 'undefined';
      case 'for_statement':
      case 'while_statement':
      case 'do_while_statement':
        this.stmt(n);
        return 'undefined';
      case 'property_declaration':
        this.stmt(n);
        return 'undefined';
      default:
        this.fail(`unsupported expression ${n.type}`, n);
    }
  }

  private override = new Map<number, Node>();
  private loops: { label: string | null; fn: FnCtx; token: string | null; noContinue?: boolean }[] = [];
  private inFallback = false;
  /** name of the call whose arguments are being compiled (default lambda label) */
  private callName: string | null = null;

  /** tree-sitter-kotlin binds prefix `!`/`-` tighter than postfix calls; find such a head. */
  private prefixHead(n: Node): { node: Node; op: string; arg: Node; left?: Node } | null {
    let cur: Node | null = n;
    while (cur && (cur.type === 'navigation_expression' || cur.type === 'call_expression' || cur.type === 'index_expression')) {
      const first: Node | undefined = named(cur)[0];
      if (!first) return null;
      if (this.override.has(first.id)) return null;
      if (first.type === 'binary_expression') {
        const left = first.childForFieldName('left');
        const right = first.childForFieldName('right');
        const op = first.childForFieldName('operator')?.text ?? this.opToken(first);
        if (left && right) return { node: first, op, arg: right, left };
        return null;
      }
      if (first.type === 'unary_expression') {
        const opNode = first.childForFieldName('operator');
        const arg = first.childForFieldName('argument');
        if (opNode && arg && opNode.startIndex < arg.startIndex && ['!', '-', '+'].includes(opNode.text)) return { node: first, op: opNode.text, arg };
        return null;
      }
      cur = first;
    }
    return null;
  }

  private ovr(n: Node): Node {
    return this.override.get(n.id) ?? n;
  }

  private importedOperatorGet(): boolean {
    return this.file.imports.some((i) => i.fqn === 'keiyoushi.utils.get');
  }

  private thisExpr(n: Node): string {
    const lbl = identOf(named(n)[0] ?? null);
    if (!lbl) {
      const r = this.receivers[0];
      return r?.js ?? 'this';
    }
    const r = this.receivers.find((x) => x.label === lbl || x.cls?.name === lbl);
    if (r) return r.js;
    this.fail(`unknown this@${lbl}`, n);
  }

  private selfJs(): string {
    for (let f: FnCtx | null = this.fn; f; f = f.parent) {
      if (f.fun?.contextParams.length) return this.scope.lookup(f.fun.contextParams[0])?.js ?? this.thisJs();
    }
    return this.thisJs();
  }

  /** Value for an implicit context parameter: an enclosing context param, else the class `this`. */
  private contextArg(): string {
    for (let f: FnCtx | null = this.fn; f; f = f.parent) {
      if (f.fun?.contextParams.length) return this.scope.lookup(f.fun.contextParams[0])?.js ?? this.thisJs();
    }
    return this.thisJs();
  }

  // ---------- strings ----------

  private stringLit(n: Node): string {
    const parts = templateParts(n);
    if (parts.every((p) => 'lit' in p)) return JSON.stringify(parts.map((p) => (p as { lit: string }).lit).join(''));
    let out = '`';
    for (const p of parts) {
      if ('lit' in p) out += escTpl(p.lit);
      else if ('ident' in p) out += `\${$s(${this.resolvedValue(this.resolveName(p.ident, n), p.ident, n)})}`;
      else out += `\${$s(${this.expr(p.expr)})}`;
    }
    return out + '`';
  }

  // ---------- names ----------

  private identExpr(n: Node): string {
    const name = identOf(n)!;
    if (name === 'null') return 'null';
    if (name === 'true' || name === 'false') return name;
    if (name === 'Unit') return 'undefined';
    if (name === 'javaClass' && !this.scope.lookup(name)) return `$k.kclass(${this.thisJs()}, $loader).java`;
    if (name === 'break' || name === 'continue') {
      const lbl = named(n.parent ?? n).find((x) => x.type === 'label');
      this.jump(name, lbl ? lbl.text.replace(/@/g, '') : null, n);
      return 'undefined';
    }
    if (name === 'it' && !this.scope.lookup('it')) this.fail("'it' outside of a lambda", n);
    const r = this.resolveName(name, n);
    return this.resolvedValue(r, name, n);
  }

  private resolvedValue(r: Resolved, name: string, n: Node): string {
    switch (r.k) {
      case 'local':
        return r.local.js;
      case 'member':
        return r.js;
      case 'dyn':
        return `$k.iprop([${r.receivers.join(', ')}], ${JSON.stringify(name)}, ${this.extList(name, null, true)}, ${r.fallback ? `() => ${r.fallback}` : 'undefined'}, ${this.selfJs()})`;
      case 'userClass': {
        // A class used as a value: its companion object (Kotlin) or the class itself for statics.
        const c = r.cls;
        if (c.kind === 'object' || c.kind === 'companion') return this.classJs(c);
        if (c.kind === 'enum') return c.jsName;
        if (c.companion) return `${c.jsName}.$companion`;
        return c.jsName;
      }
      case 'rt':
        return r.js;
      case 'topProp':
        return r.prop.extReceiver ? this.fail('extension property used without receiver', n) : `${this.topPropJs(r.prop)}.value`;
      case 'topFun':
        return r.funs[0].jsName;
      case 'companion':
        return `${this.classJs(r.cls)}.${jsIdent(r.name)}`;
    }
  }

  /** Resolve an unqualified name (not a call). */
  resolveName(name: string, n: Node | null): Resolved {
    const local = this.scope.lookup(name);
    if (local) return { k: 'local', local };
    // implicit receivers (innermost first)
    const dynRecv: string[] = [];
    for (const r of this.receivers) {
      if (r.cls) {
        const p = this.findProp(r.cls, name);
        if (p && !p.extReceiver) {
          if (dynRecv.length) return { k: 'dyn', receivers: dynRecv, name, fallback: `${r.js}.${p.jsName}` };
          return { k: 'member', js: `${r.js}.${p.jsName}`, cls: r.cls, name, prop: p, funs: null };
        }
        if (this.rtMembers(r.cls).has(name)) {
          if (dynRecv.length) return { k: 'dyn', receivers: dynRecv, name, fallback: `${r.js}.${name}` };
          return { k: 'member', js: `${r.js}.${name}`, cls: r.cls, name, prop: null, funs: null };
        }
        // companion members visible inside the class
        const comp = this.companionMember(r.cls, name);
        if (comp) return comp;
        if (r.kind === 'class' || r.kind === 'object') continue;
      } else if (r.rt !== null && r.rt !== undefined) {
        if (this.rt.members(r.rt).has(name)) {
          if (dynRecv.length) return { k: 'dyn', receivers: dynRecv, name, fallback: `${r.js}.${name}` };
          return { k: 'member', js: `${r.js}.${name}`, cls: null, name, prop: null, funs: null };
        }
        continue;
      } else {
        dynRecv.push(r.js);
      }
    }
    // static scope: classes/objects, top-level props, imports, defaults
    const s = this.resolveStatic(name, n);
    if (dynRecv.length) {
      const fb = s ? this.resolvedValue(s, name, n!) : null;
      return { k: 'dyn', receivers: dynRecv, name, fallback: fb };
    }
    if (s) return s;
    if (process.env.KANSO_LENIENT && !this.inFallback) {
      this.warn(`unresolved name ${name}`, n);
      return { k: 'rt', fqn: `$missing.${name}`, value: undefined, js: `$k.missing(${JSON.stringify(name)})` };
    }
    this.fail(`unresolved name ${name}`, n);
  }

  private companionMember(c: ClassSym, name: string): Resolved | null {
    for (let x: ClassSym | null = c; x; x = x.outer) {
      const seen = new Set<ClassSym>();
      for (let s: ClassSym | null = x; s && !seen.has(s); s = this.userSuper(s)) {
        seen.add(s);
        const comp = s.companion;
        if (comp && (comp.props.has(name) || comp.funs.has(name))) return { k: 'companion', cls: comp, name };
        if (s.kind === 'object' && s !== c && (s.props.has(name) || s.funs.has(name))) return { k: 'companion', cls: s, name };
        // enum entries are accessible unqualified inside the enum
        if (s.kind === 'enum' && s.enumEntries.some((e) => identOf(named(e).find((q) => q.type === 'identifier') ?? null) === name)) {
          return { k: 'rt', fqn: '', value: null, js: `${s.jsName}.${name}` };
        }
      }
    }
    return null;
  }

  private resolveStatic(name: string, n: Node | null): Resolved | null {
    const t = this.resolveType(name, { file: this.file, cls: this.cls });
    const pkg = this.prog.packages.get(this.file.pkg);
    const topProp = pkg?.props.get(name);
    if (topProp) return { k: 'topProp', prop: topProp };
    // explicitly imported top-level props/functions from user packages
    for (const imp of this.file.imports) {
      if (imp.star) continue;
      const simple = imp.alias ?? imp.fqn.split('.').pop();
      if (simple !== name) continue;
      const pkgName = imp.fqn.split('.').slice(0, -1).join('.');
      const up = this.prog.packages.get(pkgName);
      if (up?.props.get(imp.fqn.split('.').pop()!)) return { k: 'topProp', prop: up.props.get(imp.fqn.split('.').pop()!)! };
      if (up?.funs.get(imp.fqn.split('.').pop()!)) return { k: 'topFun', funs: up.funs.get(imp.fqn.split('.').pop()!)! };
      // companion/object member import: pkg.Cls.member
      const ownerFqn = imp.fqn.split('.').slice(0, -1).join('.');
      const owner = this.prog.classesByFqn.get(ownerFqn);
      if (owner) {
        const target = owner.kind === 'object' || owner.kind === 'companion' ? owner : owner.companion;
        if (target) return { k: 'companion', cls: target, name: imp.fqn.split('.').pop()! };
      }
    }
    if (t?.user) return { k: 'userClass', cls: t.user };
    if (t?.rt) {
      if (isAnnotation(t.rt.value)) return null;
      return { k: 'rt', fqn: t.rt.fqn, value: t.rt.value, js: this.rtValueJs(t.rt.fqn) };
    }
    // star-imported user package members
    for (const imp of this.file.imports) {
      if (!imp.star) continue;
      const up = this.prog.packages.get(imp.fqn);
      if (up?.props.get(name)) return { k: 'topProp', prop: up.props.get(name)! };
    }
    // explicit runtime imports of values (functions, objects)
    for (const imp of this.file.imports) {
      if (imp.star) continue;
      const simple = imp.alias ?? imp.fqn.split('.').pop();
      if (simple === name && this.rt.has(imp.fqn)) {
        const v = this.rt.value(imp.fqn);
        if (isAnnotation(v)) return null;
        return { k: 'rt', fqn: imp.fqn, value: v, js: this.rtRef(imp.fqn) };
      }
    }
    for (const imp of this.file.imports) {
      if (!imp.star) continue;
      const fq = `${imp.fqn}.${name}`;
      if (this.rt.has(fq)) return { k: 'rt', fqn: fq, value: this.rt.value(fq), js: this.rtRef(fq) };
    }
    if (pkg?.funs.get(name)) return { k: 'topFun', funs: pkg.funs.get(name)! };
    if (this.rt.hasDefault(name)) return { k: 'rt', fqn: `$default.${name}`, value: this.rt.defaultValue(name), js: this.defaultRef(name) };
    void n;
    return null;
  }

  // ---------- extension candidates ----------

  /** Candidate list (hoisted const) for extension function/property `name`. */
  extList(name: string, _n: Node | null, propOnly = false): string {
    const parts: string[] = [];
    const keyParts: string[] = [];
    // user extensions in scope: member extensions of enclosing classes, top-level of package & imports
    for (const r of this.receivers) {
      if (!r.cls) continue;
      for (const f of this.findFuns(r.cls, name)) {
        if (!f.extReceiver || propOnly) continue;
        const pred = this.predFor(f.extReceiver);
        parts.push(`{ name: ${JSON.stringify(name)}, recv: ${pred}, member: ${JSON.stringify(f.jsName)} }`);
        keyParts.push(`m:${f.jsName}:${pred}`);
      }
      // member extensions declared in companion objects of this class and its outers/supers
      for (const comp of this.companionsOf(r.cls)) {
        if (propOnly) break;
        for (const f of comp.funs.get(name) ?? []) {
          if (!f.extReceiver) continue;
          const pred = this.predFor(f.extReceiver);
          parts.push(`{ name: ${JSON.stringify(name)}, recv: ${pred}, fn: (r, ...a) => ${this.classJs(comp)}.${f.jsName}(r, ...a) }`);
          keyParts.push(`c:${comp.fqn}:${f.jsName}`);
        }
      }
      if (!propOnly && this.rtMembers(r.cls).has(`${name}$ext`)) {
        parts.push(`{ name: ${JSON.stringify(name)}, recv: $k.ANY, member: ${JSON.stringify(`${name}$ext`)} }`);
        keyParts.push(`rm:${name}`);
      }
      const p = this.findProp(r.cls, `${name}$extp`);
      if (p) {
        const pred = this.predFor(p.extReceiver!);
        parts.push(`{ name: ${JSON.stringify(name)}, recv: ${pred}, member: ${JSON.stringify(p.jsName)}, prop: true }`);
        keyParts.push(`mp:${p.jsName}`);
      }
    }
    for (const fsym of this.userTopExts(name)) {
      if (propOnly && fsym.kind === 'fun') continue;
      const recvNode = fsym.extReceiver!;
      const pred = this.predFor(recvNode);
      const fnJs = fsym.kind === 'fun' ? fsym.jsName : this.topPropJs(fsym);
      const ctx = fsym.kind === 'fun' && fsym.contextParams.length ? ', ctx: true' : '';
      parts.push(`{ name: ${JSON.stringify(name)}, recv: ${pred}, fn: ${fnJs}${fsym.kind === 'prop' ? ', prop: true' : ''}${ctx} }`);
      keyParts.push(`t:${fnJs}`);
    }
    // runtime: explicit imports, star imports, then stdlib defaults
    const rtFqns: string[] = [];
    for (const imp of this.file.imports) {
      if (imp.star) {
        const fq = `${imp.fqn}.${name}`;
        if (this.rt.has(fq) && isExtList(this.rt.value(fq))) rtFqns.push(fq);
        continue;
      }
      const simple = imp.alias ?? imp.fqn.split('.').pop();
      if (simple === name && this.rt.has(imp.fqn) && isExtList(this.rt.value(imp.fqn))) rtFqns.push(imp.fqn);
    }
    for (const fq of rtFqns) {
      parts.push(`...${this.rtRef(fq)}`);
      keyParts.push(`r:${fq}`);
    }
    if (this.rt.hasDefaultExt(name)) {
      parts.push(`...$rt.S[${JSON.stringify(name)}]`);
      keyParts.push(`s:${name}`);
    }
    const key = `x:${name}:${keyParts.join('|')}`;
    // member candidates depend on `this`-relative names only, safe to hoist
    return this.hoist(key, `X_${name}`, () => `[${parts.join(', ')}]`);
  }

  private userTopExts(name: string): (FunSym | PropSym)[] {
    const out: (FunSym | PropSym)[] = [];
    const pkgs = new Set<string>([this.file.pkg]);
    for (const imp of this.file.imports) {
      if (imp.star) pkgs.add(imp.fqn);
      else if ((imp.alias ?? imp.fqn.split('.').pop()) === name) pkgs.add(imp.fqn.split('.').slice(0, -1).join('.'));
    }
    for (const p of pkgs) {
      const pkg = this.prog.packages.get(p);
      if (!pkg) continue;
      for (const f of pkg.funs.get(name) ?? []) if (f.extReceiver) out.push(f);
      const prop = pkg.props.get(`${name}$extp`);
      if (prop) out.push(prop);
    }
    return out;
  }

  /** Does any extension (user/imported/stdlib) named `name` exist here? */
  private hasExt(name: string, propOnly = false): boolean {
    for (const r of this.receivers) {
      if (!r.cls) continue;
      if (!propOnly && this.findFuns(r.cls, name).some((f) => f.extReceiver)) return true;
      if (!propOnly && this.companionsOf(r.cls).some((c) => (c.funs.get(name) ?? []).some((f) => f.extReceiver))) return true;
      if (!propOnly && this.rtMembers(r.cls).has(`${name}$ext`)) return true;
      if (this.findProp(r.cls, `${name}$extp`)) return true;
    }
    if (this.userTopExts(name).some((x) => !propOnly || x.kind === 'prop')) return true;
    for (const imp of this.file.imports) {
      const fq = imp.star ? `${imp.fqn}.${name}` : imp.fqn;
      if (!imp.star && (imp.alias ?? imp.fqn.split('.').pop()) !== name) continue;
      const v = this.rt.has(fq) ? this.rt.value(fq) : undefined;
      if (isExtList(v) && (!propOnly || v.some((e) => e.prop))) return true;
    }
    const d = this.rt.defaultExts(name);
    return propOnly ? d.some((e) => e.prop) : d.length > 0;
  }

  private extPropCands(name: string): string | null {
    return this.hasExt(name, true) ? this.extList(name, null, true) : null;
  }

  /** Metadata about runtime candidates for `name` in this file. */
  private rtCands(name: string): ExtLike[] {
    const out: ExtLike[] = [];
    for (const imp of this.file.imports) {
      const fq = imp.star ? `${imp.fqn}.${name}` : imp.fqn;
      if (!imp.star && (imp.alias ?? imp.fqn.split('.').pop()) !== name) continue;
      const v = this.rt.has(fq) ? this.rt.value(fq) : undefined;
      if (isExtList(v)) out.push(...v);
    }
    out.push(...this.rt.defaultExts(name));
    return out;
  }

  /** Companion objects (and enclosing objects) whose members are visible inside class c. */
  private companionsOf(c: ClassSym): ClassSym[] {
    const out: ClassSym[] = [];
    for (let x: ClassSym | null = c; x; x = x.outer) {
      const seen = new Set<ClassSym>();
      for (let s: ClassSym | null = x; s && !seen.has(s); s = this.userSuper(s)) {
        seen.add(s);
        if (s.companion && !out.includes(s.companion)) out.push(s.companion);
      }
    }
    return out;
  }

  private userExtFuns(name: string): FunSym[] {
    const out: FunSym[] = [];
    for (const r of this.receivers) if (r.cls) out.push(...this.findFuns(r.cls, name).filter((f) => f.extReceiver), ...this.companionsOf(r.cls).flatMap((c) => (c.funs.get(name) ?? []).filter((f) => f.extReceiver)));
    out.push(...(this.userTopExts(name).filter((x) => x.kind === 'fun') as FunSym[]));
    return out;
  }

  /** JS predicate expression for an extension receiver type. */
  predFor(t: Node): string {
    const nullable = t.type === 'nullable_type';
    const inner = nullable ? named(t)[0]! : t;
    const name = typeName(inner);
    let p: string;
    if (!name || this.cls?.typeParams.includes(name)) p = '$k.ANY';
    else if (BUILTIN_TYPES[name]) p = `$k.KTypes.${BUILTIN_TYPES[name]}`;
    else {
      const r = this.resolveType(name, { file: this.file, cls: this.cls });
      if (r?.user) p = this.hoist(`pred:${r.user.fqn}`, `is_${r.user.name}`, () => `(x) => $k.is(x, ${this.classJs(r.user!)})`);
      else if (r?.rt) p = this.hoist(`pred:${r.rt.fqn}`, `is_${name.replace(/\W/g, '_')}`, () => `(x) => $k.is(x, ${this.rtValueJs(r.rt!.fqn)})`);
      else p = '$k.ANY';
    }
    return nullable ? this.hoist(`predn:${p}`, 'isn', () => `(x) => x == null || ${p}(x)`) : p;
  }

  private userTypeOf(t: Node | null): ClassSym | null {
    const name = typeName(t);
    if (!name) return null;
    return this.resolveType(name, { file: this.file, cls: this.cls })?.user ?? null;
  }

  private rtTypeOf(t: Node | null): any {
    const name = typeName(t);
    if (!name) return null;
    const r = this.resolveType(name, { file: this.file, cls: this.cls });
    return r?.rt && isRuntimeClass(r.rt.value) ? r.rt.value : null;
  }

  // ---------- navigation (a.b, a?.b, A.B static) ----------

  private navigation(n: Node): string {
    const parts = named(n);
    const recvNode = this.ovr(parts[0]);
    const memberNode = parts[parts.length - 1];
    const safe = hasToken(n, '?.');
    // callable reference forms are parsed elsewhere; `A::b` comes as navigation with '::'
    if (hasToken(n, '::')) return this.callableRefNav(n);
    const name = identOf(memberNode) ?? memberNode.text;
    // static / qualified access: Type.member, package.Type
    const qual = this.qualifiedStatic(n);
    if (qual) return qual;
    if (recvNode.type === 'super_expression') return `super.${name}`;
    const recv = this.expr(recvNode);
    return this.memberAccess(recv, name, safe, n);
  }

  private memberAccess(recv: string, name: string, safe: boolean, n: Node): string {
    if (name === 'javaClass') return `$k.kclass(${recv}, $loader).java`;
    const extp = this.extPropCands(name);
    if (safe) {
      const t = this.tmp();
      return `((${t} = ${recv}) == null ? null : ${extp ? `$k.prop(${t}, ${JSON.stringify(name)}, ${extp}, ${this.selfJs()})` : `${t}.${jsProp(name)}`})`;
    }
    void n;
    if (extp) return `$k.prop(${recv}, ${JSON.stringify(name)}, ${extp}, ${this.selfJs()})`;
    return `${recv}.${jsProp(name)}`;
  }

  /** `Foo.BAR`, `Foo.Companion.x`, `kotlin.math.PI`, enum entries, nested classes. */
  private qualifiedStatic(n: Node): string | null {
    const chain = this.identChain(n);
    if (!chain) return null;
    // a local or member shadows types
    if (this.scope.lookup(chain[0])) return null;
    for (const r of this.receivers) {
      if (r.cls && (this.findProp(r.cls, chain[0]) || this.rtMembers(r.cls).has(chain[0]))) return null;
    }
    // longest prefix that names a type
    for (let i = chain.length - 1; i >= 1; i--) {
      const typeStr = chain.slice(0, i).join('.');
      const t = this.resolveType(typeStr, { file: this.file, cls: this.cls });
      if (!t) continue;
      const rest = chain.slice(i);
      if (t.user) return this.staticMember(t.user, rest, n);
      if (t.rt) {
        if (isAnnotation(t.rt.value)) return null;
        // runtime: member FQN in table, else property access on the value
        const fq = `${t.rt.fqn}.${rest.join('.')}`;
        if (!t.rt.fqn.startsWith('$default.') && this.rt.has(fq)) return this.rtRef(fq);
        let js = this.rtValueJs(t.rt.fqn);
        for (const r of rest) js += r === 'Companion' ? '' : `.${jsProp(r)}`;
        return js;
      }
      if (t.builtin) return null;
    }
    return null;
  }

  private staticMember(c: ClassSym, rest: string[], n: Node): string {
    let cur: ClassSym = c;
    let js = this.classJs(c);
    for (let i = 0; i < rest.length; i++) {
      const r = rest[i];
      if (r === 'Companion' && cur.companion) {
        cur = cur.companion;
        js = this.classJs(cur);
        continue;
      }
      const nested = cur.nested.get(r);
      if (nested) {
        cur = nested;
        js = this.classJs(nested);
        continue;
      }
      if (cur.kind === 'enum' && cur.enumEntries.some((e) => identOf(named(e).find((q) => q.type === 'identifier') ?? null) === r)) {
        js = `${cur.jsName}.${r}`;
        return rest.slice(i + 1).reduce((acc, x) => `${acc}.${jsProp(x)}`, js);
      }
      // companion member
      const target = cur.kind === 'object' || cur.kind === 'companion' ? cur : cur.companion;
      if (target && (target.props.has(r) || target.funs.has(r))) {
        js = `${this.classJs(target)}.${jsProp(r)}`;
        return rest.slice(i + 1).reduce((acc, x) => `${acc}.${jsProp(x)}`, js);
      }
      if (cur.kind === 'enum' && (r === 'entries' || r === 'values')) return `${cur.jsName}.${r}`;
      this.fail(`unknown static member ${cur.name}.${r}`, n);
    }
    return js;
  }

  /** a.b.c of plain identifiers -> ['a','b','c'] */
  private identChain(n0: Node): string[] | null {
    const n = this.ovr(n0);
    if (n.type === 'identifier') return [identOf(n)!];
    if (n.type === 'navigation_expression' && !hasToken(n, '?.') && !hasToken(n, '::')) {
      const p = named(n);
      const head = this.identChain(p[0]);
      const tail = identOf(p[p.length - 1]);
      if (head && tail) return [...head, tail];
    }
    return null;
  }

  // ---------- calls ----------

  private call(n: Node, expected: Node | null): string {
    const parts = named(n);
    const callee = this.ovr(parts[0]);
    const typeArgsNode = parts.find((p) => p.type === 'type_arguments') ?? null;
    const va = parts.find((p) => p.type === 'value_arguments') ?? null;
    const lambdaNode = parts.find((p) => p.type === 'annotated_lambda') ?? null;
    const typeArgs = typeArgsNode ? children(typeArgsNode, 'type_projection').map((p) => named(p)[0]).filter((x): x is Node => !!x) : [];

    // f(...)(...) / expr(...)
    if (callee.type === 'call_expression' || callee.type === 'parenthesized_expression' || callee.type === 'lambda_literal' || callee.type === 'index_expression') {
      // call_expression whose callee is itself a call with trailing lambda: foo(x) { }
      if (callee.type === 'call_expression' && lambdaNode && !va) return this.callWithExtraLambda(callee, lambdaNode, expected);
      const f = this.expr(callee);
      const args = va ? this.callArgs(va, null, null, null) : [];
      if (lambdaNode) args.push(this.lambda(this.lambdaOf(lambdaNode), { mode: 'plain', recv: false, label: null }));
      return `$k.invoke(${f}, ${args.join(', ')})`;
    }

    if (callee.type === 'navigation_expression') return this.methodCall(n, callee, va, lambdaNode, typeArgs, expected);
    if (callee.type === 'identifier') return this.plainCall(n, identOf(callee)!, va, lambdaNode, typeArgs, expected);
    if (callee.type === 'this_expression' || callee.type === 'super_expression') this.fail('this()/super() call', n);
    if (callee.type === 'callable_reference') {
      const f = this.expr(callee);
      return `$k.invoke(${f}, ${(va ? this.callArgs(va, null, null, null) : []).join(', ')})`;
    }
    this.fail(`unsupported call target ${callee.type}`, n);
  }

  private callWithExtraLambda(inner: Node, lambdaNode: Node, expected: Node | null): string {
    // tree-sitter nests `foo<T>(a) { }` as call(call(foo, args), lambda) in some cases
    void expected;
    const innerParts = named(inner);
    const calleeNode = innerParts[0];
    const va = innerParts.find((p) => p.type === 'value_arguments') ?? null;
    const typeArgsNode = innerParts.find((p) => p.type === 'type_arguments') ?? null;
    const typeArgs = typeArgsNode ? children(typeArgsNode, 'type_projection').map((p) => named(p)[0]).filter((x): x is Node => !!x) : [];
    if (calleeNode.type === 'identifier') return this.plainCall(inner, identOf(calleeNode)!, va, lambdaNode, typeArgs, null);
    if (calleeNode.type === 'navigation_expression') return this.methodCall(inner, calleeNode, va, lambdaNode, typeArgs, null);
    const f = this.expr(inner);
    return `$k.invoke(${f}, ${this.lambda(this.lambdaOf(lambdaNode), { mode: 'plain', recv: false, label: null })})`;
  }

  private lambdaOf(al: Node): Node {
    return named(al).find((x) => x.type === 'lambda_literal') ?? this.fail('annotated lambda without lambda', al);
  }

  /** Unqualified call: foo(...) */
  private plainCall(n: Node, name: string, va: Node | null, lambdaNode: Node | null, typeArgs: Node[], expected: Node | null): string {
    const prevName = this.callName;
    this.callName = name;
    try {
      return this.plainCall0(n, name, va, lambdaNode, typeArgs, expected);
    } finally {
      this.callName = prevName;
    }
  }

  private plainCall0(n: Node, name: string, va: Node | null, lambdaNode: Node | null, typeArgs: Node[], expected: Node | null): string {
    // local function or local value of function type
    const local0 = this.scope.lookup(name);
    const local = local0 && (local0.fun || local0.invokable !== false) ? local0 : null;
    if (local) {
      if (local.fun) {
        const args = this.callArgs(va, lambdaNode, local.fun.params, this.lambdaModesFor(local.fun));
        const call = `${local.js}(${args.join(', ')})`;
        return this.awaitUser(local.fun) ? this.awaitIt(call, n) : call;
      }
      const args = this.callArgs(va, lambdaNode, null, local.recvLambda ? { recv: true, mode: "plain", label: null } : null);
      return `$k.invoke(${local.js}, ${args.join(', ')})`;
    }

    // implicit-receiver members (class, ext receiver, lambda receivers)
    const dynRecv: string[] = [];
    let firstType: { user?: ClassSym; rt?: any } | null = null;
    for (const r of this.receivers) {
      if (r.cls) {
        const funs = this.findFuns(r.cls, name).filter((f) => !f.extReceiver);
        if (funs.length) {
          const f = this.pickOverload(funs, va, lambdaNode);
          const args = this.withReified(f, this.callArgs(va, lambdaNode, f.params, this.lambdaModesFor(f)), typeArgs, expected, n);
          const callJs = `${r.js}.${funs.length > 1 && new Set(funs.map((x) => x.jsName)).size > 1 ? name : f.jsName}(${args.join(', ')})`;
          const awaited = this.awaitUser(f) ? this.awaitIt(callJs, n) : callJs;
          return dynRecv.length ? this.dynCall(dynRecv, name, va, lambdaNode, typeArgs, () => awaited, n) : awaited;
        }
        const prop = this.findProp(r.cls, name);
        if (prop && !prop.extReceiver) {
          // property of function type invoked
          const args = this.callArgs(va, lambdaNode, null, null);
          return `$k.invoke(${r.js}.${prop.jsName}, ${args.join(', ')})`;
        }
        // member extension with implicit receiver from an outer receiver (e.g. inside another ext fn)
        if (this.rtMembers(r.cls).has(name)) {
          const rtc = this.rtSuper(r.cls)!.value as any;
          const isAsync = this.rtMethodIsAsync(rtc, name);
          const args = this.callArgs(va, lambdaNode, null, null);
          const callJs = `${r.js}.${name}(${args.join(', ')})`;
          const v = isAsync ? this.awaitIt(callJs, n) : callJs;
          return dynRecv.length ? this.dynCall(dynRecv, name, va, lambdaNode, typeArgs, () => v, n) : v;
        }
        const comp = this.companionMember(r.cls, name);
        if (comp && comp.k === 'companion') {
          const target = comp.cls;
          const funs = target.funs.get(name) ?? [];
          const f = funs.length ? this.pickOverload(funs, va, lambdaNode) : null;
          const args = this.callArgs(va, lambdaNode, f?.params ?? null, f ? this.lambdaModesFor(f) : null);
          const callJs = `${this.classJs(target)}.${f?.jsName ?? name}(${args.join(', ')})`;
          return f && this.awaitUser(f) ? this.awaitIt(callJs, n) : callJs;
        }
        if (r.kind === 'class' || r.kind === 'object') {
          // user (or runtime member) extension functions whose receiver is this class (implicit this)
          if (this.userExtFuns(name).length || this.rtMembers(r.cls).has(`${name}$ext`)) {
            const args = this.callArgs(va, lambdaNode, null, null);
            const callJs = `$k.icall([${[...dynRecv, r.js].join(', ')}], ${JSON.stringify(name)}, ${this.extList(name, n)}, [${args.join(', ')}], undefined, ${this.selfJs()})`;
            return this.userExtFuns(name).some((f) => this.awaitUser(f)) ? this.awaitIt(callJs, n) : callJs;
          }
          continue;
        }
      } else if (r.rt) {
        if (this.rt.members(r.rt).has(name)) {
          const args = this.callArgs(va, lambdaNode, null, null);
          const callJs = `${r.js}.${name}(${args.join(', ')})`;
          const v = this.rtMethodIsAsync(r.rt, name) ? this.awaitIt(callJs, n) : callJs;
          return dynRecv.length ? this.dynCall(dynRecv, name, va, lambdaNode, typeArgs, () => v, n) : v;
        }
        // extension with receiver = this ext receiver
        if (this.hasExt(name)) {
          if (!dynRecv.length) firstType = { rt: r.rt };
          dynRecv.push(r.js);
          continue;
        }
      } else {
        dynRecv.push(r.js);
      }
    }

    const staticCall = () => this.staticCall(n, name, va, lambdaNode, typeArgs, expected);
    if (dynRecv.length) {
      // Unknown receiver types: decide at runtime, falling back to static resolution.
      return this.dynCall(dynRecv, name, va, lambdaNode, typeArgs, staticCall, n, firstType);
    }
    return staticCall();
  }

  private rtMethodIsAsync(cls: any, name: string): boolean {
    let p = cls?.prototype;
    while (p && p !== Object.prototype) {
      const d = Object.getOwnPropertyDescriptor(p, name);
      if (d && typeof d.value === 'function') return d.value.constructor?.name === 'AsyncFunction';
      p = Object.getPrototypeOf(p);
    }
    return false;
  }

  /** Call through implicit receivers whose types are unknown at compile time. */
  private dynCall(recvs: string[], name: string, va: Node | null, lambdaNode: Node | null, typeArgs: Node[], fallback: (() => string) | null, n: Node, recvType: { user?: ClassSym; rt?: any } | null = null): string {
    const rtc = this.rtCands(name);
    const userExt = this.userExtFuns(name);
    const recvLambda = rtc.some((c) => c.recvLambda);
    const inline = rtc.some((c) => !!c.async || !!c.inline);
    const suspendLambda = rtc.some((c) => c.suspendLambda);
    const mode: LambdaMode = inline ? 'inline' : suspendLambda ? 'suspend' : 'plain';
    const extRecvType = rtc.find((c: any) => c.recvType) as any;
    const args = this.callArgs(va, lambdaNode, null, { recv: recvLambda, mode, label: name, recvType: extRecvType ? { rt: extRecvType.recvType } : recvType });
    const reified = rtc.find((c) => c.reified);
    if (reified && typeArgs.length) args.push(reified.reified === 'desc' ? this.typeDesc(typeArgs[0]) : this.typeRefJs(typeArgs[0], typeArgs[0]));
    let fb = 'undefined';
    if (fallback) {
      const lines: string[] = [];
      const saved = this.out;
      this.out = lines;
      let code: string | null = null;
      const prevFb = this.inFallback;
      const prevAwait = this.fn.usedAwait;
      this.fn.usedAwait = false;
      this.inFallback = true;
      let fbAwait = false;
      try {
        code = fallback();
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        code = null;
      } finally {
        this.inFallback = prevFb;
        fbAwait = this.fn.usedAwait;
        this.fn.usedAwait = prevAwait || fbAwait;
      }
      this.out = saved;
      if (code !== null) {
        const awaitsInFallback = fbAwait || /^\(await\b/.test(code.trim());
        fb = `${awaitsInFallback ? 'async ' : ''}() => { ${lines.join(' ')} return ${code}; }`;
      }
    }
    const lambdaAsync = mode === 'inline' && args.some((a) => a.startsWith('async '));
    const fnName = lambdaAsync ? 'icallAsync' : 'icall';
    const callJs = `$k.${fnName}([${recvs.join(', ')}], ${JSON.stringify(name)}, ${this.extList(name, n)}, [${args.join(', ')}], ${fb}, ${this.selfJs()})`;
    const can = this.fn.canAwait || this.inlineChainCanAwait();
    const needsAwait = lambdaAsync || (can && rtc.some((c) => c.suspend)) || rtc.some((c) => c.infect) || userExt.some((f) => this.awaitUser(f)) || fb.startsWith('async') || (can && this.rt.suspendMembers.has(name));
    return needsAwait ? this.awaitIt(callJs, n) : callJs;
  }

  /** Calls to top-level/static functions, constructors and runtime functions. */
  private staticCall(n: Node, name: string, va: Node | null, lambdaNode: Node | null, typeArgs: Node[], expected: Node | null): string {
    // stdlib inline builders: buildList, with, run, repeat, runCatching...
    if (this.rt.isHofBuilder(name) && !this.userShadows(name)) {
      const recv = ['buildList', 'buildSet', 'buildMap', 'buildString', 'with'].includes(name);
      const mode: LambdaMode = 'inline';
      const args = this.callArgs(va, lambdaNode, null, { recv, mode, label: name, recvIndex: name === 'with' ? 0 : undefined });
      const isAsync = args.some((a) => a.startsWith('async '));
      if (name === 'with' && args.length === 2) {
        // with(x) { } : receiver lambda gets x as first param
      }
      const call = `${this.hofRef(name, isAsync)}(${args.join(', ')})`;
      return isAsync ? this.awaitIt(call, n) : call;
    }
    const r = this.resolveStatic(name, n);
    if (!r && process.env.KANSO_LENIENT && !this.inFallback) {
      this.warn(`unresolved function ${name}`, n);
      return `$k.missing(${JSON.stringify(name)})(${this.callArgs(va, lambdaNode, null, null).join(', ')})`;
    }
    if (!r) this.fail(`unresolved function ${name}`, n);
    switch (r.k) {
      case 'topFun': {
        if (!r.funs.some((x) => !x.extReceiver)) return this.dynCall([this.thisJs()], name, va, lambdaNode, typeArgs, null, n);
        const f = this.pickOverload(r.funs.filter((x) => !x.extReceiver), va, lambdaNode);
        const args = this.withReified(f, this.callArgs(va, lambdaNode, f.params, this.lambdaModesFor(f)), typeArgs, expected, n);
        const call = `${f.jsName}(${[...f.contextParams.map(() => this.contextArg()), ...args].join(', ')})`;
        return this.awaitUser(f) ? this.awaitIt(call, n) : call;
      }
      case 'userClass':
        return this.construct(r.cls, va, lambdaNode, n);
      case 'companion': {
        const target = r.cls;
        const funs = target.funs.get(name) ?? [];
        const f = funs.length ? this.pickOverload(funs, va, lambdaNode) : null;
        const args = this.callArgs(va, lambdaNode, f?.params ?? null, f ? this.lambdaModesFor(f) : null);
        const call = `${this.classJs(target)}.${f?.jsName ?? name}(${args.join(', ')})`;
        return f && this.awaitUser(f) ? this.awaitIt(call, n) : call;
      }
      case 'rt':
        return this.runtimeCall(r, name, va, lambdaNode, typeArgs, expected, n);
      case 'topProp':
      case 'local':
      case 'member':
      case 'dyn': {
        const v = this.resolvedValue(r, name, n);
        const args = this.callArgs(va, lambdaNode, null, null);
        return `$k.invoke(${v}, ${args.join(', ')})`;
      }
    }
  }

  private userShadows(name: string): boolean {
    const pkg = this.prog.packages.get(this.file.pkg);
    return !!pkg?.funs.get(name) || !!this.scope.lookup(name);
  }

  private runtimeCall(r: { fqn: string; value: unknown; js: string }, name: string, va: Node | null, lambdaNode: Node | null, typeArgs: Node[], expected: Node | null, n: Node): string {
    // classes that Kotlin also calls as functions (e.g. `Json { }`)
    if (isRuntimeClass(r.value) && typeof (r.value as any).$invoke === 'function' && (lambdaNode || !(r.value as any).$params)) {
      return this.runtimeCall({ fqn: r.fqn, value: (r.value as any).$invoke, js: `${r.js}.$invoke` }, name, va, lambdaNode, typeArgs, expected, n);
    }
    const v: any = r.value;
    // extension list imported by name and called without receiver (e.g. inside receiver lambdas)
    if (isExtList(v)) {
      return this.dynCall([this.thisJs()], name, va, lambdaNode, typeArgs, null, n);
    }
    // SAM constructor: Interceptor { chain -> ... }
    if (isRuntimeClass(v) && (v.$interface || v.$samMethod) && lambdaNode && !va) {
      const lam = this.lambda(this.lambdaOf(lambdaNode), { mode: 'plain', recv: false, label: name });
      return `$k.sam(${r.js}, ${lam})`;
    }
    const recvLambda = !!v?.$recvLambda;
    const suspendLambda = !!v?.$suspendLambda;
    const mode: LambdaMode = v?.$inline || v?.$async ? 'inline' : suspendLambda ? 'suspend' : 'plain';
    const recvType = v?.$recvType ? { rt: v.$recvType } : null;
    const args = this.callArgs(va, lambdaNode, v?.$params ?? null, { recv: recvLambda, mode, label: name, recvType }, true);
    if (v?.$reified) {
      const t = typeArgs[0] ?? expected;
      if (!t) this.fail(`cannot infer reified type for ${name}`, n);
      args.push(v.$reified === 'desc' ? this.typeDesc(t) : this.typeRefJs(t, t));
    }
    let call: string;
    const lambdaAsync = mode === 'inline' && args.some((a) => a.startsWith('async '));
    if (isRuntimeClass(v)) call = args.some((a) => a.startsWith('$k.named(')) ? `$k.construct(${r.js}, [${args.join(', ')}])` : `new ${r.js}(${args.join(', ')})`;
    else if (lambdaAsync && v?.$async) call = `${r.js}.$async(${args.join(', ')})`;
    else call = `${r.js}(${args.join(', ')})`;
    if (v?.$suspend || v?.$infect || (lambdaAsync && v?.$async)) return this.awaitIt(call, n, !!v?.$infect);
    return call;
  }

  private construct(c: ClassSym, va: Node | null, lambdaNode: Node | null, n: Node): string {
    if (c.kind === 'object' || c.kind === 'companion') {
      // invoke operator on object
      const args = this.callArgs(va, lambdaNode, null, null);
      return `$k.invoke(${this.classJs(c)}, ${args.join(', ')})`;
    }
    if (c.mods.has('abstract') || c.kind === 'interface') this.fail(`instantiating abstract ${c.name}`, n);
    const params = c.hasPrimaryCtor || !c.secondaryCtors.length ? c.ctorParams : null;
    const args = this.callArgs(va, lambdaNode, params, null);
    return `new ${this.classJs(c)}(${args.join(', ')})`;
  }

  private pickOverload(funs: FunSym[], va: Node | null, lambdaNode: Node | null): FunSym {
    if (funs.length === 1) return funs[0];
    const n = (va ? children(va, 'value_argument').length : 0) + (lambdaNode ? 1 : 0);
    return funs.find((f) => f.params.length === n) ?? funs.find((f) => f.params.length >= n && f.params.slice(n).every((p) => p.def)) ?? funs[0];
  }

  private lambdaModesFor(f: FunSym): LambdaOpts {
    // user HOF: inline -> lambda inherits suspend context; param type `suspend () -> T` -> suspend lambda
    const last = f.params[f.params.length - 1];
    const isSuspendParam = !!last?.type && last.type.text.trim().startsWith('suspend');
    const recv = !!last?.type && last.type.type === 'function_type' && this.isReceiverFnType(last.type);
    const mode: LambdaMode = isSuspendParam ? 'suspend' : f.mods.has('inline') ? 'inline' : 'plain';
    return { recv, mode, label: f.name };
  }

  /** Method call `recv.name(args)` / `recv?.name(args)` / static `Type.name(args)`. */
  private methodCall(n: Node, callee: Node, va: Node | null, lambdaNode: Node | null, typeArgs: Node[], expected: Node | null): string {
    const prevName = this.callName;
    this.callName = identOf(named(callee)[named(callee).length - 1]) ?? null;
    try {
      return this.methodCall0(n, callee, va, lambdaNode, typeArgs, expected);
    } finally {
      this.callName = prevName;
    }
  }

  private methodCall0(n: Node, callee: Node, va: Node | null, lambdaNode: Node | null, typeArgs: Node[], expected: Node | null): string {
    const parts = named(callee);
    const recvNode = this.ovr(parts[0]);
    const memberNode = parts[parts.length - 1];
    const name = identOf(memberNode) ?? this.fail('call member', callee);
    const safe = hasToken(callee, '?.');

    // super.foo()
    if (recvNode.type === 'super_expression') {
      const funs = this.cls ? this.inheritedFuns(this.cls, name).filter((f) => !f.extReceiver) : [];
      const f = funs.length ? this.pickOverload(funs, va, lambdaNode) : null;
      const args = this.callArgs(va, lambdaNode, f?.params ?? null, f ? this.lambdaModesFor(f) : null);
      const jsn = f ? f.jsName : name;
      const call = `super.${jsn}(${args.join(', ')})`;
      const isAsync = f ? this.awaitUser(f) : this.cls ? this.rtMethodIsAsync(this.rtSuper(this.cls)?.value, name) : false;
      return isAsync ? this.awaitIt(call, n) : call;
    }

    // static: Type.method(...) / Companion / object
    const qual = this.staticCallTarget(recvNode);
    if (qual) return this.staticMethodCall(qual, name, va, lambdaNode, typeArgs, expected, n);

    const recv = this.expr(recvNode);
    const t = safe ? this.tmp() : null;
    const recvRef = t ?? recv;
    const call = this.memberCall(recvRef, name, va, lambdaNode, typeArgs, expected, n, recvNode);
    if (safe) return `((${t} = ${recv}) == null ? null : ${call})`;
    return call;
  }

  private memberCall(recv: string, name: string, va: Node | null, lambdaNode: Node | null, typeArgs: Node[], expected: Node | null, n: Node, recvNode: Node | null): string {
    // fast paths
    if (name === 'to' && va && !lambdaNode) {
      const a = this.callArgs(va, null, null, null);
      return `$k.pair(${recv}, ${a[0]})`;
    }
    const userExts = this.userExtFuns(name);
    const rtc = this.rtCands(name);
    const knownUserMethod = this.userMethodsNamed(name);
    const hasExt = userExts.length > 0 || rtc.length > 0;

    // Lambda handling depends on what the callee is.
    const recvLambda = rtc.some((c) => c.recvLambda) || userExts.some((f) => this.lambdaModesFor(f).recv) || knownUserMethod.some((f) => this.lambdaModesFor(f).recv);
    const inline = rtc.some((c) => !!c.async || !!c.inline) || userExts.some((f) => f.mods.has('inline')) || knownUserMethod.some((f) => f.mods.has('inline'));
    const suspendLambda = rtc.some((c) => c.suspendLambda) || userExts.some((f) => this.lambdaModesFor(f).mode === 'suspend') || knownUserMethod.some((f) => this.lambdaModesFor(f).mode === 'suspend');
    const mode: LambdaMode = inline ? 'inline' : suspendLambda ? 'suspend' : 'plain';
    const paramsHint = knownUserMethod.length === 1 ? knownUserMethod[0].params : userExts.length === 1 ? userExts[0].params : null;
    const rtParams = rtc.find((c) => c.params)?.params ?? null;
    const extRecvType = rtc.find((c: any) => c.recvType)?.['recvType' as keyof ExtLike];
    const recvType = extRecvType ? { rt: extRecvType } : recvLambda && recvNode ? this.inferType(recvNode) : null;
    const args = this.callArgs(va, lambdaNode, paramsHint ?? (rtParams ? rtParams.map((p) => ({ name: p }) as any) : null), { recv: recvLambda, mode, label: name, recvType }, !paramsHint);
    const reified = rtc.find((c) => c.reified);
    if (reified) {
      const t = typeArgs[0] ?? expected;
      if (t) args.push(reified.reified === 'desc' ? this.typeDesc(t) : this.typeRefJs(t, t));
      else if (reified.reified === 'desc') args.push('$T.any');
      else this.fail(`cannot infer reified type for ${name}`, n);
    } else if (userExts.length === 1 && userExts[0].reified.length) {
      args.splice(0, args.length, ...this.withReified(userExts[0], args, typeArgs, expected, n));
    } else if (knownUserMethod.length === 1 && knownUserMethod[0].reified.length) {
      args.splice(0, args.length, ...this.withReified(knownUserMethod[0], args, typeArgs, expected, n));
    }
    const lambdaAsync = mode === 'inline' && args.some((a) => a.startsWith('async '));
    let call: string;
    if (hasExt) {
      call = `$k.${lambdaAsync ? 'callAsync' : 'call'}(${recv}, ${JSON.stringify(name)}, ${this.extList(name, n)}, [${args.join(', ')}], ${this.selfJs()})`;
    } else {
      call = `${recv}.${jsProp(name)}(${args.join(', ')})`;
    }
    const can = this.fn.canAwait || this.inlineChainCanAwait();
    const awaitNeeded =
      lambdaAsync ||
      (can && rtc.some((c) => c.suspend)) ||
      userExts.some((f) => this.awaitUser(f)) ||
      knownUserMethod.some((f) => this.awaitUser(f)) ||
      (can && this.rt.suspendMembers.has(name));
    const infect = this.rt.infectingMembers.has(name) || rtc.some((c) => c.infect);
    if (infect) return this.awaitIt(call, n, true);
    if (awaitNeeded) return this.awaitIt(call, n);
    void recvNode;
    return call;
  }

  /** Cheap static type of an expression: constructor calls and `X.create()` factories. */
  private inferType(n0: Node): { user?: ClassSym; rt?: any } | null {
    const n = this.ovr(n0);
    if (n.type === 'this_expression' && !named(n).length) {
      const r = this.receivers[0];
      if (r && (r.cls || r.rt)) return { user: r.cls ?? undefined, rt: r.rt ?? undefined };
      return null;
    }
    if (n.type !== 'call_expression') return null;
    const callee = named(n)[0];
    if (callee.type === 'identifier') {
      if (this.scope.lookup(callee.text)) return null;
      const t = this.resolveType(callee.text, { file: this.file, cls: this.cls });
      if (t?.user && t.user.kind === 'class') return { user: t.user };
      if (t?.rt && isRuntimeClass(t.rt.value)) return { rt: t.rt.value };
      return null;
    }
    if (callee.type === 'navigation_expression' && !hasToken(callee, '?.')) {
      const chain = this.identChain(callee);
      if (!chain || chain.length < 2) return null;
      if (this.scope.lookup(chain[0])) return null;
      const t = this.resolveType(chain.join('.'), { file: this.file, cls: this.cls });
      if (t?.user && t.user.kind === 'class') return { user: t.user };
      if (t?.rt && isRuntimeClass(t.rt.value)) return { rt: t.rt.value };
      const owner = this.resolveType(chain.slice(0, -1).join('.'), { file: this.file, cls: this.cls });
      if (owner?.rt && isRuntimeClass(owner.rt.value) && chain[chain.length - 1] === 'create') return { rt: owner.rt.value };
    }
    return null;
  }

  /** Pad omitted optional args and append reified type descriptors. */
  private withReified(f: FunSym, args: string[], typeArgs: Node[], expected: Node | null, n: Node): string[] {
    if (!f.reified.length) return args;
    const out = [...args];
    while (out.length < f.params.length) out.push('undefined');
    f.reified.forEach((tp, i) => {
      const ti = f.typeParams.indexOf(tp);
      const t = typeArgs[ti] ?? typeArgs[i] ?? (f.returnType && typeName(f.returnType) === tp ? expected : null);
      if (!t) this.fail(`cannot infer reified type ${tp} for ${f.name}`, n);
      out.push(this.typeDesc(t));
    });
    return out;
  }

  private userMethodsNamed(name: string): FunSym[] {
    const out: FunSym[] = [];
    for (const c of this.prog.allClasses) for (const f of c.funs.get(name) ?? []) if (!f.extReceiver) out.push(f);
    return out;
  }

  /** If the receiver of a call is a type (static call), return how to reach it. */
  private staticCallTarget(recvNode: Node): { user?: ClassSym; rtJs?: string; rtValue?: any; fqn?: string } | null {
    const chain = this.identChain(recvNode);
    if (!chain) return null;
    if (this.scope.lookup(chain[0])) return null;
    for (const r of this.receivers) if (r.cls && (this.findProp(r.cls, chain[0]) || this.rtMembers(r.cls).has(chain[0]))) return null;
    const t = this.resolveType(chain.join('.'), { file: this.file, cls: this.cls });
    if (t?.user) return { user: t.user };
    if (t?.rt && !isAnnotation(t.rt.value)) return { rtJs: this.rtValueJs(t.rt.fqn), rtValue: t.rt.value, fqn: t.rt.fqn };
    if (t?.builtin) {
      // String.format(...), Int.MAX_VALUE etc.
      const d = this.rt.hasDefault(chain[0]) ? this.rt.defaultValue(chain[0]) : undefined;
      if (d !== undefined) return { rtJs: this.defaultRef(chain[0]), rtValue: d };
    }
    // a top-level object referenced by a user top prop? no
    return null;
  }

  private staticMethodCall(t: { user?: ClassSym; rtJs?: string; rtValue?: any; fqn?: string }, name: string, va: Node | null, lambdaNode: Node | null, typeArgs: Node[], expected: Node | null, n: Node): string {
    if (t.user) {
      const c = t.user;
      if (name === 'serializer' && (c.serializable || c.kind === 'enum') && !va?.namedChildCount) return `$T.cls(${this.classJs(c)})`;
      // nested class constructor: Outer.Inner(...)
      const nested = c.nested.get(name);
      if (nested && nested.kind !== 'object' && nested.kind !== 'companion') return this.construct(nested, va, lambdaNode, n);
      if (c.kind === 'enum' && (name === 'values' || name === 'valueOf' || name === 'entries')) {
        const args = this.callArgs(va, lambdaNode, null, null);
        return `${c.jsName}.${name}(${args.join(', ')})`;
      }
      const target = c.kind === 'object' || c.kind === 'companion' ? c : c.companion;
      if (!target) this.fail(`no companion on ${c.name} for ${name}()`, n);
      const funs = target.funs.get(name) ?? [];
      if (!funs.length) {
        const prop = target.props.get(name);
        if (prop) return `$k.invoke(${this.classJs(target)}.${prop.jsName}, ${this.callArgs(va, lambdaNode, null, null).join(', ')})`;
        this.fail(`unknown ${c.name}.${name}()`, n);
      }
      const f = this.pickOverload(funs, va, lambdaNode);
      const args = this.callArgs(va, lambdaNode, f.params, this.lambdaModesFor(f));
      const call = `${this.classJs(target)}.${f.jsName}(${args.join(', ')})`;
      return this.awaitUser(f) ? this.awaitIt(call, n) : call;
    }
    // runtime static: FormBody.Builder(), Request.Builder(), Base64.decode(), Json.decodeFromString<T>()
    const member = t.rtValue?.[name];
    const fq = t.fqn ? `${t.fqn}.${name}` : null;
    if (fq && this.rt.has(fq)) {
      const v: any = this.rt.value(fq);
      return this.runtimeCall({ fqn: fq, value: v, js: this.rtRef(fq) }, name, va, lambdaNode, typeArgs, expected, n);
    }
    if (member === undefined) {
      // Companion extension or unknown static
      if (t.rtValue && this.hasExt(name)) return this.memberCall(t.rtJs!, name, va, lambdaNode, typeArgs, expected, n, null);
      this.fail(`unknown runtime static ${t.fqn ?? t.rtJs}.${name}()`, n);
    }
    const target = `${t.rtJs}.${jsProp(name)}`;
    if (isRuntimeClass(member)) {
      const args = this.callArgs(va, lambdaNode, member.$params ?? null, null, true);
      if (args.some((a) => a.startsWith('$k.named('))) return `$k.construct(${target}, [${args.join(', ')}])`;
      return `new ${target}(${args.join(', ')})`;
    }
    if (typeof member === 'function') {
      return this.runtimeCall({ fqn: fq ?? '', value: member, js: target }, name, va, lambdaNode, typeArgs, expected, n);
    }
    // object member method: Json.Default.decodeFromString etc.
    const args = this.callArgs(va, lambdaNode, null, null);
    return `$k.invoke(${target}, ${args.join(', ')})`;
  }

  /** Compile value arguments (+ trailing lambda). Named args -> positional when params are known. */
  callArgs(va: Node | null, lambdaNode: Node | null, params: Param[] | { name: string }[] | null, lambdaOpts: LambdaOpts | null, runtimeNamed = false): string[] {
    const argNodes = va ? children(va, 'value_argument') : [];
    const items: { name: string | null; node: Node; spread: boolean }[] = argNodes.map((a) => {
      const ps = named(a);
      const hasName = hasToken(a, '=') && ps.length >= 2 && ps[0].type === 'identifier';
      const valueNode = ps[ps.length - 1];
      return { name: hasName ? ps[0].text : null, node: valueNode, spread: hasToken(a, '*') };
    });
    // Evaluate in source order, spilling earlier args if a later one emits statements.
    const compiled: string[] = [];
    for (const it of items) {
      const mark = this.out.length;
      let v: string;
      if (it.node.type === 'lambda_literal' || it.node.type === 'annotated_lambda') {
        v = this.lambda(it.node.type === 'lambda_literal' ? it.node : this.lambdaOf(it.node), lambdaOpts ?? { mode: 'plain', recv: false, label: this.callName });
      } else v = this.expr(it.node);
      if (this.out.length > mark && compiled.length) {
        const spills: string[] = [];
        for (let i = 0; i < compiled.length; i++) {
          if (!isTrivial(compiled[i])) {
            const t = this.tmp();
            spills.push(`${t} = ${compiled[i]};`);
            compiled[i] = t;
          }
        }
        this.out.splice(mark, 0, ...spills);
      }
      compiled.push(it.spread ? `...${v}` : v);
    }
    if (lambdaNode) compiled.push(this.lambda(this.lambdaOf(lambdaNode), lambdaOpts ?? { mode: 'plain', recv: false, label: this.callName }));
    const namedItems = items.map((it, i) => ({ ...it, js: compiled[i] })).filter((x) => x.name);
    if (!namedItems.length) return compiled;
    if (params) {
      const out: string[] = [];
      let pi = 0;
      items.forEach((it, i) => {
        if (!it.name) {
          out[pi++] = compiled[i];
        }
      });
      for (const it of namedItems) {
        const idx = params.findIndex((p) => p.name === it.name);
        if (idx < 0) {
          if (runtimeNamed) return [...items.map((x, i) => ({ x, i })).filter((p) => !p.x.name).map((p) => compiled[p.i]), ...(lambdaNode ? [compiled[compiled.length - 1]] : []), `$k.named({ ${namedItems.map((x) => `${jsProp(x.name!)}: ${x.js}`).join(', ')} })`];
          this.fail(`unknown named argument ${it.name}`, it.node);
        }
        out[idx] = it.js;
      }
      if (lambdaNode) out[params.length - 1 >= out.length ? out.length : params.length - 1] = compiled[compiled.length - 1];
      for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = 'undefined';
      return out;
    }
    // unknown callee signature: pass named args as a Named object (runtime functions handle it)
    const positionalArgs = items.map((x, i) => ({ x, i })).filter((p) => !p.x.name).map((p) => compiled[p.i]);
    if (lambdaNode) positionalArgs.push(compiled[compiled.length - 1]);
    return [...positionalArgs, `$k.named({ ${namedItems.map((x) => `${jsProp(x.name!)}: ${x.js}`).join(', ')} })`];
  }

  /** Should a call to user function f be awaited here? Suspend callees only in suspend code. */
  private awaitUser(f: FunSym): boolean {
    if (!this.asyncFuns.has(f)) return false;
    if (f.isSuspend || this.overridesRuntimeAsync(f)) return this.fn.canAwait || this.inlineChainCanAwait();
    return true; // infected: async here although synchronous in Kotlin
  }

  private inlineChainCanAwait(): boolean {
    let f: FnCtx | null = this.fn;
    while (f && f.kind === 'lambda' && f.inline) f = f.parent;
    return !!f?.canAwait;
  }

  private awaitIt(call: string, n: Node, infect = false): string {
    if (!this.fn.canAwait && !infect) {
      // Await in a context Kotlin considers synchronous: allowed only when the callee is a
      // runtime member that is async here (infection) - otherwise it's a translator gap.
      if (this.fn.kind === 'lambda' && !this.fn.inline) {
        this.fn.usedAwait = true;
        return `(await ${call})`;
      }
      if (this.fn.kind === 'fun') {
        this.fn.usedAwait = true;
        return `(await ${call})`;
      }
      this.fail(`suspend call in synchronous context (${this.fn.kind})`, n);
    }
    if (infect && !this.fn.canAwait && (this.fn.kind === 'getter' || this.fn.kind === 'ctor' || this.fn.kind === 'init' || this.fn.kind === 'top')) {
      this.fail(`blocking call in ${this.fn.kind}`, n);
    }
    this.fn.usedAwait = true;
    // inline lambdas propagate async-ness to the enclosing function
    let f: FnCtx | null = this.fn;
    while (f && f.kind === 'lambda' && f.inline) {
      f.usedAwait = true;
      f = f.parent;
      if (f) f.usedAwait = true;
    }
    return `(await ${call})`;
  }

  // ---------- lambdas ----------

  private lambda(n: Node, opts: LambdaOpts): string {
    const inline = opts.mode === 'inline';
    const canAwait = opts.mode === 'inline' ? this.fn.canAwait : opts.mode === 'suspend';
    const label = this.lambdaLabel(n) ?? opts.label;
    const fnCtx: FnCtx = { ...this.newFn('lambda', canAwait, null, label, inline), parent: this.fn };
    const outerRecv = this.receivers;
    return this.inFn(fnCtx, () => {
      this.scope = new Scope(this.scope);
      const lp = child(n, 'lambda_parameters');
      const params: string[] = [];
      const destructure: string[] = [];
      if (opts.recv) {
        const r = `$r${++this.uid}`;
        params.push(r);
        const rt = opts.recvType?.rt ?? null;
        const cls = opts.recvType?.user ?? null;
        this.receivers = [{ js: r, kind: cls ? 'ext' : 'lambda', cls, rt, label }, ...outerRecv];
      }
      if (lp) {
        for (const p of named(lp)) {
          if (p.type === 'variable_declaration') {
            const name = identOf(named(p)[0] ?? null) ?? '_';
            params.push(this.declareLocal(name, true));
          } else if (p.type === 'multi_variable_declaration') {
            const d = `$d${++this.uid}`;
            params.push(d);
            children(p, 'variable_declaration').forEach((vd, i) => {
              const name = identOf(named(vd)[0] ?? null) ?? '_';
              if (name === '_') return;
              const js = this.declareLocal(name, true);
              destructure.push(`const ${js} = $k.component(${d}, ${i + 1});`);
            });
          }
        }
      } else if (!opts.recv || this.usesIt(n)) {
        if (this.usesIt(n)) params.push(this.declareLocal('it', true));
      }
      const body = this.lambdaBodyValue(n, opts.expected ?? null, destructure);
      const isAsync = this.fn.usedAwait;
      if (isAsync && !canAwait && !inline) {
        // infection inside a plain lambda (e.g. interceptor calling chain.proceed): allowed
      }
      return `${isAsync ? 'async ' : ''}(${params.join(', ')}) => {\n${indent(body)}\n}`;
    });
  }

  private lambdaLabel(n: Node): string | null {
    const p = n.parent;
    if (p?.type === 'annotated_lambda') {
      const lbl = named(p).find((x) => x.type === 'label');
      if (lbl) return lbl.text.replace(/@/g, '');
    }
    return null;
  }

  private usesIt(n: Node): boolean {
    // `it` referenced directly in this lambda (not in nested lambdas that declare their own)
    const walk = (x: Node, depth: number): boolean => {
      for (const c of named(x)) {
        if (c.type === 'identifier' && c.text === 'it') return true;
        if ((c.type === 'string_literal' || c.type === 'multiline_string_literal') && templateParts(c).some((p) => 'ident' in p && p.ident === 'it')) return true;
        if (c.type === 'lambda_literal') {
          if (child(c, 'lambda_parameters')) {
            if (walk(c, depth + 1)) return true;
          }
          continue; // nested lambda without params has its own `it`
        }
        if (walk(c, depth)) return true;
      }
      return false;
    };
    return walk(n, 0);
  }

  /** Statements of a lambda; the last expression is returned. */
  private lambdaBodyValue(n: Node, expected: Node | null, pre: string[] = []): string {
    const stmts = named(n).filter((x) => x.type !== 'lambda_parameters');
    const lines: string[] = [...pre];
    const saved = this.out;
    this.out = lines;
    this.scope = new Scope(this.scope);
    stmts.forEach((s, i) => {
      if (i < stmts.length - 1) this.stmt(s);
      else if (isStatementOnly(s)) this.stmt(s);
      else {
        const v = this.expr(s, expected);
        lines.push(`return ${v};`);
      }
    });
    this.scope = this.scope.parent!;
    this.out = saved;
    let code = lines.join('\n');
    if (this.fn.usedNlr && this.fn.nlrToken) {
      code = `const ${this.fn.nlrToken} = {};\ntry {\n${indent(code)}\n} catch ($e) {\n  if ($e instanceof $k.NonLocalReturn && $e.token === ${this.fn.nlrToken}) return $e.value;\n  throw $e;\n}`;
    }
    if (this.fn.temps.length) code = `let ${this.fn.temps.join(', ')};\n${code}`;
    return code;
  }

  private anonFun(n: Node): string {
    const f = this.prog.collectFun(n, this.file, null);
    const fnCtx = this.newFn('fun', f.isSuspend, f, null);
    return this.inFn(fnCtx, () => {
      this.scope = new Scope(this.scope);
      const params = this.emitParams(f.params, null);
      const body = f.body ? this.functionBody(f.body, f.returnType) : '';
      return `${this.fn.usedAwait ? 'async ' : ''}(${params.join(', ')}) => {\n${indent(body)}\n}`;
    });
  }

  // ---------- object expressions ----------

  private objectLiteral(n: Node): string {
    const c = this.prog.collectClass(n, this.file, null, true);
    c.jsName = `$obj${++this.uid}`;
    const ot = `$outer${++this.uid}`;
    this.emit(`const ${ot} = ${this.thisJs()};`);
    const savedCls = this.cls;
    const savedRecv = this.receivers;
    this.cls = c;
    this.receivers = [{ js: 'this', kind: 'object', cls: c, rt: null, label: null }, ...savedRecv.map((r) => (r.js === 'this' ? { ...r, js: ot } : r))];
    let code: string;
    try {
      code = this.emitClassBody(c, c.jsName, false);
    } finally {
      this.cls = savedCls;
      this.receivers = savedRecv;
    }
    this.emit(code);
    for (const l of this.linkLines.splice(0)) this.emit(l);
    const args = c.superArgs ? this.callArgs(c.superArgs, null, null, null).join(', ') : '';
    return `new ${c.jsName}(${args})`;
  }

  // ---------- callable references ----------

  private callableRef(n: Node): string {
    // `::foo`, `Type::foo`, `expr::foo`, `::Foo` (constructor)
    const parts = named(n);
    const nameNode = parts[parts.length - 1];
    const name = identOf(nameNode) ?? nameNode.text;
    const recvNode = parts.length > 1 ? parts[0] : null;
    if (!recvNode) {
      // ::foo -> bound to implicit receivers / top-level / constructor
      const local = this.scope.lookup(name);
      if (local) return local.js;
      for (const r of this.receivers) {
        if (r.cls) {
          const funs = this.findFuns(r.cls, name).filter((f) => !f.extReceiver);
          if (funs.length) return `((...a) => ${r.js}.${funs.length > 1 ? name : funs[0].jsName}(...a))`;
        } else if (!r.cls && r.kind === 'lambda') {
          return `((...a) => $k.icall([${r.js}, ${this.thisJs()}], ${JSON.stringify(name)}, ${this.extList(name, n)}, a, undefined, ${this.selfJs()}))`;
        }
      }
      const s = this.resolveStatic(name, n);
      if (s?.k === 'userClass') return `((...a) => new ${this.classJs(s.cls)}(...a))`;
      if (s?.k === 'topFun') return s.funs[0].jsName;
      if (s?.k === 'rt') return isRuntimeClass(s.value) ? `((...a) => new ${s.js}(...a))` : s.js;
      this.fail(`unresolved reference ::${name}`, n);
    }
    // Type::member (unbound) vs expr::member (bound)
    const typeName_ = recvNode.type === 'user_type' || recvNode.type === 'nullable_type' ? recvNode.text.replace(/<.*>/s, '').replace(/\?$/, '') : null;
    const chain = typeName_ ? typeName_.split('.') : this.identChain(recvNode);
    const isTypeNode = recvNode.type === 'user_type' || recvNode.type === 'nullable_type';
    const isType = isTypeNode || (chain && !this.scope.lookup(chain[0]) && !!this.resolveType(chain.join('.'), { file: this.file, cls: this.cls }) && /^[A-Z]/.test(chain[chain.length - 1]));
    if (isType) {
      if (name === 'class') return `$k.kclass(${this.typeRefJs(chain!.join('.'), recvNode)}, $loader)`;
      // unbound member/extension reference: first argument is the receiver
      return this.hoist(`ref:${name}:${this.extList(name, n)}`, `ref_${name}`, () => `$k.memberRef(${JSON.stringify(name)}, ${this.extList(name, n)})`);
    }
    if (name === 'class') return `$k.kclass(${this.expr(recvNode)}, $loader)`;
    const recv = this.spill(this.expr(recvNode));
    return `((...a) => $k.call(${recv}, ${JSON.stringify(name)}, ${this.extList(name, n)}, a, ${this.selfJs()}))`;
  }

  private callableRefNav(n: Node): string {
    return this.callableRef(n);
  }

  // ---------- operators ----------

  private binary(n: Node): string {
    const left = field(n, 'left') ?? named(n)[0]!;
    const right = field(n, 'right') ?? named(n)[named(n).length - 1]!;
    const op = field(n, 'operator')?.text ?? this.opToken(n);
    if (op === '?:') return this.elvis(left, right);
    if (op === '&&' || op === '||') {
      const l = this.expr(left);
      const sub = this.subBlock(() => this.expr(right));
      if (!sub.stmts.length) return `(${l} ${op} ${sub.e})`;
      const t = this.tmp();
      this.emit(`${t} = ${l};`);
      this.emit(`if (${op === '&&' ? '' : '!'}${t}) {\n${indent([...sub.stmts, `${t} = ${sub.e};`].join('\n'))}\n}`);
      return t;
    }
    return this.binop(op, this.expr(left), this.expr(right), left, right);
  }

  private opToken(n: Node): string {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c && !c.isNamed) return c.type;
    }
    return '?';
  }

  private binop(op: string, l: string, r: string, ln: Node | null, rn: Node | null): string {
    const numLit = (x: Node | null) => !!x && (x.type === 'number_literal' || x.type === 'float_literal');
    const strLit = (x: Node | null) => !!x && (x.type === 'string_literal' || x.type === 'multiline_string_literal');
    const isNull = (x: Node | null) => !!x && x.type === 'identifier' && x.text === 'null';
    switch (op) {
      case '+':
        if (strLit(ln) || (numLit(ln) && numLit(rn))) return `(${l} + ${strLit(ln) ? `$s(${r})` : r})`;
        return `$k.plus(${l}, ${r})`;
      case '-':
        if (numLit(ln) || numLit(rn)) return `(${l} - ${r})`;
        return `$k.minus(${l}, ${r})`;
      case '*':
        if (numLit(ln) || numLit(rn)) return `(${l} * ${r})`;
        return `$k.times(${l}, ${r})`;
      case '/':
        if ((ln && ln.type === 'float_literal') || (rn && rn.type === 'float_literal')) return `(${l} / ${r})`;
        return `$k.div(${l}, ${r})`;
      case '%':
        return `$k.rem(${l}, ${r})`;
      case '==':
        if (isNull(rn)) return `(${l} == null)`;
        if (isNull(ln)) return `(${r} == null)`;
        if (numLit(ln) || numLit(rn) || strLit(ln) || strLit(rn) || ln?.type === 'character_literal' || rn?.type === 'character_literal') return `(${l} === ${r})`;
        return `$k.eq(${l}, ${r})`;
      case '!=':
        if (isNull(rn)) return `(${l} != null)`;
        if (isNull(ln)) return `(${r} != null)`;
        if (numLit(ln) || numLit(rn) || strLit(ln) || strLit(rn) || ln?.type === 'character_literal' || rn?.type === 'character_literal') return `(${l} !== ${r})`;
        return `!$k.eq(${l}, ${r})`;
      case '===':
        return `(${l} === ${r})`;
      case '!==':
        return `(${l} !== ${r})`;
      case '<':
      case '>':
      case '<=':
      case '>=':
        if (numLit(ln) || numLit(rn)) return `(${l} ${op} ${r})`;
        return `($k.compare(${l}, ${r}) ${op} 0)`;
      default:
        this.fail(`unsupported operator ${op}`, ln ?? rn);
    }
  }

  /** Apply a binary operator to already-compiled operands (used by re-association). */
  private binopNodes(op: string, l: string, r: string, ln: Node | null, rn: Node | null): string {
    if (op === '?:') return `(${l} ?? ${r})`;
    if (op === '&&' || op === '||') return `(${l} ${op} ${r})`;
    return this.binop(op, l, r, ln, rn);
  }

  private elvis(left: Node, right: Node): string {
    const l = this.expr(left);
    const sub = this.subBlock(() => this.expr(right));
    if (!sub.stmts.length) return `(${l} ?? ${sub.e})`;
    const t = this.tmp();
    this.emit(`${t} = ${l};`);
    const tail = sub.e && sub.e !== 'undefined' ? [`${t} = ${sub.e};`] : [];
    this.emit(`if (${t} == null) {\n${indent([...sub.stmts, ...tail].join('\n'))}\n}`);
    return t;
  }

  private subBlock(f: () => string): { stmts: string[]; e: string } {
    const lines: string[] = [];
    const saved = this.out;
    this.out = lines;
    const e = f();
    this.out = saved;
    return { stmts: lines, e };
  }

  private unary(n: Node): string {
    const op = field(n, 'operator')?.text ?? this.opToken(n);
    const arg = field(n, 'argument') ?? named(n)[0]!;
    // postfix vs prefix: operator position
    const isPostfix = (field(n, 'operator')?.startIndex ?? 0) > arg.startIndex;
    switch (op) {
      case '!':
        if (isPostfix) return this.expr(arg);
        return `!${this.expr(arg)}`;
      case '!!':
        return `$k.nn(${this.expr(arg)})`;
      case '-':
        if (arg.type === 'number_literal' || arg.type === 'float_literal') return `-${this.expr(arg)}`;
        return `$k.unaryMinus(${this.expr(arg)})`;
      case '+':
        return this.expr(arg);
      case '++':
      case '--': {
        const lv = this.lvalue(arg);
        const cur = lv.get();
        if (/^[\w$.]+$/.test(cur)) return isPostfix ? `${cur}${op}` : `${op}${cur}`;
        const t = this.tmp();
        this.emit(`${t} = ${cur};`);
        lv.set(`${t} ${op === '++' ? '+' : '-'} 1`);
        return isPostfix ? t : `(${t} ${op === '++' ? '+' : '-'} 1)`;
      }
      default:
        this.fail(`unsupported unary ${op}`, n);
    }
  }

  private infix(n: Node): string {
    const [a, op, b] = named(n);
    const name = op.text;
    switch (name) {
      case 'to':
        return `$k.pair(${this.expr(a)}, ${this.expr(b)})`;
      case 'until':
        return `$k.until(${this.expr(a)}, ${this.expr(b)})`;
      case 'downTo':
        return `$k.downTo(${this.expr(a)}, ${this.expr(b)})`;
      case 'step':
        return `$k.step(${this.expr(a)}, ${this.expr(b)})`;
      case 'and':
        return `$k.and(${this.expr(a)}, ${this.expr(b)})`;
      case 'or':
        return `$k.or(${this.expr(a)}, ${this.expr(b)})`;
      case 'xor':
        return `$k.xor(${this.expr(a)}, ${this.expr(b)})`;
      case 'shl':
        return `(${this.expr(a)} << ${this.expr(b)})`;
      case 'shr':
        return `(${this.expr(a)} >> ${this.expr(b)})`;
      case 'ushr':
        return `(${this.expr(a)} >>> ${this.expr(b)})`;
    }
    // generic infix: a.name(b)
    const recv = this.expr(a);
    const lambdaLike = b.type === 'lambda_literal';
    if (lambdaLike) {
      const lam = this.lambda(b, { mode: 'plain', recv: false, label: name });
      return `$k.call(${recv}, ${JSON.stringify(name)}, ${this.extList(name, n)}, [${lam}], ${this.selfJs()})`;
    }
    const arg = this.expr(b);
    if (this.hasExt(name)) return `$k.call(${recv}, ${JSON.stringify(name)}, ${this.extList(name, n)}, [${arg}], ${this.selfJs()})`;
    return `${recv}.${jsProp(name)}(${arg})`;
  }

  // ---------- if / when / try ----------

  private ifExpr(n: Node, expected: Node | null): string {
    const c = this.cond(field(n, 'condition') ?? named(n)[0]!);
    const br = this.ifBranches(n);
    const thenR = this.branchValue(br.then, expected);
    const elseR = br.else ? this.branchValue(br.else, expected) : { stmts: [], e: 'undefined' };
    if (!thenR.stmts.length && !elseR.stmts.length) return `(${c} ? ${thenR.e} : ${elseR.e})`;
    const t = this.tmp();
    const tb = [...thenR.stmts, ...(thenR.e !== 'undefined' ? [`${t} = ${thenR.e};`] : [])];
    const eb = [...elseR.stmts, ...(elseR.e !== 'undefined' ? [`${t} = ${elseR.e};`] : [`${t} = undefined;`])];
    this.emit(`if (${c}) {\n${indent(tb.join('\n'))}\n} else {\n${indent(eb.join('\n'))}\n}`);
    return t;
  }

  /** Value of a branch body (block: statements + last expression). */
  private branchValue(b: Node | null, expected: Node | null): { stmts: string[]; e: string } {
    if (!b) return { stmts: [], e: 'undefined' };
    const nodes = this.bodyOf(b);
    return this.subBlock(() => {
      this.scope = new Scope(this.scope);
      let e = 'undefined';
      nodes.forEach((s, i) => {
        if (i < nodes.length - 1) this.stmt(s);
        else if (isStatementOnly(s)) this.stmt(s);
        else e = this.expr(s, expected);
      });
      this.scope = this.scope.parent!;
      return e;
    });
  }

  private when(n: Node, asValue: boolean, expected: Node | null = null): string {
    const subj = child(n, 'when_subject');
    let subjJs: string | null = null;
    if (subj) {
      const decl = child(subj, 'property_declaration') ?? child(subj, 'variable_declaration');
      const inner = named(subj).filter((x) => x.type !== 'property_declaration');
      if (subj.text.includes('val ')) {
        // when (val x = expr)
        const vd = subj.descendantsOfType('variable_declaration')[0]!;
        const name = identOf(named(vd)[0] ?? null)!;
        const init = named(subj)[named(subj).length - 1];
        const v = this.expr(init);
        const js = this.declareLocal(name, true);
        this.emit(`const ${js} = ${v};`);
        subjJs = js;
        void decl;
      } else {
        const t = this.tmp();
        this.emit(`${t} = ${this.expr(inner[0]!)};`);
        subjJs = t;
      }
    }
    const entries = children(n, 'when_entry');
    const result = asValue ? this.tmp() : null;
    let code = '';
    let first = true;
    let hasElse = false;
    let allPure = asValue;
    const pureParts: { cond: string; val: string }[] = [];
    for (const e of entries) {
      const conds = fields(e, 'condition');
      const bodyNode = named(e).filter((x) => !conds.some((c) => c.id === x.id)).pop() ?? null;
      const isElse = !conds.length;
      const condLines: string[] = [];
      const condJs = isElse
        ? 'true'
        : conds
            .map((c) => {
              const r = this.subBlock(() => this.whenCond(c, subjJs));
              condLines.push(...r.stmts);
              return r.e;
            })
            .join(' || ');
      if (condLines.length) this.fail('when condition needs statements', e);
      const br = this.branchValue(bodyNode, expected);
      if (br.stmts.length) allPure = false;
      pureParts.push({ cond: condJs, val: br.e });
      const bodyLines = [...br.stmts, ...(asValue && br.e !== 'undefined' ? [`${result} = ${br.e};`] : !asValue && br.e !== 'undefined' && !/^[\w$.]+$/.test(br.e) ? [`${br.e};`] : [])];
      if (isElse) {
        hasElse = true;
        code += first ? `{\n${indent(bodyLines.join('\n'))}\n}` : ` else {\n${indent(bodyLines.join('\n'))}\n}`;
      } else {
        code += `${first ? '' : ' else '}if (${condJs}) {\n${indent(bodyLines.join('\n'))}\n}`;
      }
      first = false;
    }
    if (asValue && allPure && hasElse && pureParts.length <= 12) {
      // Pure branches: one conditional expression, no temp needed.
      result && this.fn.temps.splice(this.fn.temps.indexOf(result), 1);
      let e = pureParts[pureParts.length - 1].val;
      for (let i = pureParts.length - 2; i >= 0; i--) e = `(${pureParts[i].cond} ? ${pureParts[i].val} : ${e})`;
      return e;
    }
    if (code) this.emit(code);
    if (asValue && !hasElse) this.emit(`// non-exhaustive when`);
    return result ?? 'undefined';
  }

  private whenCond(c: Node, subj: string | null): string {
    if (c.type === 'type_test') {
      const t = named(c)[0]!;
      const neg = c.text.trim().startsWith('!');
      return `${neg ? '!' : ''}$k.is(${subj}, ${this.typeRefJs(t, t)})`;
    }
    if (c.type === 'range_test') {
      const r = named(c)[0]!;
      const neg = c.text.trim().startsWith('!');
      return `${neg ? '!' : ''}$k.contains(${this.expr(r)}, ${subj})`;
    }
    const v = this.expr(c);
    if (subj === null) return v;
    if (c.type === 'string_literal' || c.type === 'number_literal' || c.type === 'character_literal') return `(${subj} === ${v})`;
    return `$k.eq(${subj}, ${v})`;
  }

  private tryExpr(n: Node, asValue: boolean, expected: Node | null = null): string {
    const parts = named(n);
    const body = parts[0];
    const catches = children(n, 'catch_block');
    const fin = child(n, 'finally_block');
    const result = asValue ? this.tmp() : null;
    const tryB = this.branchValue(body, expected);
    let code = `try {\n${indent([...tryB.stmts, ...(asValue && tryB.e !== 'undefined' ? [`${result} = ${tryB.e};`] : [])].join('\n'))}\n}`;
    if (catches.length) {
      const ev = `$e${++this.uid}`;
      let cc = `if (${ev} instanceof $k.NonLocalReturn) throw ${ev};\n`;
      catches.forEach((cb, i) => {
        const ps = named(cb);
        const name = identOf(ps.find((x) => x.type === 'identifier') ?? null) ?? '_';
        const type = ps.find((x) => x.type === 'user_type') ?? null;
        const blk = ps.find((x) => x.type === 'block') ?? null;
        this.scope = new Scope(this.scope);
        const js = this.declareLocal(name, true);
        const br = this.branchValue(blk, expected);
        this.scope = this.scope.parent!;
        const condJs = type ? `$k.isCatch(${ev}, ${this.typeRefJs(type, type)})` : 'true';
        const lines = [`const ${js} = ${ev};`, ...br.stmts, ...(asValue && br.e !== 'undefined' ? [`${result} = ${br.e};`] : [])];
        cc += `${i ? ' else ' : ''}if (${condJs}) {\n${indent(lines.join('\n'))}\n}`;
      });
      cc += ` else throw ${ev};`;
      code += ` catch (${ev}) {\n${indent(cc)}\n}`;
    }
    if (fin) {
      const blk = child(fin, 'block');
      code += ` finally {\n${indent(this.block(this.bodyOf(blk)))}\n}`;
    }
    this.emit(code);
    return result ?? 'undefined';
  }
}

// ======================================================================
// helpers
// ======================================================================

type LambdaMode = 'inline' | 'suspend' | 'plain';
interface LambdaOpts {
  mode: LambdaMode;
  recv: boolean;
  label: string | null;
  recvType?: { user?: ClassSym; rt?: any } | null;
  expected?: Node | null;
  recvIndex?: number;
}

function fields(n: Node, name: string): Node[] {
  return n.childrenForFieldName(name).filter((c): c is Node => !!c);
}

function indent(s: string): string {
  return s
    .split('\n')
    .map((l) => (l ? '  ' + l : l))
    .join('\n');
}

function escTpl(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function isTrivial(e: string): boolean {
  return /^[\w$]+$/.test(e) || /^"(?:[^"\\]|\\.)*"$/.test(e) || /^-?\d+(\.\d+)?$/.test(e) || e === 'this' || e === 'null' || e === 'undefined';
}

function isStatementOnly(n: Node): boolean {
  return ['property_declaration', 'assignment', 'for_statement', 'while_statement', 'do_while_statement', 'function_declaration', 'class_declaration', 'object_declaration'].includes(n.type);
}

function numberLit(t: string): string {
  let s = t.replace(/_/g, '').replace(/[lL]$/, '').replace(/[uU]$/, '');
  if (/^0[xX]/.test(s)) return String(parseInt(s, 16) | 0) === String(parseInt(s, 16)) ? s : String(parseInt(s, 16));
  if (/^0[bB]/.test(s)) return s;
  s = s.replace(/[fFdD]$/, '');
  return s;
}

function charLit(n: Node): string {
  const inner = n.text.slice(1, -1);
  if (inner.startsWith('\\')) return unescapeKotlin(inner);
  return inner;
}

/** Property access name: JS allows reserved words after a dot. */
function jsProp(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : `[${JSON.stringify(name)}]`;
}

export { stringLiteralValue, modifiersOf };

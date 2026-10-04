// Declarations collected from every Kotlin file of a translation unit (extension + theme + libs).

import { annotationName, annotations, annotationStringArgs, child, children, field, identOf, modifiersOf, named, type Node } from './parser';

export class Unsupported extends Error {
  constructor(
    readonly reason: string,
    readonly where?: string,
  ) {
    super(where ? `${reason} (${where})` : reason);
  }
}

export interface Import {
  fqn: string;
  alias: string | null;
  star: boolean;
}

export interface KFile {
  path: string;
  pkg: string;
  root: Node;
  imports: Import[];
}

export interface Param {
  name: string;
  type: Node | null;
  def: Node | null;
  vararg: boolean;
  /** primary-constructor `val`/`var` */
  prop: 'val' | 'var' | null;
  node: Node;
  annotations: Node[];
  mods: Set<string>;
}

export interface PropSym {
  kind: 'prop';
  name: string;
  owner: ClassSym | null;
  pkg: string;
  file: KFile;
  node: Node;
  isVal: boolean;
  mods: Set<string>;
  type: Node | null;
  init: Node | null;
  getter: Node | null;
  setter: Node | null;
  delegate: Node | null;
  extReceiver: Node | null;
  fromCtor: Param | null;
  jsName: string;
}

export interface FunSym {
  kind: 'fun';
  name: string;
  owner: ClassSym | null;
  pkg: string;
  file: KFile;
  node: Node;
  params: Param[];
  mods: Set<string>;
  extReceiver: Node | null;
  typeParams: string[];
  reified: string[];
  returnType: Node | null;
  body: Node | null;
  /** JS method/function name (mangled for overloads and extensions) */
  jsName: string;
  isSuspend: boolean;
}

export type ClassKind = 'class' | 'interface' | 'object' | 'enum' | 'companion' | 'annotation';

export interface ClassSym {
  name: string;
  fqn: string;
  pkg: string;
  file: KFile;
  node: Node;
  kind: ClassKind;
  mods: Set<string>;
  outer: ClassSym | null;
  /** superclass with ctor invocation, or null */
  superType: Node | null;
  superArgs: Node | null;
  interfaces: Node[];
  ctorParams: Param[];
  hasPrimaryCtor: boolean;
  secondaryCtors: Node[];
  props: Map<string, PropSym>;
  funs: Map<string, FunSym[]>;
  nested: Map<string, ClassSym>;
  companion: ClassSym | null;
  enumEntries: Node[];
  typeParams: string[];
  initBlocks: Node[];
  /** members in declaration order (props + init blocks) for constructor emission */
  order: Node[];
  serializable: boolean;
  serialName: string | null;
  customSerializer: Node | null;
  jsName: string;
  local: boolean;
}

export interface PackageSym {
  name: string;
  classes: Map<string, ClassSym>;
  funs: Map<string, FunSym[]>;
  props: Map<string, PropSym>;
  typeAliases: Map<string, Node>;
}

export class Program {
  readonly files: KFile[] = [];
  readonly packages = new Map<string, PackageSym>();
  readonly classesByFqn = new Map<string, ClassSym>();
  readonly allClasses: ClassSym[] = [];
  readonly allFuns: FunSym[] = [];
  readonly allProps: PropSym[] = [];
  private uid = 0;

  pkg(name: string): PackageSym {
    let p = this.packages.get(name);
    if (!p) {
      p = { name, classes: new Map(), funs: new Map(), props: new Map(), typeAliases: new Map() };
      this.packages.set(name, p);
    }
    return p;
  }

  addFile(path: string, root: Node): KFile {
    const pkgHeader = child(root, 'package_header');
    const pkg = pkgHeader ? (child(pkgHeader, 'qualified_identifier') ?? named(pkgHeader)[0])?.text.replace(/\s/g, '') ?? '' : '';
    const imports: Import[] = [];
    for (const imp of children(root, 'import')) {
      const q = child(imp, 'qualified_identifier') ?? named(imp)[0];
      const text = imp.text.replace(/^import\s+/, '').trim();
      const star = /\.\*\s*$/.test(text);
      const alias = / as\s+(\w+)\s*$/.exec(text)?.[1] ?? null;
      imports.push({ fqn: (q?.text ?? '').replace(/\s/g, ''), alias, star });
    }
    const f: KFile = { path, pkg, root, imports };
    this.files.push(f);
    const p = this.pkg(pkg);
    for (const d of named(root)) {
      if (d.type === 'class_declaration' || d.type === 'object_declaration') {
        const c = this.collectClass(d, f, null);
        p.classes.set(c.name, c);
      } else if (d.type === 'function_declaration') {
        const fn = this.collectFun(d, f, null);
        push(p.funs, fn.name, fn);
      } else if (d.type === 'property_declaration') {
        for (const prop of this.collectProps(d, f, null)) p.props.set(extKey(prop), prop);
      } else if (d.type === 'type_alias') {
        const name = identOf(field(d, 'type') ?? named(d).find((x) => x.type === 'identifier') ?? null);
        const target = named(d).filter((x) => x.type !== 'identifier' && x.type !== 'modifiers' && x.type !== 'type_parameters').pop();
        if (name && target) p.typeAliases.set(name, target);
      }
    }
    return f;
  }

  nextId(): number {
    return ++this.uid;
  }

  collectClass(d: Node, f: KFile, outer: ClassSym | null, local = false): ClassSym {
    const mods = modifiersOf(d);
    const nameNode = field(d, 'name') ?? named(d).find((c) => c.type === 'identifier') ?? null;
    let kind: ClassKind = 'class';
    if (d.type === 'object_declaration') kind = 'object';
    else if (d.type === 'companion_object') kind = 'companion';
    else if (/^\s*(\w+\s+)*interface\b/.test(d.text.slice(0, (nameNode?.startIndex ?? d.startIndex) - d.startIndex))) kind = 'interface';
    else if (mods.has('enum')) kind = 'enum';
    else if (mods.has('annotation')) kind = 'annotation';
    const name = kind === 'companion' ? (nameNode ? nameNode.text : 'Companion') : (nameNode?.text ?? `$anon${this.nextId()}`);
    const fqn = outer ? `${outer.fqn}.${name}` : f.pkg ? `${f.pkg}.${name}` : name;
    const c: ClassSym = {
      name,
      fqn,
      pkg: f.pkg,
      file: f,
      node: d,
      kind,
      mods,
      outer,
      superType: null,
      superArgs: null,
      interfaces: [],
      ctorParams: [],
      hasPrimaryCtor: false,
      secondaryCtors: [],
      props: new Map(),
      funs: new Map(),
      nested: new Map(),
      companion: null,
      enumEntries: [],
      typeParams: [],
      initBlocks: [],
      order: [],
      serializable: false,
      serialName: null,
      customSerializer: null,
      jsName: jsClassName(fqn),
      local,
    };
    for (const a of annotations(d)) {
      const an = annotationName(a);
      if (an === 'Serializable') {
        c.serializable = true;
        const withArg = a.descendantsOfType('callable_reference')[0];
        if (withArg) c.customSerializer = withArg;
      } else if (an === 'SerialName') c.serialName = annotationStringArgs(a)[0] ?? null;
    }
    const tps = child(d, 'type_parameters');
    if (tps) c.typeParams = children(tps, 'type_parameter').map((tp) => identOf(named(tp).find((x) => x.type === 'identifier') ?? null) ?? '_');
    const pc = child(d, 'primary_constructor');
    const cps = pc ? child(pc, 'class_parameters') : child(d, 'class_parameters');
    if (cps) {
      c.hasPrimaryCtor = true;
      c.ctorParams = children(cps, 'class_parameter').map((p) => paramOf(p));
    } else if (pc) c.hasPrimaryCtor = true;
    const ds = child(d, 'delegation_specifiers');
    if (ds) {
      for (const spec of children(ds, 'delegation_specifier')) {
        const ci = child(spec, 'constructor_invocation');
        if (ci) {
          c.superType = child(ci, 'user_type');
          c.superArgs = child(ci, 'value_arguments');
        } else {
          const t = named(spec).find((x) => x.type === 'user_type' || x.type === 'explicit_delegation' || x.type === 'function_type');
          if (t?.type === 'explicit_delegation') throw new Unsupported('interface delegation (by)', `${f.path}:${t.startPosition.row + 1}`);
          if (t) c.interfaces.push(t);
        }
      }
    }
    for (const p of c.ctorParams) {
      if (p.prop) {
        const ps: PropSym = {
          kind: 'prop',
          name: p.name,
          owner: c,
          pkg: f.pkg,
          file: f,
          node: p.node,
          isVal: p.prop === 'val',
          mods: p.mods,
          type: p.type,
          init: null,
          getter: null,
          setter: null,
          delegate: null,
          extReceiver: null,
          fromCtor: p,
          jsName: p.name,
        };
        c.props.set(p.name, ps);
        this.allProps.push(ps);
      }
    }
    const body = child(d, 'class_body') ?? child(d, 'enum_class_body');
    if (body) this.collectBody(body, c, f);
    this.allClasses.push(c);
    if (!local) this.classesByFqn.set(fqn, c);
    assignOverloadNames(c.funs);
    return c;
  }

  collectBody(body: Node, c: ClassSym, f: KFile): void {
    for (const m of named(body)) {
      switch (m.type) {
        case 'property_declaration':
          for (const p of this.collectProps(m, f, c)) {
            c.props.set(extKey(p), p);
            c.order.push(m);
          }
          break;
        case 'function_declaration': {
          const fn = this.collectFun(m, f, c);
          push(c.funs, fn.name, fn);
          break;
        }
        case 'class_declaration':
        case 'object_declaration': {
          const n = this.collectClass(m, f, c);
          c.nested.set(n.name, n);
          break;
        }
        case 'companion_object': {
          const n = this.collectClass(m, f, c);
          c.companion = n;
          c.nested.set(n.name, n);
          break;
        }
        case 'anonymous_initializer':
          c.initBlocks.push(m);
          c.order.push(m);
          break;
        case 'secondary_constructor':
          c.secondaryCtors.push(m);
          break;
        case 'enum_entry':
          c.enumEntries.push(m);
          break;
        case 'type_alias':
          break;
        default:
          break;
      }
    }
  }

  collectFun(d: Node, f: KFile, owner: ClassSym | null): FunSym {
    const mods = modifiersOf(d);
    const nameNode = field(d, 'name') ?? named(d).find((x) => x.type === 'identifier') ?? null;
    const name = identOf(nameNode) ?? '$anon';
    const fvp = child(d, 'function_value_parameters');
    const params = fvp ? children(fvp, 'parameter').map((p, i) => paramOf(p, fvp, i)) : [];
    // receiver type: a type node appearing before the name
    let extReceiver: Node | null = null;
    for (const c of named(d)) {
      if (c.id === nameNode?.id) break;
      if (c.type === 'user_type' || c.type === 'nullable_type' || c.type === 'function_type' || c.type === 'parenthesized_type') extReceiver = c;
    }
    const tps = child(d, 'type_parameters');
    const typeParams: string[] = [];
    const reified: string[] = [];
    if (tps) {
      for (const tp of children(tps, 'type_parameter')) {
        const n = identOf(named(tp).find((x) => x.type === 'identifier') ?? null) ?? '_';
        typeParams.push(n);
        if (tp.text.includes('reified')) reified.push(n);
      }
    }
    let returnType: Node | null = null;
    let after = false;
    for (const c of named(d)) {
      if (c.id === fvp?.id) {
        after = true;
        continue;
      }
      if (after && (c.type === 'user_type' || c.type === 'nullable_type' || c.type === 'function_type' || c.type === 'parenthesized_type')) {
        returnType = c;
        break;
      }
    }
    const body = child(d, 'function_body');
    const fn: FunSym = {
      kind: 'fun',
      name,
      owner,
      pkg: f.pkg,
      file: f,
      node: d,
      params,
      mods,
      extReceiver,
      typeParams,
      reified,
      returnType,
      body,
      jsName: name,
      isSuspend: mods.has('suspend'),
    };
    this.allFuns.push(fn);
    return fn;
  }

  collectProps(d: Node, f: KFile, owner: ClassSym | null): PropSym[] {
    const mods = modifiersOf(d);
    const isVal = /^\s*((@\S+|\w+)\s+)*val\b/.test(d.text.slice(0, 300).replace(/@\w+(\([^)]*\))?/g, ''));
    const vd = child(d, 'variable_declaration');
    const multi = child(d, 'multi_variable_declaration');
    if (multi) throw new Unsupported('destructuring property declaration at class/top level', `${f.path}:${d.startPosition.row + 1}`);
    if (!vd) throw new Unsupported('property without name', `${f.path}:${d.startPosition.row + 1}`);
    const name = identOf(named(vd).find((x) => x.type === 'identifier') ?? null) ?? '_';
    const type = named(vd).find((x) => x.type !== 'identifier') ?? null;
    let extReceiver: Node | null = null;
    for (const c of named(d)) {
      if (c.id === vd.id) break;
      if (c.type === 'user_type' || c.type === 'nullable_type') extReceiver = c;
    }
    const getter = child(d, 'getter');
    const setter = child(d, 'setter');
    const delegate = child(d, 'property_delegate');
    let init: Node | null = null;
    for (let i = 0; i < d.childCount; i++) {
      const c = d.child(i);
      if (c?.type === '=') {
        for (let j = i + 1; j < d.childCount; j++) {
          const e = d.child(j);
          if (e && e.isNamed && e.type !== 'line_comment' && e.type !== 'block_comment') {
            init = e;
            break;
          }
        }
        break;
      }
    }
    const p: PropSym = {
      kind: 'prop',
      name,
      owner,
      pkg: f.pkg,
      file: f,
      node: d,
      isVal,
      mods,
      type,
      init,
      getter,
      setter,
      delegate,
      extReceiver,
      fromCtor: null,
      jsName: extReceiver ? `${name}$extp` : name,
    };
    this.allProps.push(p);
    return [p];
  }
}

function extKey(p: PropSym): string {
  return p.extReceiver ? `${p.name}$extp` : p.name;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

function paramOf(p: Node, list?: Node, index?: number): Param {
  const mods = modifiersOf(p);
  const nameNode = named(p).find((x) => x.type === 'identifier') ?? null;
  const type = named(p).find((x) => x !== nameNode && (x.type === 'user_type' || x.type === 'nullable_type' || x.type === 'function_type' || x.type === 'parenthesized_type' || x.type === 'non_nullable_type')) ?? null;
  let def: Node | null = null;
  // class_parameter: default after '='; function parameter: default is a sibling after '=' in the list
  for (let i = 0; i < p.childCount; i++) {
    if (p.child(i)?.type === '=') {
      for (let j = i + 1; j < p.childCount; j++) {
        const e = p.child(j);
        if (e?.isNamed) {
          def = e;
          break;
        }
      }
    }
  }
  if (!def && list && index !== undefined) {
    // In function_value_parameters, `= default` follows the parameter node.
    let seen = -1;
    for (let i = 0; i < list.childCount; i++) {
      const c = list.child(i);
      if (c?.type === 'parameter') seen++;
      if (seen === index && c?.type === '=') {
        for (let j = i + 1; j < list.childCount; j++) {
          const e = list.child(j);
          if (e?.isNamed && e.type !== 'line_comment') {
            def = e;
            break;
          }
        }
        break;
      }
      if (seen > index) break;
    }
  }
  const text = p.text.replace(/@\w+(\([^)]*\))?/g, '').trim();
  const prop = /^((private|protected|internal|public|override|open|final)\s+)*val\b/.test(text) ? 'val' : /^((private|protected|internal|public|override|open|final)\s+)*var\b/.test(text) ? 'var' : null;
  const vararg = (child(p, 'parameter_modifiers')?.text ?? '').includes('vararg') || mods.has('vararg') || /^vararg\b/.test(text);
  return { name: identOf(nameNode) ?? '_', type, def, vararg, prop, node: p, annotations: annotations(p), mods };
}

/** Same-name methods in one class get `name$N` JS names plus a generated dispatcher. */
function assignOverloadNames(funs: Map<string, FunSym[]>): void {
  for (const [name, list] of funs) {
    const ext = list.filter((f) => f.extReceiver);
    const plain = list.filter((f) => !f.extReceiver);
    for (const f of ext) f.jsName = `${name}$ext`;
    if (ext.length > 1) ext.forEach((f, i) => (f.jsName = `${name}$ext$${i}`));
    if (plain.length > 1) plain.forEach((f, i) => (f.jsName = `${name}$${i}`));
  }
}

export function jsClassName(fqn: string): string {
  const parts = fqn.split('.');
  const pkgParts = parts.filter((p) => /^[a-z]/.test(p));
  const clsParts = parts.filter((p) => !/^[a-z]/.test(p));
  const pkgTag = pkgParts.slice(-1)[0] ?? '';
  return `C_${pkgTag}_${clsParts.join('$')}`.replace(/[^\w$]/g, '_');
}

export function typeName(t: Node | null): string | null {
  if (!t) return null;
  if (t.type === 'nullable_type' || t.type === 'non_nullable_type' || t.type === 'parenthesized_type') return typeName(named(t)[0] ?? null);
  if (t.type === 'user_type') return named(t).filter((x) => x.type === 'identifier').map((x) => x.text).join('.');
  return null;
}

export { children, child, named };

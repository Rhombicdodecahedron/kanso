// Translate one extension directory into a bundle.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { initParser, parseKotlin } from './parser';
import { parseGradle, type ExtensionMeta } from './gradle';
import { Program, Unsupported } from './syms';
import { Compiler } from './compiler';
import { RuntimeInfo } from './runtime-info';
import { annotationName, annotations } from './parser';
import { preprocess } from './preprocess';

/** lib/ modules implemented by hand in the runtime (not translated). */
const SHIMMED_LIBS = new Set(['i18n']);

export interface TranslateOk {
  ok: true;
  pkg: string;
  meta: ExtensionMeta;
  code: string;
  sha256: string;
  warnings: string[];
}
export interface TranslateErr {
  ok: false;
  pkg: string;
  meta: ExtensionMeta | null;
  reason: string;
  where?: string;
}
export type TranslateResult = TranslateOk | TranslateErr;

function ktFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...ktFiles(p));
    else if (e.name.endsWith('.kt')) out.push(p);
  }
  return out;
}

function assetFiles(dir: string, into: Record<string, string>): void {
  if (!fs.existsSync(dir)) return;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(properties|json|txt|js)$/.test(e.name)) into[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
}

let rtInfo: RuntimeInfo | null = null;

function parseChecked(repo: string, f: string) {
  const root = parseKotlin(preprocess(fs.readFileSync(f, 'utf8')));
  if (root.hasError) {
    const err = root.descendantsOfType('ERROR')[0];
    const at = err ? `:${err.startPosition.row + 1}` : '';
    throw new Unsupported('Kotlin parse error', path.relative(repo, f) + at);
  }
  return root;
}

export async function translateExtension(repo: string, extDir: string): Promise<TranslateResult> {
  await initParser();
  rtInfo ??= new RuntimeInfo();
  const rel = path.relative(path.join(repo, 'src'), extDir).split(path.sep);
  let meta: ExtensionMeta | null = null;
  const pkgFallback = `eu.kanade.tachiyomi.extension.${rel.join('.')}`;
  try {
    meta = parseGradle(fs.readFileSync(path.join(extDir, 'build.gradle.kts'), 'utf8'));
    const pkg = `eu.kanade.tachiyomi.extension.${meta.pkgName ?? rel.join('.')}`;
    if (meta.libVersion !== '1.6') throw new Unsupported(`legacy extension lib ${meta.libVersion}`);
    const prog = new Program();
    const assets: Record<string, string> = {};
    const libDirs = new Set<string>();
    const addDeps = (deps: string[]) => {
      for (const d of deps) {
        const m = /^:lib:(.+)$/.exec(d);
        if (m) libDirs.add(m[1]);
      }
    };
    addDeps(meta.deps);
    if (meta.theme) {
      const themeDir = path.join(repo, 'lib-multisrc', meta.theme);
      if (!fs.existsSync(themeDir)) throw new Unsupported(`missing theme ${meta.theme}`);
      const tmeta = parseGradle(fs.readFileSync(path.join(themeDir, 'build.gradle.kts'), 'utf8'));
      addDeps(tmeta.deps);
      for (const f of ktFiles(path.join(themeDir, 'src'))) prog.addFile(path.relative(repo, f), parseChecked(repo, f));
      assetFiles(path.join(themeDir, 'assets'), assets);
    }
    for (const lib of libDirs) {
      if (SHIMMED_LIBS.has(lib)) continue;
      const libDir = path.join(repo, 'lib', lib);
      if (!fs.existsSync(libDir)) throw new Unsupported(`missing lib ${lib}`);
      for (const f of ktFiles(path.join(libDir, 'src'))) prog.addFile(path.relative(repo, f), parseChecked(repo, f));
    }
    const extFiles = ktFiles(path.join(extDir, 'src'));
    for (const f of extFiles) {
      prog.addFile(path.relative(repo, f), parseChecked(repo, f));
    }
    assetFiles(path.join(extDir, 'assets'), assets);
    // main class: @Source in the extension's files
    const extRel = new Set(extFiles.map((f) => path.relative(repo, f)));
    const main = prog.allClasses.find((c) => extRel.has(c.file.path) && annotations(c.node).some((a) => annotationName(a) === 'Source'));
    if (!main) throw new Unsupported('no @Source class');
    const compiler = new Compiler(prog, rtInfo);
    const sources = meta.sources.map((s) => ({
      className: main,
      name: s.name ?? meta!.name,
      lang: s.lang,
      baseUrl: s.baseUrl ?? '',
      id: s.id,
      versionId: s.versionId,
      mirrors: s.mirrors,
      customBaseUrl: s.customBaseUrl,
    }));
    const res = compiler.compileBundle(sources, assets);
    const sha256 = createHash('sha256').update(res.code).digest('hex');
    return { ok: true, pkg, meta, code: res.code, sha256, warnings: res.warnings };
  } catch (e) {
    if (e instanceof Unsupported) return { ok: false, pkg: pkgFallback, meta, reason: e.reason, where: e.where };
    return { ok: false, pkg: pkgFallback, meta, reason: `translator error: ${(e as Error).message}`, where: (e as Error).stack?.split('\n')[1]?.trim() };
  }
}

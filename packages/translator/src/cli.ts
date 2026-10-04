// kanso-translate --src <extensions-source> --out <repo dir> [--only lang/name,...] [--jobs N]
// Translates every extension, writes bundles + index.min.json + report.{json,md}.

import fs from 'node:fs';
import path from 'node:path';
import { translateExtension, type TranslateResult } from './translate';
import { generateId } from '@kanso/source-api/src/source';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const src = path.resolve(arg('src') ?? '../../../extensions-source');
const out = path.resolve(arg('out') ?? '../../repo');
const only = arg('only')?.split(',') ?? null;
fs.mkdirSync(out, { recursive: true });

const dirs: string[] = [];
for (const lang of fs.readdirSync(path.join(src, 'src'))) {
  for (const ext of fs.readdirSync(path.join(src, 'src', lang))) {
    const d = path.join(src, 'src', lang, ext);
    if (!fs.existsSync(path.join(d, 'build.gradle.kts'))) continue;
    if (only && !only.includes(`${lang}/${ext}`)) continue;
    dirs.push(d);
  }
}

const results: TranslateResult[] = [];
const t0 = Date.now();
for (const [i, d] of dirs.entries()) {
  const r = await translateExtension(src, d);
  results.push(r);
  if (process.stdout.isTTY) process.stdout.write(`\r${i + 1}/${dirs.length} ${r.ok ? 'ok  ' : 'fail'} ${path.relative(path.join(src, 'src'), d)}`.padEnd(80));
}
if (process.stdout.isTTY) process.stdout.write('\n');

const index: any[] = [];
for (const r of results) {
  if (!r.ok) continue;
  const file = `${r.pkg}.js`;
  fs.writeFileSync(path.join(out, file), r.code);
  const m = r.meta;
  index.push({
    name: m.name,
    pkg: r.pkg,
    file,
    lang: m.sources.length > 1 && new Set(m.sources.map((s) => s.lang)).size > 1 ? 'all' : (m.sources[0]?.lang ?? 'all'),
    version: `${m.libVersion}.${m.versionCode}`,
    nsfw: m.contentWarning === 'NSFW' ? 1 : 0,
    contentWarning: m.contentWarning,
    theme: m.theme,
    sha256: r.sha256,
    size: Buffer.byteLength(r.code),
    sources: m.sources.map((s) => {
      const name = s.name ?? m.name;
      return { name, lang: s.lang, id: s.id ?? generateId(name, s.lang, s.versionId), baseUrl: s.baseUrl };
    }),
  });
}
fs.writeFileSync(path.join(out, 'index.min.json'), JSON.stringify(index));

// report
const fails = results.filter((r): r is Extract<TranslateResult, { ok: false }> => !r.ok);
const reasons = new Map<string, number>();
for (const f of fails) {
  const key = f.reason.replace(/\b(?:[A-Z][\w$]*|[a-z][\w$]*)$/, (m) => m);
  reasons.set(key, (reasons.get(key) ?? 0) + 1);
}
const byTheme = new Map<string, { ok: number; fail: number }>();
for (const r of results) {
  const th = r.meta?.theme ?? '(standalone)';
  const e = byTheme.get(th) ?? { ok: 0, fail: 0 };
  if (r.ok) e.ok++;
  else e.fail++;
  byTheme.set(th, e);
}
const report = {
  generatedAt: new Date().toISOString(),
  seconds: Math.round((Date.now() - t0) / 1000),
  total: results.length,
  translated: results.length - fails.length,
  failed: fails.length,
  topReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60),
  byTheme: Object.fromEntries([...byTheme.entries()].sort((a, b) => b[1].ok + b[1].fail - (a[1].ok + a[1].fail))),
  failures: fails.map((f) => ({ pkg: f.pkg, reason: f.reason, where: f.where })),
};
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const md = [
  `# Translation report`,
  ``,
  `${report.translated}/${report.total} extensions translated (${((100 * report.translated) / Math.max(1, report.total)).toFixed(1)}%) in ${report.seconds}s.`,
  ``,
  `## Top rejection reasons`,
  ``,
  ...report.topReasons.map(([r, n]) => `- ${n} × ${r}`),
  ``,
  `## By theme`,
  ``,
  `| theme | ok | failed |`,
  `|---|---|---|`,
  ...[...byTheme.entries()].map(([t, e]) => `| ${t} | ${e.ok} | ${e.fail} |`),
].join('\n');
fs.writeFileSync(path.join(out, 'report.md'), md);
console.log(`${report.translated}/${report.total} translated`);
console.log(report.topReasons.slice(0, 25).map(([r, n]) => `${String(n).padStart(4)}  ${r}`).join('\n'));

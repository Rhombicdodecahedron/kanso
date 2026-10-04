// Live smoke test over many bundles: kanso-harness-batch --repo ../../repo [--theme madara] [--limit 50] [--jobs 8]
import fs from 'node:fs';
import path from 'node:path';
import { smokeTest, type StageResult } from './index';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const repo = path.resolve(arg('repo') ?? '../../repo');
const theme = arg('theme');
const limit = Number(arg('limit') ?? 1e9);
const jobs = Number(arg('jobs') ?? 8);
const timeoutMs = Number(arg('timeout') ?? 60000);
const nsfw = process.argv.includes('--nsfw');

const index: any[] = JSON.parse(fs.readFileSync(path.join(repo, 'index.min.json'), 'utf8'));
let list = index.filter((e) => (!theme || (e.theme ?? 'standalone') === theme) && (nsfw || !e.nsfw));
list = list.slice(0, limit);

interface Row {
  pkg: string;
  name: string;
  theme: string | null;
  stages: StageResult[];
  passed: boolean;
}
const rows: Row[] = [];
let next = 0;
async function worker() {
  while (next < list.length) {
    const e = list[next++];
    const code = fs.readFileSync(path.join(repo, e.file), 'utf8');
    const timeout = new Promise<StageResult[]>((r) => setTimeout(() => r([{ stage: 'timeout', ok: false, ms: timeoutMs, detail: 'timed out' }]), timeoutMs));
    const stages = await Promise.race([smokeTest(code, { pkg: e.pkg }), timeout]);
    const passed = stages.some((s) => s.stage === 'image') && stages.every((s) => s.ok);
    rows.push({ pkg: e.pkg, name: e.name, theme: e.theme, stages, passed });
    const last = stages[stages.length - 1];
    console.log(`${passed ? 'PASS' : 'FAIL'} ${e.name.padEnd(28)} ${passed ? '' : `${last.stage}: ${last.detail.slice(0, 110)}`}`);
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
const failures = new Map<string, number>();
for (const r of rows) {
  if (r.passed) continue;
  const f = r.stages.find((s) => !s.ok) ?? r.stages[r.stages.length - 1];
  const key = `${f.stage}: ${f.detail.replace(/https?:\/\/\S+/g, '<url>').replace(/\d{3,}/g, 'N').slice(0, 90)}`;
  failures.set(key, (failures.get(key) ?? 0) + 1);
}
const passed = rows.filter((r) => r.passed).length;
fs.writeFileSync(path.join(repo, 'harness.json'), JSON.stringify({ at: new Date().toISOString(), passed, total: rows.length, rows }, null, 2));
console.log(`\n${passed}/${rows.length} passed all stages`);
console.log([...failures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => `${String(n).padStart(4)}  ${k}`).join('\n'));
process.exit(0);

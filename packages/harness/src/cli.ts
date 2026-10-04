import fs from 'node:fs';
import { smokeTest } from './index';

const [file, idx] = process.argv.slice(2);
if (!file) {
  console.error('usage: kanso-harness <bundle.js> [sourceIndex]');
  process.exit(2);
}
const res = await smokeTest(fs.readFileSync(file, 'utf8'), { sourceIndex: idx ? Number(idx) : 0, log: !!process.env.KANSO_LOG });
for (const r of res) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.stage.padEnd(8)} ${String(r.ms).padStart(6)}ms  ${r.detail}`);
process.exit(res.every((r) => r.ok) && res.some((r) => r.stage === 'image') ? 0 : 1);

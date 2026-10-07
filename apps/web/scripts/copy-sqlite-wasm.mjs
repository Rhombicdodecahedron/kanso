// SQLite runs in a worker served from /sqlite/: the sqlite-wasm build (module + WebAssembly) and
// our worker script next to it. Bundlers cannot follow the workers sqlite-wasm itself creates,
// so these files are copied as-is before dev and build.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve('@sqlite.org/sqlite-wasm/package.json')), 'dist');
const out = join('public', 'sqlite');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ['index.mjs', 'sqlite3.wasm']) copyFileSync(join(dist, f), join(out, f));
copyFileSync(join('src', 'adapters', 'sqlite', 'sqlite-worker.mjs'), join(out, 'worker.mjs'));

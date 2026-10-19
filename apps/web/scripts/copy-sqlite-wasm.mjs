// The sqlite-wasm build (module + WebAssembly) is served as-is from /sqlite/: bundlers cannot
// follow the URLs it builds for its own files, so it is copied before dev and build.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve('@sqlite.org/sqlite-wasm/package.json')), 'dist');
const out = join('public', 'sqlite');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ['index.mjs', 'sqlite3.wasm']) copyFileSync(join(dist, f), join(out, f));

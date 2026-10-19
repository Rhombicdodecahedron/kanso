import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll } from 'vitest';

import { syncStoreContract } from '@kanso/core/testing';

import { createTursoSyncStore } from '../src';

// A local libSQL file per test: the same engine and SQL as a Turso database, no network.
const dir = mkdtempSync(join(tmpdir(), 'kanso-turso-'));
let n = 0;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

syncStoreContract('Turso (libSQL)', async () => createTursoSyncStore({ url: `file:${join(dir, `db${++n}.sqlite`)}` }));

// Top-level inline higher-order stdlib functions (buildList, with, run, repeat, runCatching...)
// in sync and async (suspending-lambda) flavours.

import { buildersHof } from './stdlib';
import { hofFn } from './hof';

export const hofSync: Record<string, (...a: any[]) => any> = Object.create(null);
export const hofAsync: Record<string, (...a: any[]) => any> = Object.create(null);

for (const [name, gen] of Object.entries(buildersHof)) {
  const { fn, async } = hofFn(gen as any);
  hofSync[name] = fn;
  hofAsync[name] = async;
}

/** Builders whose lambda takes a receiver (passed as the lambda's first argument). */
export const RECEIVER_BUILDERS = new Set(['buildList', 'buildSet', 'buildMap', 'buildString', 'with']);

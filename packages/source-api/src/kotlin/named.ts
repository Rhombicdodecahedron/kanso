import { IllegalArgumentException } from './core';

/** Named arguments passed to a runtime (non-translated) function or constructor. */
export class Named {
  constructor(readonly values: Record<string, any>) {}
}

export function named(values: Record<string, any>): Named {
  return new Named(values);
}

/** Reorder `args` (whose last element may be Named) to positional using parameter names. */
export function positional(params: readonly string[], args: any[], what = 'function'): any[] {
  const last = args[args.length - 1];
  if (!(last instanceof Named)) return args;
  const out = args.slice(0, -1);
  for (const [k, v] of Object.entries(last.values)) {
    const i = params.indexOf(k);
    if (i < 0) throw new IllegalArgumentException(`Unknown named argument '${k}' for ${what}`);
    while (out.length < i) out.push(undefined);
    out[i] = v;
  }
  return out;
}

/** `new C(...args)` where args may end with Named; runtime classes declare static $params. */
export function construct(C: any, args: any[]): any {
  const last = args[args.length - 1];
  if (last instanceof Named) {
    if (!C.$params) throw new IllegalArgumentException(`Named arguments not supported for ${C.name}`);
    return new C(...positional(C.$params, args, C.name));
  }
  return new C(...args);
}

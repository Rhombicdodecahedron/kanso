import type { ExtDef, Fn } from './core';

// Higher-order stdlib functions are written once as generators that `yield` every lambda
// call. The sync driver feeds results straight back; the async driver awaits them. This lets
// translated code call `map { client.get(it) }` inside a suspend function.

type Gen = Generator<any, any, any>;

export function runSync(g: Gen): any {
  let r = g.next();
  while (!r.done) r = g.next(r.value);
  return r.value;
}

export async function runAsync(g: Gen): Promise<any> {
  let r = g.next();
  while (!r.done) {
    let v: any;
    try {
      v = await r.value;
    } catch (e) {
      r = g.throw(e);
      continue;
    }
    r = g.next(v);
  }
  return r.value;
}

export function hofFn(gen: (...args: any[]) => Gen): { fn: Fn; async: Fn } {
  return {
    fn: (...args: any[]) => runSync(gen(...args)),
    async: (...args: any[]) => runAsync(gen(...args)),
  };
}

export function ext(name: string, recv: (x: any) => boolean, fn: Fn): ExtDef {
  return { name, recv, fn };
}

export function hof(name: string, recv: (x: any) => boolean, gen: (...args: any[]) => Gen, recvLambda = false): ExtDef {
  const { fn, async } = hofFn(gen);
  return recvLambda ? { name, recv, fn, async, recvLambda } : { name, recv, fn, async };
}

export function extProp(name: string, recv: (x: any) => boolean, get: Fn, set?: Fn): ExtDef {
  return { name, recv, fn: get, prop: true, set };
}

// kotlinx.coroutines on top of promises. Suspend functions return promises; the translator
// awaits them. Coroutine builders run their (async) lambdas immediately.

import { CancellationException, IllegalStateException, TimeoutCancellationException } from './core';
import type { ExtDef } from './core';

export class Job {
  protected cancelled = false;
  constructor(readonly promise: Promise<any> = Promise.resolve()) {}
  get isActive(): boolean {
    return !this.cancelled;
  }
  get isCancelled(): boolean {
    return this.cancelled;
  }
  get isCompleted(): boolean {
    return false;
  }
  cancel(_cause?: any): void {
    this.cancelled = true;
  }
  join(): Promise<void> {
    return this.promise.then(
      () => undefined,
      () => undefined,
    );
  }
  invokeOnCompletion(f: (e: any) => void): void {
    this.promise.then(
      () => f(null),
      (e) => f(e),
    );
  }
}

export class Deferred<T> extends Job {
  private done = false;
  constructor(promise: Promise<T>) {
    super(promise);
    promise.then(
      () => {
        this.done = true;
      },
      () => {
        this.done = true;
      },
    );
    // Unobserved rejections are surfaced through await(); avoid unhandled-rejection noise.
    promise.catch(() => {});
  }
  get isCompleted(): boolean {
    return this.done;
  }
  await(): Promise<T> {
    return this.promise as Promise<T>;
  }
  getCompleted(): T {
    throw new IllegalStateException('Use await()');
  }
}

/** A CoroutineScope is just a receiver for async/launch; structured concurrency is approximated. */
export class CoroutineScope {
  readonly jobs: Job[] = [];
  constructor(readonly coroutineContext: any = null) {}
  get isActive(): boolean {
    return true;
  }
  cancel(): void {
    for (const j of this.jobs) j.cancel();
  }
}

export const GlobalScope = new CoroutineScope();

export const Dispatchers = {
  IO: { name: 'IO', limitedParallelism: () => Dispatchers.IO },
  Default: { name: 'Default', limitedParallelism: () => Dispatchers.Default },
  Main: { name: 'Main', immediate: { name: 'Main.immediate' } },
  Unconfined: { name: 'Unconfined' },
};

export const CoroutineStart = { DEFAULT: 'DEFAULT', LAZY: 'LAZY', ATOMIC: 'ATOMIC', UNDISPATCHED: 'UNDISPATCHED' };

function lambdaOf(args: any[]): (...a: any[]) => any {
  for (let i = args.length - 1; i >= 0; i--) if (typeof args[i] === 'function') return args[i];
  throw new IllegalStateException('Missing coroutine block');
}

export async function coroutineScope(f: (s: CoroutineScope) => any): Promise<any> {
  const scope = new CoroutineScope();
  try {
    const r = await f(scope);
    // Like structured concurrency: wait for children launched in this scope.
    await Promise.all(scope.jobs.map((j) => j.promise));
    return r;
  } catch (e) {
    scope.cancel();
    throw e;
  }
}
export const supervisorScope = coroutineScope;

export async function withContext(_ctx: any, f: (s: CoroutineScope) => any): Promise<any> {
  return f(new CoroutineScope(_ctx));
}

/** runBlocking cannot block in JS; the translator treats it as a suspend call. */
export async function runBlocking(...args: any[]): Promise<any> {
  return lambdaOf(args)(new CoroutineScope());
}

export function asyncBuilder(scope: any, ...args: any[]): Deferred<any> {
  const f = lambdaOf(args);
  const s = scope instanceof CoroutineScope ? scope : new CoroutineScope();
  const d = new Deferred(Promise.resolve().then(() => f(s)));
  if (scope instanceof CoroutineScope) scope.jobs.push(d);
  return d;
}

export function launch(scope: any, ...args: any[]): Job {
  const f = lambdaOf(args);
  const s = scope instanceof CoroutineScope ? scope : new CoroutineScope();
  const p = Promise.resolve().then(() => f(s));
  p.catch((e) => console.warn('[kanso] launched coroutine failed', e));
  const j = new Job(p);
  if (scope instanceof CoroutineScope && scope !== GlobalScope) scope.jobs.push(j);
  return j;
}

export function delay(ms: any): Promise<void> {
  const t = typeof ms === 'number' ? ms : (ms?.inWholeMilliseconds ?? 0);
  return new Promise((r) => setTimeout(r, Math.max(0, t)));
}

export function awaitAll(...xs: any[]): Promise<any[]> {
  const list = xs.length === 1 && Array.isArray(xs[0]) ? xs[0] : xs;
  return Promise.all(list.map((d: any) => (d instanceof Deferred ? d.await() : d)));
}

export function joinAll(...xs: any[]): Promise<void> {
  const list = xs.length === 1 && Array.isArray(xs[0]) ? xs[0] : xs;
  return Promise.all(list.map((j: any) => j.join())).then(() => undefined);
}

export async function withTimeout(ms: any, f: (s: CoroutineScope) => any): Promise<any> {
  const t = typeof ms === 'number' ? ms : ms.inWholeMilliseconds;
  let timer: any;
  try {
    return await Promise.race([
      f(new CoroutineScope()),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new TimeoutCancellationException(`Timed out waiting for ${t} ms`)), t);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withTimeoutOrNull(ms: any, f: (s: CoroutineScope) => any): Promise<any> {
  try {
    return await withTimeout(ms, f);
  } catch (e) {
    if (e instanceof TimeoutCancellationException) return null;
    throw e;
  }
}

export function yieldCoroutine(): Promise<void> {
  return Promise.resolve();
}

export function ensureActive(): void {}

export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  private locked = false;
  get isLocked(): boolean {
    return this.locked;
  }
  async lock(_owner?: any): Promise<void> {
    let release!: () => void;
    const prev = this.tail;
    this.tail = new Promise<void>((r) => (release = r));
    await prev;
    this.locked = true;
    this.$release = release;
  }
  tryLock(): boolean {
    if (this.locked) return false;
    this.locked = true;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    this.$release = release;
    return true;
  }
  unlock(): void {
    this.locked = false;
    const r = this.$release;
    this.$release = null;
    r?.();
  }
  private $release: (() => void) | null = null;
}

export class Semaphore {
  private waiting: (() => void)[] = [];
  constructor(private permits: number) {}
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    await new Promise<void>((r) => this.waiting.push(r));
  }
  release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.permits++;
  }
  get availablePermits(): number {
    return this.permits;
  }
}

export function SupervisorJob(): Job {
  return new Job();
}
export function JobCtor(): Job {
  return new Job();
}

export function CoroutineScopeFn(ctx?: any): CoroutineScope {
  return new CoroutineScope(ctx);
}

export function CancellationExceptionCtor(msg?: string): CancellationException {
  return new CancellationException(msg);
}

// Extension-style coroutine functions (receiver first).
export const coroutineExts: Record<string, ExtDef[]> = {
  async: [{ name: 'async', recv: () => true, fn: asyncBuilder, suspendLambda: true, recvLambda: true, recvType: CoroutineScope } as any],
  launch: [{ name: 'launch', recv: () => true, fn: launch, suspendLambda: true, recvLambda: true, recvType: CoroutineScope } as any],
  awaitAll: [{ name: 'awaitAll', recv: (x: any) => Array.isArray(x), fn: (xs: any[]) => awaitAll(xs), suspend: true } as ExtDef],
  joinAll: [{ name: 'joinAll', recv: (x: any) => Array.isArray(x), fn: (xs: any[]) => joinAll(xs), suspend: true } as ExtDef],
  withLock: [
    {
      name: 'withLock',
      recv: (x: any) => x instanceof Mutex,
      fn: async (m: Mutex, ...args: any[]) => {
        await m.lock();
        try {
          return await lambdaOf(args)();
        } finally {
          m.unlock();
        }
      },
      suspend: true,
      inline: true,
    } as ExtDef,
    {
      // kotlin.concurrent.withLock on a ReentrantLock: synchronous.
      name: 'withLock',
      recv: () => true,
      fn: (_l: any, f: () => any) => f(),
      inline: true,
    } as ExtDef,
  ],
  withPermit: [
    {
      name: 'withPermit',
      recv: (x: any) => x instanceof Semaphore,
      fn: async (s: Semaphore, f: () => any) => {
        await s.acquire();
        try {
          return await f();
        } finally {
          s.release();
        }
      },
      suspend: true,
      inline: true,
    } as ExtDef,
  ],
  cancel: [{ name: 'cancel', recv: (x: any) => x instanceof CoroutineScope || x instanceof Job, fn: (x: any) => x.cancel() } as ExtDef],
  isActive: [{ name: 'isActive', recv: () => true, fn: () => true, prop: true } as ExtDef],
  ensureActive: [{ name: 'ensureActive', recv: () => true, fn: () => undefined } as ExtDef],
};

/** Top-level coroutine functions with their suspend metadata (read by the translator). */
export const coroutineFns = {
  coroutineScope: Object.assign(coroutineScope, { $suspend: true, $suspendLambda: true, $recvLambda: true, $recvType: CoroutineScope }),
  supervisorScope: Object.assign(supervisorScope, { $suspend: true, $suspendLambda: true, $recvLambda: true, $recvType: CoroutineScope }),
  withContext: Object.assign(withContext, { $suspend: true, $suspendLambda: true, $recvLambda: true, $recvType: CoroutineScope }),
  runBlocking: Object.assign(runBlocking, { $suspend: true, $suspendLambda: true, $infect: true, $recvLambda: true }),
  delay: Object.assign(delay, { $suspend: true }),
  awaitAll: Object.assign(awaitAll, { $suspend: true }),
  joinAll: Object.assign(joinAll, { $suspend: true }),
  withTimeout: Object.assign(withTimeout, { $suspend: true, $suspendLambda: true, $recvLambda: true }),
  withTimeoutOrNull: Object.assign(withTimeoutOrNull, { $suspend: true, $suspendLambda: true, $recvLambda: true }),
  yield: Object.assign(yieldCoroutine, { $suspend: true }),
  async: Object.assign((...a: any[]) => asyncBuilder(GlobalScope, ...a), { $suspendLambda: true }),
  launch: Object.assign((...a: any[]) => launch(GlobalScope, ...a), { $suspendLambda: true }),
};

/** Member names on runtime objects that return promises (awaited inside suspend code). */
export const SUSPEND_MEMBERS = new Set(['await', 'awaitSuccess', 'join', 'lock', 'acquire', 'awaitSingle', 'awaitFirst']);
/** Member names that are synchronous in Kotlin but async here; they make the caller async. */
export const INFECTING_MEMBERS = new Set(['execute', 'proceed']);

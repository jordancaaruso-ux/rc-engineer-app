import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";

import { PERF_ENABLED } from "@/lib/perf/perfConfig";

/** One timed Prisma call: model, operation, milliseconds. Kept terse — it is stored as JSON. */
export type PerfQuery = { m: string; o: string; ms: number };

export type PerfStore = {
  kind: "page" | "api";
  /** Normalized route key. Null until the entry point learns it. */
  route: string | null;
  method: string | null;
  /** `performance.now()` at the start of the request. */
  startedAt: number;
  queryCount: number;
  dbMs: number;
  /** Slowest queries, sorted descending, capped at MAX_SLOW_QUERIES. */
  slowest: PerfQuery[];
  /** Named `perfSpan()` phases, summed if a label repeats. */
  phases: Record<string, number>;
  /** First request served by this process — i.e. the request that paid for the boot. */
  coldStart: boolean;
  /** Milliseconds since this process loaded, at the moment the request started. */
  processAgeMs: number;
  /** True once the store has been claimed by an entry point (see `currentPerfStore`). */
  seeded: boolean;
  /** True once an `after()` flush has been scheduled — guards double registration. */
  registered: boolean;
  /** True once written — guards a double write if `after()` somehow fires twice. */
  flushed: boolean;
};

const MAX_SLOW_QUERIES = 5;
/** A single request with more phases than this is a bug; cap so the JSON stays small. */
const MAX_PHASES = 40;

const als = new AsyncLocalStorage<PerfStore>();

/*
 * Cold-start detection.
 *
 * The dashboard renders in ~264ms server-side but the browser sees ~2.5s TTFB, and the
 * ~2.3s gap is spent before the root layout ever runs — so nothing measured inside the
 * render can explain it. These two fields attribute it: `coldStart` marks the first
 * request a freshly booted process serves, and `processAgeMs` says how long that process
 * had been alive. If slow requests cluster at a low process age, it is lambda boot, and
 * no query change will touch it.
 */
const PROCESS_BOOT_AT = performance.now();
let requestsServed = 0;

export function claimRequestOrdinal(): { coldStart: boolean; processAgeMs: number } {
  requestsServed += 1;
  return {
    coldStart: requestsServed === 1,
    processAgeMs: performance.now() - PROCESS_BOOT_AT,
  };
}

export function createPerfStore(kind: PerfStore["kind"]): PerfStore {
  const { coldStart, processAgeMs } = claimRequestOrdinal();
  return {
    kind,
    route: null,
    method: null,
    startedAt: performance.now(),
    queryCount: 0,
    dbMs: 0,
    slowest: [],
    phases: {},
    coldStart,
    processAgeMs,
    seeded: false,
    registered: false,
    flushed: false,
  };
}

/**
 * Per-render carrier. React gives one instance per render pass, which is the only
 * mechanism available for an RSC tree: a root layout returns JSX and its children
 * render later, so there is no callback we could wrap in `als.run()`.
 *
 * Outside a render React's `cache()` falls through and invokes the factory directly
 * (it does not throw), so every call there yields a fresh, unseeded store — which is
 * exactly how `currentPerfStore` tells the two situations apart.
 */
const renderPerfStore = cache((): PerfStore => createPerfStore("page"));

/**
 * The store for the current request, or null if nothing has claimed one.
 *
 * Route handlers are a single linear async context, so AsyncLocalStorage is the right
 * tool and is checked first. RSC renders fall back to the React cache carrier, which
 * only counts once `beginPagePerf` has seeded it.
 */
export function currentPerfStore(): PerfStore | null {
  if (!PERF_ENABLED) return null;
  const fromAls = als.getStore();
  if (fromAls) return fromAls;
  const fromRender = renderPerfStore();
  return fromRender.seeded ? fromRender : null;
}

/**
 * Claim the render-scoped store for this page render. Returns null when the layer is
 * off or when called outside a render (where the cached store can never be re-read).
 */
export function seedRenderPerfStore(route: string | null): PerfStore | null {
  if (!PERF_ENABLED) return null;
  const store = renderPerfStore();
  if (store.seeded) return store;
  store.seeded = true;
  store.route = route;
  // `cache()` memoizes the factory's return value, not the clock, and the factory
  // runs on first access — which is here, at the top of the root layout.
  store.startedAt = performance.now();
  return store;
}

/**
 * Open an ALS scope for a route handler.
 *
 * MUST be called synchronously, before the caller's first `await`. `enterWith` applies
 * to the remainder of the current *synchronous* execution and to continuations created
 * during it — so calling it at the top of a helper that the handler invokes before its
 * own first await puts the whole handler in scope. Call it after an await instead and
 * the store reaches nothing but that helper's own tail, which is why the route is filled
 * in later by `attachPerfRoute` rather than passed in here.
 */
export function enterApiPerfScope(): PerfStore | null {
  if (!PERF_ENABLED) return null;
  const existing = als.getStore();
  if (existing) return existing;
  const store = createPerfStore("api");
  store.seeded = true;
  als.enterWith(store);
  return store;
}

/** Late-bind the route once `headers()` has resolved. Never overwrites an explicit key. */
export function setPerfRoute(store: PerfStore, route: string, method: string | null): void {
  if (store.route === null) store.route = route;
  if (store.method === null) store.method = method;
}

/** Strict ALS scope, used by `withPerfRoute` where we do control the callback. */
export function runWithPerf<T>(store: PerfStore, fn: () => T): T {
  return als.run(store, fn);
}

export function recordQuery(store: PerfStore, model: string, operation: string, ms: number): void {
  store.queryCount += 1;
  store.dbMs += ms;
  if (store.slowest.length < MAX_SLOW_QUERIES) {
    store.slowest.push({ m: model, o: operation, ms });
    store.slowest.sort((a, b) => b.ms - a.ms);
    return;
  }
  const weakest = store.slowest[MAX_SLOW_QUERIES - 1];
  if (weakest && ms > weakest.ms) {
    store.slowest[MAX_SLOW_QUERIES - 1] = { m: model, o: operation, ms };
    store.slowest.sort((a, b) => b.ms - a.ms);
  }
}

export function recordPhase(store: PerfStore, label: string, ms: number): void {
  const existing = store.phases[label];
  if (existing === undefined && Object.keys(store.phases).length >= MAX_PHASES) return;
  store.phases[label] = (existing ?? 0) + ms;
}

import "server-only";

import { headers } from "next/headers";

import { PERF_ENABLED } from "@/lib/perf/perfConfig";
import type { PerfStore } from "@/lib/perf/perfStore";
import { enterApiPerfScope, seedRenderPerfStore, setPerfRoute } from "@/lib/perf/perfStore";
import { schedulePerfFlush } from "@/lib/perf/recordSample";
import { normalizeRoutePath, shouldSkipPerf } from "@/lib/perf/routeKey";

/** Request headers stamped by `src/middleware.ts` — App Router exposes no reliable built-in. */
export const PERF_PATH_HEADER = "x-rc-perf-path";
export const PERF_METHOD_HEADER = "x-rc-perf-method";

async function readStampedRoute(): Promise<{ route: string | null; method: string | null }> {
  try {
    const requestHeaders = await headers();
    const rawPath = requestHeaders.get(PERF_PATH_HEADER);
    return {
      route: rawPath ? normalizeRoutePath(rawPath) : null,
      method: requestHeaders.get(PERF_METHOD_HEADER),
    };
  } catch {
    // `headers()` throws outside a request scope (scripts, build-time evaluation).
    return { route: null, method: null };
  }
}

/**
 * Open the perf scope for a route handler.
 *
 * Two-step on purpose, and the order is load-bearing:
 *
 *   1. `beginApiPerf()` — SYNCHRONOUS, must be the caller's first statement. This is
 *      what puts the whole handler in scope (see `enterApiPerfScope`). An earlier
 *      version did the `enterWith` after `await headers()` and silently attributed
 *      zero queries on every API route, because by then the handler's continuation had
 *      already been created outside the store.
 *   2. `attachPerfRoute(store)` — async, once the route is known from the request
 *      headers. Safe to await anywhere before the response.
 *
 * A route already wrapped in `withPerfRoute` has an ALS scope open, so step 1 returns
 * that store and step 2 leaves its explicit route key alone.
 */
export function beginApiPerf(): PerfStore | null {
  if (!PERF_ENABLED) return null;
  return enterApiPerfScope();
}

export async function attachPerfRoute(store: PerfStore): Promise<void> {
  if (!PERF_ENABLED) return;
  const { route, method } = await readStampedRoute();
  if (!route) return;
  setPerfRoute(store, route, method);
  if (shouldSkipPerf(store.route ?? route)) return;
  schedulePerfFlush(store);
}

/**
 * Start measuring a page render. Called at the top of the root layout, which every
 * route passes through.
 */
export async function beginPagePerf(): Promise<void> {
  if (!PERF_ENABLED) return;
  const { route } = await readStampedRoute();
  if (!route || shouldSkipPerf(route)) return;
  const store = seedRenderPerfStore(route);
  if (!store) return;
  schedulePerfFlush(store);
}

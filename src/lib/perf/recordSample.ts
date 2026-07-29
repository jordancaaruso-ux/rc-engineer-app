import "server-only";

import { after } from "next/server";

import {
  PERF_DEPLOY_ID,
  PERF_ENABLED,
  PERF_LOG,
  PERF_RETENTION_DAYS,
  PERF_SAMPLE_RATE,
} from "@/lib/perf/perfConfig";
import type { PerfStore } from "@/lib/perf/perfStore";
import { shouldSkipPerf } from "@/lib/perf/routeKey";
import { prisma } from "@/lib/prisma";

type FlushOptions = {
  status?: number;
  /** Exact total when the caller measured it before streaming (route handlers). */
  totalMs?: number;
  userId?: string | null;
};

/** Roughly 1 request in 500 also prunes. Cheap enough to need no cron entry. */
const PRUNE_PROBABILITY = 0.002;

/**
 * Queue this request's sample to be written after the response is sent.
 *
 * `after()` runs the callback once the response has flushed, so the insert is never
 * on the latency path. Safe to call more than once per request — the first call wins.
 */
export function schedulePerfFlush(store: PerfStore, options: FlushOptions = {}): void {
  if (!PERF_ENABLED || store.registered) return;
  store.registered = true;
  after(async () => {
    await flushPerfSample(store, options);
  });
}

export async function flushPerfSample(
  store: PerfStore,
  options: FlushOptions = {}
): Promise<void> {
  if (!PERF_ENABLED || store.flushed) return;
  store.flushed = true;

  const route = store.route;
  if (!route || shouldSkipPerf(route)) return;

  // For a page render this fires after streaming completes, so it is an upper bound
  // on server time rather than TTFB. Client RUM is the ground truth for pages.
  const totalMs = options.totalMs ?? performance.now() - store.startedAt;

  if (PERF_LOG) {
    const phases = Object.entries(store.phases)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label, ms]) => `${label}=${Math.round(ms)}`)
      .join(" ");
    console.log(
      `[perf] ${store.kind} ${route} ${Math.round(totalMs)}ms db=${Math.round(store.dbMs)}ms q=${store.queryCount}${phases ? ` ${phases}` : ""}`
    );
  }

  if (PERF_SAMPLE_RATE < 1 && Math.random() >= PERF_SAMPLE_RATE) return;

  try {
    await prisma.perfSample.create({
      data: {
        kind: store.kind,
        route,
        method: store.method,
        status: options.status ?? null,
        totalMs,
        dbMs: store.dbMs,
        queryCount: store.queryCount,
        phases: Object.keys(store.phases).length > 0 ? store.phases : undefined,
        slowest: store.slowest.length > 0 ? store.slowest : undefined,
        userId: options.userId ?? null,
        deployId: PERF_DEPLOY_ID,
      },
    });
  } catch {
    // Never let the profiler surface an error to a request that already succeeded.
    return;
  }

  if (Math.random() < PRUNE_PROBABILITY) {
    await prunePerfRows();
  }
}

async function prunePerfRows(): Promise<void> {
  const cutoff = new Date(Date.now() - PERF_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    await Promise.all([
      prisma.perfSample.deleteMany({ where: { createdAt: { lt: cutoff } } }),
      prisma.perfClientMetric.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    ]);
  } catch {
    /* ignore */
  }
}

import { PERF_ENABLED } from "@/lib/perf/perfConfig";
import { currentPerfStore, recordPhase } from "@/lib/perf/perfStore";

/** Dev-only console timing. Set DEBUG_PERF=1 in .env.local. */
const devLog =
  process.env.NODE_ENV === "development" && process.env.DEBUG_PERF === "1";

/**
 * Time a named phase of a request.
 *
 * Two consumers, one call site: the dev console (DEBUG_PERF=1) and — when
 * PERF_INSTRUMENTATION=1 — the current request's perf store, where the phase lands in
 * the `PerfSample.phases` column and in the `Server-Timing` header. That means every
 * `perfSpan` already scattered through the dashboard, run-history, analysis, and
 * engineer-chat paths becomes production data with no further edits.
 *
 * With both switches off this returns `fn()` unwrapped — no timer, no allocation.
 */
export async function perfSpan<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!devLog && !PERF_ENABLED) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const ms = performance.now() - start;
    if (devLog) console.log(`[perf] ${label}: ${Math.round(ms)}ms`);
    if (PERF_ENABLED) {
      const store = currentPerfStore();
      if (store) recordPhase(store, label, ms);
    }
  }
}

export function perfMark(label: string): void {
  if (!devLog) return;
  console.log(`[perf] ${label}`);
}

/**
 * Production performance instrumentation — configuration and kill switch.
 *
 * Every value is read once at module load so each call site compiles down to a
 * `const` branch. With PERF_INSTRUMENTATION unset the Prisma extension is never
 * applied, `withPerfRoute` is the identity function, and the client reporter chunk
 * is never fetched — the whole layer costs nothing.
 *
 * See docs/PERFORMANCE.md.
 */

/** Master switch. Set PERF_INSTRUMENTATION=1 to record anything at all. */
export const PERF_ENABLED = process.env.PERF_INSTRUMENTATION === "1";

/**
 * Fraction of requests written to `PerfSample`. 1 is correct at founder scale
 * (single-digit thousands of rows/day, pruned at PERF_RETENTION_DAYS). Lower it
 * only if row volume ever bites — it needs no code change.
 */
export const PERF_SAMPLE_RATE = clampRate(process.env.PERF_SAMPLE_RATE, 1);

/**
 * Print every sample to the server console as well as storing it. This is how you
 * verify the layer works without a browser: `PERF_INSTRUMENTATION=1 PERF_LOG=1 npm run dev`.
 */
export const PERF_LOG = process.env.PERF_LOG === "1";

/** Rows older than this are dropped by the opportunistic prune in `recordSample`. */
export const PERF_RETENTION_DAYS = clampDays(process.env.PERF_RETENTION_DAYS, 14);

/** Stamped onto every row so a regression can be pinned to the deploy that caused it. */
export const PERF_DEPLOY_ID = process.env.VERCEL_DEPLOYMENT_ID ?? null;

function clampRate(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 1);
}

function clampDays(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.round(parsed), 365);
}

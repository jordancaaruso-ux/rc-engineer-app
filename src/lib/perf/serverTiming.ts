/**
 * `Server-Timing` header construction. Pure so it can be unit-tested without a request.
 *
 * Only route handlers get this header — a Server Component cannot set response headers,
 * so page renders are measured client-side instead (see `WebVitalsReporter`).
 */
import type { PerfStore } from "@/lib/perf/perfStore";

/** Server-Timing names are RFC 7230 tokens; phase labels are not. */
function sanitizeToken(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_");
  const trimmed = cleaned.replace(/^_+|_+$/g, "");
  return (trimmed.length === 0 ? "phase" : trimmed).slice(0, 40);
}

/** `desc` is a quoted-string; strip anything that would terminate it. */
function sanitizeDesc(raw: string): string {
  return raw.replace(/["\\\r\n]/g, "").slice(0, 60);
}

function round(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.round(ms * 10) / 10;
}

/**
 * `total;dur=412.3, db;dur=310.1;desc="14q", loadRunHistory;dur=280`
 *
 * Duplicate sanitized names are dropped rather than emitted twice — Chrome shows only
 * the first, so a duplicate is misleading rather than useful.
 */
export function buildServerTimingHeader(store: PerfStore, totalMs: number): string {
  const parts = [
    `total;dur=${round(totalMs)}`,
    `db;dur=${round(store.dbMs)};desc="${sanitizeDesc(`${store.queryCount}q`)}"`,
  ];

  const seen = new Set(["total", "db"]);
  for (const [label, ms] of Object.entries(store.phases)) {
    const name = sanitizeToken(label);
    if (seen.has(name)) continue;
    seen.add(name);
    parts.push(`${name};dur=${round(ms)}`);
  }

  return parts.join(", ");
}

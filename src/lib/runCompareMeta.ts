import { formatRunCreatedAtDateTime } from "@/lib/formatDate";

/**
 * THE wallclock shown next to a run — every list, header, row and compare line reads
 * this one function, so no two screens can ever print two times for one run.
 *
 * Preference order:
 *   1. `sessionCompletedAt` — when the car was actually on track, off the timing sheet.
 *      The one time a racer means by "the 2:34 heat", and the one nothing else can
 *      reconstruct.
 *   2. `loggingCompletedAt` — when the run was saved as complete. Minutes after the run
 *      when logged trackside; the honest answer when no timing sheet was imported.
 *   3. `createdAt` — the row's first write, for legacy rows that stamped neither.
 *
 * It used to prefer the save time, with the on-track time second — and the Sessions row
 * printed the row's CREATION time, its own third choice. On a club race day imported from
 * LiveRC the two screens never agreed to within an hour (reported 2026-09-05, Bayside
 * 23 May), and the one time that was actually right was the one neither of them showed.
 *
 * Deliberately **never** reads `sortAt`: that is the draggable ordering axis, and a drag
 * rewrites it to a midpoint that was no moment at all. Accepted in the input type so
 * callers that already select it still compile.
 */
export function resolveRunDisplayInstant(run: {
  createdAt: Date | string;
  sessionCompletedAt?: Date | string | null;
  sortAt?: Date | string | null;
  loggingCompletedAt?: Date | string | null;
}): Date {
  const s = run.sessionCompletedAt;
  if (s != null) {
    const d = typeof s === "string" ? new Date(s) : s;
    if (!Number.isNaN(d.getTime())) return d;
  }
  const lc = run.loggingCompletedAt;
  if (lc != null) {
    const d = typeof lc === "string" ? new Date(lc) : lc;
    if (!Number.isNaN(d.getTime())) return d;
  }
  return typeof run.createdAt === "string" ? new Date(run.createdAt) : run.createdAt;
}

/**
 * Instant to use when **ordering** runs in any list that needs to match the
 * Sessions page order (which the user can drag to reorder).
 *
 * Preference order:
 *   1. `sortAt` — explicit stable ordering axis, bumped only by user reorder.
 *   2. `sessionCompletedAt` — on-track wall time if `sortAt` isn't present
 *      (defensive; post-backfill every row has `sortAt`).
 *   3. `createdAt` — final fallback.
 *
 * This is intentionally different from `resolveRunDisplayInstant`: a drag
 * should change ordering but NOT the shown timestamp. Call this from every
 * sort comparator that feeds run pickers, compare lists, or history tables
 * so the driver sees a single consistent chronology everywhere.
 */
export function resolveRunSortInstant(run: {
  createdAt: Date | string;
  sessionCompletedAt?: Date | string | null;
  sortAt?: Date | string | null;
}): Date {
  const s = run.sortAt;
  if (s != null) {
    const d = typeof s === "string" ? new Date(s) : s;
    if (!Number.isNaN(d.getTime())) return d;
  }
  return resolveRunDisplayInstant(run);
}

/** Second line under “Me” in lap comparison (event · track · session/save time). */
export function formatCompareRunMetaLine(run: {
  createdAt: Date | string;
  sessionCompletedAt?: Date | string | null;
  loggingCompletedAt?: Date | string | null;
  sortAt?: Date | string | null;
  event?: { name: string } | null;
  track?: { name: string } | null;
  trackNameSnapshot?: string | null;
}): string {
  const event = run.event?.name?.trim();
  const track = run.track?.name?.trim() || run.trackNameSnapshot?.trim();
  const when = formatRunCreatedAtDateTime(resolveRunDisplayInstant(run));
  const parts: string[] = [];
  if (event) parts.push(event);
  if (track) parts.push(track);
  parts.push(when);
  return parts.join(" · ");
}

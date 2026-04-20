import { formatRunCreatedAtDateTime } from "@/lib/formatDate";

/**
 * Wallclock shown next to a run in lists / headers / compare lines. Deliberately
 * **does not** read `sortAt`: the displayed time must stay put even when the
 * driver drags a run to a new position in the history list. Ordering lives in
 * a different column (`sortAt`, set once at create, mutated only by explicit
 * drag); display reflects "when did this run happen", which shouldn't move.
 *
 * Preference order:
 *   1. `sessionCompletedAt` — on-track wall time from a timing import.
 *   2. `createdAt` — row insert / first-save time.
 *
 * Accept `sortAt` in the input type (so callers that already select it still
 * compile) but intentionally ignore it here.
 */
export function resolveRunDisplayInstant(run: {
  createdAt: Date | string;
  sessionCompletedAt?: Date | string | null;
  sortAt?: Date | string | null;
}): Date {
  const s = run.sessionCompletedAt;
  if (s != null) {
    const d = typeof s === "string" ? new Date(s) : s;
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

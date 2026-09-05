import { formatRunCreatedAtDateTime } from "@/lib/formatDate";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function asValidDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * THE wallclock shown next to a run — every list, header, row and compare line reads
 * this one function, so no two screens can ever print two times for one run. (The
 * Sessions row printed raw `createdAt` until 2026-09-05 while the lap sheet read this,
 * and on a LiveRC race weekend the two never agreed to within an hour.)
 *
 * The stamps a run carries, and how far each can be trusted (read off Jordan's own
 * Bayside rows, 25–29 Jun 2026):
 *
 *   `createdAt`          — the log was STARTED. Trackside that is 30–80 min BEFORE the
 *                          heat (tyres and setup go in first); a draft banked the night
 *                          before is a day early.
 *   `loggingCompletedAt` — the log was FINISHED: within minutes after the heat when the
 *                          laps were imported on the spot, or a day+ later when they
 *                          weren't (a Sunday main saved Monday 5:50 PM).
 *   `sessionCompletedAt` — meant to be the on-track time off the timing sheet, and for
 *                          an auto-created practice run it is. But a race-result import
 *                          with no wall clock stored the IMPORT time here, and some
 *                          practice imports stored the wall clock as if it were UTC
 *                          (9:25 AM showing as 7:25 PM). Nothing in the row says which.
 *
 * So no stamp is preferred blindly; each is admitted only when it is plausible against
 * the others:
 *
 *   1. `sessionCompletedAt`, when it is no later than the log's finish (a real on-track
 *      time always precedes the import that recorded it; a UTC-mangled one lands hours
 *      after) and no more than a fortnight before the row (an auto-created run can be
 *      synced days after the day).
 *   2. `loggingCompletedAt`, when it is within a day of `createdAt` — the same outing.
 *   3. `createdAt`.
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
  const created = asValidDate(run.createdAt) ?? new Date(NaN);
  const createdMs = created.getTime();

  const logged = asValidDate(run.loggingCompletedAt);
  const loggedSameOuting =
    logged != null &&
    Number.isFinite(createdMs) &&
    logged.getTime() >= createdMs - 10 * MINUTE_MS &&
    logged.getTime() <= createdMs + DAY_MS;

  const session = asValidDate(run.sessionCompletedAt);
  if (session != null) {
    const upper = (loggedSameOuting ? logged!.getTime() : createdMs) + 10 * MINUTE_MS;
    const lower = createdMs - 14 * DAY_MS;
    const t = session.getTime();
    if (!Number.isFinite(createdMs) || (t >= lower && t <= upper)) return session;
  }
  if (loggedSameOuting) return logged!;
  return created;
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

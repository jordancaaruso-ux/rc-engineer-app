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
 * ## The fortnight floor is lifted for a run the app filed at its heat (2026-09-14)
 *
 * "Add N other runs from today" writes `sortAt` AND `sessionCompletedAt` from the same
 * trusted instant — the timing sheet's clock, converted by the app, never an import time —
 * and the run being saved beside them is stamped the same way. A driver catching up on a
 * day from last month then has rows whose heat is far more than a fortnight before the row
 * was written, and the floor printed the SAVE time on every one of them ("14 Sept, 3:38 PM"
 * on an October day, seen on a real drive). So when the two stamps agree to the
 * millisecond, the instant is the app's own and the floor does not apply. The upper bound
 * still does: a dirty stamp is always LATER than the log, never a fortnight earlier.
 *
 * Why equality is a safe signal: a drag rewrites `sortAt` to a midpoint between two
 * neighbours, which can never coincide with a stamp; a draft's day-stamp and a plain create
 * write `sortAt` from `createdAt`. The April 2026 migration did copy `sessionCompletedAt`
 * into `sortAt` on legacy rows — checked on the scratch clone (559 runs): no such row
 * carries a fortnight-old stamp, so none of them moves.
 *
 * ## …and for a run that is linked to the import it was stamped from (2026-09-18)
 *
 * A tester imported an event from a month earlier and every run came up dated the minute he
 * imported it. The floor was guessing at provenance from AGE, and a race a fortnight old is
 * not less real than one from yesterday — it is just older. Where the run names the import it
 * came from (`importedLapTimeSessionId`), the provenance is not a guess: that stamp was read
 * off a timing sheet, so the floor does not apply to it either.
 *
 * This does NOT reopen the dirty legacy stamps the floor was written beside. Both kinds sit
 * ABOVE the row, not below it — an import-time stamp is ~`createdAt` and a wall clock stored
 * as-if-UTC lands hours after the save — so the upper bound catches them, and it is untouched.
 * Verified on the scratch clone: of the runs stamped more than a fortnight before their row,
 * every one is a real old race and not a single one is garbage.
 *
 * Otherwise deliberately **never** reads `sortAt` as a time to SHOW: that is the draggable
 * ordering axis.
 */
export function resolveRunDisplayInstant(run: {
  createdAt: Date | string;
  sessionCompletedAt?: Date | string | null;
  sortAt?: Date | string | null;
  loggingCompletedAt?: Date | string | null;
  /**
   * A run the app filed from the timing sheet ("Add N other runs from today"). Its
   * `sessionCompletedAt` was written by the app as a real instant — never an import time,
   * never a wall clock as-if-UTC — so it is trusted outright, however long after the day
   * the row was written. After confirm the `sortAt` agreement below carries the same trust.
   */
  unconfirmedAt?: Date | string | null;
  /**
   * The imported timing session this run was created from or linked to. Its presence is what
   * says `sessionCompletedAt` was read off a timing sheet rather than guessed, so an old stamp
   * on such a run is admitted — see the fortnight note above.
   *
   * Every list that shows a run time must select it, or two screens print two times for one
   * run, which is the whole reason this function exists.
   */
  importedLapTimeSessionId?: string | null;
}): Date {
  const created = asValidDate(run.createdAt) ?? new Date(NaN);
  const createdMs = created.getTime();

  if (run.unconfirmedAt != null) {
    const stamped = asValidDate(run.sessionCompletedAt);
    if (stamped != null) return stamped;
  }

  const logged = asValidDate(run.loggingCompletedAt);
  const loggedSameOuting =
    logged != null &&
    Number.isFinite(createdMs) &&
    logged.getTime() >= createdMs - 10 * MINUTE_MS &&
    logged.getTime() <= createdMs + DAY_MS;

  const session = asValidDate(run.sessionCompletedAt);
  if (session != null) {
    const upper = (loggedSameOuting ? logged!.getTime() : createdMs) + 10 * MINUTE_MS;
    const t = session.getTime();
    const sortStamp = asValidDate(run.sortAt);
    const filedAtHeat = sortStamp != null && sortStamp.getTime() === t;
    const fromTimingSheet = run.importedLapTimeSessionId != null;
    const lower =
      filedAtHeat || fromTimingSheet ? Number.NEGATIVE_INFINITY : createdMs - 14 * DAY_MS;
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

/**
 * Which run each backfilled session copies its setup from, and what tyre run it is.
 *
 * "Add N other runs from today" (lap step, 2026-09-14): the driver saves one run and asks for the
 * day's other timing sessions to become runs beside it. The founder's rule for what those runs
 * carry —
 *
 *   car, track, event, session type: from the run being saved (the "parent");
 *   setup, tyres, prep:              from the nearest EARLIER run the driver logged that day,
 *                                    or from the parent when there is none.
 *
 * "Logged" means confirmed: a run the app itself backfilled earlier is never a source, or one
 * guess would compound into the next. Pure so the rule is unit-tested; the DB work is in
 * `createBackfilledRuns`.
 */

export type BackfillPlanRun = {
  id: string;
  /** When the car was on track — `sessionCompletedAt`, else `sortAt`. */
  instant: Date;
  tireStintId: string | null;
  tireRunNumber: number;
};

export type BackfillPlanSession = {
  id: string;
  instant: Date;
};

export type BackfillPlanEntry = {
  sessionId: string;
  instant: Date;
  /** The run whose setup, tyres and prep this one copies. */
  setupSourceRunId: string;
  /**
   * Position on the source's rubber. Later sessions count up from the source; sessions before the
   * parent (only possible when the parent IS the source) count down from it, floored at 1. A later
   * confirmed run on the same stint can collide on the number — a v1 limit the Unconfirmed mark
   * covers, and the tyre cascade repairs when the driver confirms.
   */
  tireRunNumber: number;
};

export function planBackfilledRuns(input: {
  parent: BackfillPlanRun;
  /** Confirmed runs of the same car on the parent's local day. May or may not include the parent. */
  confirmedDayRuns: readonly BackfillPlanRun[];
  sessions: readonly BackfillPlanSession[];
}): BackfillPlanEntry[] {
  const sources = [...input.confirmedDayRuns];
  if (!sources.some((r) => r.id === input.parent.id)) sources.push(input.parent);
  sources.sort((a, b) => a.instant.getTime() - b.instant.getTime());

  const sessions = [...input.sessions].sort((a, b) => a.instant.getTime() - b.instant.getTime());

  const out: BackfillPlanEntry[] = [];
  for (const session of sessions) {
    const t = session.instant.getTime();
    let source: BackfillPlanRun | null = null;
    for (const candidate of sources) {
      if (candidate.instant.getTime() < t) source = candidate;
      else break;
    }
    if (!source) source = input.parent;

    const sourceT = source.instant.getTime();
    let tireRunNumber = 1;
    if (source.tireStintId) {
      if (sourceT < t) {
        // How many planned sessions sit between the source and this one, this one included.
        const k = sessions.filter((s) => {
          const st = s.instant.getTime();
          return st > sourceT && st <= t;
        }).length;
        tireRunNumber = Math.max(1, source.tireRunNumber + k);
      } else {
        // Before the parent, on the parent's rubber: count back from it.
        const k = sessions.filter((s) => {
          const st = s.instant.getTime();
          return st >= t && st < sourceT;
        }).length;
        tireRunNumber = Math.max(1, source.tireRunNumber - k);
      }
    }

    out.push({
      sessionId: session.id,
      instant: session.instant,
      setupSourceRunId: source.id,
      tireRunNumber,
    });
  }
  return out;
}

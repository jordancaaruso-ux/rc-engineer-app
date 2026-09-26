import { groupOutings, type Outing, type OutingSession } from "@/lib/runs/groupOutings";
import { spansOverlap, type Span } from "@/lib/runs/outingSpan";

/**
 * "Add N other runs": the day's sessions as outings, and which outings join a run the driver
 * already has. Pure, so the rule is tested without a database; `createBackfilledRuns` writes it.
 *
 * One run per time on track (founder ruling 2026-09-15): sessions whose windows overlap are one
 * outing, and an outing that overlaps a run the driver already has joins that run rather than
 * opening a second. Both need a time on track. A session the timing site gave only a DATE for
 * (`isDateOnlyTrackTime`, stored at the day's midnight) has none — and read as midnight, every such
 * session of a day overlapped every other. A LiveRC meeting's six races all sat at 12:00 am, all
 * joined the first race's run, and "Log them as 5 runs" made no runs (test drive, 2026-09-26).
 *
 * So a date-only session is always an outing of its own and never joins a run, and a run whose
 * time is only a date hosts nothing. Distinct races stay distinct runs.
 */

export type BackfillOutingSession = { session: OutingSession; dateOnly: boolean };

/** A run the driver already has at the track, with its time on track. */
export type BackfillHostRun = { id: string; span: Span; dateOnly: boolean };

export type BackfillOutingPlan = {
  /** Outings that become runs of their own. */
  standalone: Outing[];
  /** Outings that are the same time on track as a run the driver has: linked to it, not made. */
  joined: Array<{ runId: string; outing: Outing }>;
};

export function planBackfillOutings(
  sessions: readonly BackfillOutingSession[],
  hostRuns: readonly BackfillHostRun[],
): BackfillOutingPlan {
  const dateOnly = sessions.filter((s) => s.dateOnly);
  const outings = [
    ...groupOutings(sessions.filter((s) => !s.dateOnly).map((s) => s.session)),
    ...dateOnly.flatMap((s) => groupOutings([s.session])),
  ];
  const dateOnlyIds = new Set(dateOnly.map((s) => s.session.id));
  const hosts = hostRuns.filter((r) => !r.dateOnly);

  const plan: BackfillOutingPlan = { standalone: [], joined: [] };
  for (const outing of outings) {
    const host = dateOnlyIds.has(outing.primaryId)
      ? undefined
      : hosts.find((r) => spansOverlap(r.span, outing));
    if (host) plan.joined.push({ runId: host.id, outing });
    else plan.standalone.push(outing);
  }
  return plan;
}

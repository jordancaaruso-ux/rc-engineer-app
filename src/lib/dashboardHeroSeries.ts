/**
 * Which points the desktop hero's pace chart plots on a day the driver hasn't run.
 *
 * Pulled out of `dashboardServer` deliberately. The fault this replaces — plotting the
 * last eight runs in date order whatever the venue, so a 12-second club track and an
 * 18-second big track shared an axis and `foundSeconds` measured the gap between two car
 * parks — survived because the decision lived inline in a 600-line function that needs a
 * database to reach. It is a pure function now so it can be held to the rule in a test.
 *
 * The rule: compare like with like, or don't compare. Sessions at ONE track, and when
 * that track has no earlier session to compare against, drop a level to the laps inside
 * the one run there rather than draw a trend out of nothing (founder call 2026-08-10).
 */

/** A completed run from the history, already carrying its display label. */
export type HeroSeriesRun = {
  id: string;
  trackId: string | null;
  bestLapSeconds: number | null;
  /** Pre-formatted in the user's zone — this module does no date work. */
  label: string;
};

/** One included lap of the anchor run. */
export type HeroSeriesLap = {
  lapNumber: number;
  lapTimeSeconds: number;
};

export type HeroSeriesPoint = {
  runId: string;
  label: string;
  best: number;
};

export type HeroSeries = {
  /**
   * `sessions` = one point per run at the anchor track; `laps` = one point per lap of the
   * anchor run. Different quantities on the same axis, so every label and every derived
   * number downstream has to branch on this.
   */
  kind: "sessions" | "laps";
  points: HeroSeriesPoint[];
};

/** Most sessions the chart will plot — eight points is what the 620-unit viewBox holds. */
const MAX_SESSIONS = 8;

export function pickHeroSeries({
  anchorRunId,
  anchorTrackId,
  history,
  anchorLaps,
  maxSessions = MAX_SESSIONS,
}: {
  anchorRunId: string | null;
  /** The anchor run's track. Null (an untracked run) scopes to nothing, so laps it is. */
  anchorTrackId: string | null;
  /** Completed runs, oldest first. */
  history: HeroSeriesRun[];
  /** Included laps of the anchor run, in lap order. */
  anchorLaps: HeroSeriesLap[];
  maxSessions?: number;
}): HeroSeries {
  const sessions: HeroSeriesPoint[] = anchorTrackId
    ? history
        .filter((r) => r.trackId === anchorTrackId && typeof r.bestLapSeconds === "number")
        .slice(-maxSessions)
        .map((r) => ({ runId: r.id, label: r.label, best: r.bestLapSeconds as number }))
    : [];

  // One point is not a trend. A single session at the track falls through to its laps,
  // which is a real trend over a shorter window rather than a dot with nothing to say.
  if (sessions.length >= 2) return { kind: "sessions", points: sessions };

  const laps: HeroSeriesPoint[] = anchorRunId
    ? anchorLaps.map((l) => ({
        runId: `${anchorRunId}:lap-${l.lapNumber}`,
        label: `L${l.lapNumber}`,
        best: l.lapTimeSeconds,
      }))
    : [];

  // Only take the fallback when it can actually draw. Otherwise hand back the thin session
  // series so the chart shows its own "first session here" empty state, which names the
  // track — more use than "one timed lap".
  if (laps.length >= 2) return { kind: "laps", points: laps };

  return { kind: "sessions", points: sessions };
}

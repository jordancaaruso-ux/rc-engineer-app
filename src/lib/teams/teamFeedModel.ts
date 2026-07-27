import { calendarYmdInTimeZone } from "@/lib/formatDate";
import { setupChangedRowsSincePrevious } from "@/lib/setupCompare/changedSincePrevious";
import { isSetupChangeNoiseKey } from "@/lib/setupCompare/setupChangeNoise";

/**
 * Team delta feed — pure types + shaping helpers shared by the server loader
 * (`loadTeamFeed`) and the `/teams/[teamId]` client cards.
 *
 * Keep this file Prisma-free so `npx tsx src/lib/teams/teamFeedModel.test.ts` runs offline.
 *
 * The feed answers one question about a teammate's run: *was it better, what did they
 * change, and what else moved at the same time.* It deliberately does **not** rule on
 * whether the change caused the gain — no verdict, no confound flag, no score. It lays
 * `changed` and `alsoMoved` side by side and the driver decides.
 */

/** A run as the feed needs it: pace, context, and the setup blob. Owner-agnostic. */
export type TeamFeedRunInput = {
  id: string;
  userId: string;
  carId: string | null;
  trackId: string | null;
  eventId: string | null;
  /** Stable ordering axis (`Run.sortAt`). Newest first in every input array. */
  sortAt: string;
  /** When the session actually happened, for the same-day baseline test. */
  occurredAt: string;
  shareWithTeam: boolean;
  loggingComplete: boolean;
  bestLapSeconds: number | null;
  setupData: unknown;

  conditionsAirTempC: number | null;
  conditionsTrackTempC: number | null;

  /** One continuous life of rubber. Null on pre-tire-counter rows. */
  tireStintId: string | null;
  tireTypeId: string | null;
  tireTypeLabel: string | null;
  /** NOT NULL, defaults to 1 — "not answered" and "brand new" look identical. */
  tireRunNumber: number;
  /** False when the driver said "not sure how many runs" — the count is then relative. */
  tireAgeKnown: boolean;

  trackLayoutId: string | null;
  trackDirection: string | null;
};

export type SetupChangeRow = {
  key: string;
  /** Includes the unit, e.g. "Droop (Rear) (mm)". */
  label: string;
  previousValue: string;
  value: string;
};

export type AlsoMovedRow = {
  kind: "trackTemp" | "airTemp" | "tires" | "layout" | "direction";
  label: string;
  detail: string;
};

export type TeamFeedEntry = {
  runId: string;
  ownerUserId: string;
  /** Null when there is no comparable earlier run in the same meeting or on the same day. */
  baselineRunId: string | null;
  bestLapSeconds: number | null;
  /** Negative = faster than the baseline. Null when there is no baseline. */
  paceDeltaSeconds: number | null;
  changed: SetupChangeRow[];
  /** How many changes were dropped by the display cap. */
  changedOverflow: number;
  alsoMoved: AlsoMovedRow[];
  alsoMovedOverflow: number;
};

/** Display caps — load-bearing at 390px, not cosmetic. A bulk import can move 30 fields. */
export const MAX_CHANGED_ROWS = 4;
export const MAX_ALSO_MOVED_ROWS = 5;

/**
 * The same driver's most recent earlier run that is genuinely comparable.
 *
 * Comparable means same car and same track (so both the setup diff and the lap delta
 * mean something) **and** the same meeting or the same calendar day. The day/event
 * bound is the important one: a delta against "last time at this track, three months
 * ago" is an enormous diff that explains nothing, and showing no delta is better than
 * showing a fake one.
 *
 * `runsDesc` must be newest-first. Runs the owner hid (`shareWithTeam: false`) and
 * drafts are skipped — a hidden run must not leak its setup values through the
 * "before →" half of the arrow.
 */
export function pickPreviousComparableRun(
  runsDesc: readonly TeamFeedRunInput[],
  index: number,
  timeZone: string
): TeamFeedRunInput | null {
  const run = runsDesc[index];
  if (!run || !run.carId || !run.trackId) return null;

  for (let i = index + 1; i < runsDesc.length; i++) {
    const prev = runsDesc[i];
    if (prev.userId !== run.userId) continue;
    if (!prev.shareWithTeam || !prev.loggingComplete) continue;
    if (prev.carId !== run.carId || prev.trackId !== run.trackId) continue;
    if (!sameMeetingOrDay(run, prev, timeZone)) continue;
    return prev;
  }
  return null;
}

/** Same event (both non-null), else the same calendar day in the viewer's zone. */
export function sameMeetingOrDay(
  a: { eventId: string | null; occurredAt: string },
  b: { eventId: string | null; occurredAt: string },
  timeZone: string
): boolean {
  if (a.eventId && b.eventId) return a.eventId === b.eventId;
  return calendarYmdInTimeZone(a.occurredAt, timeZone) === calendarYmdInTimeZone(b.occurredAt, timeZone);
}

/** Setup fields that moved between two runs, with tire and sheet-header noise removed. */
export function computeSetupChangedRows(
  current: unknown,
  previous: unknown
): SetupChangeRow[] {
  return setupChangedRowsSincePrevious(current, previous)
    .filter((row) => !isSetupChangeNoiseKey(row.key))
    .map((row) => ({
      key: row.key,
      label: row.label,
      previousValue: row.previousValue,
      value: row.value,
    }));
}

function formatTempDelta(from: number, to: number): string {
  const delta = to - from;
  const sign = delta > 0 ? "+" : "";
  return `${round1(from)} → ${round1(to)} °C (${sign}${round1(delta)})`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Everything other than the setup that moved between the baseline and this run.
 *
 * This is the honest other half of the comparison. It states what shifted; it never
 * weighs those shifts against the setup change or implies the delta is untrustworthy.
 */
export function computeAlsoMoved(
  run: TeamFeedRunInput,
  baseline: TeamFeedRunInput
): AlsoMovedRow[] {
  const rows: AlsoMovedRow[] = [];

  if (baseline.conditionsTrackTempC != null && run.conditionsTrackTempC != null) {
    if (round1(baseline.conditionsTrackTempC) !== round1(run.conditionsTrackTempC)) {
      rows.push({
        kind: "trackTemp",
        label: "Track temp",
        detail: formatTempDelta(baseline.conditionsTrackTempC, run.conditionsTrackTempC),
      });
    }
  }

  if (baseline.conditionsAirTempC != null && run.conditionsAirTempC != null) {
    if (round1(baseline.conditionsAirTempC) !== round1(run.conditionsAirTempC)) {
      rows.push({
        kind: "airTemp",
        label: "Air temp",
        detail: formatTempDelta(baseline.conditionsAirTempC, run.conditionsAirTempC),
      });
    }
  }

  const tires = describeTireChange(run, baseline);
  if (tires) rows.push(tires);

  if (baseline.trackLayoutId !== run.trackLayoutId) {
    rows.push({ kind: "layout", label: "Track layout", detail: "Different layout" });
  }
  if (baseline.trackDirection !== run.trackDirection && run.trackDirection) {
    rows.push({ kind: "direction", label: "Direction", detail: String(run.trackDirection) });
  }

  return rows;
}

/**
 * Tire state change. Three distinct signals, in order of how much they matter:
 * fresh rubber, a different compound, and another run on the same set.
 *
 * `tireRunNumber` is NOT NULL and defaults to 1, and `tireAgeKnown` defaults to true,
 * so on legacy rows "never answered" is indistinguishable from "brand new". We only
 * report a run-count step when both runs claim to know the age and the stint matches.
 */
function describeTireChange(
  run: TeamFeedRunInput,
  baseline: TeamFeedRunInput
): AlsoMovedRow | null {
  const compoundChanged =
    run.tireTypeId != null && baseline.tireTypeId != null && run.tireTypeId !== baseline.tireTypeId;

  if (compoundChanged) {
    const from = baseline.tireTypeLabel ?? "another compound";
    const to = run.tireTypeLabel ?? "a different compound";
    return { kind: "tires", label: "Tires", detail: `${from} → ${to}` };
  }

  const stintChanged =
    run.tireStintId != null && baseline.tireStintId != null && run.tireStintId !== baseline.tireStintId;

  if (stintChanged) {
    return { kind: "tires", label: "Tires", detail: "New set" };
  }

  const sameStint =
    run.tireStintId != null && baseline.tireStintId != null && run.tireStintId === baseline.tireStintId;

  if (sameStint && run.tireAgeKnown && baseline.tireAgeKnown) {
    if (run.tireRunNumber !== baseline.tireRunNumber) {
      return {
        kind: "tires",
        label: "Tires",
        detail: `Run ${baseline.tireRunNumber} → ${run.tireRunNumber}`,
      };
    }
  }

  return null;
}

/** Signed lap delta in seconds. Negative = faster. Null unless both runs have a best lap. */
export function computePaceDelta(
  run: { bestLapSeconds: number | null },
  baseline: { bestLapSeconds: number | null } | null
): number | null {
  if (!baseline || run.bestLapSeconds == null || baseline.bestLapSeconds == null) return null;
  return run.bestLapSeconds - baseline.bestLapSeconds;
}

/** "−0.31" / "+0.08". Sign is always explicit so a gain never reads as a bare number. */
export function formatPaceDelta(deltaSeconds: number | null): string | null {
  if (deltaSeconds == null) return null;
  const rounded = Math.round(deltaSeconds * 100) / 100;
  if (rounded === 0) return "±0.00";
  const sign = rounded < 0 ? "−" : "+";
  return `${sign}${Math.abs(rounded).toFixed(2)}`;
}

/**
 * Build one feed entry. With no baseline the entry still renders — the run happened and
 * that is worth seeing — but with no delta and no diff rather than a fabricated one.
 */
export function buildFeedEntry(
  runsDesc: readonly TeamFeedRunInput[],
  index: number,
  timeZone: string
): TeamFeedEntry {
  const run = runsDesc[index];
  const baseline = pickPreviousComparableRun(runsDesc, index, timeZone);

  const allChanged = baseline ? computeSetupChangedRows(run.setupData, baseline.setupData) : [];
  const allAlsoMoved = baseline ? computeAlsoMoved(run, baseline) : [];

  return {
    runId: run.id,
    ownerUserId: run.userId,
    baselineRunId: baseline?.id ?? null,
    bestLapSeconds: run.bestLapSeconds,
    paceDeltaSeconds: computePaceDelta(run, baseline),
    changed: allChanged.slice(0, MAX_CHANGED_ROWS),
    changedOverflow: Math.max(0, allChanged.length - MAX_CHANGED_ROWS),
    alsoMoved: allAlsoMoved.slice(0, MAX_ALSO_MOVED_ROWS),
    alsoMovedOverflow: Math.max(0, allAlsoMoved.length - MAX_ALSO_MOVED_ROWS),
  };
}

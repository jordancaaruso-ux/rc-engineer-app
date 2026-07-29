import { normalizeSetupData } from "@/lib/runSetup";
import { buildSetupDiffRows } from "@/lib/setupDiff";

/**
 * Pure shaping for the event (race meeting) anchor digest — one compact line per
 * run, deliberately NOT full per-run context (a big weekend would blow the token
 * budget). The DB loader lives in eventAnchorDigest.ts.
 */

export const MAX_EVENT_DIGEST_RUNS = 24;
export const MAX_EVENT_FIELD_STAT_LINES = 12;
const MAX_SETUP_CHANGE_MOVERS = 3;

export type EventDigestRunLineV1 = {
  runId: string;
  whenLabel: string;
  sessionLabel: string;
  carName: string | null;
  lapCount: number | null;
  bestLapSeconds: number | null;
  avgTop5Seconds: number | null;
  tireLabel: string | null;
  carRating: number | null;
  /** "3 keys vs previous run — front camber, front spring, ride height" (same car only). */
  setupChangeSummary: string | null;
};

export type EventDigestFieldStatLineV1 = {
  sessionLabel: string | null;
  driverCount: number;
  yourRank: number | null;
  /** Your best minus the field's mean best; negative = faster than the session average. */
  gapBestVsFieldMeanSeconds: number | null;
};

export type EventAnchorDigestV1 = {
  version: 1;
  eventId: string;
  name: string;
  trackName: string | null;
  dateRangeLabel: string;
  yourRuns: EventDigestRunLineV1[];
  importedFieldStats: EventDigestFieldStatLineV1[];
  truncated: boolean;
  note: string | null;
};

export type EventDigestRunInput = {
  id: string;
  whenLabel: string;
  sessionLabel: string;
  carId: string | null;
  carName: string | null;
  lapCount: number | null;
  bestLapSeconds: number | null;
  avgTop5Seconds: number | null;
  tireLabel: string | null;
  carRating: number | null;
  snapshotData: unknown;
};

/**
 * Setup-change one-liner between consecutive runs on the same car: count + the
 * first few changed keys. Null when nothing changed or the cars differ.
 */
export function summarizeSetupChangeBetweenRuns(
  current: { carId: string | null; snapshotData: unknown },
  previous: { carId: string | null; snapshotData: unknown } | null
): string | null {
  if (!previous || !current.carId || current.carId !== previous.carId) return null;
  const changed = buildSetupDiffRows(
    normalizeSetupData(current.snapshotData),
    normalizeSetupData(previous.snapshotData)
  ).filter((row) => row.changed);
  if (changed.length === 0) return null;
  const movers = changed.slice(0, MAX_SETUP_CHANGE_MOVERS).map((row) => row.label);
  const rest = changed.length - movers.length;
  return `${changed.length} key${changed.length === 1 ? "" : "s"} vs previous run — ${movers.join(", ")}${
    rest > 0 ? ` (+${rest} more)` : ""
  }`;
}

/** Chronological run lines with per-car pairwise setup summaries. */
export function shapeEventDigestRunLines(
  runsChronological: EventDigestRunInput[]
): { lines: EventDigestRunLineV1[]; truncated: boolean } {
  const lastByCar = new Map<string, EventDigestRunInput>();
  const lines = runsChronological.map((run) => {
    const previous = run.carId ? lastByCar.get(run.carId) ?? null : null;
    if (run.carId) lastByCar.set(run.carId, run);
    return {
      runId: run.id,
      whenLabel: run.whenLabel,
      sessionLabel: run.sessionLabel,
      carName: run.carName,
      lapCount: run.lapCount,
      bestLapSeconds: run.bestLapSeconds,
      avgTop5Seconds: run.avgTop5Seconds,
      tireLabel: run.tireLabel,
      carRating: run.carRating,
      setupChangeSummary: summarizeSetupChangeBetweenRuns(run, previous),
    };
  });
  // Keep the tail — the newest runs are the ones a meeting question is usually about.
  const truncated = lines.length > MAX_EVENT_DIGEST_RUNS;
  return { lines: truncated ? lines.slice(-MAX_EVENT_DIGEST_RUNS) : lines, truncated };
}

export function shapeEventAnchorDigest(params: {
  eventId: string;
  name: string;
  trackName: string | null;
  dateRangeLabel: string;
  runsChronological: EventDigestRunInput[];
  importedFieldStats: EventDigestFieldStatLineV1[];
}): EventAnchorDigestV1 {
  const { lines, truncated } = shapeEventDigestRunLines(params.runsChronological);
  const stats = params.importedFieldStats.slice(0, MAX_EVENT_FIELD_STAT_LINES);
  return {
    version: 1,
    eventId: params.eventId,
    name: params.name,
    trackName: params.trackName,
    dateRangeLabel: params.dateRangeLabel,
    yourRuns: lines,
    importedFieldStats: stats,
    truncated: truncated || stats.length < params.importedFieldStats.length,
    note:
      lines.length === 0
        ? params.importedFieldStats.length > 0
          ? "No logged runs at this meeting — imported timing only."
          : "No logged runs or imported timing at this meeting."
        : null,
  };
}

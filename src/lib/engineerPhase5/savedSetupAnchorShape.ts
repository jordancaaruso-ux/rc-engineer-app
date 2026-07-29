import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { buildSetupDiffRows } from "@/lib/setupDiff";

/**
 * Pure shaping for the saved-setup anchor block — no prisma, unit-tested directly.
 * The DB loader lives in savedSetupAnchorContext.ts.
 */

export const MAX_RUNS_BASED_ON_IT = 10;
export const MAX_COMBO_DIFF_ROWS = 40;

export type SavedSetupAnchorRunOutcome = {
  runId: string;
  whenLabel: string;
  sessionLabel: string;
  trackName: string | null;
  bestLapSeconds: number | null;
  carRating: number | null;
  /** How far that run's sheet had drifted from this library setup when it ran. */
  changedKeyCountVsThisSetup: number;
};

export type SavedSetupAnchorComboDiff = {
  anchoredRunId: string;
  changedRows: Array<{ key: string; label: string; thisSetup: string; anchoredRun: string }>;
  changedRowCount: number;
  truncated: boolean;
};

export function shapeSavedSetupRunOutcomes(
  librarySetupData: SetupSnapshotData,
  runs: Array<{
    id: string;
    whenLabel: string;
    sessionLabel: string;
    trackName: string | null;
    bestLapSeconds: number | null;
    carRating: number | null;
    snapshotData: unknown;
  }>
): SavedSetupAnchorRunOutcome[] {
  return runs.slice(0, MAX_RUNS_BASED_ON_IT).map((run) => ({
    runId: run.id,
    whenLabel: run.whenLabel,
    sessionLabel: run.sessionLabel,
    trackName: run.trackName,
    bestLapSeconds: run.bestLapSeconds,
    carRating: run.carRating,
    changedKeyCountVsThisSetup: buildSetupDiffRows(
      normalizeSetupData(run.snapshotData),
      librarySetupData
    ).filter((row) => row.changed).length,
  }));
}

/** Labelled changed-row diff, this setup vs the anchored run's sheet. */
export function shapeSavedSetupComboDiff(
  librarySetupData: SetupSnapshotData,
  anchoredRunId: string,
  anchoredRunSnapshotData: unknown
): SavedSetupAnchorComboDiff {
  const changed = buildSetupDiffRows(
    librarySetupData,
    normalizeSetupData(anchoredRunSnapshotData)
  ).filter((row) => row.changed);
  return {
    anchoredRunId,
    changedRows: changed.slice(0, MAX_COMBO_DIFF_ROWS).map((row) => ({
      key: row.key,
      label: row.label,
      thisSetup: row.current,
      anchoredRun: row.previous ?? "—",
    })),
    changedRowCount: changed.length,
    truncated: changed.length > MAX_COMBO_DIFF_ROWS,
  };
}

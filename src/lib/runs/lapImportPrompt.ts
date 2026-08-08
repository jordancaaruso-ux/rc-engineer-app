/**
 * "This run has no lap times" — one definition, shared by the Sessions row
 * warning and the log-run wizard's landing-step logic.
 *
 * Why it exists (founder report 2026-08-08): a driver logged a run before
 * LiveRC had posted the times, marked it complete, and the app then said
 * nothing — a completed run with no laps renders as three em-dashes and no
 * affordance to go and get them. The row warning and the wizard's "first
 * unfinished step" must agree on what "has laps" means, or tapping the warning
 * lands you somewhere other than Laps.
 */

/**
 * Minimal shape every caller satisfies (Prisma row, client `Run` prop, wizard
 * `LastRun`). `importedLapSets` stays opaque on purpose — the callers select
 * wildly different columns and all this asks is whether there are any.
 */
export type LapPresenceRun = {
  lapTimes?: unknown;
  importedLapSets?: readonly unknown[] | null;
};

export type LapImportPromptRun = LapPresenceRun & {
  lapImportPromptDismissedAt?: Date | string | null;
  loggingComplete?: boolean | null;
};

/**
 * Laps are in if the driver typed/pasted them (`lapTimes`) OR an import
 * attached a set (`importedLapSets`).
 *
 * Deliberately NOT `bestLapSeconds != null`: that column is materialised at
 * save time and is null on legacy pre-column runs, which is why the Sessions
 * table still recomputes best/median from lap rows as a fallback.
 */
export function runHasLapTimes(run: LapPresenceRun): boolean {
  const typed = Array.isArray(run.lapTimes) && run.lapTimes.length > 0;
  const imported = (run.importedLapSets?.length ?? 0) > 0;
  return typed || imported;
}

/**
 * Show the amber "import laps" warning on this run's row.
 *
 * Drafts are excluded (founder 2026-08-08, after seeing the count on real data):
 * a draft is lapless because it isn't finished yet, which is not a defect. It
 * already carries a "Draft" badge and a "Finish run" FAB that resumes on the
 * Laps step. The bug being fixed is the run marked COMPLETE with nothing in it —
 * that one had no signal and no way back to the importer.
 */
export function runNeedsLapImport(run: LapImportPromptRun): boolean {
  if (run.loggingComplete === false) return false;
  if (runHasLapTimes(run)) return false;
  return run.lapImportPromptDismissedAt == null;
}

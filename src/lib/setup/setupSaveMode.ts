/**
 * What a save is allowed to mean for the setup currently open in an editor.
 *
 * ============================== THE RULE ==============================
 *
 * The mode is decided by THE DOOR THE DRIVER WALKED THROUGH, not by how many runs happen to point
 * at the snapshot (founder call, 2026-08-16).
 *
 * Opened from a run — the session log's Setup panel, which links with `?run=<id>` — the driver is
 * looking at that day's record and means to fix it. Opened from the garage, the same numbers are a
 * starting point: the setup that worked on Saturday, about to become the setup for Sunday. Editing
 * it must not touch Saturday.
 *
 * Before this, the count alone decided, so a run's setup opened from the garage offered "Correct
 * this run" as its loud button and a snapshot two runs shared refused to save at all. That read as
 * the app being frightened of the driver.
 *
 * ============================== NO AUTOSAVE, ANYWHERE ==============================
 *
 * Every mode here saves on a press. There used to be a debounced write-as-you-type on the driver's
 * own named setups; it was the only place in the app where typing changed something already on the
 * shelf, and it went (same call). Drafts still autosave — the log-run wizard and the sheet fill keep
 * their scratch pad — but a draft is a scrap of paper, not a setup.
 */
export type SetupSaveMode =
  /** No run points at this setup, so it may be written over. Explicit "Save changes". */
  | { kind: "inPlace" }
  /**
   * Reached from this run's own record, and saving means correcting it: a NEW snapshot is written
   * and the run repointed at it, so the numbers a logged run claims to have raced change only when
   * the driver says so. Other runs on the old snapshot are untouched — nothing is rewritten.
   */
  | { kind: "correctRun"; runId: string }
  /**
   * Reached from the garage with runs behind these numbers. Saving writes a separate setup that
   * records where it came from; the runs keep their record.
   *
   * `correctableRunId` is the one run pointing here, when there is exactly one — the quiet second
   * door for "I typed the camber wrong when I logged that". With several runs it is null, because
   * "this run" no longer names anything, and the driver is sent to the run they mean.
   */
  | { kind: "fork"; runCount: number; correctableRunId: string | null };

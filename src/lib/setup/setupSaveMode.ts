/**
 * What a save is allowed to mean for the setup currently open in an editor.
 *
 * A setup's values are safe to write over when nothing depends on them. The moment a logged run
 * points at a snapshot, those numbers are that run's account of what it raced — so the editor stops
 * writing in place and starts writing a new snapshot the run is repointed at instead. Decided once,
 * on the server, from the run count; the editors only render what it says.
 */
export type SetupSaveMode =
  /**
   * No run points at this setup, so it may be written over.
   *
   * `autosave` is true only for a setup the driver built and named themselves — their own working
   * document, where a save bar would be friction. It is FALSE for a setup that arrived from
   * somewhere else, an uploaded sheet above all: those numbers are a record of what the driver
   * typed on paper, and silently overwriting them the moment a box is touched takes away the
   * original with no way back. There, the choice is made explicitly — save over it, or keep both.
   */
  | { kind: "inPlace"; autosave: boolean }
  /** Exactly one run's record. Saving corrects that run via a new snapshot. */
  | { kind: "correctRun"; runId: string }
  /** Several runs share this snapshot, so correcting one would rewrite the rest. Copy only. */
  | { kind: "copyOnly"; runCount: number };

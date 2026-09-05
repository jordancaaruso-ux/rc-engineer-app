/**
 * What "get this setup off my list" is allowed to mean, for one saved setup.
 *
 * ============================== WHY THIS IS SHARED ==============================
 *
 * The Saved setups card and `DELETE /api/setup-snapshots/[id]` used to decide this separately, and
 * they disagreed: the API refused a delete only when a RUN pointed at the snapshot, while the card
 * hid the button whenever `runs + derivedSnapshots > 0`. Logging a run from a saved setup writes a
 * new snapshot pointing back at it (`baseSetupSnapshotId`), so every setup the driver actually
 * raced picked up a derived row — and the one door that would have worked was never drawn. The
 * setups you use were exactly the setups you could not remove (founder report, 2026-09-03).
 *
 * So the rule lives here once and both surfaces read it. A row never offers what the API refuses,
 * and never hides what the API allows.
 *
 * ============================== THE RULE ==============================
 *
 * Delete is about what would be LOST, and a run loses nothing: `SetupSnapshot.data` is always the
 * full resolved values, so a run copied every number into its own record on the day it was logged.
 * The lineage link is audit metadata. Deleting a setup three runs started from leaves those three
 * runs saying exactly what they said before.
 *
 * Two things genuinely cannot survive it:
 *
 *  1. A snapshot a RUN points at IS that run's record — `Run.setupSnapshot` is a required relation,
 *     so the database would refuse anyway. The driver's real intent there is "stop showing me this
 *     in Saved setups", which is un-saving, and that is offered instead.
 *  2. A snapshot an UPLOADED SHEET created, which other setups then came from.
 *     `SetupDocument.createdSetupId` points at it, and it is a link in the chain
 *     `resolveUploadedPdfSourceForRun` walks to find the driver's own paper for a car with no
 *     chassis blank. Delete it and those runs export on the wrong paper. Un-saving is offered
 *     instead. An upload's setup that nothing came from is free to go.
 */

export type SetupRemoveDecision =
  /** Nothing depends on these values. `derivedCount` is runs that STARTED here; they keep theirs. */
  | { kind: "delete"; derivedCount: number }
  /**
   * Deleting would take something with it, so the door is "remove from saved" — the row leaves the
   * list, the setup stays where the thing that needs it can still find it.
   *
   * `because` is "run" when the setup is a logged run's own record, "sheet" when it is what an
   * uploaded sheet created and other setups came from it.
   */
  | { kind: "unsave"; because: "run" | "sheet"; runCount: number }
  /** Not in the driver's saved setups, so there is nothing to remove FROM. */
  | { kind: "none" };

export type SetupRemoveInput = {
  /** In the driver's saved list right now — the flag the bookmark toggles. */
  isLibrary: boolean;
  /** Logged runs whose record IS this snapshot. */
  runCount: number;
  /** Snapshots that name this one as where they started (`baseSetupSnapshotId`). */
  derivedCount: number;
  /** Uploaded sheets that produced this setup (`SetupDocument.createdSetupId`). */
  sourceDocumentCount: number;
};

export function decideSetupRemoval(input: SetupRemoveInput): SetupRemoveDecision {
  if (!input.isLibrary) return { kind: "none" };
  if (input.runCount > 0) return { kind: "unsave", because: "run", runCount: input.runCount };
  if (input.sourceDocumentCount > 0 && input.derivedCount > 0) {
    return { kind: "unsave", because: "sheet", runCount: 0 };
  }
  return { kind: "delete", derivedCount: input.derivedCount };
}

/** Plural without the "(s)" — these strings are read by a person, not a parser. */
function runWord(count: number): string {
  return count === 1 ? "run" : "runs";
}

/**
 * The question asked before a delete goes through.
 *
 * Short when nothing points at the setup, because there is nothing to warn about. When runs started
 * from it, it says the one thing a driver would reasonably fear — "do I lose my sessions?" — and
 * answers it in the same breath.
 */
export function setupDeleteConfirmMessage(name: string, derivedCount: number): string {
  if (derivedCount <= 0) return `Delete “${name}”?`;
  const keep = derivedCount === 1 ? "keeps its own numbers" : "keep their own numbers";
  return `Delete “${name}”? ${derivedCount} ${runWord(derivedCount)} started from it and ${keep}.`;
}

/** Why the API turned a delete down, in words a row can show as-is. */
export function setupDeleteRefusalMessage(decision: SetupRemoveDecision): string {
  if (decision.kind === "unsave" && decision.because === "run") {
    return `This setup is what ${decision.runCount} logged ${runWord(
      decision.runCount
    )} recorded, so it can't be deleted. Remove it from saved instead.`;
  }
  if (decision.kind === "unsave") {
    return "This setup is the record of a sheet you uploaded, and other setups came from it. Remove it from saved instead.";
  }
  return "This setup can't be deleted.";
}

/**
 * The count under a saved setup's name.
 *
 * The card used to add `runs + derivedSnapshots` together and print "3 runs", which was wrong twice
 * over: a setup no run had ever used claimed three, and the number that hid the Delete button was
 * the same number the driver was reading as proof it was in use. Runs that ARE this setup and runs
 * that merely STARTED here are different facts and now say so. Null when there is nothing to say.
 */
export function setupUsageLabel(input: { runCount: number; derivedCount: number }): string | null {
  if (input.runCount > 0) return `${input.runCount} ${runWord(input.runCount)}`;
  if (input.derivedCount > 0) {
    return `${input.derivedCount} ${runWord(input.derivedCount)} from it`;
  }
  return null;
}

/**
 * Which run's SETUP the next run starts from.
 *
 * ============================== THE BUG THIS EXISTS TO FIX ==============================
 *
 * `/api/runs/last` has always preferred the most recently COMPLETED run, skipping drafts, on
 * the reasoning written into that route: a run the driver never marked complete may be half
 * filled in, and half-filled-in details should not become the next run's starting point.
 *
 * That is right for the DAY CONTEXT — session, track, event, tyres. It is wrong for the setup,
 * and it cost a paying driver his work (reported 2026-08-23, reproduced here 2026-08-25).
 *
 * What he did: logged a run, changed a value on the setup sheet, tapped the sheet's yellow
 * "Save to this run" — which saves a DRAFT — and left. The edit stored correctly on that run.
 * Next time out he tapped "Prefill from your last run" and got the setup from the run BEFORE it,
 * because his own run was a draft and the route stepped over it. Nothing told him. Measured on
 * the same run with one boolean flipped: as a draft the next run prefilled the old value, as a
 * completed run it prefilled his edit.
 *
 * ============================== WHY THE SETUP IS DIFFERENT ==============================
 *
 * The day context describes an intention — which session this is, which track, which event —
 * and an abandoned draft's intention is worth nothing.
 *
 * A setup describes the CAR. Screws are where the driver last put them whether or not the log
 * entry about it was finished, so the newest statement about the car is the truest one available,
 * and "unfinished" says nothing about whether it is accurate. That asymmetry is the whole rule:
 * the setup comes forward from a draft, everything else still waits for a completed run.
 *
 * ============================== WHAT STILL GETS SKIPPED ==============================
 *
 * A draft with nothing in its setup. Starting a run on a blank sheet and abandoning it leaves a
 * snapshot full of nothing, and carrying THAT forward would wipe the sheet the driver actually
 * races — the failure this fix would otherwise introduce. An empty setup is not a statement about
 * the car, so it loses to the completed run behind it.
 *
 * Pure and out of the route so the rule can be tested without a database — the same reason
 * `setupSourceDefault.ts` and `carSwap.ts` live where they do.
 */

/** Just enough of a run for this decision. */
export type SetupCarryRun = {
  id: string;
  loggingComplete: boolean;
  setupSnapshot: { id: string; data: unknown } | null;
};

/**
 * Does this value put anything on the sheet?
 *
 * Recursive because stored setups are not flat: grouped rows arrive as arrays, preset-with-other
 * rows as objects, and a cleared box as `""` — a deletion marker, which is the absence of a value
 * rather than one. Numbers and booleans always count, including `0`.
 */
function holdsAValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some(holdsAValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(holdsAValue);
  return true;
}

/** A setup says something about the car only if at least one box has a value in it. */
export function setupSnapshotHasValues(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  return Object.values(data as Record<string, unknown>).some(holdsAValue);
}

/**
 * The unfinished run whose setup should be carried onto the next run, or `null` for
 * "the completed run's setup is still the right one".
 *
 * `newest` is the newest run on the car by `sortAt` regardless of state; `completed` is the
 * newest one marked complete. Both come from the same ordering, so when they are the same row
 * there is no draft in front and nothing to decide.
 */
export function unfinishedRunToCarrySetupFrom<T extends SetupCarryRun>(args: {
  completed: T | null;
  newest: T | null;
}): T | null {
  const { completed, newest } = args;
  // No completed run at all: the caller already falls back to `newest` whole, setup included.
  if (!newest || !completed) return null;
  if (newest.id === completed.id) return null;
  if (newest.loggingComplete) return null;
  if (!newest.setupSnapshot) return null;
  if (!setupSnapshotHasValues(newest.setupSnapshot.data)) return null;
  return newest;
}

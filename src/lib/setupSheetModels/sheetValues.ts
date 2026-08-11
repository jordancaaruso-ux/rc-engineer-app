import type { SetupSnapshotData } from "@/lib/runSetup";

/**
 * Moving values between a setup snapshot and the sheet surface.
 *
 * The surface deals in plain strings keyed by box. A setup snapshot holds those same keys plus
 * things that were never on the paper — the tire selection, the additive, the run context — and
 * those are objects and arrays, not strings. So the two directions are not symmetrical, and getting
 * that wrong loses a driver's data quietly, which is why the rules live here with a test rather
 * than inline in three components.
 */

/**
 * Boxes the driver opened and left blank are absent, not blank.
 *
 * A key on a derived sheet means nothing to the app, so an empty string survives storage as a
 * deliberate value — and then "what changed since your last run" reports that box every run,
 * forever, because a blank is not the same as a missing key. Stripped here rather than in the
 * shared normaliser, which every setup writer in the app goes through.
 */
export function withoutEmptySheetValues(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v !== "string") continue;
    if (v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

/**
 * Seed the sheet from a setup the driver already has.
 *
 * Only what can be drawn in a box comes across. A number is stringified because that is what a box
 * shows; everything structured is left behind, because the surface would render `[object Object]`
 * into somebody's tire row and then hand it back as their tire choice.
 */
export function sheetValuesFromSnapshot(setup: SetupSnapshotData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(setup)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = String(v);
  }
  return out;
}

/**
 * Fold what the sheet now holds back into the setup.
 *
 * Keys the sheet never mentions are left exactly as they were — that is what protects the tires,
 * the additive and the run context from a surface that has no idea they exist.
 *
 * A box cleared to empty REMOVES its key rather than storing a blank. Merging with a plain spread
 * looks equivalent and is not: an emptied box would keep its old value forever, because an empty
 * string loses to whatever was already there.
 */
export function mergeSheetValuesIntoSnapshot(
  previous: SetupSnapshotData,
  sheetValues: Record<string, string>
): SetupSnapshotData {
  const next: SetupSnapshotData = { ...previous };
  for (const [k, v] of Object.entries(sheetValues)) {
    if (typeof v !== "string") continue;
    if (v.trim() === "") delete next[k];
    else next[k] = v;
  }
  return next;
}

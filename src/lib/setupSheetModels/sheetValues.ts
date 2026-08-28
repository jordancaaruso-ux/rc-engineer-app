import type { SetupSnapshotData, SetupSnapshotValue } from "@/lib/runSetup";
import { PRESET_WITH_OTHER_BASE_KEYS, scalarSetupTextFromUnknown } from "@/lib/setup/presetWithOther";
import { storedValuesToSurface } from "@/lib/setupSheetModels/sheetSurfaceValues";

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
 * Only what can be drawn in a box comes across, through the shared bridge: strings and numbers as
 * themselves, a many-of-many array as its ticked options, a preset-with-other object as its two
 * boxes. What the bridge cannot draw — the tire selection, the additive, the run context — is
 * left behind, because the surface would render `[object Object]` into somebody's tire row and
 * then hand it back as their tire choice.
 */
export function sheetValuesFromSnapshot(setup: SetupSnapshotData): Record<string, string> {
  return storedValuesToSurface(setup);
}

/**
 * Fold what the sheet now holds back into the setup.
 *
 * Keys the sheet never mentions are left exactly as they were — that is what protects the tires,
 * the additive and the run context from a surface that has no idea they exist.
 *
 * ============================== A CLEARED BOX KEEPS ITS KEY, HOLDING "" ==============================
 *
 * This used to `delete next[k]`, on the reasoning that a key which is gone cannot bring an old
 * value back with it. That is true only where the result REPLACES a stored setup. The log-run
 * wizard does not replace: it posts this object alongside `setupBaselineSnapshotId`, and the
 * server merges it onto that baseline — so a key that is simply missing is read as "the driver
 * said nothing about this box", and the baseline's old value is written into the new run.
 *
 * A driver reported it and filmed it (2026-08-25): he emptied a text box on the sheet while
 * logging a run, and it was back on his next run. Reproduced end to end — the browser posted 97
 * keys and the run stored 98, the extra one being the value he had just deleted. His other edits
 * that run stuck, because a CHANGED box does say something and a cleared one said nothing. That
 * is why "some of my changes stay and some don't" had no visible pattern: anything erased came
 * back, everything typed survived.
 *
 * So an emptied box now stays in the object holding `""`, which is the deletion marker
 * `surfaceValuesToStoredMerge` already produces upstream and which `resolveSetupSnapshot` already
 * honours downstream (it writes the blank over the baseline, and the storage normaliser then drops
 * the key). This function was the one link that threw the marker away. It also brings the sheet
 * into line with the ordinary field list, which has always committed `""` for a cleared field —
 * the two editors disagreed, and only the sheet's way lost work.
 *
 * Callers that count values must not count markers: see `filledSetupValueCount`.
 */
export function mergeSheetValuesIntoSnapshot(
  previous: SetupSnapshotData,
  sheetValues: Record<string, unknown>
): SetupSnapshotData {
  const next: SetupSnapshotData = { ...previous };
  for (const [k, v] of Object.entries(sheetValues)) {
    if (typeof v === "string") {
      next[k] = v.trim() === "" ? "" : v;
      // A marker on a `_other` companion whose base is NOT in this save: the previous snapshot
      // keeps that text inside the base's object (`front_bumper: { otherText: "Plastic" }`), so
      // blank it there as well — otherwise the marker lands on a key the snapshot never used and
      // the text comes back (2026-08-29). The sheet now sends the marker on the base too; this
      // covers a phone still running the old bundle.
      if (next[k] === "" && k.endsWith("_other") && !(k.slice(0, -6) in sheetValues)) {
        const base = k.slice(0, -6);
        const prev = previous[base];
        if (
          (PRESET_WITH_OTHER_BASE_KEYS as readonly string[]).includes(base) &&
          prev != null &&
          typeof prev === "object" &&
          !Array.isArray(prev) &&
          "otherText" in prev
        ) {
          const preset = scalarSetupTextFromUnknown((prev as { selectedPreset?: unknown }).selectedPreset).trim();
          next[base] = preset ? { selectedPreset: preset, otherText: "" } : "";
        }
      }
      continue;
    }
    // Stored shapes from a calibrated sheet: a ticked-options array, a preset-with-other object,
    // a number. They land as themselves — that is the entire point of the bridge.
    if (v == null) continue;
    next[k] = v as SetupSnapshotValue;
  }
  return next;
}

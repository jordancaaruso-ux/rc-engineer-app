import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { isDerivedSetupKey } from "@/lib/setupCalculations/a800rrDerived";
import { isRunContextSetupKey } from "@/lib/setup/runContextSetupKeys";
import { buildSetupDiffRows } from "@/lib/setupDiff";

/**
 * The boxes a driver has changed since a setup was loaded into the run form: what its
 * "N changes since loaded" badge counts and the rows under it list.
 *
 * ============================== THE BUG THIS FIXES ==============================
 *
 * Changing one box on a Schumacher Mi10 read "2 changes since loaded", and putting it back read
 * "1 change" (test drive 2026-09-26). The first edit hands the whole sheet back, and the sheet
 * does not give every value back in the shape it was loaded in: that driver's setup (a copied
 * manufacturer baseline) keeps `chassis` as a preset-with-other object, which the sheet draws as a
 * separate `chassis_other` box and returns as a plain string. The raw comparison saw a box that
 * had not existed before, and it stayed through the revert.
 *
 * So both sides are compared as they would be STORED, through the same normaliser the server runs
 * on save (`resolveSetupSnapshot`): the companion folds back into its row, a cleared box's `""`
 * marker reads as empty, and a value that only changed shape is no change.
 *
 * Two kinds of key are never counted. The run-context keys (today's tyre, additive, prep) are
 * written by the form itself, not the driver. The derived boxes (spring rate, final drive) follow
 * the boxes they are worked out from, and the sheet recomputes them on the first edit, so one
 * changed spring gap would otherwise read as two changes, or a stale stored rate as a change
 * nobody made.
 */
export function setupChangesSinceLoaded(
  current: SetupSnapshotData,
  loaded: SetupSnapshotData | null
): ReturnType<typeof buildSetupDiffRows> {
  if (!loaded) return [];
  return buildSetupDiffRows(normalizeSetupData(current), normalizeSetupData(loaded)).filter(
    (r) => r.changed && !isRunContextSetupKey(r.key) && !isDerivedSetupKey(r.key)
  );
}

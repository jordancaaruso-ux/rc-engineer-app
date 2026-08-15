import { isTireFieldKey } from "@/lib/tires/tireSelectionValue";
import { allTirePrepBooleanKeys } from "@/lib/tires/tirePrepFields";
import { isRunContextSetupKey } from "@/lib/setup/runContextSetupKeys";
import { isDocumentMetadataField } from "@/lib/setupCalibrations/calibrationFieldCatalog";

/**
 * Setup-diff noise filters shared by every "what changed since the previous run"
 * surface (analysis trend wrench row, team delta feed).
 *
 * Keep this file Prisma-free — it is imported by pure, offline-testable modules.
 */

const EXCLUDED_TIRE_PREP_KEYS = new Set(allTirePrepBooleanKeys());

/**
 * Tire selection + legacy tire-prep booleans. Tires change nearly every run and are
 * reported separately (as run context), so counting them as *setup* changes buries
 * the actual tuning move. Battery / additive / tire set are Run columns rather than
 * setup-sheet data, so they never reach a setup diff at all.
 */
export function isExcludedSetupChangeKey(key: string): boolean {
  return isTireFieldKey(key) || EXCLUDED_TIRE_PREP_KEYS.has(key);
}

/**
 * Everything a "what changed" list should drop: tire noise **plus** sheet header
 * fields (driver name, race, track, date).
 *
 * The header lives in the same `SetupSnapshot.data` blob as the tuning parameters, so
 * without this every entry reports `Date: 2026-07-20 → 2026-07-25` as a setup change.
 */
export function isSetupChangeNoiseKey(key: string): boolean {
  return isExcludedSetupChangeKey(key) || isDocumentMetadataField(key);
}

/**
 * What a **run-to-run** setup diff must ignore, used by the car page's "All setups" list to decide
 * whether a run changed the car at all.
 *
 * Wider than `isSetupChangeNoiseKey` by exactly two keys — `additive` and `additive_time`. Those are
 * written by the run form's Tires tab, not the chassis sheet, and they move nearly every run; a list
 * whose job is "what did I change on the car" cannot treat picking today's additive as a change.
 * The narrower filter is left alone because the team feed and the analysis trend row report additive
 * deliberately.
 */
export function isRunToRunSetupNoiseKey(key: string): boolean {
  return isRunContextSetupKey(key) || isDocumentMetadataField(key);
}

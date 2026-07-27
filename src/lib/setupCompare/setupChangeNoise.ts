import { isTireFieldKey } from "@/lib/tires/tireSelectionValue";
import { allTirePrepBooleanKeys } from "@/lib/tires/tirePrepFields";
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

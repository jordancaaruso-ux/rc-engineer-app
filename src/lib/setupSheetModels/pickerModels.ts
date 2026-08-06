import {
  normalizeSetupSheetModelName,
  setupSheetModelSlugRank,
} from "@/lib/setupSheetModels/normalizeModelName";

export type SetupSheetModelPickerRow = {
  id: string;
  name: string;
  slug: string;
  carCount: number;
  calibrationCount: number;
  /** Curated catalog entry. Absent is treated as unauthorized — the safe default. */
  isAuthorized?: boolean;
};

/**
 * Higher score = preferred row when collapsing duplicate chassis names.
 *
 * Authorized dominates everything. Drivers can author their own chassis types, which go live for
 * everyone the moment they are made, so without this term a user-created "Mugen MTC3" that picked
 * up a calibration and a couple of cars would outrank the curated row and become the one the whole
 * app resolves — silently breaking scoped fingerprint matching against the real sheet. This mirrors
 * `compareDedupeKeeper`'s precedence deliberately: the picker and the dedupe script must never
 * disagree about which row is canonical.
 *
 * Below that, a row that actually has a calibration beats one without, because the calibrated row
 * is the only one whose example PDF can fingerprint-match uploads. (Car count used to dominate that
 * too, with the same class of consequence.)
 */
export function setupSheetModelPickerScore(row: SetupSheetModelPickerRow): number {
  const authorized = row.isAuthorized ? 1_000_000_000 : 0;
  const hasCalibration = row.calibrationCount > 0 ? 1_000_000 : 0;
  return (
    authorized +
    hasCalibration +
    row.carCount * 1000 +
    row.calibrationCount * 10 -
    setupSheetModelSlugRank(row.slug)
  );
}

/** Id of the row `dedupeSetupSheetModelsForPicker` would keep for each normalized name. */
export function recommendedSetupSheetModelIds(models: SetupSheetModelPickerRow[]): Set<string> {
  const byNorm = new Map<string, SetupSheetModelPickerRow>();
  for (const m of models) {
    const key = normalizeSetupSheetModelName(m.name);
    if (!key) continue;
    const existing = byNorm.get(key);
    if (!existing || setupSheetModelPickerScore(m) > setupSheetModelPickerScore(existing)) {
      byNorm.set(key, m);
    }
  }
  return new Set([...byNorm.values()].map((m) => m.id));
}

/**
 * One row per chassis type for upload / wizard pickers.
 * Collapses duplicate names (e.g. many "Mugen MTC3" rows from repeated wizard runs).
 */
export function dedupeSetupSheetModelsForPicker(
  models: SetupSheetModelPickerRow[]
): SetupSheetModelPickerRow[] {
  const ids = recommendedSetupSheetModelIds(models);
  return models.filter((m) => ids.has(m.id)).sort((a, b) => a.name.localeCompare(b.name));
}

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
};

/** Higher score = preferred row when collapsing duplicate chassis names. */
export function setupSheetModelPickerScore(row: SetupSheetModelPickerRow): number {
  return row.carCount * 1000 + row.calibrationCount * 10 - setupSheetModelSlugRank(row.slug);
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

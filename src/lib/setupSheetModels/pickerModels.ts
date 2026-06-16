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

/**
 * One row per chassis type for upload / wizard pickers.
 * Collapses duplicate names (e.g. many "Mugen MTC3" rows from repeated wizard runs).
 */
export function dedupeSetupSheetModelsForPicker(
  models: SetupSheetModelPickerRow[]
): SetupSheetModelPickerRow[] {
  const byNorm = new Map<string, SetupSheetModelPickerRow>();
  for (const m of models) {
    const key = normalizeSetupSheetModelName(m.name);
    if (!key) continue;
    const existing = byNorm.get(key);
    if (!existing) {
      byNorm.set(key, m);
      continue;
    }
    const score = (row: SetupSheetModelPickerRow) =>
      row.carCount * 1000 +
      row.calibrationCount * 10 -
      setupSheetModelSlugRank(row.slug);
    if (score(m) > score(existing)) byNorm.set(key, m);
  }
  return [...byNorm.values()].sort((a, b) => a.name.localeCompare(b.name));
}

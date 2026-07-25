import { layoutRowFieldKeys } from "@/lib/setupSheetModels/layoutGroupOps";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

/**
 * Bring an existing generic-preset chassis up to date with newly-added preset fields.
 *
 * Every catalog chassis except the A800 was seeded from the generic touring preset, and
 * `ensureAuthorizedSetupSheetCatalog` only ever *creates* rows — it never rewrites `schemaJson`.
 * So improving the preset does nothing for the eleven chassis already in the database unless
 * something merges the difference in. That is this.
 *
 * Unlike `mergeMissingA800CatalogFields` this also merges LAYOUT: the sheet renders from
 * `structuredSections` (see `buildSetupSheetTemplate`), so a field added to `fields` alone would
 * exist in the schema and be invisible to the driver.
 *
 * Strictly additive — it appends fields and rows, and never edits, reorders or removes anything
 * already there. A chassis someone has hand-tuned keeps its layout; it just gains the new rows at
 * the end of the matching section.
 */
export function mergeMissingGenericCatalogFields(
  existing: SetupSheetModelSchema,
  seed: SetupSheetModelSchema
): SetupSheetModelSchema | null {
  const existingKeys = new Set(existing.fields.map((f) => f.key));
  const missingFields = seed.fields.filter((f) => !existingKeys.has(f.key));
  if (missingFields.length === 0) return null;

  const missingKeys = new Set(missingFields.map((f) => f.key));

  // Only append a row when EVERY key it lays out is missing. A partially-present row (say the
  // driver already added their own "Caster (Front)") would otherwise render a key twice.
  const isFullyMissing = (row: Parameters<typeof layoutRowFieldKeys>[0]): boolean => {
    const keys = layoutRowFieldKeys(row);
    return keys.length > 0 && keys.every((k) => missingKeys.has(k));
  };

  const sectionIndexById = new Map(existing.structuredSections.map((s, i) => [s.id, i]));
  const mergedSections = existing.structuredSections.map((s) => ({ ...s, rows: [...s.rows] }));
  const newSections: SetupSheetModelSchema["structuredSections"] = [];

  for (const seedSection of seed.structuredSections) {
    const rowsToAdd = seedSection.rows.filter(isFullyMissing);
    if (rowsToAdd.length === 0) continue;

    const index = sectionIndexById.get(seedSection.id);
    if (index === undefined) {
      // A whole new section (e.g. "Link geometry") — append it after the existing ones.
      newSections.push({ id: seedSection.id, title: seedSection.title, rows: rowsToAdd });
    } else {
      mergedSections[index].rows.push(...rowsToAdd);
    }
  }

  return {
    ...existing,
    structuredSections: [...mergedSections, ...newSections],
    fields: [...existing.fields, ...missingFields],
  };
}

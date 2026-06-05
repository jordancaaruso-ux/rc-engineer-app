import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

/** Add catalog fields missing from an existing schema without touching saved layout. */
export function mergeMissingA800CatalogFields(
  existing: SetupSheetModelSchema,
  seed: SetupSheetModelSchema
): SetupSheetModelSchema | null {
  const existingKeys = new Set(existing.fields.map((f) => f.key));
  const missingFields = seed.fields.filter((f) => !existingKeys.has(f.key));
  if (missingFields.length === 0) return null;
  return { ...existing, fields: [...existing.fields, ...missingFields] };
}

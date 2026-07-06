/**
 * Stage-1 AI vision extraction for setup sheets (SETUP_UPLOAD_NORTH_STAR.md).
 * Pure types — no server-only import so the eval harness can run these under tsx.
 */

export type ExtractionFieldDef = {
  key: string;
  /** Label as printed on the sheet (what the vision model should look for). */
  label: string;
  section: string;
  valueType: "text" | "choice";
  /** For choice fields: canonical option values the extractor must pick from. */
  options?: string[];
  /**
   * Canonical cross-car aggregation key (e.g. `droop_front` even if this sheet calls the
   * row "Downstop"). Carried so extracted values stay poolable across cars/sheets — see
   * `universalParameters.ts`. Absent for car-specific fields with no universal equivalent.
   */
  universalParameterId?: string;
};

export type ExtractionSchema = {
  version: 1;
  label: string;
  fields: ExtractionFieldDef[];
};

export type ExtractedFieldValue = {
  key: string;
  /** Verbatim value ("" when the field is blank on the sheet). */
  value: string;
  /** 0..1 self-reported, then adjusted by dual-pass agreement. */
  confidence: number;
  /** Set when dual passes disagreed; carries the losing pass's value. */
  disagreementValue?: string;
};

export type SetupSheetAiExtraction = {
  version: 1;
  model: string;
  schemaLabel: string;
  fields: ExtractedFieldValue[];
  /** Total OpenAI calls made (2 for dual-pass). */
  passCount: number;
  warnings: string[];
};

/** Below this confidence a field is presented as flagged-for-review, never silently imported. */
export const EXTRACTION_FLAG_THRESHOLD = 0.8;

export function isFlagged(field: ExtractedFieldValue): boolean {
  return field.confidence < EXTRACTION_FLAG_THRESHOLD;
}

export function parseExtractionSchema(raw: unknown): ExtractionSchema | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fieldsRaw = Array.isArray(r.fields) ? r.fields : [];
  const fields: ExtractionFieldDef[] = [];
  for (const item of fieldsRaw) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const key = typeof f.key === "string" ? f.key.trim() : "";
    const label = typeof f.label === "string" ? f.label.trim() : "";
    const section = typeof f.section === "string" ? f.section.trim() : "";
    const valueType = f.valueType === "choice" ? "choice" : "text";
    if (!key || !label) continue;
    const options = Array.isArray(f.options)
      ? f.options.filter((o): o is string => typeof o === "string")
      : undefined;
    const universalParameterId = typeof f.universalParameterId === "string" && f.universalParameterId.trim()
      ? f.universalParameterId.trim()
      : undefined;
    fields.push({
      key,
      label,
      section,
      valueType,
      ...(options && options.length > 0 ? { options } : {}),
      ...(universalParameterId ? { universalParameterId } : {}),
    });
  }
  if (fields.length === 0) return null;
  return {
    version: 1,
    label: typeof r.label === "string" ? r.label : "Setup sheet",
    fields,
  };
}

import { suggestKeyFromPdfFieldName } from "@/lib/setupCalibrations/customFieldCatalog";
import { groupedOptionValueFromLabel } from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import type { SetupSheetModelFieldDef, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

/**
 * Building a parameter while mapping a sheet (the mapping editor is where chassis types are built —
 * you click a box on the PDF and name it there). Kept pure and separate from the editor component so
 * key collisions, grouped-option shapes and free-text group naming are testable.
 *
 * `value` splits into number/text at the call site; grouped kinds carry one option label per box the
 * driver clicked, in click order.
 */
export type NewParameterKind = "number" | "text" | "one_of_many" | "many_of_many";

export type NewParameterInput = {
  displayLabel: string;
  /** Free text — the driver groups the sheet however he wants ("Front end", "Diffs"). */
  groupTitle: string;
  kind: NewParameterKind;
  /** One label per clicked box, in click order. Grouped kinds only. */
  optionLabels?: string[];
  /** Canonical cross-car parameter, when this one is a universal (see universalParameters.ts). */
  universalParameterId?: string;
  unit?: string;
};

export type NewParameterResult =
  | { ok: true; field: SetupSheetModelFieldDef }
  | { ok: false; error: string };

/** Free-text group name → a stable sectionId, reusing the existing section when the title matches. */
export function sectionIdForGroupTitle(
  groupTitle: string,
  schema: Pick<SetupSheetModelSchema, "fields">
): string {
  const title = groupTitle.trim();
  if (!title) return "general";
  const existing = schema.fields.find(
    (f) => (f.sectionTitle ?? "").trim().toLowerCase() === title.toLowerCase()
  );
  if (existing?.sectionId) return existing.sectionId;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (!slug) return "general";
  return /^[a-z]/.test(slug) ? slug : `s_${slug}`;
}

/** Distinct group titles already used on this sheet, in first-seen order (chips in the name panel). */
export function existingGroupTitles(schema: Pick<SetupSheetModelSchema, "fields">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of schema.fields) {
    const title = (f.sectionTitle ?? "").trim();
    if (!title) continue;
    const norm = title.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(title);
  }
  return out;
}

/** Unique snake_case key from a label, suffixed until it no longer collides. */
export function uniqueParameterKey(displayLabel: string, existingKeys: Iterable<string>): string {
  const taken = new Set(existingKeys);
  const base = suggestKeyFromPdfFieldName(displayLabel);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/**
 * Build the field def for a parameter created against a sheet model. Grouped kinds need one option
 * label per box; a blank label falls back to its position so a half-labelled group still saves.
 */
export function buildNewParameterField(
  input: NewParameterInput,
  schema: SetupSheetModelSchema
): NewParameterResult {
  const displayLabel = input.displayLabel.trim();
  if (!displayLabel) return { ok: false, error: "Name is required." };

  const grouped = input.kind === "one_of_many" || input.kind === "many_of_many";
  const optionLabels = (input.optionLabels ?? []).map((l, i) => l.trim() || `Option ${i + 1}`);
  if (grouped && optionLabels.length < 2) {
    return { ok: false, error: "A grouped parameter needs at least 2 boxes." };
  }

  const key = uniqueParameterKey(displayLabel, schema.fields.map((f) => f.key));
  const sectionTitle = input.groupTitle.trim() || "General";
  const sectionId = sectionIdForGroupTitle(sectionTitle, schema);
  const sortOrder = schema.fields.reduce((m, f) => Math.max(m, f.sortOrder ?? 0), 0) + 1;

  const base: SetupSheetModelFieldDef = {
    key,
    displayLabel,
    sectionId,
    sectionTitle,
    valueType: "string",
    uiType: "text",
    showInSetupSheet: true,
    showInAnalysis: true,
    showInLogRun: true,
    sortOrder,
    ...(input.unit?.trim() ? { unit: input.unit.trim() } : {}),
    ...(input.universalParameterId?.trim()
      ? { universalParameterId: input.universalParameterId.trim() }
      : {}),
  };

  if (input.kind === "number") {
    return { ok: true, field: { ...base, valueType: "number", uiType: "text" } };
  }
  if (input.kind === "text") {
    return { ok: true, field: base };
  }

  const values = optionLabels.map((l, i) => groupedOptionValueFromLabel(l, i));
  // Duplicate labels would collapse two boxes onto one option value and silently lose a box.
  if (new Set(values).size !== values.length) {
    return { ok: false, error: "Each box needs a different label." };
  }
  const single = input.kind === "one_of_many";
  return {
    ok: true,
    field: {
      ...base,
      valueType: single ? "enum" : "multi",
      uiType: single ? "select" : "multiSelect",
      groupBehaviorType: single ? "singleSelect" : "multiChoiceGroup",
      groupedOptionLabels: optionLabels,
      groupedOptionValues: values,
    },
  };
}

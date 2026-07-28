import { suggestKeyFromPdfFieldName } from "@/lib/setupCalibrations/customFieldCatalog";
import { groupedOptionValueFromLabel } from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import { suggestUniversalParameterId } from "@/lib/setupSheetModels/matchUniversalParameter";
import {
  SETUP_SHEET_GROUPS,
  groupForFieldKey,
} from "@/lib/setupSheetModels/setupSheetGroups";
import type { SetupSheetModelFieldDef, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

/**
 * Building a parameter while mapping a sheet (the mapping editor is where chassis types are built —
 * you click a box on the PDF and name it there). Kept pure and separate from the editor component so
 * key collisions, grouped-option shapes and free-text group naming are testable.
 *
 * `value` splits into number/text at the call site; grouped kinds carry one option label per box the
 * driver clicked, in click order.
 */
export type NewParameterKind = "number" | "text" | "checkbox" | "one_of_many" | "many_of_many";

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

/**
 * Group chips offered while building a sheet: the app's universal groups first, then anything this
 * sheet already invented.
 *
 * A brand-new chassis type starts with zero fields, so "titles already on the sheet" was an empty
 * row of chips — every group had to be typed, and a typo minted a private section that never lined
 * up with the display groups. Offering the canonical set up front means a sheet is built into the
 * same six-plus-catch-all vocabulary it will later be *rendered* in (`setupSheetGroups.ts`).
 *
 * The titles are load bearing: `sectionIdForGroupTitle` slugifies each one straight onto its
 * `SetupSheetGroupId` ("Shocks & springs" -> `shocks_springs`), so the structural section id a
 * parameter is stored under matches the display group it regroups into. `newParameterDef.test.ts`
 * pins that.
 */
export function groupTitleChoices(schema: Pick<SetupSheetModelSchema, "fields">): string[] {
  const canonical = SETUP_SHEET_GROUPS.map((g) => g.title);
  const taken = new Set(canonical.map((t) => t.toLowerCase()));
  const extras = existingGroupTitles(schema).filter((t) => !taken.has(t.toLowerCase()));
  return [...canonical, ...extras];
}

/**
 * The group a parameter's name implies, as a title from {@link groupTitleChoices}. Undefined when
 * nothing matches, so the caller leaves the driver's own choice alone rather than guessing.
 */
export function suggestGroupTitleForLabel(displayLabel: string): string | undefined {
  const label = displayLabel.trim();
  if (!label) return undefined;
  const id = groupForFieldKey(suggestKeyFromPdfFieldName(label), label);
  if (!id) return undefined;
  return SETUP_SHEET_GROUPS.find((g) => g.id === id)?.title;
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
  // A lone tick box on the sheet — ticked or not. Same shape `buildFieldDefFromKind` emits, so a
  // checkbox made here and one made in the schema editor are indistinguishable downstream.
  if (input.kind === "checkbox") {
    return { ok: true, field: { ...base, valueType: "boolean", uiType: "checkbox" } };
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

/**
 * One parameter measured at several places on the car. `single` is one parameter as before; the
 * others expand one typed stem ("Camber") into that many sibling parameters, saving the driver
 * typing the position on every box.
 */
export type PositionSplit = "single" | "front_rear" | "corner4";

/**
 * Position label per split, in slot order. These are the *only* source of the label and key
 * suffixes, so they must stay spellings that `layoutGroupOps` recognizes as roles — the schema
 * page infers pair / corner4 rows from `_front`/`_rear` and `_ff`/`_fr`/`_rf`/`_rr` alone.
 */
export const POSITION_LABELS: Record<PositionSplit, readonly string[]> = {
  single: [],
  front_rear: ["Front", "Rear"],
  corner4: ["FF", "FR", "RF", "RR"],
};

export type PositionSplitResult =
  | { ok: true; fields: SetupSheetModelFieldDef[] }
  | { ok: false; error: string };

/**
 * Expand a stem into one sibling parameter per position — `Camber` → `camber_front` +
 * `camber_rear`, labelled "Camber (Front)" / "Camber (Rear)".
 *
 * Siblings, not one grouped parameter: everything downstream (the flat snapshot map, the universal
 * registry, per-axle Engineer notes) is per-position, so a grouped parameter would be the wrong
 * shape. No `layoutGroupId` is written — the suffixes are what the schema page groups on.
 */
export function buildPositionSplitFields(
  input: NewParameterInput,
  split: Exclude<PositionSplit, "single">,
  schema: SetupSheetModelSchema,
  /**
   * Grouped kinds only: one option-label list per position, index-aligned with
   * `POSITION_LABELS[split]`. Front and rear can differ in labels *and* count — each position
   * becomes its own independent parameter, so nothing forces them to match.
   */
  optionLabelsByPosition?: readonly string[][]
): PositionSplitResult {
  const stem = input.displayLabel.trim();
  if (!stem) return { ok: false, error: "Name is required." };

  const positions = POSITION_LABELS[split];
  const grouped = input.kind === "one_of_many" || input.kind === "many_of_many";
  if (grouped && (optionLabelsByPosition?.length ?? 0) !== positions.length) {
    return { ok: false, error: "Each position needs its own option list." };
  }

  const takenKeys = new Set(schema.fields.map((f) => f.key));
  const fields: SetupSheetModelFieldDef[] = [];
  // Grows as each sibling is built so they get distinct sort orders and a shared section id.
  let acc = schema;

  for (const [i, position] of positions.entries()) {
    const displayLabel = `${stem} (${position})`;
    const key = suggestKeyFromPdfFieldName(displayLabel);
    // Refuse rather than let `uniqueParameterKey` produce `camber_front_2` — the suffix is load
    // bearing, and a silently renamed key drops out of both layout grouping and cross-car stats.
    if (takenKeys.has(key)) {
      return { ok: false, error: `“${displayLabel}” already exists on this sheet.` };
    }
    const built = buildNewParameterField(
      {
        ...input,
        displayLabel,
        optionLabels: grouped ? [...(optionLabelsByPosition![i] ?? [])] : undefined,
        // Front/rear labels map cleanly onto the registry. Corners must not: "Camber (FR)" reads
        // `fr` as *front* (matchUniversalParameter's detectAxle) and would book one inner pickup
        // stack as the whole front axle, and the registry has no per-corner ids anyway. Grouped
        // parameters are never universal — the registry is numeric tuning values.
        universalParameterId:
          !grouped && split === "front_rear"
            ? suggestUniversalParameterId(key, displayLabel)
            : undefined,
      },
      acc
    );
    // Name the position — "needs at least 2 boxes" is useless without knowing which row failed.
    if (!built.ok) return { ok: false, error: `${position}: ${built.error}` };
    takenKeys.add(built.field.key);
    fields.push(built.field);
    acc = { ...acc, fields: [...acc.fields, built.field] };
  }

  return { ok: true, fields };
}

import {
  collectStructuredFieldKeys,
  type StructuredRow,
  type StructuredSection,
} from "@/lib/a800rrSetupDisplayConfig";
import { A800RR_STRUCTURED_SECTIONS } from "@/lib/a800rrSetupDisplayConfig";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import type { SetupFieldMeta } from "@/lib/setupFieldCatalog";
import { buildCatalogFromTemplate } from "@/lib/setupFieldCatalog";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import type {
  CustomSetupFieldDefinition,
  CustomFieldUiType,
  FieldDisplayOverride,
} from "@/lib/setupCalibrations/types";
import {
  buildCalibrationFieldCatalog,
  getCalibrationFieldCategory,
  getCalibrationFieldKind,
  getPairGroupForKey,
} from "@/lib/setupCalibrations/calibrationFieldCatalog";

/** Preset sections for new custom fields (ids stable for storage). */
export const CUSTOM_FIELD_SECTION_PRESETS: Array<{ id: string; title: string }> = [
  { id: "metadata", title: "Metadata" },
  { id: "document", title: "Document / header" },
  { id: "event", title: "Event & track" },
  { id: "car", title: "Car & body" },
  { id: "drivetrain", title: "Drivetrain & hardware" },
  { id: "electronics", title: "Electronics" },
  { id: "tuning", title: "Tuning (additional)" },
  { id: "other", title: "Other" },
];

const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

export function validateCustomFieldKey(
  key: string,
  reservedKeys: Set<string>,
  existingCustomKeys: Set<string>
): string | null {
  const k = key.trim();
  if (!k) return "Key is required.";
  if (!KEY_RE.test(k)) {
    return "Use lowercase snake_case: letters, digits, underscores (e.g. driver_name, track_date).";
  }
  if (reservedKeys.has(k)) return `Key "${k}" is already used by the base setup template.`;
  if (existingCustomKeys.has(k)) return `Key "${k}" is already used by another custom field.`;
  return null;
}

export function suggestKeyFromPdfFieldName(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (!s) return "custom_field";
  if (/^[a-z]/.test(s)) return s;
  return `f_${s}`;
}

export function inferUiTypeFromAcroType(rowType: string): CustomFieldUiType {
  const t = rowType.trim();
  if (t === "CheckBox" || t === "RadioGroup") return "checkbox";
  if (t === "Ch" || t === "Btn") return "checkbox";
  return "text";
}

export function mergeCustomFieldsIntoCatalog(
  base: readonly SetupFieldMeta[],
  custom: CustomSetupFieldDefinition[]
): SetupFieldMeta[] {
  const seen = new Set(base.map((f) => f.key));
  const out: SetupFieldMeta[] = [...base];
  const sorted = [...custom].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  for (const c of sorted) {
    if (!c.key?.trim() || seen.has(c.key)) continue;
    seen.add(c.key);
    out.push({
      key: c.key,
      label: c.displayLabel,
      unit: c.unit,
      groupId: c.sectionId,
      groupTitle: c.sectionTitle,
    });
  }
  return out;
}

export function buildMergedLabelMap(custom: CustomSetupFieldDefinition[]): Record<string, string> {
  const base = Object.fromEntries(
    buildCatalogFromTemplate(A800RR_SETUP_SHEET_V1)
      .filter((f) => f.key !== "notes" && f.key !== "tires_setup")
      .map((f) => [f.key, f.label])
  );
  const customMap = Object.fromEntries(custom.map((c) => [c.key, c.displayLabel]));
  return { ...base, ...customMap };
}

export function reservedTemplateKeys(): Set<string> {
  return new Set(
    buildCatalogFromTemplate(A800RR_SETUP_SHEET_V1)
      .filter((f) => f.key !== "notes" && f.key !== "tires_setup")
      .map((f) => f.key)
  );
}

/** All A800RR structured section groups plus custom presets — use for custom field section assignment. */
export function getMergedSectionGroupOptions(): Array<{ id: string; title: string }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; title: string }> = [];
  for (const sec of A800RR_STRUCTURED_SECTIONS) {
    if (!seen.has(sec.id)) {
      seen.add(sec.id);
      out.push({ id: sec.id, title: sec.title });
    }
  }
  for (const p of CUSTOM_FIELD_SECTION_PRESETS) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push({ id: p.id, title: p.title });
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Moves template `single` rows into another section when `fieldDisplayOverrides[key]` specifies sheetGroupId.
 * Layout only; does not change snapshot keys.
 */
export function relocateTemplateSingleFieldRows(
  sections: StructuredSection[],
  layoutOverrides: Record<string, FieldDisplayOverride> | undefined
): StructuredSection[] {
  if (!layoutOverrides) return sections;
  const moves = new Map<string, { targetId: string; targetTitle: string }>();
  for (const [key, o] of Object.entries(layoutOverrides)) {
    const gid = o.sheetGroupId?.trim();
    const gtitle = o.sheetGroupTitle?.trim();
    if (gid && gtitle) moves.set(key, { targetId: gid, targetTitle: gtitle });
  }
  if (moves.size === 0) return sections;

  const extracted: StructuredRow[] = [];
  const stripped: StructuredSection[] = sections.map((sec) => ({
    ...sec,
    rows: sec.rows.filter((row) => {
      if (row.type !== "single") return true;
      const m = moves.get(row.key);
      if (!m) return true;
      if (sec.id === m.targetId) return true;
      extracted.push(row);
      return false;
    }),
  }));

  const out = stripped.map((s) => ({ ...s, rows: [...s.rows] }));
  for (const row of extracted) {
    if (row.type !== "single") continue;
    const m = moves.get(row.key);
    if (!m) continue;
    let target = out.find((s) => s.id === m.targetId);
    if (!target) {
      target = { id: m.targetId, title: m.targetTitle, rows: [] };
      out.push(target);
    }
    target.rows.push(row);
  }
  return out.filter((s) => s.rows.length > 0);
}

function fieldKindFromCustom(d: CustomSetupFieldDefinition): "text" | "bool" | "multi" | undefined {
  if (d.uiType === "checkbox" || d.uiType === "groupOption") return "bool";
  if (d.valueType === "multi" || d.valueType === "string_array" || d.uiType === "select" || d.uiType === "multiSelect") return "multi";
  return undefined;
}

function structuredRowKeys(row: StructuredRow): string[] {
  if (row.type === "single") return [row.key];
  if (row.type === "pair") return [row.leftKey, row.rightKey];
  if (row.type === "corner4") return [row.ff, row.fr, row.rf, row.rr];
  if (row.type === "top_deck_block") return ["top_deck_front", "top_deck_rear", "top_deck_cuts", "top_deck_single"];
  if (row.type === "screw_strip") return [row.key];
  return [];
}

function fieldKindForStructuredRow(key: string): "text" | "bool" | "multi" | undefined {
  const kind = getCalibrationFieldKind(key);
  if (kind === "boolean") return "bool";
  if (kind === "visualMulti") return "multi";
  return undefined;
}

/**
 * Ensures setup/analysis rendering uses one authoritative registry:
 * structured template rows + calibration catalog rows not yet laid out.
 */
/** Merged into preset base keys on snapshot; custom text is edited on those rows — no standalone sheet lines. */
const OMIT_STANDALONE_SETUP_SHEET_KEYS = new Set([
  "top_deck_front_other",
  "top_deck_rear_other",
  "top_deck_single_other",
]);

function appendMissingCatalogRowsToSections(
  sections: StructuredSection[],
  view: "setup" | "analysis",
  hiddenKeys: Set<string>
): StructuredSection[] {
  const catalog = buildCalibrationFieldCatalog();
  const result = sections.map((sec) => ({ ...sec, rows: [...sec.rows] }));
  const existingKeys = new Set(collectStructuredFieldKeys(result));
  const pairedDone = new Set<string>();

  const ensureSection = (id: string, title: string): StructuredSection => {
    let sec = result.find((s) => s.id === id);
    if (!sec) {
      sec = { id, title, rows: [] };
      result.push(sec);
    }
    return sec;
  };

  for (const meta of catalog) {
    const key = meta.key;
    if (view === "setup" && OMIT_STANDALONE_SETUP_SHEET_KEYS.has(key)) continue;
    if (hiddenKeys.has(key) || existingKeys.has(key)) continue;
    if (view === "setup" && getCalibrationFieldCategory(key) === "document") continue;

    const pair = getPairGroupForKey(key);
    if (pair) {
      if (pairedDone.has(pair.id)) continue;
      const bothVisible = !hiddenKeys.has(pair.frontKey) && !hiddenKeys.has(pair.rearKey);
      if (!bothVisible || existingKeys.has(pair.frontKey) || existingKeys.has(pair.rearKey)) continue;
      const sec = ensureSection(meta.groupId, meta.groupTitle);
      sec.rows.push({
        type: "pair",
        label: pair.label,
        leftKey: pair.frontKey,
        rightKey: pair.rearKey,
        fieldKind: pair.innerKind === "boolean" ? "bool" : undefined,
      });
      pairedDone.add(pair.id);
      existingKeys.add(pair.frontKey);
      existingKeys.add(pair.rearKey);
      continue;
    }

    const sec = ensureSection(meta.groupId, meta.groupTitle);
    sec.rows.push({
      type: "single",
      key,
      label: meta.label,
      unit: meta.unit,
      fieldKind: fieldKindForStructuredRow(key),
    });
    existingKeys.add(key);
  }

  return result.filter((sec) => sec.rows.length > 0);
}

function rowFullyHidden(row: StructuredRow, hiddenKeys: Set<string>): boolean {
  const keys = structuredRowKeys(row);
  if (keys.length === 0) return false;
  return keys.every((k) => hiddenKeys.has(k));
}

/** Remove structured rows whose keys are all marked hidden (template + override prefs). */
export function filterStructuredSectionsByHiddenKeys(
  sections: StructuredSection[],
  hiddenKeys: Set<string>
): StructuredSection[] {
  return sections
    .map((sec) => ({
      ...sec,
      rows: sec.rows.filter((row) => !rowFullyHidden(row, hiddenKeys)),
    }))
    .filter((sec) => sec.rows.length > 0);
}

/** Keys to omit from a given UI surface (setup sheet vs analysis). */
export function buildHiddenKeysForView(
  custom: CustomSetupFieldDefinition[],
  overrides: Record<string, FieldDisplayOverride> | undefined,
  view: "setup" | "analysis"
): Set<string> {
  const hidden = new Set<string>();
  for (const c of custom) {
    const hide = view === "setup" ? c.showInSetupSheet === false : c.showInAnalysis === false;
    if (hide) hidden.add(c.key);
  }
  if (overrides) {
    for (const [k, o] of Object.entries(overrides)) {
      const hide = view === "setup" ? o.showInSetupSheet === false : o.showInAnalysis === false;
      if (hide) hidden.add(k);
    }
  }
  return hidden;
}

/**
 * Appends structured rows for user-defined fields after the base A800RR layout.
 */
export function mergeCustomFieldsIntoStructuredSections(
  base: StructuredSection[],
  custom: CustomSetupFieldDefinition[],
  view: "setup" | "analysis"
): StructuredSection[] {
  const visible = custom.filter((c) =>
    view === "setup" ? c.showInSetupSheet !== false : c.showInAnalysis !== false
  );
  if (visible.length === 0) return base;

  const sorted = [...visible].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  const groups = new Map<string, { title: string; defs: CustomSetupFieldDefinition[] }>();
  for (const c of sorted) {
    let g = groups.get(c.sectionId);
    if (!g) {
      g = { title: c.sectionTitle, defs: [] };
      groups.set(c.sectionId, g);
    }
    g.defs.push(c);
  }

  const extra: StructuredSection[] = [];
  for (const [sectionId, { title, defs }] of groups) {
    const rows: StructuredRow[] = defs.map((d) => ({
      type: "single",
      key: d.key,
      label: d.displayLabel,
      unit: d.unit,
      fieldKind: fieldKindFromCustom(d),
      multiline: d.uiType === "textarea",
    }));
    extra.push({
      id: `custom_${sectionId}`,
      title: `${title} · custom`,
      rows,
    });
  }
  return [...base, ...extra];
}

/**
 * A800RR template with calibration display preferences applied (hides rows/keys) and custom sections merged.
 */
export function getA800rrSetupSheetTemplateWithDisplayPreferences(
  custom?: CustomSetupFieldDefinition[] | null,
  fieldDisplayOverrides?: Record<string, FieldDisplayOverride> | null,
  view: "setup" | "analysis" = "setup"
): SetupSheetTemplate {
  const baseSections = A800RR_SETUP_SHEET_V1.structuredSections ?? [];
  const hidden = buildHiddenKeysForView(custom ?? [], fieldDisplayOverrides ?? undefined, view);
  const filteredBase = filterStructuredSectionsByHiddenKeys(baseSections, hidden);
  const relocated = relocateTemplateSingleFieldRows(filteredBase, fieldDisplayOverrides ?? undefined);
  const withCatalogRows = appendMissingCatalogRowsToSections(relocated, view, hidden);
  return {
    ...A800RR_SETUP_SHEET_V1,
    structuredSections: mergeCustomFieldsIntoStructuredSections(withCatalogRows, custom ?? [], view),
  };
}

/** @deprecated Prefer getA800rrSetupSheetTemplateWithDisplayPreferences — kept for call sites that only merge custom fields. */
export function getA800rrSetupSheetTemplateWithCustom(
  custom?: CustomSetupFieldDefinition[] | null
): SetupSheetTemplate {
  return getA800rrSetupSheetTemplateWithDisplayPreferences(custom, null, "setup");
}

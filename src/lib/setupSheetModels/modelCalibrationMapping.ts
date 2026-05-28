import type { CustomSetupFieldDefinition, PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import { pruneGroupedRuleOptionKeys, pruneOrphanCalibrationMappingKeys } from "@/lib/setupCalibrations/pdfFieldMappingOwnership";
import {
  isSingleSelectGroupedBehavior,
  type GroupedFieldBehaviorType,
  type GroupedFieldOptionDefinition,
} from "@/lib/setupCalibrations/types";
import { schemaKindFromField, type SchemaParameterKind } from "@/lib/setupSheetModels/fieldParamTypes";
import { normalizeGroupedFieldOnField } from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import type { SetupSheetModelFieldDef, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

export type ModelOptionAssignment = {
  optionValue: string;
  optionLabel: string;
  /** `pdfFieldName#instanceIndex` */
  sourceKey: string;
};

function parseAcroKey(key: string): { pdfFieldName: string; instanceIndex: number } {
  const hash = key.lastIndexOf("#");
  if (hash <= 0) return { pdfFieldName: key, instanceIndex: 0 };
  return {
    pdfFieldName: key.slice(0, hash),
    instanceIndex: Number(key.slice(hash + 1)) || 0,
  };
}

export function isGroupedModelField(f: SetupSheetModelFieldDef): boolean {
  const k = schemaKindFromField(f);
  return k === "one_of_many" || k === "many_of_many";
}

export function isSimpleModelField(f: SetupSheetModelFieldDef): boolean {
  return !isGroupedModelField(f);
}

export function modelFieldOptionEntries(f: SetupSheetModelFieldDef): Array<{ value: string; label: string }> {
  const normalized = normalizeGroupedFieldOnField(f);
  const labels = normalized.groupedOptionLabels ?? [];
  const values = normalized.groupedOptionValues ?? [];
  if (labels.length === 0) return [];
  return labels.map((label, i) => ({
    label,
    value: values[i] ?? `opt_${i + 1}`,
  }));
}

export function groupedBehaviorForModelField(f: SetupSheetModelFieldDef): GroupedFieldBehaviorType {
  const normalized = normalizeGroupedFieldOnField(f);
  if (normalized.groupBehaviorType) return normalized.groupBehaviorType;
  return schemaKindFromField(normalized) === "one_of_many" ? "singleSelect" : "multiChoiceGroup";
}

/** Prefer visualMulti when every assigned widget shares one AcroForm field name (Awesomatix row). */
export function groupedBehaviorForAssignments(
  field: SetupSheetModelFieldDef,
  assignments: ModelOptionAssignment[]
): GroupedFieldBehaviorType {
  const base = groupedBehaviorForModelField(field);
  if (assignments.length < 2) return base;
  const refs = assignments.map((a) => parseAcroKey(a.sourceKey));
  const samePdfFieldName =
    refs.every((r) => r.pdfFieldName === refs[0]!.pdfFieldName) && Boolean(refs[0]!.pdfFieldName);
  if (samePdfFieldName && (base === "multiChoiceGroup" || schemaKindFromField(field) === "many_of_many")) {
    return "visualMulti";
  }
  return base;
}

/** Whether a model parameter has a complete form-field mapping. */
export function isModelParameterMapped(
  field: SetupSheetModelFieldDef,
  formFieldMappings: Record<string, PdfFormFieldMappingRule>
): boolean {
  const rule = formFieldMappings[field.key];
  if (!rule) return false;
  if (!isGroupedModelField(field)) {
    const simple = rule as { pdfFieldName?: string };
    return Boolean(simple.pdfFieldName?.trim());
  }
  const opts = modelFieldOptionEntries(field);
  if (opts.length === 0) return false;
  const assigned = extractAssignmentsFromGroupedRule(rule);
  return opts.every((o) => assigned.some((a) => a.optionValue === o.value));
}

export function extractAssignmentsFromGroupedRule(
  rule: PdfFormFieldMappingRule
): ModelOptionAssignment[] {
  if ("mode" in rule && rule.mode === "singleChoiceWidgetGroup") {
    return Object.entries(rule.options).map(([optionValue, ref]) => ({
      optionValue,
      optionLabel: optionValue,
      sourceKey: `${rule.pdfFieldName}#${ref.widgetInstanceIndex}`,
    }));
  }
  if ("mode" in rule && rule.mode === "multiSelectWidgetGroup") {
    return Object.entries(rule.options).map(([optionValue, ref]) => ({
      optionValue,
      optionLabel: optionValue,
      sourceKey: `${rule.pdfFieldName}#${ref.widgetInstanceIndex}`,
    }));
  }
  if ("mode" in rule && (rule.mode === "singleChoiceNamedFields" || rule.mode === "multiSelectNamedFields")) {
    return Object.entries(rule.options).map(([optionValue, ref]) => ({
      optionValue,
      optionLabel: optionValue,
      sourceKey: `${ref.pdfFieldName}#${ref.widgetInstanceIndex ?? 0}`,
    }));
  }
  return [];
}

export function buildGroupedRuleFromAssignments(
  behavior: GroupedFieldBehaviorType,
  assignments: ModelOptionAssignment[]
): PdfFormFieldMappingRule | null {
  if (assignments.length < 2) return null;
  const payload: GroupedFieldOptionDefinition[] = assignments.map((a, order) => ({
    sourceKey: a.sourceKey,
    optionLabel: a.optionLabel,
    optionValue: a.optionValue,
    order,
  }));
  const refs = payload.map((p) => parseAcroKey(p.sourceKey));
  const samePdfFieldName = refs.every((r) => r.pdfFieldName === refs[0]!.pdfFieldName);
  const valueToRef = Object.fromEntries(
    payload.map((p) => [p.optionValue, parseAcroKey(p.sourceKey)] as const)
  );

  if (isSingleSelectGroupedBehavior(behavior)) {
    if (samePdfFieldName) {
      return {
        mode: "singleChoiceWidgetGroup",
        pdfFieldName: refs[0]!.pdfFieldName,
        options: Object.fromEntries(
          payload.map((p) => [p.optionValue, { widgetInstanceIndex: parseAcroKey(p.sourceKey).instanceIndex }] as const)
        ),
      };
    }
    return {
      mode: "singleChoiceNamedFields",
      options: Object.fromEntries(
        payload.map((p) => [
          p.optionValue,
          {
            pdfFieldName: parseAcroKey(p.sourceKey).pdfFieldName,
            widgetInstanceIndex: parseAcroKey(p.sourceKey).instanceIndex,
          },
        ] as const)
      ),
    };
  }
  if (behavior === "visualMulti" && samePdfFieldName) {
    return {
      mode: "multiSelectWidgetGroup",
      pdfFieldName: refs[0]!.pdfFieldName,
      options: Object.fromEntries(
        payload.map((p) => [p.optionValue, { widgetInstanceIndex: parseAcroKey(p.sourceKey).instanceIndex }] as const)
      ),
    };
  }
  return {
    mode: "multiSelectNamedFields",
    options: Object.fromEntries(
      Object.entries(valueToRef).map(([valueKey, ref]) => [
        valueKey,
        { pdfFieldName: ref.pdfFieldName, widgetInstanceIndex: ref.instanceIndex },
      ] as const)
    ),
  };
}

export type ModelParameterRow = {
  field: SetupSheetModelFieldDef;
  kind: SchemaParameterKind;
  mapped: boolean;
};

export function listModelParameters(schema: SetupSheetModelSchema): ModelParameterRow[] {
  return [...schema.fields]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.displayLabel.localeCompare(b.displayLabel))
    .map((field) => {
      const normalized = normalizeGroupedFieldOnField(field);
      return {
        field: normalized,
        kind: schemaKindFromField(normalized),
        mapped: false,
      };
    });
}

export function modelMappingProgress(
  schema: SetupSheetModelSchema,
  formFieldMappings: Record<string, PdfFormFieldMappingRule>
): { mapped: number; total: number } {
  const fields = schema.fields.filter((f) => f.key);
  const mapped = fields.filter((f) => isModelParameterMapped(f, formFieldMappings)).length;
  return { mapped, total: fields.length };
}

/** Filter parameters eligible for linking given widget selection count. */
export function filterParametersForWidgetCount(
  rows: ModelParameterRow[],
  widgetCount: number
): ModelParameterRow[] {
  if (widgetCount === 1) {
    return rows.filter((r) => r.kind === "number" || r.kind === "text" || r.kind === "checkbox");
  }
  if (widgetCount >= 2) {
    return rows.filter((r) => {
      if (r.kind !== "one_of_many" && r.kind !== "many_of_many") return false;
      const optCount = modelFieldOptionEntries(r.field).length;
      return optCount >= 2 && optCount === widgetCount;
    });
  }
  return [];
}

function allowedOptionValuesForCalibrationKey(
  key: string,
  schema: SetupSheetModelSchema | null,
  customByKey: ReadonlyMap<string, CustomSetupFieldDefinition>
): ReadonlySet<string> | null {
  const custom = customByKey.get(key);
  if (custom?.groupedOptions && custom.groupedOptions.length >= 2) {
    return new Set(custom.groupedOptions.map((o) => o.optionValue));
  }
  if (schema) {
    const field = schema.fields.find((f) => f.key === key);
    if (field) {
      const opts = modelFieldOptionEntries(field);
      if (opts.length >= 2) return new Set(opts.map((o) => o.value));
    }
  }
  return null;
}

/**
 * Clean mappings before save — never run on load (would wipe in-memory edits).
 * Keeps custom calibration-only keys; option values follow custom defs, then schema.
 */
export function sanitizeFormFieldMappingsForPersistence(
  mappings: Record<string, PdfFormFieldMappingRule>,
  validCanonicalKeys: ReadonlySet<string>,
  schema: SetupSheetModelSchema | null,
  customFieldDefinitions: readonly CustomSetupFieldDefinition[]
): Record<string, PdfFormFieldMappingRule> {
  const customByKey = new Map(customFieldDefinitions.map((c) => [c.key, c] as const));
  let next = pruneOrphanCalibrationMappingKeys(mappings, validCanonicalKeys);
  for (const key of Object.keys(next)) {
    const allowed = allowedOptionValuesForCalibrationKey(key, schema, customByKey);
    if (!allowed) continue;
    const rule = next[key]!;
    const pruned = pruneGroupedRuleOptionKeys(rule, allowed);
    if (pruned === null) {
      const copy = { ...next };
      delete copy[key];
      next = copy;
    } else if (pruned !== rule) {
      next = { ...next, [key]: pruned };
    }
  }
  return next;
}

/** @deprecated Use sanitizeFormFieldMappingsForPersistence — schema-only prune is unsafe on load. */
export function sanitizeFormFieldMappingsForSchema(
  mappings: Record<string, PdfFormFieldMappingRule>,
  schema: SetupSheetModelSchema
): Record<string, PdfFormFieldMappingRule> {
  const validKeys = new Set(schema.fields.map((f) => f.key));
  return sanitizeFormFieldMappingsForPersistence(mappings, validKeys, schema, []);
}

/** Default option→widget assignment using click order. */
export function defaultOptionAssignments(
  field: SetupSheetModelFieldDef,
  widgetSourceKeys: string[]
): ModelOptionAssignment[] {
  const options = modelFieldOptionEntries(field);
  return options.map((opt, i) => ({
    optionValue: opt.value,
    optionLabel: opt.label,
    sourceKey: widgetSourceKeys[i] ?? "",
  }));
}

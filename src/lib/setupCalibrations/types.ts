export type CalibrationFieldRegion = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Optional widget target within a field (stable sort: page, y, x). */
export type PdfFormWidgetInstanceRef = {
  widgetInstanceIndex: number;
};

/** Simple AcroForm field (text, dropdown, or one checkbox semantics). */
export type PdfFormFieldMappingSimple = {
  mode?: "acroField";
  pdfFieldName: string;
  /** When set, checkbox/button state is read from this widget only. */
  widgetInstanceIndex?: number;
};

/** Several PDF widgets share `pdfFieldName`; each option maps to one widget instance. */
export type PdfFormSingleChoiceWidgetGroupMapping = {
  mode: "singleChoiceWidgetGroup";
  pdfFieldName: string;
  options: Record<string, PdfFormWidgetInstanceRef>;
};

export type PdfFormMultiSelectWidgetGroupMapping = {
  mode: "multiSelectWidgetGroup";
  pdfFieldName: string;
  options: Record<string, PdfFormWidgetInstanceRef>;
};

/** Option labels map to distinct PDF fields (each usually single checkbox). */
export type PdfFormOptionFieldRef = {
  pdfFieldName: string;
  widgetInstanceIndex?: number;
};

export type PdfFormSingleChoiceNamedFieldsMapping = {
  mode: "singleChoiceNamedFields";
  options: Record<string, PdfFormOptionFieldRef>;
};

export type PdfFormMultiSelectNamedFieldsMapping = {
  mode: "multiSelectNamedFields";
  options: Record<string, PdfFormOptionFieldRef>;
};

export type PdfFormFieldMappingRule =
  | PdfFormFieldMappingSimple
  | PdfFormSingleChoiceWidgetGroupMapping
  | PdfFormMultiSelectWidgetGroupMapping
  | PdfFormSingleChoiceNamedFieldsMapping
  | PdfFormMultiSelectNamedFieldsMapping;

/** Rule: pick one token on a line identified by stable line index (same grouping on identical layouts). */
export type TextFieldMappingRuleFixed = {
  mode: "fixed_line_token";
  page: number;
  lineIndex: number;
  tokenIndex: number;
};

/** Rule: find line(s) containing anchor text, then pick token index on that line. */
export type TextFieldMappingRuleAnchor = {
  mode: "anchor_token";
  page: number;
  anchorContains: string;
  occurrence?: number;
  tokenIndex: number;
};

export type TextFieldMappingRule = TextFieldMappingRuleFixed | TextFieldMappingRuleAnchor;

export type CalibrationSheetFieldBase = {
  /** Stable id for UI edits (does not affect mapping). */
  id: string;
  /** Human label shown in calibration editor. */
  label: string;
  /** Canonical app setup key this field maps to (or exports from). */
  canonicalFieldKey: string;
  /** Optional page hint for UI / export. */
  page?: number;
  /** Internal notes for calibration work. */
  notes?: string;
  /** Allow disabling without deleting. */
  active?: boolean;
};

export type CalibrationSheetTextField = CalibrationSheetFieldBase & {
  sourceType: "text";
  /** PDF source name (e.g. AcroForm field name or text anchor identifier). */
  sourceName: string;
};

export type CalibrationSheetCheckboxField = CalibrationSheetFieldBase & {
  sourceType: "checkbox";
  /** PDF source name (AcroForm field name). */
  sourceName: string;
  /** Value represented when checked (defaults to "1"). */
  checkedValue?: string;
  /** Value represented when unchecked (defaults to ""). */
  uncheckedValue?: string;
};

export type CalibrationSheetGroupOption = {
  id: string;
  sourceName: string;
  optionValue: string;
  label?: string;
  widgetInstanceIndex?: number;
  active?: boolean;
};

export type CalibrationSheetGroupField = CalibrationSheetFieldBase & {
  sourceType: "group";
  options: CalibrationSheetGroupOption[];
};

export type CalibrationSheetField =
  | CalibrationSheetTextField
  | CalibrationSheetCheckboxField
  | CalibrationSheetGroupField;

/** Domain for user-defined fields (full-sheet calibration; not limited to tuning grid). */
export type SetupFieldDomain = "setup" | "metadata" | "document";

/** Logical value semantics for export/import and future UI. */
export type CustomFieldValueType = "string" | "number" | "boolean" | "date" | "enum" | "multi" | "string_array";

/** How the field is presented in setup UI / PDF tooling. */
export type CustomFieldUiType =
  | "text"
  | "textarea"
  | "checkbox"
  | "select"
  | "multiSelect"
  | "date"
  | "groupOption";

export type GroupedFieldBehaviorType =
  | "singleChoiceGroup"
  /** Alias for singleChoiceGroup — mutually exclusive options, one canonical value (same as chassis / front bumper). */
  | "singleSelect"
  | "visualMulti"
  | "multiChoiceGroup";

/** True for enum-style single-select grouped fields (not visual multi or generic multi). */
export function isSingleSelectGroupedBehavior(b: GroupedFieldBehaviorType | undefined): boolean {
  return b === "singleChoiceGroup" || b === "singleSelect";
}

export type GroupedFieldOptionDefinition = {
  /** Acro source key `${pdfFieldName}#${instanceIndex}`. */
  sourceKey: string;
  optionLabel: string;
  optionValue: string;
  order: number;
  notes?: string;
};

/** Per-key display prefs for base template fields (merged with custom definitions). */
export type FieldDisplayOverride = {
  /** When false, field is omitted from standard setup sheet UI (data may still exist). */
  showInSetupSheet?: boolean;
  /** When false, field is omitted from analysis / compare setup surfaces that use this flag. */
  showInAnalysis?: boolean;
  /** Move a template `single` row into another structured section (layout only; same ids as A800RR sections). */
  sheetGroupId?: string;
  sheetGroupTitle?: string;
};

/**
 * User-defined setup field stored on the calibration profile.
 * Keys are merged with the base A800RR template catalog for mapping and labeling.
 */
export type CustomSetupFieldDefinition = {
  id: string;
  /** Unique canonical key (snake_case), used in formFieldMappings and setup snapshots. */
  key: string;
  displayLabel: string;
  sectionId: string;
  sectionTitle: string;
  /** Optional subsection label for grouping within a section (layout). */
  subsectionId?: string;
  /** Rough placement hints for future layout engines (metadata vs corner grids, etc.). */
  layoutPlacement?: "none" | "front" | "rear" | "left" | "right" | "full";
  /** Optional pairing / mutual-exclusion group id for advanced layout. */
  pairGroupId?: string;
  fieldDomain: SetupFieldDomain;
  valueType: CustomFieldValueType;
  uiType: CustomFieldUiType;
  isMetadata: boolean;
  /** Standard setup sheet / document review surfaces. */
  showInSetupSheet: boolean;
  /** Run analysis, compare modals, etc. */
  showInAnalysis: boolean;
  isPdfExportable: boolean;
  sortOrder: number;
  unit?: string;
  /** For groupOption / enum-style checkboxes */
  optionValue?: string;
  checkedValue?: string;
  uncheckedValue?: string;
  groupKey?: string;
  /** Parent grouped-field behavior for multi-source checkbox clusters. */
  groupBehaviorType?: GroupedFieldBehaviorType;
  /** Child option mapping metadata for grouped parent fields. */
  groupedOptions?: GroupedFieldOptionDefinition[];
  notes?: string;
};

export function parseCustomSetupFieldDefinition(raw: unknown): CustomSetupFieldDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const key = typeof r.key === "string" ? r.key.trim() : "";
  if (!key) return null;
  const id = typeof r.id === "string" && r.id.trim() ? r.id : `cf_${key}`;
  const displayLabel =
    typeof r.displayLabel === "string"
      ? r.displayLabel.trim()
      : typeof r.label === "string"
        ? r.label.trim()
        : "";
  if (!displayLabel) return null;
  const sectionId = typeof r.sectionId === "string" && r.sectionId.trim() ? r.sectionId.trim() : "other";
  const sectionTitle =
    typeof r.sectionTitle === "string" && r.sectionTitle.trim() ? r.sectionTitle.trim() : "Other";
  const fieldDomain: SetupFieldDomain =
    r.fieldDomain === "metadata" || r.fieldDomain === "document" || r.fieldDomain === "setup" ? r.fieldDomain : "setup";
  const valueType = typeof r.valueType === "string" ? (r.valueType as CustomFieldValueType) : "string";
  const uiType = typeof r.uiType === "string" ? (r.uiType as CustomFieldUiType) : "text";
  const sortOrder = typeof r.sortOrder === "number" && Number.isFinite(r.sortOrder) ? r.sortOrder : 0;
  const legacyVisible =
    typeof r.showInSetupSheet === "boolean"
      ? r.showInSetupSheet
      : typeof r.isVisibleInSetupSheet === "boolean"
        ? r.isVisibleInSetupSheet
        : true;
  const subsectionId = typeof r.subsectionId === "string" ? r.subsectionId.trim() : undefined;
  const layoutPlacementRaw = typeof r.layoutPlacement === "string" ? r.layoutPlacement.trim() : "";
  const layoutPlacement:
    | CustomSetupFieldDefinition["layoutPlacement"]
    | undefined = ["none", "front", "rear", "left", "right", "full"].includes(layoutPlacementRaw)
    ? (layoutPlacementRaw as CustomSetupFieldDefinition["layoutPlacement"])
    : undefined;
  const pairGroupId = typeof r.pairGroupId === "string" ? r.pairGroupId.trim() : undefined;
  const groupBehaviorRaw = typeof r.groupBehaviorType === "string" ? r.groupBehaviorType.trim() : "";
  const groupBehaviorType:
    | GroupedFieldBehaviorType
    | undefined = ["singleChoiceGroup", "singleSelect", "visualMulti", "multiChoiceGroup"].includes(groupBehaviorRaw)
    ? (groupBehaviorRaw as GroupedFieldBehaviorType)
    : undefined;
  const groupedOptionsRaw = Array.isArray(r.groupedOptions) ? r.groupedOptions : [];
  const groupedOptions = groupedOptionsRaw
    .map((entry, idx) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;
      const sourceKey = typeof e.sourceKey === "string" ? e.sourceKey.trim() : "";
      const optionLabel = typeof e.optionLabel === "string" ? e.optionLabel.trim() : "";
      const optionValue = typeof e.optionValue === "string" ? e.optionValue.trim() : "";
      if (!sourceKey || !optionLabel || !optionValue) return null;
      const order = typeof e.order === "number" && Number.isFinite(e.order) ? e.order : idx;
      const notes = typeof e.notes === "string" ? e.notes : undefined;
      return { sourceKey, optionLabel, optionValue, order, notes };
    })
    .filter(Boolean) as GroupedFieldOptionDefinition[];
  return {
    id,
    key,
    displayLabel,
    sectionId,
    sectionTitle,
    subsectionId: subsectionId || undefined,
    layoutPlacement,
    pairGroupId: pairGroupId || undefined,
    fieldDomain,
    valueType: ["string", "number", "boolean", "date", "enum", "multi", "string_array"].includes(valueType) ? valueType : "string",
    uiType: ["text", "textarea", "checkbox", "select", "multiSelect", "date", "groupOption"].includes(uiType) ? uiType : "text",
    isMetadata: typeof r.isMetadata === "boolean" ? r.isMetadata : fieldDomain !== "setup",
    showInSetupSheet: legacyVisible,
    showInAnalysis: typeof r.showInAnalysis === "boolean" ? r.showInAnalysis : true,
    isPdfExportable: typeof r.isPdfExportable === "boolean" ? r.isPdfExportable : true,
    sortOrder,
    unit: typeof r.unit === "string" ? r.unit : undefined,
    optionValue: typeof r.optionValue === "string" ? r.optionValue : undefined,
    checkedValue: typeof r.checkedValue === "string" ? r.checkedValue : undefined,
    uncheckedValue: typeof r.uncheckedValue === "string" ? r.uncheckedValue : undefined,
    groupKey: typeof r.groupKey === "string" ? r.groupKey : undefined,
    groupBehaviorType,
    groupedOptions: groupedOptions.length ? groupedOptions : undefined,
    notes: typeof r.notes === "string" ? r.notes : undefined,
  };
}

export type SetupSheetCalibrationData = {
  calibrationMeta?: {
    versionLabel?: string;
    parentCalibrationId?: string;
    clonedFromCalibrationId?: string;
  };
  templateType?:
    | "pdf_form_fields"
    | "editable_pdf_text_mapping"
    | "pdf_region_fallback"
    | string;
  documentMeta?: {
    pageCount?: number;
    lineGroupingEpsilon?: number;
    sourceWidthByPage?: Record<string, number>;
    sourceHeightByPage?: Record<string, number>;
  };
  /** Primary for filled editable PDFs: AcroForm field names → values. */
  formFieldMappings?: Record<string, PdfFormFieldMappingRule>;
  /** Secondary: printed text line/token mapping. */
  fieldMappings?: Record<string, TextFieldMappingRule>;
  /** Fallback: PDF-space regions (visual mapper). */
  fields: Record<string, CalibrationFieldRegion>;
  /**
   * Full-sheet calibration model (for reconstruction/export and explicit mapping audit).
   * This is orthogonal to the legacy `formFieldMappings`/`fieldMappings`/`fields` parsing-oriented maps.
   */
  sheetFields?: CalibrationSheetField[];
  /**
   * User-defined setup field definitions for this calibration (merged with the base template catalog).
   * Keys must be unique vs template keys and vs each other.
   */
  customFieldDefinitions?: CustomSetupFieldDefinition[];
  /**
   * Optional visibility/layout overrides for **base template** keys (not custom definitions).
   * Custom fields store visibility on `CustomSetupFieldDefinition`.
   */
  fieldDisplayOverrides?: Record<string, FieldDisplayOverride>;
};

export function isCalibrationFieldRegion(value: unknown): value is CalibrationFieldRegion {
  if (!value || typeof value !== "object") return false;
  const region = value as Record<string, unknown>;
  return (
    typeof region.page === "number"
    && typeof region.x === "number"
    && typeof region.y === "number"
    && typeof region.width === "number"
    && typeof region.height === "number"
  );
}

function isWidgetInstanceRef(value: unknown): value is PdfFormWidgetInstanceRef {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return typeof o.widgetInstanceIndex === "number" && Number.isFinite(o.widgetInstanceIndex) && o.widgetInstanceIndex >= 0;
}

function isOptionFieldRef(value: unknown): value is PdfFormOptionFieldRef {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (typeof o.pdfFieldName !== "string" || !o.pdfFieldName.trim()) return false;
  if (o.widgetInstanceIndex == null) return true;
  return typeof o.widgetInstanceIndex === "number" && Number.isFinite(o.widgetInstanceIndex) && o.widgetInstanceIndex >= 0;
}

export function isPdfFormFieldMappingRule(value: unknown): value is PdfFormFieldMappingRule {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (r.mode === "singleChoiceNamedFields" || r.mode === "multiSelectNamedFields") {
    if (!r.options || typeof r.options !== "object") return false;
    for (const v of Object.values(r.options as Record<string, unknown>)) {
      if (!isOptionFieldRef(v)) return false;
    }
    return true;
  }
  if (r.mode === "singleChoiceWidgetGroup" || r.mode === "multiSelectWidgetGroup") {
    if (typeof r.pdfFieldName !== "string" || !r.pdfFieldName.trim()) return false;
    if (!r.options || typeof r.options !== "object") return false;
    for (const v of Object.values(r.options as Record<string, unknown>)) {
      if (!isWidgetInstanceRef(v)) return false;
    }
    return true;
  }
  return typeof r.pdfFieldName === "string" && r.pdfFieldName.trim() !== "";
}

export function normalizePdfFormFieldMappingRule(value: PdfFormFieldMappingRule): PdfFormFieldMappingRule {
  if ("mode" in value && value.mode === "singleChoiceNamedFields") {
    const options: Record<string, PdfFormOptionFieldRef> = {};
    for (const [k, v] of Object.entries(value.options)) {
      options[k] = {
        pdfFieldName: v.pdfFieldName.trim(),
        widgetInstanceIndex:
          typeof v.widgetInstanceIndex === "number" && Number.isFinite(v.widgetInstanceIndex)
            ? v.widgetInstanceIndex
            : undefined,
      };
    }
    return { mode: "singleChoiceNamedFields", options };
  }
  if ("mode" in value && value.mode === "multiSelectNamedFields") {
    const options: Record<string, PdfFormOptionFieldRef> = {};
    for (const [k, v] of Object.entries(value.options)) {
      options[k] = {
        pdfFieldName: v.pdfFieldName.trim(),
        widgetInstanceIndex:
          typeof v.widgetInstanceIndex === "number" && Number.isFinite(v.widgetInstanceIndex)
            ? v.widgetInstanceIndex
            : undefined,
      };
    }
    return { mode: "multiSelectNamedFields", options };
  }
  if ("mode" in value && value.mode === "singleChoiceWidgetGroup") {
    const options: Record<string, PdfFormWidgetInstanceRef> = {};
    for (const [k, v] of Object.entries(value.options)) {
      options[k] = { widgetInstanceIndex: v.widgetInstanceIndex };
    }
    return { mode: "singleChoiceWidgetGroup", pdfFieldName: value.pdfFieldName.trim(), options };
  }
  if ("mode" in value && value.mode === "multiSelectWidgetGroup") {
    const options: Record<string, PdfFormWidgetInstanceRef> = {};
    for (const [k, v] of Object.entries(value.options)) {
      options[k] = { widgetInstanceIndex: v.widgetInstanceIndex };
    }
    return { mode: "multiSelectWidgetGroup", pdfFieldName: value.pdfFieldName.trim(), options };
  }
  const simple = value as PdfFormFieldMappingSimple;
  return {
    mode: simple.mode === "acroField" ? "acroField" : undefined,
    pdfFieldName: simple.pdfFieldName.trim(),
    widgetInstanceIndex:
      typeof simple.widgetInstanceIndex === "number" && Number.isFinite(simple.widgetInstanceIndex)
        ? simple.widgetInstanceIndex
        : undefined,
  };
}

export function isTextFieldMappingRule(value: unknown): value is TextFieldMappingRule {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (r.mode === "fixed_line_token") {
    return (
      typeof r.page === "number"
      && typeof r.lineIndex === "number"
      && typeof r.tokenIndex === "number"
    );
  }
  if (r.mode === "anchor_token") {
    return typeof r.page === "number" && typeof r.anchorContains === "string" && typeof r.tokenIndex === "number";
  }
  return false;
}

function inferTemplateType(out: SetupSheetCalibrationData): void {
  const formN = Object.keys(out.formFieldMappings ?? {}).length;
  const textN = Object.keys(out.fieldMappings ?? {}).length;
  const regionN = Object.keys(out.fields ?? {}).length;
  if (formN > 0) {
    out.templateType = "pdf_form_fields";
    return;
  }
  if (textN > 0) {
    out.templateType = "editable_pdf_text_mapping";
    return;
  }
  if (regionN > 0) {
    out.templateType = "pdf_region_fallback";
    return;
  }
  out.templateType = "pdf_form_fields";
}

/**
 * Older templates stored PSS 30/25/15 under damper_percent_*; those keys are now the dial (60–100).
 */
function migrateAwesomatixPssPercentFromDamperPercent(m: Record<string, PdfFormFieldMappingRule>): void {
  const pssLabels = new Set(["30", "25", "15"]);
  for (const side of ["front", "rear"] as const) {
    const oldKey = `damper_percent_${side}`;
    const newKey = `pss_percent_setup_${side}`;
    const rule = m[oldKey];
    if (!rule || typeof rule !== "object") continue;
    if (!("mode" in rule) || rule.mode !== "singleChoiceWidgetGroup") continue;
    const optKeys = Object.keys(rule.options);
    if (optKeys.length === 0) continue;
    if (!optKeys.every((k) => pssLabels.has(k))) continue;
    if (m[newKey]) {
      delete m[oldKey];
      continue;
    }
    m[newKey] = rule;
    delete m[oldKey];
  }
}

function migrateLegacyVisualMultiRules(m: Record<string, PdfFormFieldMappingRule>): void {
  const visualMultiKeys = new Set(["track_layout", "traction"]);
  for (const key of visualMultiKeys) {
    const rule = m[key];
    if (!rule || typeof rule !== "object" || !("mode" in rule)) continue;
    if (rule.mode === "singleChoiceNamedFields") {
      m[key] = {
        mode: "multiSelectNamedFields",
        options: { ...rule.options },
      };
      continue;
    }
    if (rule.mode === "singleChoiceWidgetGroup") {
      m[key] = {
        mode: "multiSelectWidgetGroup",
        pdfFieldName: rule.pdfFieldName,
        options: { ...rule.options },
      };
    }
  }
}

export function normalizeCalibrationData(input: unknown): SetupSheetCalibrationData {
  const out: SetupSheetCalibrationData = {
    templateType: "pdf_form_fields",
    formFieldMappings: {},
    fieldMappings: {},
    fields: {},
    sheetFields: [],
    customFieldDefinitions: [],
    fieldDisplayOverrides: {},
  };
  if (!input || typeof input !== "object") return out;
  const obj = input as Record<string, unknown>;

  if (typeof obj.templateType === "string") {
    out.templateType = obj.templateType;
  }

  if (obj.calibrationMeta && typeof obj.calibrationMeta === "object") {
    const m = obj.calibrationMeta as Record<string, unknown>;
    out.calibrationMeta = {
      versionLabel: typeof m.versionLabel === "string" ? m.versionLabel.trim() || undefined : undefined,
      parentCalibrationId:
        typeof m.parentCalibrationId === "string" ? m.parentCalibrationId.trim() || undefined : undefined,
      clonedFromCalibrationId:
        typeof m.clonedFromCalibrationId === "string" ? m.clonedFromCalibrationId.trim() || undefined : undefined,
    };
  }

  if (obj.documentMeta && typeof obj.documentMeta === "object") {
    out.documentMeta = { ...(obj.documentMeta as SetupSheetCalibrationData["documentMeta"]) };
  }

  if (obj.formFieldMappings && typeof obj.formFieldMappings === "object") {
    for (const [fieldKey, value] of Object.entries(obj.formFieldMappings as Record<string, unknown>)) {
      if (isPdfFormFieldMappingRule(value)) {
        out.formFieldMappings![fieldKey] = normalizePdfFormFieldMappingRule(value as PdfFormFieldMappingRule);
      }
    }
    migrateAwesomatixPssPercentFromDamperPercent(out.formFieldMappings!);
    migrateLegacyVisualMultiRules(out.formFieldMappings!);
  }

  if (obj.fieldMappings && typeof obj.fieldMappings === "object") {
    for (const [fieldKey, value] of Object.entries(obj.fieldMappings as Record<string, unknown>)) {
      if (isTextFieldMappingRule(value)) out.fieldMappings![fieldKey] = value;
    }
  }

  if (obj.fields && typeof obj.fields === "object") {
    for (const [fieldKey, value] of Object.entries(obj.fields as Record<string, unknown>)) {
      if (isCalibrationFieldRegion(value)) {
        out.fields[fieldKey] = {
          page: value.page,
          x: value.x,
          y: value.y,
          width: value.width,
          height: value.height,
        };
      }
    }
  }

  if (Array.isArray(obj.sheetFields)) {
    const fields: CalibrationSheetField[] = [];
    for (const raw of obj.sheetFields) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const sourceType = String(r.sourceType ?? "");
      const base: CalibrationSheetFieldBase = {
        id: typeof r.id === "string" && r.id.trim() ? r.id : `sf_${Math.random().toString(16).slice(2)}`,
        label: typeof r.label === "string" ? r.label : "",
        canonicalFieldKey: typeof r.canonicalFieldKey === "string" ? r.canonicalFieldKey : "",
        page: typeof r.page === "number" && Number.isFinite(r.page) ? r.page : undefined,
        notes: typeof r.notes === "string" ? r.notes : undefined,
        active: typeof r.active === "boolean" ? r.active : true,
      };
      if (sourceType === "text") {
        const sourceName = typeof r.sourceName === "string" ? r.sourceName.trim() : "";
        fields.push({ ...base, sourceType: "text", sourceName });
      } else if (sourceType === "checkbox") {
        const sourceName = typeof r.sourceName === "string" ? r.sourceName.trim() : "";
        fields.push({
          ...base,
          sourceType: "checkbox",
          sourceName,
          checkedValue: typeof r.checkedValue === "string" ? r.checkedValue : undefined,
          uncheckedValue: typeof r.uncheckedValue === "string" ? r.uncheckedValue : undefined,
        });
      } else if (sourceType === "group") {
        const optionsRaw = Array.isArray(r.options) ? r.options : [];
        const options: CalibrationSheetGroupOption[] = optionsRaw
          .map((o) => {
            if (!o || typeof o !== "object") return null;
            const oo = o as Record<string, unknown>;
            const id = typeof oo.id === "string" && oo.id.trim() ? oo.id : `opt_${Math.random().toString(16).slice(2)}`;
            const sourceName = typeof oo.sourceName === "string" ? oo.sourceName.trim() : "";
            const optionValue = typeof oo.optionValue === "string" ? oo.optionValue : "";
            const label = typeof oo.label === "string" ? oo.label : undefined;
            const widgetInstanceIndex =
              typeof oo.widgetInstanceIndex === "number" && Number.isFinite(oo.widgetInstanceIndex)
                ? oo.widgetInstanceIndex
                : undefined;
            const active = typeof oo.active === "boolean" ? oo.active : true;
            return { id, sourceName, optionValue, label, widgetInstanceIndex, active };
          })
          .filter(Boolean) as CalibrationSheetGroupOption[];
        fields.push({ ...base, sourceType: "group", options });
      }
    }
    out.sheetFields = fields;
  }

  if (Array.isArray(obj.customFieldDefinitions)) {
    const defs: CustomSetupFieldDefinition[] = [];
    for (const raw of obj.customFieldDefinitions) {
      const d = parseCustomSetupFieldDefinition(raw);
      if (d) defs.push(d);
    }
    out.customFieldDefinitions = defs;
  }

  if (obj.fieldDisplayOverrides && typeof obj.fieldDisplayOverrides === "object") {
    const fo: Record<string, FieldDisplayOverride> = {};
    for (const [k, v] of Object.entries(obj.fieldDisplayOverrides as Record<string, unknown>)) {
      if (!k.trim() || !v || typeof v !== "object") continue;
      const o = v as Record<string, unknown>;
      const entry: FieldDisplayOverride = {};
      if (typeof o.showInSetupSheet === "boolean") entry.showInSetupSheet = o.showInSetupSheet;
      if (typeof o.showInAnalysis === "boolean") entry.showInAnalysis = o.showInAnalysis;
      if (typeof o.sheetGroupId === "string" && o.sheetGroupId.trim()) entry.sheetGroupId = o.sheetGroupId.trim();
      if (typeof o.sheetGroupTitle === "string" && o.sheetGroupTitle.trim()) {
        entry.sheetGroupTitle = o.sheetGroupTitle.trim();
      }
      if (Object.keys(entry).length) fo[k.trim()] = entry;
    }
    out.fieldDisplayOverrides = fo;
  }

  if (typeof obj.templateType !== "string") {
    inferTemplateType(out);
  }
  return out;
}

export function calibrationMappingCounts(data: SetupSheetCalibrationData): {
  formFields: number;
  textFields: number;
  regionFields: number;
} {
  return {
    formFields: Object.keys(data.formFieldMappings ?? {}).length,
    textFields: Object.keys(data.fieldMappings ?? {}).length,
    regionFields: Object.keys(data.fields ?? {}).length,
  };
}

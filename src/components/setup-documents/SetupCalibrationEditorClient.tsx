"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { A800RR_FIELD_CATALOG } from "@/lib/setupDocuments/fieldMap";
import type {
  CalibrationFieldRegion,
  PdfFormFieldMappingRule,
  PdfFormMultiSelectNamedFieldsMapping,
  PdfFormSingleChoiceNamedFieldsMapping,
  TextFieldMappingRule,
  CalibrationSheetField,
  CalibrationSheetGroupField,
} from "@/lib/setupCalibrations/types";
import {
  normalizeCalibrationData,
  type CustomSetupFieldDefinition,
  type CustomFieldUiType,
  type CustomFieldValueType,
  type FieldDisplayOverride,
  type GroupedFieldBehaviorType,
  type GroupedFieldOptionDefinition,
  type SetupFieldDomain,
  isSingleSelectGroupedBehavior,
} from "@/lib/setupCalibrations/types";
import {
  buildMergedLabelMap,
  CUSTOM_FIELD_SECTION_PRESETS,
  getMergedSectionGroupOptions,
  inferUiTypeFromAcroType,
  mergeCustomFieldsIntoCatalog,
  getReservedKeysForCalibrationEditor,
  reservedTemplateKeyError,
  suggestKeyFromPdfFieldName,
  validateCustomFieldKey,
} from "@/lib/setupCalibrations/customFieldCatalog";
import { buildCatalogFromModelSchema, modelFieldKeys } from "@/lib/setupSheetModels/modelFieldCatalog";
import { modelMappingProgress } from "@/lib/setupSheetModels/modelCalibrationMapping";
import {
  parseSetupSheetModelSchema,
  type SetupSheetModelFieldDef,
  type SetupSheetModelSchema,
} from "@/lib/setupSheetModels/types";
import {
  applyCalibrationFieldRecipe,
  inferGroupedFieldDefaultsFromPdfNames,
  inferSectionAndDomainForNewCustomField,
} from "@/lib/setupCalibrations/calibrationCustomFieldHints";
import {
  SetupCalibrationModelSidebar,
  type NewParameterInput,
} from "@/components/setup-documents/SetupCalibrationModelSidebar";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import {
  buildGroupedRuleFromAssignments,
  extractAssignmentsFromGroupedRule,
  groupedBehaviorForAssignments,
  isModelParameterMapped,
  listModelParameters,
  modelFieldOptionEntries,
  sanitizeFormFieldMappingsForPersistence,
  type ModelOptionAssignment,
} from "@/lib/setupSheetModels/modelCalibrationMapping";
import { normalizeSetupSheetModelSchemaFields } from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import {
  buildQuickCustomFieldDefinition,
  type QuickCalibrationFieldKind,
} from "@/lib/setupCalibrations/quickCalibrationField";
import { TEMPLATE_PRIORITY_FIELD_KEYS } from "@/lib/setupCalibrations/priorityFieldKeys";
import {
  getCalibrationFieldCategory,
  getCalibrationFieldKind,
  getLogicalFieldKind,
  getSingleSelectChipOptions,
  getVisualMultiOptions,
  usesSingleSelectChipWorkflow,
} from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { awesomatixGroupKind, awesomatixGroupOptions } from "@/lib/setupDocuments/awesomatixWidgetGroups";
import { customFieldGroupedChipContext } from "@/lib/setupCalibrations/customFieldGroupedChips";
import {
  filterCrossFieldConflicts,
  findAppKeysForWidget,
  isToggleFieldType,
  listPdfWidgetOwnershipDetails,
  removePdfWidgetFromMappings,
  type PdfWidgetOwnershipDetail,
} from "@/lib/setupCalibrations/pdfFieldMappingOwnership";

const PdfPreviewClient = dynamic(() => import("./PdfPreviewClient").then((m) => m.PdfPreviewClient), {
  ssr: false,
});

type PdfTextStructureDocument = {
  version: 1;
  lineGroupingEpsilon: number;
  pages: Array<{
    pageNumber: number;
    width: number;
    height: number;
    lines: Array<{
      lineIndex: number;
      yBucket: number;
      text: string;
      tokens: Array<{ x: number; y: number; w: number; text: string }>;
    }>;
  }>;
};

type PdfFormFieldWidget = {
  instanceIndex?: number;
  pageNumber: number;
  pageWidth?: number;
  pageHeight?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  checked?: boolean;
};

type PdfFormFieldRow = {
  name: string;
  type: string;
  value: string;
  booleanValue?: boolean | null;
  widgets?: PdfFormFieldWidget[];
  pageNumber: number | null;
  readError?: string;
};

function formatPdfFieldDisplayValue(row: PdfFormFieldRow): string {
  if (row.booleanValue === true) return "on";
  if (row.booleanValue === false) return "off";
  const t = row.value.trim();
  return t || "—";
}

function rulePdfFieldName(rule: PdfFormFieldMappingRule): string {
  if ("mode" in rule && (rule.mode === "singleChoiceNamedFields" || rule.mode === "multiSelectNamedFields")) {
    const first = Object.values(rule.options)[0];
    return first?.pdfFieldName ?? "";
  }
  if ("mode" in rule && (rule.mode === "singleChoiceWidgetGroup" || rule.mode === "multiSelectWidgetGroup")) {
    return rule.pdfFieldName;
  }
  return rule.pdfFieldName;
}

function isNamedFieldsMappingRule(
  rule: PdfFormFieldMappingRule
): rule is PdfFormSingleChoiceNamedFieldsMapping | PdfFormMultiSelectNamedFieldsMapping {
  return (
    "mode" in rule &&
    (rule.mode === "singleChoiceNamedFields" || rule.mode === "multiSelectNamedFields")
  );
}

function pdfRowForFormRule(
  rule: PdfFormFieldMappingRule,
  pdfRowByName: Map<string, PdfFormFieldRow>
): PdfFormFieldRow | undefined {
  if ("pdfFieldName" in rule && typeof rule.pdfFieldName === "string" && rule.pdfFieldName.trim()) {
    return pdfRowByName.get(rule.pdfFieldName);
  }
  if (isNamedFieldsMappingRule(rule)) {
    for (const ref of Object.values(rule.options)) {
      const row = pdfRowByName.get(ref.pdfFieldName);
      if (row) return row;
    }
  }
  return undefined;
}

function formatNamedFieldsLiveValues(
  rule: PdfFormFieldMappingRule,
  pdfRowByName: Map<string, PdfFormFieldRow>
): string {
  if (!isNamedFieldsMappingRule(rule)) return "";
  const parts: string[] = [];
  for (const [label, ref] of Object.entries(rule.options)) {
    const row = pdfRowByName.get(ref.pdfFieldName);
    if (!row) {
      parts.push(`${label}:?`);
      continue;
    }
    const w =
      ref.widgetInstanceIndex != null
        ? row.widgets?.find((wi) => wi.instanceIndex === ref.widgetInstanceIndex)
        : undefined;
    if (w?.checked === true) parts.push(`${label}:on`);
    else if (w?.checked === false) parts.push(`${label}:off`);
    else parts.push(`${label}:${formatPdfFieldDisplayValue(row)}`);
  }
  return parts.join(" ");
}

function formRulePanelValue(
  rule: PdfFormFieldMappingRule,
  pdfRowByName: Map<string, PdfFormFieldRow>
): string | null {
  const named = formatNamedFieldsLiveValues(rule, pdfRowByName);
  if (named) return named;
  const row = pdfRowForFormRule(rule, pdfRowByName);
  if (!row) return null;
  return formatPdfFieldDisplayValue(row);
}

/** Stable id for one AcroForm widget instance (field name + instance index). */
type AcroFormSourceRef = {
  pdfFieldName: string;
  instanceIndex: number;
};

function acroSourceKey(ref: AcroFormSourceRef): string {
  return `${ref.pdfFieldName}#${ref.instanceIndex}`;
}

function parseAcroKey(key: string): AcroFormSourceRef {
  const hash = key.lastIndexOf("#");
  if (hash <= 0) return { pdfFieldName: key, instanceIndex: 0 };
  return {
    pdfFieldName: key.slice(0, hash),
    instanceIndex: Number(key.slice(hash + 1)) || 0,
  };
}

function inferOptionValueFromPdfName(name: string): string {
  const v = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return v || "option";
}

/** Display label fallback when loading a mapping without groupedOptions metadata. */
function humanizeCanonicalStoredValue(v: string): string {
  const s = v.replace(/_/g, " ").trim();
  if (!s) return v;
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeGroupedBehaviorForStorage(
  gt: GroupedFieldBehaviorType,
  hasGrouped: boolean
): GroupedFieldBehaviorType | undefined {
  if (!hasGrouped) return undefined;
  return isSingleSelectGroupedBehavior(gt) ? "singleSelect" : gt;
}

/** User’s Editor control (cfUiType) must match PDF mapping group shape; the pink panel can lag behind. */
function resolveGroupedBuildBehavior(
  ui: CustomFieldUiType,
  panel: GroupedFieldBehaviorType
): GroupedFieldBehaviorType {
  if (ui === "multiSelect") {
    if (panel === "visualMulti" || panel === "multiChoiceGroup") return panel;
    return "multiChoiceGroup";
  }
  if (ui === "select") {
    if (isSingleSelectGroupedBehavior(panel)) return panel;
    return "singleSelect";
  }
  return panel;
}

/** Pick one PDF widget to highlight for a canonical mapping rule (for catalog → PDF sync). */
function resolveAcroFromCanonicalKey(
  key: string,
  rule: PdfFormFieldMappingRule | undefined
): AcroFormSourceRef | null {
  if (!rule) return null;
  if ("mode" in rule && rule.mode === "singleChoiceWidgetGroup") {
    const entries = Object.values(rule.options);
    if (entries.length === 0) return null;
    const sorted = [...entries].sort((a, b) => a.widgetInstanceIndex - b.widgetInstanceIndex);
    return { pdfFieldName: rule.pdfFieldName, instanceIndex: sorted[0]!.widgetInstanceIndex };
  }
  if ("mode" in rule && rule.mode === "multiSelectWidgetGroup") {
    const entries = Object.values(rule.options);
    if (entries.length === 0) return null;
    const sorted = [...entries].sort((a, b) => a.widgetInstanceIndex - b.widgetInstanceIndex);
    return { pdfFieldName: rule.pdfFieldName, instanceIndex: sorted[0]!.widgetInstanceIndex };
  }
  if (
    "mode" in rule
    && (rule.mode === "singleChoiceNamedFields" || rule.mode === "multiSelectNamedFields")
  ) {
    const first = Object.values(rule.options)[0];
    if (!first) return null;
    return { pdfFieldName: first.pdfFieldName, instanceIndex: first.widgetInstanceIndex ?? 0 };
  }
  const simple = rule as { pdfFieldName: string; widgetInstanceIndex?: number };
  if (!simple.pdfFieldName) return null;
  return { pdfFieldName: simple.pdfFieldName, instanceIndex: simple.widgetInstanceIndex ?? 0 };
}

type CalibrationUiTool = "select" | "new_text" | "new_checkbox" | "new_group" | "delete";

type PdfOverlayBox = {
  key: string;
  pageNumber: number;
  left: number;
  top: number;
  width: number;
  height: number;
  colorClass: string;
  title: string;
  sheetFieldId?: string;
  pdfFieldName?: string;
  instanceIndex?: number;
};

function summarizeFormRuleForPanel(rule: PdfFormFieldMappingRule, pdfRow: PdfFormFieldRow | undefined): string {
  if ("mode" in rule && rule.mode === "singleChoiceWidgetGroup") {
    return Object.entries(rule.options)
      .map(([label, ref]) => {
        const c = pdfRow?.widgets?.find((w) => (w.instanceIndex ?? -1) === ref.widgetInstanceIndex)?.checked;
        const mark = c === true ? "✓" : c === false ? "○" : "?";
        return `${label}→#${ref.widgetInstanceIndex}${mark}`;
      })
      .join(" ");
  }
  if ("mode" in rule && rule.mode === "multiSelectWidgetGroup") {
    return Object.entries(rule.options)
      .map(([label, ref]) => {
        const c = pdfRow?.widgets?.find((w) => (w.instanceIndex ?? -1) === ref.widgetInstanceIndex)?.checked;
        const mark = c === true ? "✓" : c === false ? "○" : "?";
        return `${label}→#${ref.widgetInstanceIndex}${mark}`;
      })
      .join(" ");
  }
  if ("mode" in rule && (rule.mode === "singleChoiceNamedFields" || rule.mode === "multiSelectNamedFields")) {
    return Object.entries(rule.options)
      .map(([label, ref]) => `${label}→${ref.pdfFieldName}${ref.widgetInstanceIndex != null ? `#${ref.widgetInstanceIndex}` : ""}`)
      .join(" ");
  }
  const idx = "widgetInstanceIndex" in rule && rule.widgetInstanceIndex != null ? `#${rule.widgetInstanceIndex}` : "";
  return `${rule.pdfFieldName}${idx}`;
}

export function SetupCalibrationEditorClient({
  calibrationId,
  documentId: initialDocumentId,
  previewUrl: initialPreviewUrl,
  exampleDocumentOriginalFilename: initialExampleDocumentOriginalFilename = null,
  initialName,
  initialSourceType,
  initialCalibrationData,
  setupSheetModelId: initialSetupSheetModelId = null,
}: {
  calibrationId: string;
  documentId: string;
  previewUrl: string;
  exampleDocumentOriginalFilename?: string | null;
  initialName: string;
  initialSourceType: string;
  initialCalibrationData: unknown;
  /** When set, catalog and reserved keys come from this model schema only (not A800). */
  setupSheetModelId?: string | null;
}) {
  const router = useRouter();
  const [documentId, setDocumentId] = useState(initialDocumentId);
  const [previewUrl, setPreviewUrl] = useState(initialPreviewUrl);
  const [linkedExampleFilename, setLinkedExampleFilename] = useState(
    initialExampleDocumentOriginalFilename ?? ""
  );
  useEffect(() => {
    setDocumentId(initialDocumentId);
    setPreviewUrl(initialPreviewUrl);
    setLinkedExampleFilename(initialExampleDocumentOriginalFilename ?? "");
  }, [initialDocumentId, initialPreviewUrl, initialExampleDocumentOriginalFilename]);
  const normalized = normalizeCalibrationData(initialCalibrationData);
  const [tab, setTab] = useState<"sheet" | "form" | "text" | "region">("form");
  const [name, setName] = useState(initialName);
  const [sourceType, setSourceType] = useState(initialSourceType);
  const [formFieldMappings, setFormFieldMappings] = useState<Record<string, PdfFormFieldMappingRule>>(() => ({
    ...(normalized.formFieldMappings ?? {}),
  }));
  const [fieldMappings, setFieldMappings] = useState<Record<string, TextFieldMappingRule>>(() => ({
    ...(normalized.fieldMappings ?? {}),
  }));
  const [fields, setFields] = useState<Record<string, CalibrationFieldRegion>>(normalized.fields);
  const [sheetFields, setSheetFields] = useState<CalibrationSheetField[]>(() => normalized.sheetFields ?? []);
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState<CustomSetupFieldDefinition[]>(
    () => normalized.customFieldDefinitions ?? []
  );
  const [fieldDisplayOverrides, setFieldDisplayOverrides] = useState<Record<string, FieldDisplayOverride>>(
    () => normalized.fieldDisplayOverrides ?? {}
  );
  const [showCreateFieldForm, setShowCreateFieldForm] = useState(false);
  /** When set, create form updates this custom definition instead of appending. */
  const [createFieldEditKey, setCreateFieldEditKey] = useState<string | null>(null);
  const [createFieldError, setCreateFieldError] = useState<string | null>(null);
  const [cfKey, setCfKey] = useState("");
  const [cfLabel, setCfLabel] = useState("");
  const [cfSectionId, setCfSectionId] = useState(CUSTOM_FIELD_SECTION_PRESETS[0]!.id);
  const [cfFieldDomain, setCfFieldDomain] = useState<SetupFieldDomain>("metadata");
  const [cfValueType, setCfValueType] = useState<CustomFieldValueType>("string");
  const [cfUiType, setCfUiType] = useState<CustomFieldUiType>("text");
  const [cfIsMetadata, setCfIsMetadata] = useState(true);
  const [cfShowInSetupSheet, setCfShowInSetupSheet] = useState(true);
  const [cfShowInAnalysis, setCfShowInAnalysis] = useState(true);
  const [cfPdfExportable, setCfPdfExportable] = useState(true);
  const [cfUnit, setCfUnit] = useState("");
  const [cfCheckedValue, setCfCheckedValue] = useState("1");
  const [cfUncheckedValue, setCfUncheckedValue] = useState("");
  const [cfGroupKey, setCfGroupKey] = useState("");
  const [cfOptionValue, setCfOptionValue] = useState("");
  const [cfNotes, setCfNotes] = useState("");
  const [cfSubsectionId, setCfSubsectionId] = useState("");
  const [cfLayoutPlacement, setCfLayoutPlacement] = useState<CustomSetupFieldDefinition["layoutPlacement"]>("none");
  const [cfPairGroupId, setCfPairGroupId] = useState("");
  const [cfSortOrder, setCfSortOrder] = useState(0);
  /** Right-column editor target; null = no setup field being edited (cleared explicitly). */
  const [activeSetupFieldKey, setActiveSetupFieldKey] = useState<string | null>(null);
  /** When creating a grouped field from PDF multi-select, mapping is applied after save. */
  const [pendingGroupedSourceKeys, setPendingGroupedSourceKeys] = useState<string[] | null>(null);
  /** Group editor child source keys (create and edit use same surface). */
  const [groupedEditorSourceKeys, setGroupedEditorSourceKeys] = useState<string[] | null>(null);
  const [groupBehaviorType, setGroupBehaviorType] = useState<GroupedFieldBehaviorType>("singleSelect");
  const [groupedOptionDrafts, setGroupedOptionDrafts] = useState<
    Record<string, { optionLabel: string; optionValue: string; notes: string }>
  >({});
  /** When creating / editing a grouped custom field: table of drafts vs pick-chip then click-PDF. */
  const [groupedMappingPanelMode, setGroupedMappingPanelMode] = useState<"table" | "chips">("table");
  /** Preset from "New field kind" — keeps Form editor control + PDF group shape aligned with user intent. */
  const [newFieldKindPreset, setNewFieldKindPreset] = useState<{
    valueType: CustomFieldValueType;
    ui: CustomFieldUiType;
    behavior: GroupedFieldBehaviorType;
  } | null>(null);
  /** One option name per line; if count matches # of selected PDFs, used as display labels when creating a grouped field. */
  const [preGroupedOptionNameHints, setPreGroupedOptionNameHints] = useState<string>("");
  /** custom | template | new — drives commit behavior and form fieldScope. */
  const [setupFieldFormScope, setSetupFieldFormScope] = useState<"new" | "custom" | "template">("new");
  /** Explicit editor mode so create vs edit vs source selection do not compete. */
  const [editorMode, setEditorMode] = useState<
    "idle" | "sourceSelection" | "createSingleField" | "createGroupedField" | "editSetupField"
  >("idle");
  const [anchorInput, setAnchorInput] = useState("");
  const [occurrenceInput, setOccurrenceInput] = useState("0");

  const [pdfFormRows, setPdfFormRows] = useState<PdfFormFieldRow[]>([]);
  const [pdfFormMeta, setPdfFormMeta] = useState<{ hasFormFields: boolean; loadError?: string } | null>(null);
  const [pdfFormLoading, setPdfFormLoading] = useState(false);
  const [showExtractedFields, setShowExtractedFields] = useState(false);

  const [tool, setTool] = useState<CalibrationUiTool>("select");
  const [selectedSheetFieldId, setSelectedSheetFieldId] = useState<string | null>(null);
  const [draftGroupFieldId, setDraftGroupFieldId] = useState<string | null>(null);
  const [hoveredSheetOverlayId, setHoveredSheetOverlayId] = useState<string | null>(null);

  const sheetPdfContainerRef = useRef<HTMLDivElement | null>(null);
  const formPdfContainerRef = useRef<HTMLDivElement | null>(null);
  const examplePdfSectionRef = useRef<HTMLDivElement | null>(null);
  const [pdfRenderWidth, setPdfRenderWidth] = useState<number>(900);
  /** PDF source multi-select: toggle per unmapped widget; `activeKey` drives the detail panel. */
  /** Parameter-first mapping: the armed parameter and its options assigned so far. */
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [armedAssignments, setArmedAssignments] = useState<ModelOptionAssignment[]>([]);
  const [acroSelection, setAcroSelection] = useState<{ keys: string[]; activeKey: string | null }>({
    keys: [],
    activeKey: null,
  });
  const selectedAcroField = useMemo((): AcroFormSourceRef | null => {
    if (!acroSelection.activeKey) return null;
    return parseAcroKey(acroSelection.activeKey);
  }, [acroSelection.activeKey]);
  const [showAddMappingForm, setShowAddMappingForm] = useState(false);
  const [newMappingCanonicalKey, setNewMappingCanonicalKey] = useState<string>(A800RR_FIELD_CATALOG[0]?.key ?? "");
  const [newMappingNotes, setNewMappingNotes] = useState("");
  const [linkTargetCanonicalKey, setLinkTargetCanonicalKey] = useState<string>(A800RR_FIELD_CATALOG[0]?.key ?? "");
  /** For Awesomatix grouped fields: option label to bind on next PDF click. */
  const [pendingGroupOption, setPendingGroupOption] = useState<string | null>(null);
  /** Cross-field PDF widget reuse requires explicit overwrite confirmation. */
  const [pdfMappingConflict, setPdfMappingConflict] = useState<
    | null
    | {
        kind: "simple";
        pdfFieldName: string;
        instanceIndex: number;
        targetCanonicalKey: string;
        newCustomDef?: CustomSetupFieldDefinition;
        conflicts: PdfWidgetOwnershipDetail[];
      }
    | {
        kind: "groupChip";
        pdfFieldName: string;
        instanceIndex: number;
        optionValue: string;
        targetCanonicalKey: string;
        conflicts: PdfWidgetOwnershipDetail[];
      }
  >(null);
  const [formListFilter, setFormListFilter] = useState<"all" | "values" | "unmapped">("all");
  const [hoveredFormOverlayKey, setHoveredFormOverlayKey] = useState<string | null>(null);
  const [formFieldListOpen, setFormFieldListOpen] = useState(false);

  const [structure, setStructure] = useState<PdfTextStructureDocument | null>(null);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [structureLoading, setStructureLoading] = useState(false);
  const [epsilon, setEpsilon] = useState(normalized.documentMeta?.lineGroupingEpsilon ?? 2.5);

  const [numPages, setNumPages] = useState<number>(normalized.documentMeta?.pageCount ?? 1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pdfPageSize, setPdfPageSize] = useState<{ width: number; height: number } | null>(null);
  const [renderedPageSize, setRenderedPageSize] = useState<{ width: number; height: number } | null>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingAsNew, setSavingAsNew] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [attachListOpen, setAttachListOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attachCandidates, setAttachCandidates] = useState<Array<{ id: string; originalFilename: string }>>([]);
  const [attachListLoading, setAttachListLoading] = useState(false);
  const [attachLinking, setAttachLinking] = useState(false);
  const [setupSheetModelSchema, setSetupSheetModelSchema] = useState<SetupSheetModelSchema | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkDialogEditKey, setLinkDialogEditKey] = useState<string | null>(null);
  const [linkDialogAssignments, setLinkDialogAssignments] = useState<ModelOptionAssignment[] | null>(null);
  const [linkAssignOnPdfOption, setLinkAssignOnPdfOption] = useState<string | null>(null);
  const [schemaNavPending, setSchemaNavPending] = useState(false);

  const modelLinkedMode = Boolean(initialSetupSheetModelId && setupSheetModelSchema);

  const loadSetupSheetModelSchema = useCallback(async () => {
    if (!initialSetupSheetModelId) {
      setSetupSheetModelSchema(null);
      return;
    }
    try {
      const res = await fetch(`/api/setup-sheet-models/${initialSetupSheetModelId}`, { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { model?: { schema?: SetupSheetModelSchema } };
      if (d.model?.schema) {
        setSetupSheetModelSchema({
          ...d.model.schema,
          fields: normalizeSetupSheetModelSchemaFields(d.model.schema.fields),
        });
      } else {
        setSetupSheetModelSchema(null);
      }
    } catch {
      setSetupSheetModelSchema(null);
    }
  }, [initialSetupSheetModelId]);

  useEffect(() => {
    void loadSetupSheetModelSchema();
  }, [loadSetupSheetModelSchema]);

  useEffect(() => {
    if (!initialSetupSheetModelId) return;
    const onFocus = () => void loadSetupSheetModelSchema();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [initialSetupSheetModelId, loadSetupSheetModelSchema]);

  useEffect(() => {
    if (modelLinkedMode) setTab("form");
  }, [modelLinkedMode]);

  const modelFieldKeySet = useMemo(
    () => (setupSheetModelSchema ? modelFieldKeys(setupSheetModelSchema) : null),
    [setupSheetModelSchema]
  );

  const modelProgress = useMemo(
    () => (setupSheetModelSchema ? modelMappingProgress(setupSheetModelSchema, formFieldMappings) : null),
    [setupSheetModelSchema, formFieldMappings]
  );

  const calibrationPersistedSnapshot = useMemo(() => {
    const initial = normalizeCalibrationData(initialCalibrationData);
    return JSON.stringify({
      name: (initialName ?? "").trim(),
      formFieldMappings: initial.formFieldMappings ?? {},
      fieldMappings: initial.fieldMappings ?? {},
      fields: initial.fields ?? {},
      sheetFields: initial.sheetFields ?? [],
      customFieldDefinitions: initial.customFieldDefinitions ?? [],
      fieldDisplayOverrides: initial.fieldDisplayOverrides ?? {},
    });
  }, [initialCalibrationData, initialName]);

  const [savedCalibrationSnapshot, setSavedCalibrationSnapshot] = useState<string | null>(null);

  const calibrationDirtySnapshot = useMemo(
    () =>
      JSON.stringify({
        name: name.trim(),
        formFieldMappings,
        fieldMappings,
        fields,
        sheetFields,
        customFieldDefinitions,
        fieldDisplayOverrides,
      }),
    [
      name,
      formFieldMappings,
      fieldMappings,
      fields,
      sheetFields,
      customFieldDefinitions,
      fieldDisplayOverrides,
    ]
  );

  const calibrationDirty = useMemo(() => {
    const baseline = savedCalibrationSnapshot ?? calibrationPersistedSnapshot;
    return calibrationDirtySnapshot !== baseline;
  }, [calibrationDirtySnapshot, calibrationPersistedSnapshot, savedCalibrationSnapshot]);

  useEffect(() => {
    if (!calibrationDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [calibrationDirty]);

  // Autosave: persist ~1.5s after the last edit. The effect re-arms on every
  // snapshot change, so the request always carries the latest state.
  useEffect(() => {
    if (!calibrationDirty || saving || savingAsNew) return;
    const t = setTimeout(() => {
      void save({ silent: true });
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibrationDirty, calibrationDirtySnapshot, saving, savingAsNew]);

  const loadPdfCandidates = useCallback(async () => {
    setAttachListLoading(true);
    try {
      const res = await fetch("/api/setup-documents?forExamplePdf=1", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        documents?: Array<{ id: string; originalFilename: string; mimeType: string }>;
        error?: string;
      };
      if (!res.ok) {
        setAttachCandidates([]);
        setStatus(data.error || "Could not load setup documents");
        return;
      }
      const list = (data.documents ?? []).filter((d) => d.mimeType === "application/pdf");
      setAttachCandidates(list.map((d) => ({ id: d.id, originalFilename: d.originalFilename })));
    } catch {
      setAttachCandidates([]);
      setStatus("Could not load setup documents");
    } finally {
      setAttachListLoading(false);
    }
  }, []);

  const openExamplePdfPicker = useCallback(() => {
    setSettingsOpen(true);
    setAttachListOpen(true);
    void loadPdfCandidates();
    requestAnimationFrame(() => {
      examplePdfSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [loadPdfCandidates]);

  const linkExampleDocument = useCallback(
    async (nextId: string) => {
      if (!nextId.trim()) return;
      setAttachLinking(true);
      setStatus(null);
      try {
        const res = await fetch(`/api/setup-calibrations/${calibrationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exampleDocumentId: nextId.trim() }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setStatus(data.error || "Failed to link example PDF");
          return;
        }
        const meta = attachCandidates.find((d) => d.id === nextId.trim());
        setDocumentId(nextId.trim());
        setPreviewUrl(`/api/setup-documents/${nextId.trim()}/file`);
        setLinkedExampleFilename(meta?.originalFilename ?? nextId.trim());
        setAttachListOpen(false);
        setStatus("Example PDF linked.");
        router.refresh();
      } catch {
        setStatus("Failed to link example PDF");
      } finally {
        setAttachLinking(false);
      }
    },
    [attachCandidates, calibrationId, router]
  );
  const [pdfLoadDetail, setPdfLoadDetail] = useState<string | null>(null);
  const [lineFilter, setLineFilter] = useState("");
  const [inspectPage, setInspectPage] = useState(1);

  function newId(prefix: string) {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }

  function addSheetField(kind: "text" | "checkbox" | "group", init?: Partial<CalibrationSheetField>) {
    const id = newId("sf");
    const base = {
      id,
      label: "",
      canonicalFieldKey: activeSetupFieldKey || "",
      active: true,
    };
    const next: CalibrationSheetField =
      kind === "text"
        ? { ...base, sourceType: "text", sourceName: "" }
        : kind === "checkbox"
          ? { ...base, sourceType: "checkbox", sourceName: "", checkedValue: "1", uncheckedValue: "" }
          : ({ ...base, sourceType: "group", options: [] } as CalibrationSheetGroupField);
    const merged = { ...(next as any), ...(init ?? {}) } as CalibrationSheetField;
    setSheetFields((prev) => [merged, ...prev]);
    setSelectedSheetFieldId(id);
    if (merged.sourceType === "group") setDraftGroupFieldId(id);
    return id;
  }


  function deleteSheetField(id: string) {
    setSheetFields((prev) => prev.filter((f) => f.id !== id));
    setSelectedSheetFieldId((cur) => (cur === id ? null : cur));
    setDraftGroupFieldId((cur) => (cur === id ? null : cur));
  }





  const resolvedFileUrl = useMemo(() => {
    if (!previewUrl) return "";
    if (typeof window === "undefined") return previewUrl;
    return new URL(previewUrl, window.location.origin).href;
  }, [previewUrl]);

  const mergedLabelMap = useMemo(() => buildMergedLabelMap(customFieldDefinitions), [customFieldDefinitions]);

  const customFieldKeySet = useMemo(
    () => new Set(customFieldDefinitions.map((c) => c.key)),
    [customFieldDefinitions]
  );
  const customFieldByKey = useMemo(
    () => new Map(customFieldDefinitions.map((c) => [c.key, c] as const)),
    [customFieldDefinitions]
  );

  /** A800RR sheet sections + presets + any ids already stored on custom defs (no artificial restriction). */
  const mergedSectionOptions = useMemo(() => {
    const base = getMergedSectionGroupOptions();
    const byId = new Map(base.map((o) => [o.id, o] as const));
    for (const c of customFieldDefinitions) {
      if (c.sectionId && !byId.has(c.sectionId)) {
        byId.set(c.sectionId, { id: c.sectionId, title: c.sectionTitle || c.sectionId });
      }
    }
    return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [customFieldDefinitions]);

  const sortedCatalog = useMemo(() => {
    const base = setupSheetModelSchema
      ? buildCatalogFromModelSchema(setupSheetModelSchema)
      : A800RR_FIELD_CATALOG;
    const merged = mergeCustomFieldsIntoCatalog(base, customFieldDefinitions);
    return [...merged].sort((a, b) => {
      const ia = TEMPLATE_PRIORITY_FIELD_KEYS.indexOf(a.key as (typeof TEMPLATE_PRIORITY_FIELD_KEYS)[number]);
      const ib = TEMPLATE_PRIORITY_FIELD_KEYS.indexOf(b.key as (typeof TEMPLATE_PRIORITY_FIELD_KEYS)[number]);
      const na = ia === -1 ? 9999 : ia;
      const nb = ib === -1 ? 9999 : ib;
      if (na !== nb) return na - nb;
      if (a.groupTitle !== b.groupTitle) return a.groupTitle.localeCompare(b.groupTitle);
      return a.label.localeCompare(b.label);
    });
  }, [customFieldDefinitions, setupSheetModelSchema]);

  const knownCalibrationFieldKeys = useMemo(
    () => new Set(sortedCatalog.map((f) => f.key)),
    [sortedCatalog]
  );

  const pdfRowByName = useMemo(() => {
    const m = new Map<string, PdfFormFieldRow>();
    for (const row of pdfFormRows) m.set(row.name, row);
    return m;
  }, [pdfFormRows]);

  const acroSelectOptions = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    for (const row of pdfFormRows) {
      const w = row.widgets?.length ?? 0;
      const count = Math.max(1, w);
      for (let i = 0; i < count; i++) {
        const value = `${row.name}#${i}`;
        out.push({
          value,
          label: `${row.name} #${i} (${row.type || "?"})`,
        });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [pdfFormRows]);

  const widgetOptionsForLink = useMemo(() => {
    return acroSelection.keys.map((key) => {
      const ref = parseAcroKey(key);
      const row = pdfRowByName.get(ref.pdfFieldName);
      return {
        value: key,
        label: `${ref.pdfFieldName} #${ref.instanceIndex}${row?.type ? ` (${row.type})` : ""}`,
      };
    });
  }, [acroSelection.keys, pdfRowByName]);

  /** Awesomatix + catalog: singleSelect chip flow vs visual multi vs legacy. */
  function effectiveWidgetGroupKind(fieldKey: string | null): "single" | "multi" | null {
    if (!fieldKey) return null;
    if (usesSingleSelectChipWorkflow(fieldKey)) return "single";
    const vm = getVisualMultiOptions(fieldKey);
    if (vm && vm.length > 0) return "multi";
    const aw = awesomatixGroupKind(fieldKey);
    if (aw) return aw;
    const def = customFieldByKey.get(fieldKey);
    return customFieldGroupedChipContext(def)?.kind ?? null;
  }

  /** Catalog + Awesomatix keys only (not custom groupedOptions). */
  function baseCatalogChipOptionValues(fieldKey: string | null): string[] {
    if (!fieldKey) return [];
    const ss = getSingleSelectChipOptions(fieldKey);
    if (ss && ss.length > 0) return [...ss];
    const vm = getVisualMultiOptions(fieldKey);
    if (vm && vm.length > 0) return [...vm];
    return [...(awesomatixGroupOptions(fieldKey) ?? [])];
  }

  function chipOptionsForField(fieldKey: string | null): string[] {
    if (!fieldKey) return [];
    const base = baseCatalogChipOptionValues(fieldKey);
    if (base.length > 0) return base;
    const def = customFieldByKey.get(fieldKey);
    const ctx = customFieldGroupedChipContext(def);
    return ctx ? ctx.entries.map((e) => e.value) : [];
  }


  const mappedSheetPdfFieldNames = useMemo(() => {
    const mapped = new Set<string>();
    for (const f of sheetFields) {
      if (f.sourceType === "group") {
        for (const opt of f.options) {
          if (opt.sourceName.trim()) mapped.add(opt.sourceName.trim());
        }
      } else {
        const n = (f as any).sourceName as string | undefined;
        if (typeof n === "string" && n.trim()) mapped.add(n.trim());
      }
    }
    return mapped;
  }, [sheetFields]);

  const pdfFieldToAppKeys = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [appKey, rule] of Object.entries(formFieldMappings)) {
      const n = rulePdfFieldName(rule);
      if (!m.has(n)) m.set(n, []);
      m.get(n)!.push(appKey);
    }
    return m;
  }, [formFieldMappings]);

  const mappedWidgetKeys = useMemo(() => {
    const s = new Set<string>();
    for (const rule of Object.values(formFieldMappings)) {
      if ("mode" in rule && rule.mode === "singleChoiceWidgetGroup") {
        for (const opt of Object.values(rule.options)) {
          s.add(`${rule.pdfFieldName}#${opt.widgetInstanceIndex}`);
        }
      } else if ("mode" in rule && rule.mode === "multiSelectWidgetGroup") {
        for (const opt of Object.values(rule.options)) {
          s.add(`${rule.pdfFieldName}#${opt.widgetInstanceIndex}`);
        }
      } else if ("mode" in rule && (rule.mode === "singleChoiceNamedFields" || rule.mode === "multiSelectNamedFields")) {
        for (const ref of Object.values(rule.options)) {
          if (ref.widgetInstanceIndex != null) s.add(`${ref.pdfFieldName}#${ref.widgetInstanceIndex}`);
        }
      } else {
        const r = rule as { pdfFieldName: string; widgetInstanceIndex?: number };
        const row = pdfRowByName.get(r.pdfFieldName);
        const n = row?.widgets?.length ?? 0;
        if (r.widgetInstanceIndex != null) {
          s.add(`${r.pdfFieldName}#${r.widgetInstanceIndex}`);
        } else if (n <= 1) {
          if (n === 1) s.add(`${r.pdfFieldName}#0`);
        } else {
          for (let i = 0; i < n; i++) s.add(`${r.pdfFieldName}#${i}`);
        }
      }
    }
    return s;
  }, [formFieldMappings, pdfRowByName]);

  const catalogByGroup = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, (typeof A800RR_FIELD_CATALOG)[number][]>();
    for (const f of sortedCatalog) {
      const title = f.groupTitle || "Other";
      if (!map.has(title)) {
        map.set(title, []);
        order.push(title);
      }
      map.get(title)!.push(f);
    }
    return { order, map };
  }, [sortedCatalog]);

  const loadPdfFormFields = useCallback(async () => {
    if (!documentId) return;
    setPdfFormLoading(true);
    setPdfFormMeta(null);
    try {
      const res = await fetch(`/api/setup-documents/${documentId}/pdf-form-fields`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as PdfFormFieldRow[] & {
        hasFormFields?: boolean;
        loadError?: string;
        fields?: PdfFormFieldRow[];
      };
      if (!res.ok) {
        setPdfFormRows([]);
        setPdfFormMeta({ hasFormFields: false, loadError: (data as { error?: string }).error || `HTTP ${res.status}` });
        return;
      }
      const rows = Array.isArray(data.fields) ? data.fields : [];
      setPdfFormRows(rows);
      setPdfFormMeta({ hasFormFields: Boolean(data.hasFormFields), loadError: data.loadError });
      if (process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console
        console.info("[calibration pdf-form-fields]", rows.length, "fields", data.hasFormFields);
      }
    } catch (e) {
      setPdfFormRows([]);
      setPdfFormMeta({ hasFormFields: false, loadError: e instanceof Error ? e.message : "Load failed" });
    } finally {
      setPdfFormLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (!documentId) return;
    void loadPdfFormFields();
  }, [documentId, loadPdfFormFields]);

  const loadStructure = useCallback(async () => {
    if (!documentId) return;
    setStructureLoading(true);
    setStructureError(null);
    try {
      const res = await fetch(
        `/api/setup-documents/${documentId}/pdf-structure?epsilon=${encodeURIComponent(String(epsilon))}`,
        { cache: "no-store" }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        structure?: PdfTextStructureDocument;
        epsilon?: number;
      };
      if (!res.ok) {
        setStructureError(data.error || `HTTP ${res.status}`);
        setStructure(null);
        return;
      }
      if (!data.structure) {
        setStructureError("No structure in response");
        setStructure(null);
        return;
      }
      setStructure(data.structure);
      setInspectPage(1);
    } catch (e) {
      setStructureError(e instanceof Error ? e.message : "Load failed");
      setStructure(null);
    } finally {
      setStructureLoading(false);
    }
  }, [documentId, epsilon]);

  useEffect(() => {
    if (tab !== "text" || !documentId) return;
    void loadStructure();
  }, [tab, documentId, loadStructure]);

  useEffect(() => {
    if (!previewUrl || typeof window === "undefined") return;
    setPdfLoadDetail(null);
    if (process.env.NODE_ENV !== "development") return;
    const url = new URL(previewUrl, window.location.origin).href;
    void fetch(url, { method: "HEAD", cache: "no-store" }).then((r) => {
      // eslint-disable-next-line no-console
      console.info("[calibration PDF]", url, "HTTP", r.status, r.headers.get("content-type"));
    });
  }, [previewUrl]);

  const formCount = useMemo(() => Object.keys(formFieldMappings).length, [formFieldMappings]);
  const textCount = useMemo(() => Object.keys(fieldMappings).length, [fieldMappings]);
  const regionCount = useMemo(() => Object.keys(fields).length, [fields]);

  const inProgressRect = useMemo(() => {
    if (!drawStart || !drawCurrent) return null;
    return {
      x: Math.min(drawStart.x, drawCurrent.x),
      y: Math.min(drawStart.y, drawCurrent.y),
      width: Math.abs(drawCurrent.x - drawStart.x),
      height: Math.abs(drawCurrent.y - drawStart.y),
    };
  }, [drawCurrent, drawStart]);

  /** Applies simple mapping after widget is detached from any prior uses (single ownership). */
  function applyWidgetToCanonicalKeyAfterDetach(
    canonicalKey: string,
    pdfFieldName: string,
    instanceIndex: number,
    newCustomDef?: CustomSetupFieldDefinition
  ) {
    if (!canonicalKey.trim()) return;
    const row = pdfRowByName.get(pdfFieldName);
    const n = row?.widgets?.length ?? 0;
    const toggle = row && isToggleFieldType(row.type);
    const useIndex = toggle && n > 1;
    const payload: PdfFormFieldMappingRule = useIndex
      ? { pdfFieldName, widgetInstanceIndex: instanceIndex }
      : { pdfFieldName };

    setFormFieldMappings((prev) => {
      const cleaned = removePdfWidgetFromMappings(prev, pdfFieldName, instanceIndex, row);
      return { ...cleaned, [canonicalKey.trim()]: payload };
    });
    const ak = acroSourceKey({ pdfFieldName, instanceIndex });
    setAcroSelection({ keys: [ak], activeKey: ak });
    setActiveSetupFieldKey(canonicalKey.trim());
    setShowAddMappingForm(false);
    setShowCreateFieldForm(false);
    setCreateFieldEditKey(null);
    setPendingGroupedSourceKeys(null);
    setStatus(null);
    setEditorMode("editSetupField");
    openEditSetupFieldUnified(canonicalKey.trim(), newCustomDef);
  }

  /** Links the selected AcroForm widget to a canonical setup field key (single-field / simple rule). */
  function applyWidgetToCanonicalKey(
    canonicalKey: string,
    pdfFieldName: string,
    instanceIndex: number,
    newCustomDef?: CustomSetupFieldDefinition
  ) {
    if (!canonicalKey.trim()) return;
    const row = pdfRowByName.get(pdfFieldName);
    const cross = filterCrossFieldConflicts(
      listPdfWidgetOwnershipDetails(formFieldMappings, pdfFieldName, instanceIndex, row),
      canonicalKey.trim()
    );
    if (cross.length > 0) {
      setPdfMappingConflict({
        kind: "simple",
        pdfFieldName,
        instanceIndex,
        targetCanonicalKey: canonicalKey.trim(),
        newCustomDef,
        conflicts: cross,
      });
      return;
    }
    applyWidgetToCanonicalKeyAfterDetach(canonicalKey, pdfFieldName, instanceIndex, newCustomDef);
  }

  function assignGroupPdfWidgetApply(
    targetCanonicalKey: string,
    pdfFieldName: string,
    instanceIndex: number,
    optionValue: string
  ) {
    const gk = effectiveWidgetGroupKind(targetCanonicalKey);
    if (!gk) return;
    const mode: "singleChoiceWidgetGroup" | "multiSelectWidgetGroup" =
      gk === "single" ? "singleChoiceWidgetGroup" : "multiSelectWidgetGroup";
    const row = pdfRowByName.get(pdfFieldName);

    setFormFieldMappings((prev) => {
      const next = removePdfWidgetFromMappings(prev, pdfFieldName, instanceIndex, row);
      const prevRule = next[targetCanonicalKey];
      if (prevRule && "mode" in prevRule && (prevRule.mode === "singleChoiceNamedFields" || prevRule.mode === "multiSelectNamedFields")) {
        const namedMode = gk === "single" ? "singleChoiceNamedFields" : "multiSelectNamedFields";
        return {
          ...next,
          [targetCanonicalKey]: {
            mode: namedMode,
            options: {
              ...prevRule.options,
              [optionValue]: { pdfFieldName, widgetInstanceIndex: instanceIndex },
            },
          },
        };
      }

      let base =
        prevRule && "mode" in prevRule && prevRule.mode === mode
          ? prevRule
          : { mode, pdfFieldName, options: {} as Record<string, { widgetInstanceIndex: number }> };

      if (base.pdfFieldName !== pdfFieldName) {
        const namedMode = gk === "single" ? "singleChoiceNamedFields" : "multiSelectNamedFields";
        const promoted: Record<string, { pdfFieldName: string; widgetInstanceIndex?: number }> = {};
        for (const [label, ref] of Object.entries(base.options)) {
          promoted[label] = { pdfFieldName: base.pdfFieldName, widgetInstanceIndex: ref.widgetInstanceIndex };
        }
        promoted[optionValue] = { pdfFieldName, widgetInstanceIndex: instanceIndex };
        return {
          ...next,
          [targetCanonicalKey]: { mode: namedMode, options: promoted },
        };
      }

      return {
        ...next,
        [targetCanonicalKey]: {
          ...base,
          options: {
            ...base.options,
            [optionValue]: { widgetInstanceIndex: instanceIndex },
          },
        },
      };
    });

    const sk = acroSourceKey({ pdfFieldName, instanceIndex });
    setCustomFieldDefinitions((prev) =>
      prev.map((c) => {
        if (c.key !== targetCanonicalKey || !c.groupedOptions?.length) return c;
        if (!c.groupedOptions.some((o) => o.optionValue === optionValue)) return c;
        return {
          ...c,
          groupedOptions: c.groupedOptions.map((o) =>
            o.optionValue === optionValue ? { ...o, sourceKey: sk } : o
          ),
        };
      })
    );

    setAcroSelection({ keys: [sk], activeKey: sk });
    setActiveSetupFieldKey(targetCanonicalKey);
    setStatus(null);
    setPendingGroupOption(optionValue);
  }

  function cancelPdfMappingConflict() {
    setPdfMappingConflict(null);
  }

  function confirmPdfMappingOverwrite() {
    const c = pdfMappingConflict;
    if (!c) return;
    setPdfMappingConflict(null);
    if (c.kind === "simple") {
      applyWidgetToCanonicalKeyAfterDetach(c.targetCanonicalKey, c.pdfFieldName, c.instanceIndex, c.newCustomDef);
    } else {
      assignGroupPdfWidgetApply(c.targetCanonicalKey, c.pdfFieldName, c.instanceIndex, c.optionValue);
    }
  }

  function openEditTemplateFieldForKey(key: string) {
    const meta = sortedCatalog.find((f) => f.key === key);
    if (!meta) return;
    const ov = fieldDisplayOverrides[key];
    setCreateFieldError(null);
    setCreateFieldEditKey(null);
    setCfKey(meta.key);
    setCfLabel(meta.label);
    const sectionId = ov?.sheetGroupId ?? meta.groupId;
    const sectionMatch = mergedSectionOptions.find((o) => o.id === sectionId);
    setCfSectionId(sectionMatch ? sectionId : mergedSectionOptions[0]!.id);
    const kind = getCalibrationFieldKind(meta.key);
    const isVisualMulti = kind === "visualMulti";
    setCfFieldDomain("metadata");
    setCfValueType(isVisualMulti ? "string_array" : "string");
    setCfUiType(isVisualMulti ? "multiSelect" : "text");
    setCfIsMetadata(true);
    setCfShowInSetupSheet(ov?.showInSetupSheet !== false);
    setCfShowInAnalysis(ov?.showInAnalysis !== false);
    setCfPdfExportable(true);
    setCfUnit(meta.unit ?? "");
    setCfCheckedValue("1");
    setCfUncheckedValue("");
    setCfGroupKey("");
    setCfOptionValue("");
    setCfNotes("");
    setCfSubsectionId("");
    setCfLayoutPlacement("none");
    setCfPairGroupId("");
    setCfSortOrder(0);
    setSetupFieldFormScope("template");
    setShowCreateFieldForm(true);
    setShowAddMappingForm(false);
    setEditorMode("editSetupField");
  }

  function initGroupedEditorFromSources(
    sourceKeys: string[],
    behavior: GroupedFieldBehaviorType,
    existingOptions?: GroupedFieldOptionDefinition[],
    optionHintLabels?: string[]
  ) {
    const existingBySource = new Map((existingOptions ?? []).map((o) => [o.sourceKey, o] as const));
    const drafts: Record<string, { optionLabel: string; optionValue: string; notes: string }> = {};
    sourceKeys.forEach((k, i) => {
      const ref = parseAcroKey(k);
      const row = pdfRowByName.get(ref.pdfFieldName);
      const fallbackName = row?.name ?? ref.pdfFieldName;
      const existing = existingBySource.get(k);
      const hint = optionHintLabels?.[i]?.trim();
      if (hint) {
        drafts[k] = {
          optionLabel: hint,
          optionValue: inferOptionValueFromPdfName(hint) || `option_${i + 1}`,
          notes: existing?.notes ?? "",
        };
        return;
      }
      drafts[k] = {
        optionLabel: existing?.optionLabel ?? fallbackName.replace(/_/g, " "),
        optionValue: existing?.optionValue ?? inferOptionValueFromPdfName(fallbackName),
        notes: existing?.notes ?? "",
      };
    });
    setGroupedEditorSourceKeys(sourceKeys);
    setGroupedOptionDrafts(drafts);
    setGroupBehaviorType(behavior);
    setGroupedMappingPanelMode("table");
  }

  function clearGroupedEditorState() {
    setGroupedEditorSourceKeys(null);
    setGroupedOptionDrafts({});
    setGroupBehaviorType("singleSelect");
    setGroupedMappingPanelMode("table");
  }

  function deriveGroupedEditorFromRule(
    fieldKey: string,
    def: CustomSetupFieldDefinition | undefined,
    rule: PdfFormFieldMappingRule | undefined
  ) {
    if (!rule) {
      clearGroupedEditorState();
      return;
    }

    const existingBySource = new Map((def?.groupedOptions ?? []).map((o) => [o.sourceKey, o] as const));

    if ("mode" in rule && (rule.mode === "singleChoiceNamedFields" || rule.mode === "multiSelectNamedFields")) {
      const entries = Object.entries(rule.options);
      const behavior: GroupedFieldBehaviorType =
        def?.groupBehaviorType
        ?? (rule.mode === "singleChoiceNamedFields" ? "singleSelect" : "multiChoiceGroup");
      const keys: string[] = [];
      const drafts: Record<string, { optionLabel: string; optionValue: string; notes: string }> = {};
      for (const [canonicalValue, ref] of entries) {
        const sk = acroSourceKey({
          pdfFieldName: ref.pdfFieldName,
          instanceIndex: ref.widgetInstanceIndex ?? 0,
        });
        keys.push(sk);
        const existing = existingBySource.get(sk);
        drafts[sk] = {
          optionLabel: existing?.optionLabel ?? humanizeCanonicalStoredValue(canonicalValue),
          optionValue: canonicalValue,
          notes: existing?.notes ?? "",
        };
      }
      setGroupedEditorSourceKeys(keys);
      setGroupedOptionDrafts(drafts);
      setGroupBehaviorType(behavior);
      setGroupedMappingPanelMode(
        rule.mode === "multiSelectNamedFields" || (rule.mode === "singleChoiceNamedFields" && entries.length >= 2)
          ? "chips"
          : "table"
      );
      return;
    }

    if ("mode" in rule && (rule.mode === "singleChoiceWidgetGroup" || rule.mode === "multiSelectWidgetGroup")) {
      const entries = Object.entries(rule.options).sort(
        (a, b) => a[1].widgetInstanceIndex - b[1].widgetInstanceIndex
      );
      const behavior: GroupedFieldBehaviorType =
        def?.groupBehaviorType
        ?? (rule.mode === "singleChoiceWidgetGroup"
          ? "singleSelect"
          : (effectiveWidgetGroupKind(fieldKey) === "multi" ? "visualMulti" : "multiChoiceGroup"));
      const keys: string[] = [];
      const drafts: Record<string, { optionLabel: string; optionValue: string; notes: string }> = {};
      for (const [canonicalValue, ref] of entries) {
        const sk = acroSourceKey({ pdfFieldName: rule.pdfFieldName, instanceIndex: ref.widgetInstanceIndex });
        keys.push(sk);
        const existing = existingBySource.get(sk);
        drafts[sk] = {
          optionLabel: existing?.optionLabel ?? humanizeCanonicalStoredValue(canonicalValue),
          optionValue: canonicalValue,
          notes: existing?.notes ?? "",
        };
      }
      setGroupedEditorSourceKeys(keys);
      setGroupedOptionDrafts(drafts);
      setGroupBehaviorType(behavior);
      setGroupedMappingPanelMode("table");
      return;
    }
    clearGroupedEditorState();
  }

  function openEditCustomFieldForKey(key: string, defOverride?: CustomSetupFieldDefinition) {
    const def = defOverride ?? customFieldDefinitions.find((c) => c.key === key);
    if (!def) return;
    setSetupFieldFormScope("custom");
    setCreateFieldError(null);
    setCreateFieldEditKey(key);
    setCfKey(def.key);
    setCfLabel(def.displayLabel);
    const sectionMatch = mergedSectionOptions.find((o) => o.id === def.sectionId);
    setCfSectionId(sectionMatch ? def.sectionId : (mergedSectionOptions[0]?.id ?? "other"));
    setCfFieldDomain(def.fieldDomain);
    setCfValueType(def.valueType);
    setCfUiType(def.uiType);
    setCfIsMetadata(def.isMetadata);
    setCfShowInSetupSheet(def.showInSetupSheet !== false);
    setCfShowInAnalysis(def.showInAnalysis !== false);
    setCfPdfExportable(def.isPdfExportable);
    setCfUnit(def.unit ?? "");
    setCfCheckedValue(def.checkedValue ?? "1");
    setCfUncheckedValue(def.uncheckedValue ?? "");
    setCfGroupKey(def.groupKey ?? "");
    setCfOptionValue(def.optionValue ?? "");
    setCfNotes(def.notes ?? "");
    setCfSubsectionId(def.subsectionId ?? "");
    setCfLayoutPlacement(def.layoutPlacement ?? "none");
    setCfPairGroupId(def.pairGroupId ?? "");
    setCfSortOrder(def.sortOrder);
    setShowCreateFieldForm(true);
    setShowAddMappingForm(false);
    setEditorMode("editSetupField");
    deriveGroupedEditorFromRule(key, def, formFieldMappings[key]);
  }

  function openEditSetupFieldUnified(key: string, customDefOverride?: CustomSetupFieldDefinition) {
    if (customDefOverride || customFieldKeySet.has(key)) {
      openEditCustomFieldForKey(key, customDefOverride);
    } else {
      openEditTemplateFieldForKey(key);
      deriveGroupedEditorFromRule(key, undefined, formFieldMappings[key]);
    }
  }

  function clearActiveSetupFieldEditor() {
    setActiveSetupFieldKey(null);
    setShowCreateFieldForm(false);
    setCreateFieldEditKey(null);
    setCreateFieldError(null);
    setPendingGroupedSourceKeys(null);
    clearGroupedEditorState();
    setSetupFieldFormScope("new");
    setShowAddMappingForm(false);
    setPendingGroupOption(null);
    setEditorMode(acroSelection.keys.length > 0 ? "sourceSelection" : "idle");
  }


  function beginCreateGroupedFromSelection() {
    const keys = acroSelection.keys;
    if (keys.length < 2) return;
    setCreateFieldError(null);
    setShowAddMappingForm(false);
    setPendingGroupOption(null);
    const names = keys.map((k) => {
      const ref = parseAcroKey(k);
      return pdfRowByName.get(ref.pdfFieldName)?.name ?? ref.pdfFieldName;
    });
    const groupedInfer = inferGroupedFieldDefaultsFromPdfNames(names);
    const preset = newFieldKindPreset;
    const behaviorForInit = preset?.behavior ?? groupedInfer.groupBehaviorType;
    const lines = preGroupedOptionNameHints
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const hintList = lines.length === keys.length ? lines : undefined;
    initGroupedEditorFromSources(keys, behaviorForInit, undefined, hintList);
    setNewFieldKindPreset(null);

    const templateKey =
      activeSetupFieldKey && !customFieldKeySet.has(activeSetupFieldKey) ? activeSetupFieldKey : null;
    if (templateKey) {
      setCreateFieldEditKey(null);
      setSetupFieldFormScope("template");
      setEditorMode("editSetupField");
      setPendingGroupedSourceKeys(null);
      setActiveSetupFieldKey(templateKey);
      openEditTemplateFieldForKey(templateKey);
      if (preset) {
        setCfUiType(preset.ui);
        setCfValueType(preset.valueType);
        setGroupBehaviorType(preset.behavior);
      } else {
        setGroupBehaviorType(behaviorForInit);
      }
      setShowCreateFieldForm(true);
      const label = mergedLabelMap[templateKey] ?? templateKey;
      setStatus(
        `Link ${keys.length} PDF controls to “${label}” (${templateKey}). Name each option below, then Save changes.`
      );
      return;
    }

    setCreateFieldEditKey(null);
    setActiveSetupFieldKey(null);
    setSetupFieldFormScope("new");
    setEditorMode("createGroupedField");
    setPendingGroupedSourceKeys([...keys]);
    setShowCreateFieldForm(true);
    const first = parseAcroKey(keys[0]!);
    const row = pdfRowByName.get(first.pdfFieldName);
    setCfKey(suggestKeyFromPdfFieldName(names.join("_").slice(0, 64) || row?.name || "group_field"));
    if (preset) {
      setCfLabel(groupedInfer.labelSuggestion);
      setCfUiType(preset.ui);
      setCfValueType(preset.valueType);
    } else {
      setCfLabel(groupedInfer.labelSuggestion);
      setCfUiType(groupedInfer.groupBehaviorType === "visualMulti" ? "multiSelect" : "select");
      setCfValueType(groupedInfer.groupBehaviorType === "visualMulti" ? "multi" : "string");
    }
    setCfFieldDomain(groupedInfer.fieldDomain);
    setCfIsMetadata(groupedInfer.isMetadata);
    setCfSectionId(groupedInfer.sectionId);
    setCfShowInSetupSheet(true);
    setCfShowInAnalysis(true);
    setCfPdfExportable(true);
    setCfUnit("");
    setCfCheckedValue("1");
    setCfUncheckedValue("");
    setCfGroupKey("");
    setCfOptionValue("");
    setCfNotes("");
    setCfSubsectionId("");
    setCfLayoutPlacement("none");
    setCfPairGroupId("");
    const maxOrder = customFieldDefinitions.reduce((m, c) => Math.max(m, c.sortOrder), -1);
    setCfSortOrder(maxOrder + 1);
  }



  function buildGroupedOptionsPayload(sourceKeys: string[]): GroupedFieldOptionDefinition[] | null {
    const byValue = new Set<string>();
    const payload = sourceKeys
      .map((sourceKey, idx) => {
        const d = groupedOptionDrafts[sourceKey];
        if (!d) return null;
        const optionLabel = (d.optionLabel ?? "").trim();
        const optionValue = (d.optionValue ?? "").trim();
        if (!optionLabel || !optionValue) return null;
        if (byValue.has(optionValue)) return null;
        byValue.add(optionValue);
        return {
          sourceKey,
          optionLabel,
          optionValue,
          order: idx,
          notes: d.notes?.trim() || undefined,
        } satisfies GroupedFieldOptionDefinition;
      })
      .filter(Boolean) as GroupedFieldOptionDefinition[];
    if (payload.length !== sourceKeys.length) return null;
    return payload.sort((a, b) => a.order - b.order);
  }

  function buildGroupedFormMappingFromPayload(
    behavior: GroupedFieldBehaviorType,
    payload: GroupedFieldOptionDefinition[]
  ): PdfFormFieldMappingRule | null {
    if (payload.length < 2) return null;
    const refs = payload.map((p) => parseAcroKey(p.sourceKey));
    const samePdfFieldName = refs.every((r) => r.pdfFieldName === refs[0]!.pdfFieldName);
    /** Map option keys in formFieldMappings are canonical stored values (import uses these keys). */
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
          payload.map((p) => [p.optionValue, {
            pdfFieldName: parseAcroKey(p.sourceKey).pdfFieldName,
            widgetInstanceIndex: parseAcroKey(p.sourceKey).instanceIndex,
          }] as const)
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
        Object.entries(valueToRef).map(([valueKey, ref]) => [valueKey, {
          pdfFieldName: ref.pdfFieldName,
          widgetInstanceIndex: ref.instanceIndex,
        }] as const)
      ),
    };
  }




  function assignGroupPdfWidget(pdfFieldName: string, instanceIndex: number, optionValue: string) {
    if (!activeSetupFieldKey) return;
    const targetCanonicalKey = activeSetupFieldKey;
    const row = pdfRowByName.get(pdfFieldName);
    const cross = filterCrossFieldConflicts(
      listPdfWidgetOwnershipDetails(formFieldMappings, pdfFieldName, instanceIndex, row),
      targetCanonicalKey
    );
    if (cross.length > 0) {
      setPdfMappingConflict({
        kind: "groupChip",
        pdfFieldName,
        instanceIndex,
        optionValue,
        targetCanonicalKey,
        conflicts: cross,
      });
      return;
    }
    assignGroupPdfWidgetApply(targetCanonicalKey, pdfFieldName, instanceIndex, optionValue);
  }

  function closeLinkDialog() {
    setLinkDialogOpen(false);
    setLinkDialogEditKey(null);
    setLinkDialogAssignments(null);
    setLinkAssignOnPdfOption(null);
  }


  function commitModelGroupedLink(parameterKey: string, assignments: ModelOptionAssignment[]) {
    const field = setupSheetModelSchema?.fields.find((f) => f.key === parameterKey);
    if (!field) return;
    const behavior = groupedBehaviorForAssignments(field, assignments);
    const rule = buildGroupedRuleFromAssignments(behavior, assignments);
    if (!rule) {
      setStatus(
        "Could not save mapping — assign each option to a different PDF control from your selection, then confirm."
      );
      return;
    }

    setFormFieldMappings((prev) => {
      let next = { ...prev };
      for (const a of assignments) {
        const ref = parseAcroKey(a.sourceKey);
        const row = pdfRowByName.get(ref.pdfFieldName);
        next = removePdfWidgetFromMappings(next, ref.pdfFieldName, ref.instanceIndex, row);
      }
      next[parameterKey] = rule;
      return next;
    });
    setAcroSelection({ keys: [], activeKey: null });
    closeLinkDialog();
    setStatus(`Mapped “${field.displayLabel}”.`);
  }


  /** Arm a parameter: the next PDF clicks map its box(es). */
  function armParameter(parameterKey: string) {
    setArmedKey(parameterKey);
    setArmedAssignments([]);
    setAcroSelection({ keys: [], activeKey: null });
    setStatus(null);
  }

  function disarmParameter() {
    setArmedKey(null);
    setArmedAssignments([]);
    setStatus(null);
  }

  /** After a parameter completes, arm the next unmapped one (wrapping). */
  function advanceAfter(justMappedKey: string) {
    if (!setupSheetModelSchema) {
      disarmParameter();
      return;
    }
    const all = listModelParameters(setupSheetModelSchema);
    const idx = all.findIndex((r) => r.field.key === justMappedKey);
    const ordered = idx >= 0 ? [...all.slice(idx + 1), ...all.slice(0, idx)] : all;
    const next = ordered.find(
      (r) => r.field.key !== justMappedKey && !isModelParameterMapped(r.field, formFieldMappings)
    );
    if (next) {
      setArmedKey(next.field.key);
      setArmedAssignments([]);
    } else {
      setArmedKey(null);
      setArmedAssignments([]);
    }
  }

  /** Model-linked: parameter-first — arm a parameter, then click its box(es). */
  function onAcroWidgetClickModel(pdfFieldName: string, instanceIndex: number) {
    const sourceKey = acroSourceKey({ pdfFieldName, instanceIndex });
    const armedField = armedKey
      ? setupSheetModelSchema?.fields.find((f) => f.key === armedKey) ?? null
      : null;

    if (!armedField) {
      setStatus("Pick a parameter on the right, then click its box on the sheet.");
      return;
    }

    const options = modelFieldOptionEntries(armedField);

    if (options.length === 0) {
      applyWidgetToCanonicalKey(armedField.key, pdfFieldName, instanceIndex);
      setStatus(`Mapped “${armedField.displayLabel}”.`);
      advanceAfter(armedField.key);
      return;
    }

    const nextIndex = armedAssignments.length;
    const option = options[nextIndex];
    if (!option) return;
    if (armedAssignments.some((a) => a.sourceKey === sourceKey)) {
      setStatus("That box is already used by another option of this parameter.");
      return;
    }

    const nextAssignments = [
      ...armedAssignments,
      { optionValue: option.value, optionLabel: option.label, sourceKey },
    ];
    if (nextAssignments.length >= options.length) {
      commitModelGroupedLink(armedField.key, nextAssignments);
      advanceAfter(armedField.key);
    } else {
      setArmedAssignments(nextAssignments);
      setStatus(null);
    }
  }

  /** Adds a parameter to the car's sheet model schema, then arms it. */
  async function createSchemaParameter(input: NewParameterInput): Promise<boolean> {
    if (!setupSheetModelSchema || !initialSetupSheetModelId) return false;
    const base = input.displayLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "parameter";
    const existingKeys = new Set(setupSheetModelSchema.fields.map((f) => f.key));
    let key = base;
    let n = 2;
    while (existingKeys.has(key)) key = `${base}_${n++}`;

    const grouped = input.kind !== "value";
    const maxSort = setupSheetModelSchema.fields.reduce((m, f) => Math.max(m, f.sortOrder ?? 0), 0);
    const field: SetupSheetModelFieldDef = {
      key,
      displayLabel: input.displayLabel,
      sectionId: input.sectionId,
      sectionTitle: input.sectionTitle,
      valueType: grouped ? (input.kind === "one_of_many" ? "enum" : "multi") : "string",
      uiType: grouped ? (input.kind === "one_of_many" ? "select" : "multiSelect") : "text",
      showInSetupSheet: true,
      showInAnalysis: true,
      showInLogRun: true,
      sortOrder: maxSort + 1,
      ...(grouped
        ? {
            groupBehaviorType: (input.kind === "one_of_many"
              ? "singleSelect"
              : "multiChoiceGroup") as GroupedFieldBehaviorType,
            groupedOptionLabels: input.optionLabels,
            groupedOptionValues: input.optionLabels.map((l) =>
              l.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "opt"
            ),
          }
        : {}),
    };

    const nextSchema = { ...setupSheetModelSchema, fields: [...setupSheetModelSchema.fields, field] };
    try {
      const res = await fetch(`/api/setup-sheet-models/${initialSetupSheetModelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: nextSchema }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus(data.error || "Could not add the parameter.");
        return false;
      }
      setSetupSheetModelSchema(nextSchema);
      armParameter(key);
      setStatus(`Added “${input.displayLabel}”.`);
      return true;
    } catch {
      setStatus("Could not add the parameter.");
      return false;
    }
  }

  /** Mapped click → edit setup field + highlight PDF. Unmapped → source multi-select only (toggle); clears editor. */
  function onAcroWidgetClick(pdfFieldName: string, instanceIndex: number) {
    if (modelLinkedMode) {
      onAcroWidgetClickModel(pdfFieldName, instanceIndex);
      return;
    }
    const row = pdfRowByName.get(pdfFieldName);
    const mappingKeys = findAppKeysForWidget(formFieldMappings, pdfFieldName, instanceIndex, row);
    const knownMappingKeys = mappingKeys.filter((k) => knownCalibrationFieldKeys.has(k));
    const toggleKey = acroSourceKey({ pdfFieldName, instanceIndex });
    /** When a widget is part of a chip-mapped field, keep the corresponding chip selected (visual link feedback). */
    const syncPendingChipFromMappedWidget = (kFocus: string) => {
      const own = listPdfWidgetOwnershipDetails(formFieldMappings, pdfFieldName, instanceIndex, row);
      const hit = own.find((d) => d.canonicalKey === kFocus);
      if (hit?.optionValue && effectiveWidgetGroupKind(kFocus)) {
        setPendingGroupOption(hit.optionValue);
      } else {
        setPendingGroupOption(null);
      }
    };

    if (pendingGroupOption && showCreateFieldForm && groupedEditorSourceKeys?.includes(toggleKey)) {
      const inGroupedEditor =
        editorMode === "createGroupedField"
        || (editorMode === "editSetupField" && (groupedEditorSourceKeys?.length ?? 0) >= 2);
      if (inGroupedEditor) {
        const v = pendingGroupOption;
        setGroupedOptionDrafts((prev) => {
          const refk = parseAcroKey(toggleKey);
          const row0 = pdfRowByName.get(refk.pdfFieldName);
          const defDraft = {
            optionLabel: (row0?.name ?? refk.pdfFieldName).replace(/_/g, " "),
            optionValue: inferOptionValueFromPdfName(row0?.name ?? refk.pdfFieldName),
            notes: "",
          };
          const cur = prev[toggleKey] ?? defDraft;
          return {
            ...prev,
            [toggleKey]: {
              ...cur,
              optionValue: v,
              optionLabel: cur.optionLabel?.trim() ? cur.optionLabel : humanizeCanonicalStoredValue(v),
            },
          };
        });
        setPendingGroupOption(v);
        setStatus(`Stored value “${v}” linked to this PDF control.`);
        return;
      }
    }

    /**
     * If the user picked a catalog field first (armed target), a click on a PDF widget must bind
     * to that exact key — not jump to whichever canonical key currently owns the widget. Otherwise
     * preset fields (e.g. top_deck_front) steal focus from companion text keys (top_deck_front_other)
     * when the same physical widget was previously linked to the preset or ownership overlaps.
     */
    const armed = activeSetupFieldKey;
    const preferAssignToArmedField =
      armed != null && knownMappingKeys.length >= 1 && !knownMappingKeys.includes(armed);

    if (knownMappingKeys.length >= 1 && !preferAssignToArmedField) {
      const k0 = knownMappingKeys[0]!;
      if (acroSelection.keys.includes(toggleKey) && acroSelection.activeKey === toggleKey) {
        setAcroSelection((prev) => {
          const nextKeys = prev.keys.filter((k) => k !== toggleKey);
          return { keys: nextKeys, activeKey: nextKeys[nextKeys.length - 1] ?? null };
        });
        if (activeSetupFieldKey === k0) {
          setActiveSetupFieldKey(null);
          setShowCreateFieldForm(false);
          setCreateFieldEditKey(null);
          setPendingGroupedSourceKeys(null);
          clearGroupedEditorState();
          setSetupFieldFormScope("new");
          setEditorMode("idle");
        }
        syncPendingChipFromMappedWidget(k0);
        setShowAddMappingForm(false);
        setStatus(null);
        return;
      }
      setActiveSetupFieldKey(k0);
      setAcroSelection({ keys: [toggleKey], activeKey: toggleKey });
      setShowAddMappingForm(false);
      setPendingGroupedSourceKeys(null);
      setSetupFieldFormScope(customFieldKeySet.has(k0) ? "custom" : "template");
      openEditSetupFieldUnified(k0);
      syncPendingChipFromMappedWidget(k0);
      setEditorMode("editSetupField");
      setStatus(null);
      return;
    }

    const focusKey = activeSetupFieldKey;
    if (focusKey) {
      const gk = effectiveWidgetGroupKind(focusKey);
      const opts = gk ? chipOptionsForField(focusKey) : [];
      const needsOptionChip = Boolean(gk && opts.length > 0);

      if (needsOptionChip) {
        if (pendingGroupOption && opts.includes(pendingGroupOption)) {
          assignGroupPdfWidget(pdfFieldName, instanceIndex, pendingGroupOption);
          return;
        }
        setStatus("Pick an option chip in the catalog, then click this PDF widget again.");
        setShowAddMappingForm(false);
        setShowCreateFieldForm(false);
        setEditorMode("editSetupField");
        return;
      }

      applyWidgetToCanonicalKey(focusKey, pdfFieldName, instanceIndex);
      return;
    }

    setShowAddMappingForm(false);
    setShowCreateFieldForm(false);
    setCreateFieldEditKey(null);
    setPendingGroupedSourceKeys(null);
    clearGroupedEditorState();
    setSetupFieldFormScope("new");
    setPendingGroupOption(null);

    setAcroSelection((prev) => {
      const removing = prev.keys.includes(toggleKey);
      const nextKeys = removing ? prev.keys.filter((k) => k !== toggleKey) : [...prev.keys, toggleKey];
      const nextActive = !removing
        ? toggleKey
        : prev.activeKey === toggleKey
          ? nextKeys[0] ?? null
          : prev.activeKey;
      return { keys: nextKeys, activeKey: nextActive };
    });

    setEditorMode("sourceSelection");
    setStatus(null);
  }

  function bindToken(page: number, lineIndex: number, tokenIndex: number) {
    if (!activeSetupFieldKey) return;
    const anchor = anchorInput.trim();
    if (anchor) {
      const occ = Math.max(0, Math.min(50, Number.parseInt(occurrenceInput, 10) || 0));
      const rule: TextFieldMappingRule = {
        mode: "anchor_token",
        page,
        anchorContains: anchor,
        occurrence: occ,
        tokenIndex,
      };
      setFieldMappings((prev) => ({ ...prev, [activeSetupFieldKey]: rule }));
    } else {
      const rule: TextFieldMappingRule = {
        mode: "fixed_line_token",
        page,
        lineIndex,
        tokenIndex,
      };
      setFieldMappings((prev) => ({ ...prev, [activeSetupFieldKey]: rule }));
    }
  }






  function buildCalibrationPayload(mode: "update" | "saveAsNew") {
    const pageCount = structure?.pages.length ?? normalized.documentMeta?.pageCount ?? numPages;
    const trimmedName = name.trim() || "Setup sheet calibration";
    const parentCalibrationId = normalized.calibrationMeta?.parentCalibrationId ?? calibrationId;
    const mappingsForSave = sanitizeFormFieldMappingsForPersistence(
      formFieldMappings,
      knownCalibrationFieldKeys,
      setupSheetModelSchema,
      customFieldDefinitions
    );
    return {
      name: trimmedName,
      sourceType: sourceType.trim() || "awesomatix_pdf",
      exampleDocumentId: documentId.trim() || null,
      calibrationDataJson: {
        templateType: "pdf_form_fields" as const,
        calibrationMeta: {
          versionLabel: trimmedName,
          parentCalibrationId,
          clonedFromCalibrationId: mode === "saveAsNew" ? calibrationId : (normalized.calibrationMeta?.clonedFromCalibrationId ?? undefined),
        },
        documentMeta: {
          ...normalized.documentMeta,
          pageCount,
          lineGroupingEpsilon: epsilon,
          sourceWidthByPage: pdfPageSize ? { [String(currentPage)]: pdfPageSize.width } : normalized.documentMeta?.sourceWidthByPage,
          sourceHeightByPage: pdfPageSize ? { [String(currentPage)]: pdfPageSize.height } : normalized.documentMeta?.sourceHeightByPage,
        },
        formFieldMappings: mappingsForSave,
        fieldMappings,
        fields,
        sheetFields,
        customFieldDefinitions,
        fieldDisplayOverrides,
      },
    };
  }

  async function save(opts?: { silent?: boolean }) {
    const silent = opts?.silent === true;
    setSaving(true);
    setStatus(null);
    try {
      const payload = buildCalibrationPayload("update");
      const res = await fetch(`/api/setup-calibrations/${calibrationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus(data.error || "Failed to save calibration");
        return;
      }
      setSavedCalibrationSnapshot(calibrationDirtySnapshot);
      if (!silent) {
        setFormFieldMappings(
          sanitizeFormFieldMappingsForPersistence(
            formFieldMappings,
            knownCalibrationFieldKeys,
            setupSheetModelSchema,
            customFieldDefinitions
          )
        );
        setStatus("Calibration saved.");
        router.refresh();
      }
    } catch {
      setStatus("Failed to save calibration");
    } finally {
      setSaving(false);
    }
  }

  async function saveAsNewVersion() {
    setSavingAsNew(true);
    setStatus(null);
    try {
      const payload = {
        ...buildCalibrationPayload("saveAsNew"),
        clonedFromCalibrationId: calibrationId,
        // Without this the copy lands unlinked and can't be mapped (it has no parameter list).
        setupSheetModelId: initialSetupSheetModelId ?? null,
      };
      const res = await fetch("/api/setup-calibrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setStatus(data.error || "Failed to save as new version");
        return;
      }
      setStatus("Created new calibration version.");
      router.push(`/setup-calibrations/${data.id}`);
      router.refresh();
    } catch {
      setStatus("Failed to save as new version");
    } finally {
      setSavingAsNew(false);
    }
  }

  const linesForInspect = useMemo(() => {
    if (!structure) return [];
    const p = structure.pages.find((x) => x.pageNumber === inspectPage);
    if (!p) return [];
    const q = lineFilter.trim().toLowerCase();
    if (!q) return p.lines;
    return p.lines.filter((l) => l.text.toLowerCase().includes(q));
  }, [structure, inspectPage, lineFilter]);

  const filteredFormRows = useMemo(() => {
    return pdfFormRows.filter((row) => {
      const mapped = pdfFieldToAppKeys.has(row.name);
      if (formListFilter === "values") {
        const hasText = row.value.trim() !== "";
        const hasBool = row.booleanValue === true || row.booleanValue === false;
        return hasText || hasBool;
      }
      if (formListFilter === "unmapped") return !mapped;
      return true;
    });
  }, [pdfFormRows, formListFilter, pdfFieldToAppKeys]);

  const selectedAcroPdfRow = useMemo(() => {
    if (!selectedAcroField) return undefined;
    return pdfRowByName.get(selectedAcroField.pdfFieldName);
  }, [selectedAcroField, pdfRowByName]);

  const selectedAcroAppKeys = useMemo(() => {
    const out = new Set<string>();
    for (const k of acroSelection.keys) {
      const ref = parseAcroKey(k);
      const row = pdfRowByName.get(ref.pdfFieldName);
      for (const appKey of findAppKeysForWidget(formFieldMappings, ref.pdfFieldName, ref.instanceIndex, row)) {
        out.add(appKey);
      }
    }
    return [...out];
  }, [acroSelection.keys, formFieldMappings, pdfRowByName]);


  const unmappedCanonicalKeys = useMemo(() => {
    return sortedCatalog.map((f) => f.key).filter((k) => !formFieldMappings[k]);
  }, [sortedCatalog, formFieldMappings]);

  useEffect(() => {
    const first = unmappedCanonicalKeys[0];
    if (first) setLinkTargetCanonicalKey(first);
  }, [unmappedCanonicalKeys]);

  useEffect(() => {
    if (selectedAcroAppKeys.length === 1) setNewMappingCanonicalKey(selectedAcroAppKeys[0]!);
  }, [acroSelection.activeKey, selectedAcroAppKeys]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = tab === "form" ? formPdfContainerRef.current : tab === "sheet" ? sheetPdfContainerRef.current : null;
    if (!el) return;

    function commitWidth(w: number) {
      const clamped = Math.max(520, Math.min(1600, Math.floor(w)));
      setPdfRenderWidth((prev) => (Math.abs(prev - clamped) > 2 ? clamped : prev));
    }

    commitWidth(el.clientWidth);

    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        const width = entry?.contentRect?.width ?? el.clientWidth;
        commitWidth(width);
      });
      ro.observe(el);
    } catch {
      // ignore
    }

    return () => {
      try {
        ro?.disconnect();
      } catch {
        /* ignore */
      }
    };
  }, [tab]);

  const selectedSheetField = useMemo(() => {
    if (!selectedSheetFieldId) return null;
    return sheetFields.find((f) => f.id === selectedSheetFieldId) ?? null;
  }, [selectedSheetFieldId, sheetFields]);

  function sheetOverlayColor(sourceType: CalibrationSheetField["sourceType"], selected: boolean, hovered: boolean): string {
    const base =
      sourceType === "text"
        ? "border-sky-400/90 bg-sky-400/15"
        : sourceType === "checkbox"
          ? "border-emerald-400/90 bg-emerald-400/15"
          : "border-fuchsia-400/90 bg-fuchsia-400/15";
    const sel = selected ? "ring-2 ring-amber-300/90" : "";
    const hov = hovered ? "ring-2 ring-amber-300/70" : "";
    return `${base} ${sel || hov}`.trim();
  }

  const sheetOverlaysForPage = useMemo((): PdfOverlayBox[] => {
    if (!pdfPageSize || !renderedPageSize) return [];
    const out: PdfOverlayBox[] = [];

    for (const f of sheetFields) {
      if (f.sourceType === "group") {
        for (const opt of f.options) {
          const pdfFieldName = opt.sourceName?.trim();
          if (!pdfFieldName) continue;
          const row = pdfRowByName.get(pdfFieldName);
          const widgets = row?.widgets ?? [];
          if (widgets.length === 0) continue;
          const w = opt.widgetInstanceIndex != null ? widgets.find((ww, wi) => (ww.instanceIndex ?? wi) === opt.widgetInstanceIndex) : widgets[0];
          if (!w) continue;
          if (w.pageNumber !== currentPage) continue;
          const instanceIndex = opt.widgetInstanceIndex ?? w.instanceIndex ?? 0;
          const left = (w.x / pdfPageSize.width) * renderedPageSize.width;
          const top = (w.y / pdfPageSize.height) * renderedPageSize.height;
          const width = Math.max((w.width / pdfPageSize.width) * renderedPageSize.width, 10);
          const height = Math.max((w.height / pdfPageSize.height) * renderedPageSize.height, 10);
          out.push({
            key: `sf:${f.id}:opt:${opt.id}`,
            pageNumber: currentPage,
            left,
            top,
            width,
            height,
            colorClass: sheetOverlayColor("group", selectedSheetFieldId === f.id, hoveredSheetOverlayId === f.id),
            title: `${f.canonicalFieldKey || "—"} · group · ${opt.optionValue || "—"} · ${pdfFieldName}`,
            sheetFieldId: f.id,
            pdfFieldName,
            instanceIndex,
          });
        }
        continue;
      }

      const pdfFieldName = String((f as any).sourceName ?? "").trim();
      if (!pdfFieldName) continue;
      const row = pdfRowByName.get(pdfFieldName);
      const widgets = row?.widgets ?? [];
      if (widgets.length === 0) continue;
      const w = widgets.find((ww) => ww.pageNumber === currentPage) ?? widgets[0];
      if (!w || w.pageNumber !== currentPage) continue;
      const instanceIndex = w.instanceIndex ?? 0;
      const left = (w.x / pdfPageSize.width) * renderedPageSize.width;
      const top = (w.y / pdfPageSize.height) * renderedPageSize.height;
      const width = Math.max((w.width / pdfPageSize.width) * renderedPageSize.width, 10);
      const height = Math.max((w.height / pdfPageSize.height) * renderedPageSize.height, 10);
      out.push({
        key: `sf:${f.id}`,
        pageNumber: currentPage,
        left,
        top,
        width,
        height,
        colorClass: sheetOverlayColor(f.sourceType, selectedSheetFieldId === f.id, hoveredSheetOverlayId === f.id),
        title: `${f.canonicalFieldKey || "—"} · ${f.sourceType} · ${pdfFieldName}`,
        sheetFieldId: f.id,
        pdfFieldName,
        instanceIndex,
      });
    }

    return out;
  }, [
    currentPage,
    hoveredSheetOverlayId,
    pdfPageSize,
    pdfRowByName,
    renderedPageSize,
    selectedSheetFieldId,
    sheetFields,
  ]);


  return (
    <section className="page-body">
      <CardPanel contentClassName="p-3">
        <div className="flex flex-wrap items-center gap-3">
          {modelLinkedMode && modelProgress ? (
            <>
              <span className="font-mono text-xs tabular-nums text-foreground">
                {modelProgress.mapped}
                <span className="text-muted-foreground"> / {modelProgress.total} mapped</span>
              </span>
              <div className="h-1 w-44 max-w-full overflow-hidden rounded bg-border">
                <div
                  className="h-full rounded bg-primary transition-[width] duration-300"
                  style={{
                    width: `${modelProgress.total ? Math.round((modelProgress.mapped / modelProgress.total) * 100) : 0}%`,
                  }}
                />
              </div>
            </>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              {formCount} form · {textCount} text · {regionCount} region
            </span>
          )}
          <span
            className={`text-xs ${
              saving ? "text-muted-foreground" : calibrationDirty ? "text-amber-200/90" : "text-emerald-300"
            }`}
          >
            {saving ? "Saving…" : calibrationDirty ? "Unsaved edits" : "Saved"}
          </span>
          {status ? <span className="text-xs text-muted-foreground">{status}</span> : null}
          <button
            type="button"
            className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
            onClick={() => setSettingsOpen((o) => !o)}
          >
            {settingsOpen ? "Close settings" : "Settings"}
          </button>
        </div>
        {settingsOpen ? (
          <div className="mt-3 space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="min-w-[18rem] rounded-md border border-border bg-muted/60 px-2 py-1.5 text-xs"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Calibration name / version"
              />
              <input
                className="rounded-md border border-border bg-muted/60 px-2 py-1.5 font-mono text-xs"
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                placeholder="Source type"
              />
              <button
                type="button"
                className="rounded-md border border-border bg-muted/60 px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save now"}
              </button>
              <button
                type="button"
                className="rounded-md border border-accent/60 bg-accent/10 px-3 py-1.5 text-xs hover:bg-accent/20 disabled:opacity-60"
                onClick={saveAsNewVersion}
                disabled={savingAsNew || saving}
              >
                {savingAsNew ? "Saving copy…" : "Save as new version"}
              </button>
            </div>
        <div
          ref={examplePdfSectionRef}
          className="mt-2 rounded-md border border-border/70 bg-muted/25 px-3 py-2 text-[11px]"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 font-medium text-muted-foreground">Example PDF</span>
            {documentId ? (
              <span className="min-w-0 truncate text-foreground" title={linkedExampleFilename || documentId}>
                {linkedExampleFilename || documentId}
              </span>
            ) : (
              <span className="text-amber-200/90">None linked — form preview and field values need a PDF.</span>
            )}
            <button
              type="button"
              className="rounded border border-border bg-card px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
              onClick={() => {
                setAttachListOpen((o) => !o);
                if (!attachListOpen) void loadPdfCandidates();
              }}
              disabled={attachLinking}
            >
              {attachListOpen ? "Close picker" : documentId ? "Change…" : "Link PDF…"}
            </button>
            <Link href="/setup-documents" className="text-xs text-accent hover:text-accent/80">
              Upload PDF
            </Link>
          </div>
          {attachListOpen ? (
            <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
              {attachListLoading ? (
                <div className="text-muted-foreground">Loading your PDFs…</div>
              ) : attachCandidates.length === 0 ? (
                <div className="text-muted-foreground">
                  No PDFs found.{" "}
                  <Link href="/setup-documents" className="text-accent hover:text-accent/80">
                    Upload one
                  </Link>{" "}
                  (bulk-import PDFs are included here).
                </div>
              ) : (
                <label className="flex flex-col gap-1 text-muted-foreground">
                  <span className="ui-title text-[10px]">Choose document</span>
                  <select
                    className="max-w-full rounded border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground"
                    disabled={attachLinking}
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v) void linkExampleDocument(v);
                    }}
                  >
                    <option value="">{attachLinking ? "Linking…" : "Select a PDF…"}</option>
                    {attachCandidates.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.originalFilename}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                className="text-[10px] text-muted-foreground underline hover:text-foreground"
                onClick={() => void loadPdfCandidates()}
                disabled={attachListLoading || attachLinking}
              >
                Refresh list
              </button>
            </div>
          ) : null}
        </div>
          </div>
        ) : null}
      </CardPanel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr]">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
                  onClick={() => void loadPdfFormFields()}
                  disabled={pdfFormLoading || !documentId}
                >
                  {pdfFormLoading ? "Loading…" : "Reload fields"}
                </button>
                {numPages > 1 ? (
                  <>
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 disabled:opacity-50"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage <= 1}
                    >
                      Prev
                    </button>
                    <span className="text-muted-foreground">
                      Page {currentPage} / {numPages}
                    </span>
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 disabled:opacity-50"
                      onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                      disabled={currentPage >= numPages}
                    >
                      Next
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            {!documentId ? (
              <div className="space-y-2 rounded border border-border/70 bg-muted/40 px-3 py-6 text-xs text-muted-foreground">
                <div>No example PDF is linked to this calibration.</div>
                <button
                  type="button"
                  className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-muted"
                  onClick={openExamplePdfPicker}
                >
                  Link example PDF…
                </button>
              </div>
            ) : pdfFormMeta?.loadError && pdfFormRows.length === 0 ? (
              <div className="space-y-2 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-3 text-xs text-rose-200">
                <div>Could not read PDF form fields.</div>
                <div className="font-mono text-[10px]">{pdfFormMeta.loadError}</div>
              </div>
            ) : !previewUrl ? (
              <div className="rounded border border-border/70 bg-muted/40 px-3 py-6 text-xs text-muted-foreground">
                No PDF preview URL — attach an example PDF to use the widget overlay.
              </div>
            ) : (
              <>
                {!pdfFormMeta?.hasFormFields && !pdfFormLoading ? (
                  <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                    {modelLinkedMode
                      ? "No AcroForm fields found in this PDF. Link a different example PDF that has fillable form fields."
                      : (
                        <>
                          No AcroForm fields found. Use <strong>Printed text</strong> or <strong>Regions</strong> (fallback
                          tabs).
                        </>
                      )}
                  </div>
                ) : null}
                <div
                  ref={formPdfContainerRef}
                  className="relative min-h-[50vh] overflow-auto rounded border border-border bg-muted/30"
                  onMouseLeave={() => setHoveredFormOverlayKey(null)}
                >
                  <PdfPreviewClient
                    fileUrl={resolvedFileUrl || previewUrl}
                    pageNumber={currentPage}
                    width={pdfRenderWidth}
                    renderAnnotationLayer={false}
                    error={
                      <div className="space-y-2 px-3 py-4 text-xs">
                        <div className="text-rose-300">Failed to load PDF file.</div>
                        {process.env.NODE_ENV === "development" ? (
                          <div className="space-y-1 text-muted-foreground">
                            <div>URL: {resolvedFileUrl || previewUrl || "—"}</div>
                            {pdfLoadDetail ? (
                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-muted/40 p-2 font-mono text-[10px]">
                                {pdfLoadDetail}
                              </pre>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    }
                    onSourceError={(err) => {
                      const msg = err instanceof Error ? err.message : String(err);
                      setPdfLoadDetail(`Source error: ${msg}`);
                    }}
                    onLoadError={(err) => {
                      const msg = err instanceof Error ? err.message : String(err);
                      setPdfLoadDetail((prev) => `${prev ? `${prev}\n` : ""}Load error: ${msg}`);
                    }}
                    onDocumentLoadSuccess={({ numPages: loadedPages }) => {
                      setPdfLoadDetail(null);
                      setNumPages(loadedPages);
                      setCurrentPage((p) => Math.min(Math.max(p, 1), loadedPages));
                    }}
                    onPageLoadSuccess={(page) => {
                      const viewport = page.getViewport({ scale: 1 });
                      setPdfPageSize({ width: viewport.width, height: viewport.height });
                      const renderedWidth = pdfRenderWidth;
                      const renderedHeight = viewport.height * (renderedWidth / viewport.width);
                      setRenderedPageSize({ width: renderedWidth, height: renderedHeight });
                    }}
                  />
                  {pdfPageSize && renderedPageSize
                    ? pdfFormRows.flatMap((row) => {
                        const widgets = row.widgets ?? [];
                        return widgets
                          .map((w, wi) => ({ row, w, wi }))
                          .filter(({ w }) => w.pageNumber === currentPage);
                      }).map(({ row, w, wi }) => {
                        const instanceIndex = w.instanceIndex ?? wi;
                        const overlayKey = `${row.name}#${instanceIndex}`;
                        const isMapped = mappedWidgetKeys.has(overlayKey);
                        const isInstanceSelected = acroSelection.keys.includes(overlayKey);
                        const isHovered = hoveredFormOverlayKey === overlayKey;
                        const left = (w.x / pdfPageSize.width) * renderedPageSize.width;
                        const top = (w.y / pdfPageSize.height) * renderedPageSize.height;
                        const width = Math.max((w.width / pdfPageSize.width) * renderedPageSize.width, 10);
                        const height = Math.max((w.height / pdfPageSize.height) * renderedPageSize.height, 10);
                        const chk = w.checked === true ? "on" : w.checked === false ? "off" : "";
                        return (
                          <button
                            key={overlayKey}
                            type="button"
                            title={`${row.name} #${instanceIndex} (${row.type})${chk ? ` · ${chk}` : ""}`}
                            onMouseEnter={() => setHoveredFormOverlayKey(overlayKey)}
                            onClick={() => onAcroWidgetClick(row.name, instanceIndex)}
                            className={`absolute box-border rounded-sm border-2 transition-colors ${
                              isInstanceSelected
                                ? "z-20 border-amber-300 bg-amber-400/30 ring-2 ring-amber-300 ring-offset-1"
                                : isMapped
                                  ? "z-[2] border-emerald-500/85 bg-emerald-500/15"
                                  : "z-[1] border-sky-500/45 bg-sky-500/10"
                            } ${isHovered && !isInstanceSelected ? "ring-1 ring-amber-200/70" : ""} `}
                            style={{ left, top, width, height }}
                          />
                        );
                      })
                    : null}
                </div>
                {!modelLinkedMode ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    For grouped fields: in the catalog, pick an option button (blue = active), then the PDF. The button stays
                    blue when that option is linked.
                  </p>
                ) : null}
                <div className="mt-3 border-t border-border pt-2">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded px-1 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => setFormFieldListOpen((o) => !o)}
                  >
                    <span>Field list (same as PDF)</span>
                    <span className="text-[10px]">{formFieldListOpen ? "▼" : "▶"}</span>
                  </button>
                  {formFieldListOpen ? (
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        <span className="text-muted-foreground">Show:</span>
                        {(["all", "values", "unmapped"] as const).map((f) => (
                          <button
                            key={f}
                            type="button"
                            className={`rounded border px-2 py-0.5 capitalize ${formListFilter === f ? "border-sky-500/60 bg-sky-500/10" : "border-border"}`}
                            onClick={() => setFormListFilter(f)}
                          >
                            {f === "values" ? "non-empty values" : f}
                          </button>
                        ))}
                      </div>
                      <div className="max-h-[28vh] space-y-2 overflow-auto rounded border border-border/60 bg-muted/20 p-2">
                        {filteredFormRows.length === 0 ? (
                          <div className="text-xs text-muted-foreground">No rows match this filter.</div>
                        ) : (
                          filteredFormRows.map((row) => {
                            const mappedApps = pdfFieldToAppKeys.get(row.name) ?? [];
                            const isMapped = mappedApps.length > 0;
                            const hasWidgets = (row.widgets?.length ?? 0) > 0;
                            return (
                              <div
                                key={row.name}
                                className={`rounded border p-2 transition ${isMapped ? "ring-1 ring-emerald-500/40" : "border-border/60 bg-card/90"}`}
                              >
                                <div className="font-mono text-sm font-semibold tabular-nums text-foreground">
                                  {formatPdfFieldDisplayValue(row)}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                                  <span className="font-mono text-foreground/80">{row.name}</span>
                                  <span>·</span>
                                  <span>{row.type}</span>
                                  {row.pageNumber != null ? (
                                    <>
                                      <span>·</span>
                                      <span>p{row.pageNumber}</span>
                                    </>
                                  ) : null}
                                  {!hasWidgets ? (
                                    <>
                                      <span>·</span>
                                      <span className="text-amber-200/90">no bbox</span>
                                    </>
                                  ) : null}
                                </div>
                                {mappedApps.length ? (
                                  <div className="mt-1 text-[10px] font-medium text-emerald-300">→ {mappedApps.join(", ")}</div>
                                ) : (
                                  <div className="mt-1 text-[10px] text-muted-foreground">unmapped</div>
                                )}
                                {hasWidgets ? (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {(row.widgets ?? []).map((w, wi) => {
                                      const instanceIndex = w.instanceIndex ?? wi;
                                      const k = `${row.name}#${instanceIndex}`;
                                      const sel = acroSelection.keys.includes(k);
                                      const chk = w.checked === true ? "✓" : w.checked === false ? "·" : "";
                                      return (
                                        <button
                                          key={k}
                                          type="button"
                                          title={`#${instanceIndex} p${w.pageNumber} ${chk}`}
                                          onClick={() => onAcroWidgetClick(row.name, instanceIndex)}
                                          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                                            sel ? "border-amber-400/80 bg-amber-500/20" : "border-border bg-muted/50 hover:bg-muted"
                                          }`}
                                        >
                                          #{instanceIndex}
                                          {chk ? ` ${chk}` : ""}
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : null}
                                {row.readError ? (
                                  <div className="mt-1 text-[10px] text-rose-300">Read error: {row.readError}</div>
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>

        <CardPanel contentClassName="p-3">
          {modelLinkedMode && setupSheetModelSchema && initialSetupSheetModelId ? (
            <SetupCalibrationModelSidebar
              schema={setupSheetModelSchema}
              modelId={initialSetupSheetModelId}
              calibrationId={calibrationId}
              formFieldMappings={formFieldMappings}
              armedKey={armedKey}
              armedAssignments={armedAssignments}
              onArm={armParameter}
              onDisarm={disarmParameter}
              onCreateParameter={createSchemaParameter}
            />
          ) : null}
        </CardPanel>
      </div>


      {pdfMappingConflict ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pdf-map-conflict-title"
        >
          <SurfaceCard className="max-w-md shadow-lg" contentClassName="p-4">
            <div id="pdf-map-conflict-title" className="text-sm font-semibold text-foreground">
              PDF widget already in use
            </div>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              This PDF widget is already mapped elsewhere. Overwrite removes those references so only the new assignment
              remains.
            </p>
            <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-xs text-muted-foreground">
              {pdfMappingConflict.conflicts.map((c) => (
                <li key={`${c.canonicalKey}-${c.optionValue ?? ""}-${c.context}`}>
                  <span className="font-medium text-foreground">{mergedLabelMap[c.canonicalKey] ?? c.canonicalKey}</span>
                  <span className="font-mono text-[10px] text-foreground/80"> ({c.canonicalKey})</span>
                  {c.context ? <span> · {c.context}</span> : null}
                </li>
              ))}
            </ul>
            <div className="mt-2 text-xs text-muted-foreground">
              Assign to:{" "}
              <span className="font-medium text-foreground">
                {mergedLabelMap[pdfMappingConflict.targetCanonicalKey] ?? pdfMappingConflict.targetCanonicalKey}
              </span>
              <span className="font-mono text-[10px] text-foreground/80"> ({pdfMappingConflict.targetCanonicalKey})</span>
              {pdfMappingConflict.kind === "groupChip" ? (
                <span className="font-mono"> · stored value {pdfMappingConflict.optionValue}</span>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted"
                onClick={cancelPdfMappingConflict}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded border border-amber-500/60 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/25"
                onClick={confirmPdfMappingOverwrite}
              >
                Overwrite
              </button>
            </div>
          </SurfaceCard>
        </div>
      ) : null}
    </section>
  );
}

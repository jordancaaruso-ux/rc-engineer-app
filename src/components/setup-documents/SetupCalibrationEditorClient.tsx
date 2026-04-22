"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { A800RR_FIELD_CATALOG } from "@/lib/setupDocuments/fieldMap";
import type {
  CalibrationFieldRegion,
  PdfFormFieldMappingRule,
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
  reservedTemplateKeys,
  suggestKeyFromPdfFieldName,
  validateCustomFieldKey,
} from "@/lib/setupCalibrations/customFieldCatalog";
import {
  applyCalibrationFieldRecipe,
  inferGroupedFieldDefaultsFromPdfNames,
  inferSectionAndDomainForNewCustomField,
} from "@/lib/setupCalibrations/calibrationCustomFieldHints";
import { SetupFieldDefinitionForm } from "@/components/setup-documents/SetupFieldDefinitionForm";
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
  return rule.pdfFieldName;
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
}: {
  calibrationId: string;
  documentId: string;
  previewUrl: string;
  exampleDocumentOriginalFilename?: string | null;
  initialName: string;
  initialSourceType: string;
  initialCalibrationData: unknown;
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
  const [attachCandidates, setAttachCandidates] = useState<Array<{ id: string; originalFilename: string }>>([]);
  const [attachListLoading, setAttachListLoading] = useState(false);
  const [attachLinking, setAttachLinking] = useState(false);

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

  function updateSheetField(id: string, patch: Partial<CalibrationSheetField>) {
    setSheetFields((prev) => prev.map((f) => (f.id === id ? ({ ...f, ...patch } as any) : f)));
  }

  function deleteSheetField(id: string) {
    setSheetFields((prev) => prev.filter((f) => f.id !== id));
    setSelectedSheetFieldId((cur) => (cur === id ? null : cur));
    setDraftGroupFieldId((cur) => (cur === id ? null : cur));
  }

  function addGroupOption(fieldId: string) {
    setSheetFields((prev) =>
      prev.map((f) => {
        if (f.id !== fieldId) return f;
        if (f.sourceType !== "group") return f;
        return {
          ...f,
          options: [
            { id: newId("opt"), sourceName: "", optionValue: "", label: "", active: true },
            ...f.options,
          ],
        };
      })
    );
  }

  function updateGroupOption(fieldId: string, optId: string, patch: any) {
    setSheetFields((prev) =>
      prev.map((f) => {
        if (f.id !== fieldId) return f;
        if (f.sourceType !== "group") return f;
        return { ...f, options: f.options.map((o) => (o.id === optId ? { ...o, ...patch } : o)) };
      })
    );
  }

  function deleteGroupOption(fieldId: string, optId: string) {
    setSheetFields((prev) =>
      prev.map((f) => {
        if (f.id !== fieldId) return f;
        if (f.sourceType !== "group") return f;
        return { ...f, options: f.options.filter((o) => o.id !== optId) };
      })
    );
  }

  function duplicateSheetField(id: string) {
    const src = sheetFields.find((f) => f.id === id);
    if (!src) return;
    const nextId = newId("sf");
    const cloneBase = { ...src, id: nextId, label: src.label ? `${src.label} (copy)` : "" } as CalibrationSheetField;
    if (cloneBase.sourceType === "group") {
      cloneBase.options = cloneBase.options.map((o) => ({ ...o, id: newId("opt") }));
    }
    setSheetFields((prev) => [cloneBase, ...prev]);
    setSelectedSheetFieldId(nextId);
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
    const merged = mergeCustomFieldsIntoCatalog(A800RR_FIELD_CATALOG, customFieldDefinitions);
    return [...merged].sort((a, b) => {
      const ia = TEMPLATE_PRIORITY_FIELD_KEYS.indexOf(a.key as (typeof TEMPLATE_PRIORITY_FIELD_KEYS)[number]);
      const ib = TEMPLATE_PRIORITY_FIELD_KEYS.indexOf(b.key as (typeof TEMPLATE_PRIORITY_FIELD_KEYS)[number]);
      const na = ia === -1 ? 9999 : ia;
      const nb = ib === -1 ? 9999 : ib;
      if (na !== nb) return na - nb;
      if (a.groupTitle !== b.groupTitle) return a.groupTitle.localeCompare(b.groupTitle);
      return a.label.localeCompare(b.label);
    });
  }, [customFieldDefinitions]);

  const pdfRowByName = useMemo(() => {
    const m = new Map<string, PdfFormFieldRow>();
    for (const row of pdfFormRows) m.set(row.name, row);
    return m;
  }, [pdfFormRows]);

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

  /** Value + display label for chip buttons (custom options can show optionLabel). */
  function chipOptionEntriesForField(fieldKey: string | null): Array<{ value: string; label: string }> {
    if (!fieldKey) return [];
    const def = customFieldByKey.get(fieldKey);
    const custom = customFieldGroupedChipContext(def);
    if (custom) return custom.entries;
    return baseCatalogChipOptionValues(fieldKey).map((v) => ({ value: v, label: v }));
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
    existingOptions?: GroupedFieldOptionDefinition[]
  ) {
    const existingBySource = new Map((existingOptions ?? []).map((o) => [o.sourceKey, o] as const));
    const drafts: Record<string, { optionLabel: string; optionValue: string; notes: string }> = {};
    sourceKeys.forEach((k) => {
      const ref = parseAcroKey(k);
      const row = pdfRowByName.get(ref.pdfFieldName);
      const fallbackName = row?.name ?? ref.pdfFieldName;
      const existing = existingBySource.get(k);
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
      setGroupedMappingPanelMode("table");
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
    setCreateFieldEditKey(null);
    setCreateFieldError(null);
    setActiveSetupFieldKey(null);
    setSetupFieldFormScope("new");
    setEditorMode("createGroupedField");
    setPendingGroupedSourceKeys([...keys]);
    setShowAddMappingForm(false);
    setShowCreateFieldForm(true);
    setPendingGroupOption(null);
    const names = keys.map((k) => {
      const ref = parseAcroKey(k);
      return pdfRowByName.get(ref.pdfFieldName)?.name ?? ref.pdfFieldName;
    });
    const groupedInfer = inferGroupedFieldDefaultsFromPdfNames(names);
    initGroupedEditorFromSources(keys, groupedInfer.groupBehaviorType);
    const first = parseAcroKey(keys[0]!);
    const row = pdfRowByName.get(first.pdfFieldName);
    setCfKey(suggestKeyFromPdfFieldName(names.join("_").slice(0, 64) || row?.name || "group_field"));
    setCfLabel(groupedInfer.labelSuggestion);
    setCfUiType(groupedInfer.groupBehaviorType === "visualMulti" ? "multiSelect" : "select");
    setCfValueType(groupedInfer.groupBehaviorType === "visualMulti" ? "multi" : "string");
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

  function openCreateFieldFromSelection() {
    if (acroSelection.keys.length >= 2) {
      beginCreateGroupedFromSelection();
      return;
    }
    if (!selectedAcroField) return;
    setActiveSetupFieldKey(null);
    setPendingGroupedSourceKeys(null);
    clearGroupedEditorState();
    setSetupFieldFormScope("new");
    setEditorMode("createSingleField");
    setCreateFieldEditKey(null);
    setCreateFieldError(null);
    const row = selectedAcroPdfRow;
    const nameHint = row?.name ?? "";
    const inferredPlacement = inferSectionAndDomainForNewCustomField(nameHint);
    setCfKey(suggestKeyFromPdfFieldName(nameHint || "field"));
    setCfLabel(nameHint ? nameHint.replace(/_/g, " ") : "");
    const uiBase = inferUiTypeFromAcroType(row?.type ?? "Text");
    const looksLikeDate = /date|datum|time|event/i.test(nameHint);
    if (uiBase === "text" && looksLikeDate) {
      setCfUiType("date");
      setCfValueType("date");
    } else {
      setCfUiType(uiBase);
      setCfValueType(uiBase === "checkbox" || uiBase === "groupOption" ? "boolean" : "string");
    }
    setCfFieldDomain(inferredPlacement.fieldDomain);
    setCfIsMetadata(inferredPlacement.isMetadata);
    setCfSectionId(inferredPlacement.sectionId);
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
    setShowCreateFieldForm(true);
    setShowAddMappingForm(false);
  }

  /** Catalog click: same as mapped PDF — highlight source + open the unified setup field editor. */
  function selectCanonicalField(key: string) {
    if (activeSetupFieldKey === key) {
      clearActiveSetupFieldEditor();
      return;
    }
    setActiveSetupFieldKey(key);
    setPendingGroupOption(null);
    setPendingGroupedSourceKeys(null);
    setShowAddMappingForm(false);
    setCreateFieldError(null);
    setEditorMode("editSetupField");
    const rule = formFieldMappings[key];
    const ref = resolveAcroFromCanonicalKey(key, rule);
    if (ref) {
      const ak = acroSourceKey(ref);
      setAcroSelection({ keys: [ak], activeKey: ak });
    } else {
      setAcroSelection({ keys: [], activeKey: null });
    }
    openEditSetupFieldUnified(key);
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

  function commitCreateField() {
    setCreateFieldError(null);
    const reserved = reservedTemplateKeys();

    if (setupFieldFormScope === "template" && activeSetupFieldKey) {
      const key = activeSetupFieldKey;
      const opt = mergedSectionOptions.find((o) => o.id === cfSectionId);
      setFieldDisplayOverrides((prev) => {
        const next = { ...prev };
        const cur: FieldDisplayOverride = { ...(next[key] ?? {}) };
        if (cfShowInSetupSheet) delete cur.showInSetupSheet;
        else cur.showInSetupSheet = false;
        if (cfShowInAnalysis) delete cur.showInAnalysis;
        else cur.showInAnalysis = false;
        if (cfSectionId.trim()) {
          cur.sheetGroupId = cfSectionId.trim();
          cur.sheetGroupTitle = opt?.title ?? cfSectionId;
        } else {
          delete cur.sheetGroupId;
          delete cur.sheetGroupTitle;
        }
        if (Object.keys(cur).length === 0) delete next[key];
        else next[key] = cur;
        return next;
      });
      if (groupedEditorSourceKeys && groupedEditorSourceKeys.length >= 2) {
        const groupedPayload = buildGroupedOptionsPayload(groupedEditorSourceKeys);
        if (!groupedPayload) {
          setCreateFieldError("Each grouped option needs a unique label and value.");
          return;
        }
        const groupedRule = buildGroupedFormMappingFromPayload(groupBehaviorType, groupedPayload);
        if (!groupedRule) {
          setCreateFieldError("Grouped fields require at least two valid source options.");
          return;
        }
        setFormFieldMappings((prev) => ({ ...prev, [key]: groupedRule }));
      }
      setStatus("Saved calibration field preferences.");
      setShowCreateFieldForm(false);
      setSetupFieldFormScope("new");
      setEditorMode("editSetupField");
      return;
    }

    if (createFieldEditKey) {
      if (!cfLabel.trim()) {
        setCreateFieldError("Display label is required.");
        return;
      }
      const section =
        mergedSectionOptions.find((o) => o.id === cfSectionId)
        ?? CUSTOM_FIELD_SECTION_PRESETS.find((p) => p.id === cfSectionId)
        ?? CUSTOM_FIELD_SECTION_PRESETS[CUSTOM_FIELD_SECTION_PRESETS.length - 1]!;
      if (cfUiType === "groupOption" && !cfGroupKey.trim()) {
        setCreateFieldError("Group key is required for group option fields.");
        return;
      }
      if ((cfUiType === "checkbox" || cfUiType === "groupOption") && !String(cfCheckedValue ?? "").trim()) {
        setCreateFieldError("Checked value is required for checkbox-style fields.");
        return;
      }
      const oldKey = createFieldEditKey;
      const groupedPayloadForEdit =
        groupedEditorSourceKeys && groupedEditorSourceKeys.length >= 2
          ? buildGroupedOptionsPayload(groupedEditorSourceKeys)
          : null;
      if (groupedEditorSourceKeys && groupedEditorSourceKeys.length >= 2 && !groupedPayloadForEdit) {
        setCreateFieldError("Each grouped option needs a unique label and value.");
        return;
      }
      const groupedRuleForEdit =
        groupedPayloadForEdit ? buildGroupedFormMappingFromPayload(groupBehaviorType, groupedPayloadForEdit) : null;
      if (groupedPayloadForEdit && !groupedRuleForEdit) {
        setCreateFieldError("Grouped fields require at least two valid source options.");
        return;
      }
      const existingIds = new Set(customFieldDefinitions.map((c) => c.key));
      existingIds.delete(oldKey);
      const keyErr = validateCustomFieldKey(cfKey, reserved, existingIds);
      if (keyErr) {
        setCreateFieldError(keyErr);
        return;
      }
      const targetKey = cfKey.trim();
      const existingDef = customFieldDefinitions.find((c) => c.key === oldKey);
      if (!existingDef) {
        setCreateFieldError("Could not find field to update.");
        return;
      }
      const def: CustomSetupFieldDefinition = {
        ...existingDef,
        key: targetKey,
        displayLabel: cfLabel.trim(),
        sectionId: section.id,
        sectionTitle: section.title,
        fieldDomain: cfFieldDomain,
        valueType: cfValueType,
        uiType: cfUiType,
        isMetadata: cfIsMetadata,
        showInSetupSheet: cfShowInSetupSheet,
        showInAnalysis: cfShowInAnalysis,
        isPdfExportable: cfPdfExportable,
        sortOrder: cfSortOrder,
        unit: cfUnit.trim() || undefined,
        subsectionId: cfSubsectionId.trim() || undefined,
        layoutPlacement: cfLayoutPlacement === "none" ? undefined : cfLayoutPlacement,
        pairGroupId: cfPairGroupId.trim() || undefined,
        checkedValue: cfUiType === "checkbox" || cfUiType === "groupOption" ? cfCheckedValue : undefined,
        uncheckedValue: cfUiType === "checkbox" || cfUiType === "groupOption" ? cfUncheckedValue : undefined,
        groupKey: cfUiType === "groupOption" ? cfGroupKey.trim() : undefined,
        optionValue: cfUiType === "groupOption" ? cfOptionValue.trim() || undefined : undefined,
        groupBehaviorType: normalizeGroupedBehaviorForStorage(
          groupBehaviorType,
          Boolean(groupedEditorSourceKeys && groupedEditorSourceKeys.length >= 2)
        ),
        groupedOptions:
          groupedEditorSourceKeys && groupedEditorSourceKeys.length >= 2
            ? (groupedPayloadForEdit ?? undefined)
            : undefined,
        notes: cfNotes.trim() || undefined,
      };
      setCustomFieldDefinitions((prev) => prev.map((c) => (c.key === oldKey ? def : c)));
      if (targetKey !== oldKey) {
        setFormFieldMappings((prev) => {
          const rule = prev[oldKey];
          if (!rule) return prev;
          const next = { ...prev };
          delete next[oldKey];
          next[targetKey] = rule;
          return next;
        });
        setFieldMappings((prev) => {
          const rule = prev[oldKey];
          if (!rule) return prev;
          const next = { ...prev };
          delete next[oldKey];
          next[targetKey] = rule;
          return next;
        });
        setFields((prev) => {
          const region = prev[oldKey];
          if (!region) return prev;
          const next = { ...prev };
          delete next[oldKey];
          next[targetKey] = region;
          return next;
        });
        setActiveSetupFieldKey((cur) => (cur === oldKey ? targetKey : cur));
      }
      setCreateFieldEditKey(null);
      setShowCreateFieldForm(false);
      if (groupedRuleForEdit) {
        setFormFieldMappings((prev) => ({ ...prev, [targetKey]: groupedRuleForEdit }));
      }
      setStatus("Updated setup field.");
      return;
    }

    if (pendingGroupedSourceKeys && pendingGroupedSourceKeys.length >= 2) {
      const existing = new Set(customFieldDefinitions.map((c) => c.key));
      const err = validateCustomFieldKey(cfKey, reserved, existing);
      if (err) {
        setCreateFieldError(err);
        return;
      }
      if (!cfLabel.trim()) {
        setCreateFieldError("Display label is required.");
        return;
      }
      const section =
        mergedSectionOptions.find((o) => o.id === cfSectionId)
        ?? CUSTOM_FIELD_SECTION_PRESETS.find((p) => p.id === cfSectionId)
        ?? CUSTOM_FIELD_SECTION_PRESETS[CUSTOM_FIELD_SECTION_PRESETS.length - 1]!;
      if (cfUiType === "groupOption" && !cfGroupKey.trim()) {
        setCreateFieldError("Group key is required for group option fields.");
        return;
      }
      if ((cfUiType === "checkbox" || cfUiType === "groupOption") && !String(cfCheckedValue ?? "").trim()) {
        setCreateFieldError("Checked value is required for checkbox-style fields.");
        return;
      }
      const groupedPayload = buildGroupedOptionsPayload(pendingGroupedSourceKeys);
      if (!groupedPayload) {
        setCreateFieldError("Each grouped option needs a unique label and value.");
        return;
      }
      const groupedRule = buildGroupedFormMappingFromPayload(groupBehaviorType, groupedPayload);
      if (!groupedRule) {
        setCreateFieldError("Grouped fields require at least two valid source options.");
        return;
      }
      const def: CustomSetupFieldDefinition = {
        id: newId("cf"),
        key: cfKey.trim(),
        displayLabel: cfLabel.trim(),
        sectionId: section.id,
        sectionTitle: section.title,
        fieldDomain: cfFieldDomain,
        valueType: cfValueType,
        uiType: cfUiType,
        isMetadata: cfIsMetadata,
        showInSetupSheet: cfShowInSetupSheet,
        showInAnalysis: cfShowInAnalysis,
        isPdfExportable: cfPdfExportable,
        sortOrder: cfSortOrder,
        unit: cfUnit.trim() || undefined,
        subsectionId: cfSubsectionId.trim() || undefined,
        layoutPlacement: cfLayoutPlacement === "none" ? undefined : cfLayoutPlacement,
        pairGroupId: cfPairGroupId.trim() || undefined,
        checkedValue: cfUiType === "checkbox" || cfUiType === "groupOption" ? cfCheckedValue : undefined,
        uncheckedValue: cfUiType === "checkbox" || cfUiType === "groupOption" ? cfUncheckedValue : undefined,
        groupKey: cfUiType === "groupOption" ? cfGroupKey.trim() : undefined,
        optionValue: cfUiType === "groupOption" ? cfOptionValue.trim() || undefined : undefined,
        groupBehaviorType: normalizeGroupedBehaviorForStorage(groupBehaviorType, true),
        groupedOptions: groupedPayload,
        notes: cfNotes.trim() || undefined,
      };
      setCustomFieldDefinitions((prev) => [...prev, def]);
      setFormFieldMappings((prev) => ({
        ...prev,
        [def.key]: groupedRule,
      }));
      initGroupedEditorFromSources(pendingGroupedSourceKeys, groupBehaviorType, groupedPayload);
      setPendingGroupedSourceKeys(null);
      setAcroSelection({ keys: [], activeKey: null });
      setShowCreateFieldForm(false);
      setCreateFieldEditKey(null);
      setActiveSetupFieldKey(def.key);
      setSetupFieldFormScope("custom");
      setEditorMode("editSetupField");
      openEditCustomFieldForKey(def.key, def);
      setStatus("Created grouped setup field and mapping.");
      return;
    }

    if (!selectedAcroField) return;
    const existing = new Set(customFieldDefinitions.map((c) => c.key));
    const err = validateCustomFieldKey(cfKey, reserved, existing);
    if (err) {
      setCreateFieldError(err);
      return;
    }
    if (!cfLabel.trim()) {
      setCreateFieldError("Display label is required.");
      return;
    }
    const section =
      mergedSectionOptions.find((o) => o.id === cfSectionId)
      ?? CUSTOM_FIELD_SECTION_PRESETS.find((p) => p.id === cfSectionId)
      ?? CUSTOM_FIELD_SECTION_PRESETS[CUSTOM_FIELD_SECTION_PRESETS.length - 1]!;
    if (cfUiType === "groupOption" && !cfGroupKey.trim()) {
      setCreateFieldError("Group key is required for group option fields.");
      return;
    }
    if ((cfUiType === "checkbox" || cfUiType === "groupOption") && !String(cfCheckedValue ?? "").trim()) {
      setCreateFieldError("Checked value is required for checkbox-style fields.");
      return;
    }
    const def: CustomSetupFieldDefinition = {
      id: newId("cf"),
      key: cfKey.trim(),
      displayLabel: cfLabel.trim(),
      sectionId: section.id,
      sectionTitle: section.title,
      fieldDomain: cfFieldDomain,
      valueType: cfValueType,
      uiType: cfUiType,
      isMetadata: cfIsMetadata,
      showInSetupSheet: cfShowInSetupSheet,
      showInAnalysis: cfShowInAnalysis,
      isPdfExportable: cfPdfExportable,
      sortOrder: cfSortOrder,
      unit: cfUnit.trim() || undefined,
      subsectionId: cfSubsectionId.trim() || undefined,
      layoutPlacement: cfLayoutPlacement === "none" ? undefined : cfLayoutPlacement,
      pairGroupId: cfPairGroupId.trim() || undefined,
      checkedValue: cfUiType === "checkbox" || cfUiType === "groupOption" ? cfCheckedValue : undefined,
      uncheckedValue: cfUiType === "checkbox" || cfUiType === "groupOption" ? cfUncheckedValue : undefined,
      groupKey: cfUiType === "groupOption" ? cfGroupKey.trim() : undefined,
      optionValue: cfUiType === "groupOption" ? cfOptionValue.trim() || undefined : undefined,
      notes: cfNotes.trim() || undefined,
    };
    setCustomFieldDefinitions((prev) => [...prev, def]);
    applyWidgetToCanonicalKey(def.key, selectedAcroField.pdfFieldName, selectedAcroField.instanceIndex, def);
    setShowCreateFieldForm(false);
    setStatus("Created setup field and mapped.");
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

  /** Mapped click → edit setup field + highlight PDF. Unmapped → source multi-select only (toggle); clears editor. */
  function onAcroWidgetClick(pdfFieldName: string, instanceIndex: number) {
    const row = pdfRowByName.get(pdfFieldName);
    const mappingKeys = findAppKeysForWidget(formFieldMappings, pdfFieldName, instanceIndex, row);
    const toggleKey = acroSourceKey({ pdfFieldName, instanceIndex });

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
        setPendingGroupOption(null);
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
      armed != null && mappingKeys.length >= 1 && !mappingKeys.includes(armed);

    if (mappingKeys.length >= 1 && !preferAssignToArmedField) {
      const k0 = mappingKeys[0]!;
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
        setPendingGroupOption(null);
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
      setPendingGroupOption(null);
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

  function clearSelectedMapping() {
    if (!activeSetupFieldKey) return;
    setFormFieldMappings((prev) => {
      const next = { ...prev };
      delete next[activeSetupFieldKey];
      return next;
    });
    setFieldMappings((prev) => {
      const next = { ...prev };
      delete next[activeSetupFieldKey];
      return next;
    });
    setFields((prev) => {
      const next = { ...prev };
      delete next[activeSetupFieldKey];
      return next;
    });
    setPendingGroupOption(null);
    setAcroSelection({ keys: [], activeKey: null });
  }

  function mappingLabel(key: string): string {
    const parts: string[] = [];
    if (formFieldMappings[key]) parts.push("form");
    if (fieldMappings[key]) parts.push("text");
    if (fields[key]) parts.push("region");
    return parts.length ? parts.join("+") : "—";
  }

  function setTemplateFieldShowInSetupSheet(key: string, visible: boolean) {
    setFieldDisplayOverrides((prev) => {
      const next = { ...prev };
      const cur: FieldDisplayOverride = { ...next[key] };
      if (visible) delete cur.showInSetupSheet;
      else cur.showInSetupSheet = false;
      if (Object.keys(cur).length === 0) delete next[key];
      else next[key] = cur;
      return next;
    });
  }

  function setTemplateFieldShowInAnalysis(key: string, visible: boolean) {
    setFieldDisplayOverrides((prev) => {
      const next = { ...prev };
      const cur: FieldDisplayOverride = { ...next[key] };
      if (visible) delete cur.showInAnalysis;
      else cur.showInAnalysis = false;
      if (Object.keys(cur).length === 0) delete next[key];
      else next[key] = cur;
      return next;
    });
  }

  function setTemplateFieldSheetGroup(key: string, groupId: string | null, groupTitle: string | null) {
    setFieldDisplayOverrides((prev) => {
      const next = { ...prev };
      const cur: FieldDisplayOverride = { ...next[key] };
      if (!groupId) {
        delete cur.sheetGroupId;
        delete cur.sheetGroupTitle;
      } else {
        cur.sheetGroupId = groupId;
        cur.sheetGroupTitle = groupTitle ?? groupId;
      }
      if (Object.keys(cur).length === 0) delete next[key];
      else next[key] = cur;
      return next;
    });
  }

  function buildCalibrationPayload(mode: "update" | "saveAsNew") {
    const pageCount = structure?.pages.length ?? normalized.documentMeta?.pageCount ?? numPages;
    const trimmedName = name.trim() || "Setup sheet calibration";
    const parentCalibrationId = normalized.calibrationMeta?.parentCalibrationId ?? calibrationId;
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
        formFieldMappings,
        fieldMappings,
        fields,
        sheetFields,
        customFieldDefinitions,
        fieldDisplayOverrides,
      },
    };
  }

  async function save() {
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
      setStatus("Calibration saved.");
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

  function clearMappingsForSelectedAcroWidget() {
    if (!selectedAcroField) return;
    const row = pdfRowByName.get(selectedAcroField.pdfFieldName);
    setFormFieldMappings((prev) =>
      removePdfWidgetFromMappings(prev, selectedAcroField.pdfFieldName, selectedAcroField.instanceIndex, row)
    );
    setStatus(null);
  }

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

  function handleSheetCanvasClick(input: { pdfFieldName?: string; instanceIndex?: number }) {
    if (tool === "select") return;
    if (tool === "delete") {
      if (input.pdfFieldName && input.instanceIndex != null) {
        // If they clicked a widget overlay while deleting, prefer deleting selected sheet field.
        if (selectedSheetFieldId) deleteSheetField(selectedSheetFieldId);
      }
      return;
    }

    const pdfFieldName = input.pdfFieldName?.trim() ?? "";
    const instanceIndex = input.instanceIndex ?? 0;

    if (tool === "new_text") {
      const id = addSheetField("text", {
        sourceName: pdfFieldName,
        page: currentPage,
      } as any);
      setTool("select");
      setDraftGroupFieldId(null);
      setSelectedSheetFieldId(id);
      return;
    }

    if (tool === "new_checkbox") {
      const id = addSheetField("checkbox", {
        sourceName: pdfFieldName,
        page: currentPage,
        checkedValue: "1",
        uncheckedValue: "",
      } as any);
      setTool("select");
      setDraftGroupFieldId(null);
      setSelectedSheetFieldId(id);
      return;
    }

    if (tool === "new_group") {
      const gid = draftGroupFieldId ?? addSheetField("group", { page: currentPage } as any);
      setDraftGroupFieldId(gid);
      if (pdfFieldName) {
        setSheetFields((prev) =>
          prev.map((f) => {
            if (f.id !== gid) return f;
            if (f.sourceType !== "group") return f;
            const nextOpt = {
              id: newId("opt"),
              sourceName: pdfFieldName,
              optionValue: "",
              label: "",
              widgetInstanceIndex: instanceIndex,
              active: true,
            };
            return { ...f, options: [nextOpt, ...f.options] };
          })
        );
      }
      setSelectedSheetFieldId(gid);
    }
  }

  return (
    <section className="page-body space-y-3">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="ui-title text-xs text-muted-foreground">Calibration mapping profile</div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          <span className="text-foreground">Form fields</span> tab: click an AcroForm widget to select it, then link it to a
          setup field in the side panel. Printed text and regions are <span className="text-foreground/80">fallbacks only</span>.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className="min-w-[18rem] rounded-md border border-border bg-muted/60 px-2 py-1.5 text-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Calibration name / version"
          />
          <input
            className="rounded-md border border-border bg-muted/60 px-2 py-1.5 text-xs"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
            placeholder="Source type"
          />
          <button
            type="button"
            className="rounded-md border border-border bg-muted/60 px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save calibration"}
          </button>
          <button
            type="button"
            className="rounded-md border border-sky-500/60 bg-sky-500/10 px-3 py-1.5 text-xs hover:bg-sky-500/20 disabled:opacity-60"
            onClick={saveAsNewVersion}
            disabled={savingAsNew || saving}
          >
            {savingAsNew ? "Saving copy…" : "Save as new version"}
          </button>
          <span className="text-xs text-muted-foreground">
            {formCount} form · {textCount} text · {regionCount} region
          </span>
          {status ? <span className="text-xs text-muted-foreground">{status}</span> : null}
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
            <Link href="/setup-documents" className="text-xs text-sky-300/90 hover:text-sky-200">
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
                  <Link href="/setup-documents" className="text-sky-300/90 hover:text-sky-200">
                    Upload one
                  </Link>{" "}
                  (bulk-import PDFs are included here).
                </div>
              ) : (
                <label className="flex flex-col gap-1 text-muted-foreground">
                  <span className="text-[10px] uppercase tracking-wide">Choose document</span>
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
        <div className="mt-2 flex flex-wrap items-center gap-2 border-b border-border pb-2">
          <button
            type="button"
            className={`rounded px-3 py-1.5 text-xs font-medium ${tab === "sheet" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("sheet")}
          >
            Full sheet
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 text-xs font-medium ${tab === "form" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("form")}
          >
            Form fields
          </button>
          <span className="text-[10px] text-muted-foreground">Fallback</span>
          <button
            type="button"
            className={`rounded px-2 py-1 text-[11px] ${tab === "text" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("text")}
          >
            Printed text
          </button>
          <button
            type="button"
            className={`rounded px-2 py-1 text-[11px] ${tab === "region" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("region")}
          >
            Regions
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr]">
        {tab === "sheet" ? (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_420px]">
            <div className="rounded-lg border border-border bg-card">
              <div className="sticky top-0 z-[3] border-b border-border bg-card/95 p-2 backdrop-blur-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="ui-title text-xs text-muted-foreground">Calibration canvas</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Use tools to create mappings directly on the PDF. Editing happens in the inspector.
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    {[
                      ["select", "Select"],
                      ["new_text", "New Text"],
                      ["new_checkbox", "New Checkbox"],
                      ["new_group", "New Group"],
                      ["delete", "Delete"],
                    ].map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        className={`rounded border px-2 py-1 ${tool === k ? "border-sky-500/70 bg-sky-500/10" : "border-border hover:bg-muted"}`}
                        onClick={() => {
                          setTool(k as CalibrationUiTool);
                          if (k !== "new_group") setDraftGroupFieldId(null);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`ml-2 rounded border px-2 py-1 ${showExtractedFields ? "border-amber-500/60 bg-amber-500/10" : "border-border hover:bg-muted"}`}
                      onClick={() => setShowExtractedFields((v) => !v)}
                    >
                      Toggle Debug
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
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
                  {draftGroupFieldId ? (
                    <span className="text-[11px] text-amber-200/90">
                      Group mode: click multiple widgets, then switch back to Select.
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="p-2">
                {!previewUrl ? (
                  <div className="space-y-2 rounded border border-border/70 bg-muted/40 px-3 py-6 text-xs text-muted-foreground">
                    <div>No PDF preview URL — attach an example PDF to use the canvas.</div>
                    <button
                      type="button"
                      className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-muted"
                      onClick={openExamplePdfPicker}
                    >
                      Link example PDF…
                    </button>
                  </div>
                ) : (
                  <div
                    ref={sheetPdfContainerRef}
                    className="relative min-h-[55vh] overflow-auto rounded border border-border bg-muted/20"
                    onMouseLeave={() => setHoveredSheetOverlayId(null)}
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

                    {sheetOverlaysForPage.map((b) => (
                      <button
                        key={b.key}
                        type="button"
                        title={b.title}
                        onMouseEnter={() => setHoveredSheetOverlayId(b.sheetFieldId ?? null)}
                        onClick={() => {
                          if (tool === "select") {
                            if (b.sheetFieldId) setSelectedSheetFieldId(b.sheetFieldId);
                            return;
                          }
                          handleSheetCanvasClick({ pdfFieldName: b.pdfFieldName, instanceIndex: b.instanceIndex });
                        }}
                        className={`absolute box-border rounded-sm border-2 transition-colors ${b.colorClass}`}
                        style={{ left: b.left, top: b.top, width: b.width, height: b.height, zIndex: b.sheetFieldId === selectedSheetFieldId ? 5 : 2 }}
                      />
                    ))}

                    {/* Click-to-create on blank canvas (no sourceName). */}
                    <button
                      type="button"
                      className="absolute inset-0 cursor-crosshair bg-transparent"
                      style={{ zIndex: 1 }}
                      onClick={() => handleSheetCanvasClick({})}
                      aria-label="PDF canvas click target"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="ui-title text-xs text-muted-foreground">Inspector</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {selectedSheetField ? (
                      <span className="font-mono text-foreground/80">{selectedSheetField.sourceType}</span>
                    ) : (
                      "Select an overlay or create a new mapping."
                    )}
                  </div>
                </div>
                {selectedSheetField ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                      onClick={() => duplicateSheetField(selectedSheetField.id)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                      onClick={() => deleteSheetField(selectedSheetField.id)}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>

              {selectedSheetField ? (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-1 gap-2">
                    <label className="text-[11px] text-muted-foreground">
                      Canonical key
                      <input
                        className="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
                        value={selectedSheetField.canonicalFieldKey}
                        onChange={(e) => updateSheetField(selectedSheetField.id, { canonicalFieldKey: e.target.value } as any)}
                        placeholder="e.g. caster_front"
                      />
                    </label>
                    <label className="text-[11px] text-muted-foreground">
                      Label (optional)
                      <input
                        className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                        value={selectedSheetField.label}
                        onChange={(e) => updateSheetField(selectedSheetField.id, { label: e.target.value } as any)}
                        placeholder="Shown in editor"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-muted-foreground">
                        Source type
                        <input
                          className="mt-1 w-full rounded border border-border bg-muted/50 px-2 py-1 font-mono text-xs"
                          value={selectedSheetField.sourceType}
                          readOnly
                        />
                      </label>
                      <label className="text-[11px] text-muted-foreground">
                        Page (optional)
                        <input
                          className="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
                          value={selectedSheetField.page ?? ""}
                          onChange={(e) => {
                            const v = e.target.value.trim();
                            updateSheetField(selectedSheetField.id, { page: v ? Number(v) || undefined : undefined } as any);
                          }}
                          placeholder="1"
                        />
                      </label>
                    </div>
                    <label className="text-[11px] text-muted-foreground">
                      Notes (optional)
                      <textarea
                        className="mt-1 min-h-16 w-full resize-y rounded border border-border bg-card px-2 py-1 text-xs"
                        value={selectedSheetField.notes ?? ""}
                        onChange={(e) => updateSheetField(selectedSheetField.id, { notes: e.target.value } as any)}
                      />
                    </label>
                  </div>

                  {"sourceName" in selectedSheetField ? (
                    <label className="text-[11px] text-muted-foreground">
                      Source name
                      <input
                        className="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
                        value={(selectedSheetField as any).sourceName ?? ""}
                        onChange={(e) => updateSheetField(selectedSheetField.id, { sourceName: e.target.value } as any)}
                        placeholder="AcroForm field name…"
                      />
                    </label>
                  ) : null}

                  {selectedSheetField.sourceType === "checkbox" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-muted-foreground">
                        Checked value
                        <input
                          className="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
                          value={(selectedSheetField as any).checkedValue ?? "1"}
                          onChange={(e) => updateSheetField(selectedSheetField.id, { checkedValue: e.target.value } as any)}
                        />
                      </label>
                      <label className="text-[11px] text-muted-foreground">
                        Unchecked value
                        <input
                          className="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
                          value={(selectedSheetField as any).uncheckedValue ?? ""}
                          onChange={(e) => updateSheetField(selectedSheetField.id, { uncheckedValue: e.target.value } as any)}
                        />
                      </label>
                    </div>
                  ) : null}

                  {selectedSheetField.sourceType === "group" ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-medium text-muted-foreground">Group members</div>
                        <button
                          type="button"
                          className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
                          onClick={() => addGroupOption(selectedSheetField.id)}
                        >
                          Add member
                        </button>
                      </div>
                      {(selectedSheetField.options ?? []).length === 0 ? (
                        <div className="rounded border border-border/60 bg-muted/30 px-2 py-2 text-[11px] text-muted-foreground">
                          No members yet. Use “New Group” then click widgets on the PDF, or add members here.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {selectedSheetField.options.map((o) => (
                            <div key={o.id} className="grid grid-cols-1 gap-2 rounded border border-border/60 bg-muted/20 p-2">
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                                <input
                                  className="rounded border border-border bg-card px-2 py-1 font-mono text-xs md:col-span-2"
                                  value={o.sourceName}
                                  onChange={(e) => updateGroupOption(selectedSheetField.id, o.id, { sourceName: e.target.value })}
                                  placeholder="Source name"
                                />
                                <input
                                  className="rounded border border-border bg-card px-2 py-1 font-mono text-xs"
                                  value={o.optionValue}
                                  onChange={(e) => updateGroupOption(selectedSheetField.id, o.id, { optionValue: e.target.value })}
                                  placeholder="Option value"
                                />
                                <div className="flex items-center gap-2">
                                  <input
                                    className="flex-1 rounded border border-border bg-card px-2 py-1 text-xs"
                                    value={o.label ?? ""}
                                    onChange={(e) => updateGroupOption(selectedSheetField.id, o.id, { label: e.target.value })}
                                    placeholder="Label"
                                  />
                                  <button
                                    type="button"
                                    className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
                                    onClick={() => deleteGroupOption(selectedSheetField.id, o.id)}
                                    title="Remove member"
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 rounded border border-border/60 bg-muted/20 px-3 py-6 text-xs text-muted-foreground">
                  Click an overlay on the PDF or use the toolbar to create a new mapping.
                </div>
              )}

              {showExtractedFields ? (
                <div className="mt-4 border-t border-border pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="ui-title text-[11px] text-muted-foreground">Extracted fields (debug)</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {pdfFormRows.length} fields · {mappedSheetPdfFieldNames.size} mapped in full-sheet
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
                      onClick={() => void loadPdfFormFields()}
                      disabled={pdfFormLoading || !documentId}
                    >
                      {pdfFormLoading ? "Loading…" : "Reload"}
                    </button>
                  </div>
                  <div className="mt-2 max-h-[42vh] overflow-auto rounded border border-border/60 bg-muted/20 p-2">
                    {pdfFormRows.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No extracted fields loaded.</div>
                    ) : (
                      <div className="space-y-2">
                        {pdfFormRows.map((r) => {
                          const isMapped = mappedSheetPdfFieldNames.has(r.name);
                          return (
                            <div
                              key={r.name}
                              className={`rounded border p-2 ${isMapped ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/60 bg-card/60"}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate font-mono text-[11px] text-foreground/90">{r.name}</div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {formatPdfFieldDisplayValue(r)} · {r.type} {r.pageNumber ? `· p${r.pageNumber}` : ""}
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  <button
                                    type="button"
                                    className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-muted"
                                    onClick={() => {
                                      const id = addSheetField("text", { sourceName: r.name, page: r.pageNumber ?? undefined } as any);
                                      setTool("select");
                                      setSelectedSheetFieldId(id);
                                    }}
                                  >
                                    New Text
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-muted"
                                    onClick={() => {
                                      const id = addSheetField("checkbox", { sourceName: r.name, page: r.pageNumber ?? undefined } as any);
                                      setTool("select");
                                      setSelectedSheetFieldId(id);
                                    }}
                                  >
                                    New Checkbox
                                  </button>
                                  {selectedSheetField && "sourceName" in selectedSheetField ? (
                                    <button
                                      type="button"
                                      className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-muted"
                                      onClick={() => updateSheetField(selectedSheetField.id, { sourceName: r.name } as any)}
                                    >
                                      Assign to selected
                                    </button>
                                  ) : null}
                                  {selectedSheetField && selectedSheetField.sourceType === "group" ? (
                                    <button
                                      type="button"
                                      className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-muted"
                                      onClick={() => {
                                        setSheetFields((prev) =>
                                          prev.map((f) => {
                                            if (f.id !== selectedSheetField.id) return f;
                                            if (f.sourceType !== "group") return f;
                                            return {
                                              ...f,
                                              options: [
                                                { id: newId("opt"), sourceName: r.name, optionValue: "", label: "", active: true },
                                                ...f.options,
                                              ],
                                            };
                                          })
                                        );
                                      }}
                                    >
                                      Add to group
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : tab === "form" ? (
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="ui-title text-xs text-muted-foreground">AcroForm map</div>
                <p className="mt-0.5 max-w-xl text-[11px] text-muted-foreground">
                  Click a field to select it (highlighted on the PDF), then use the right panel to add or edit the setup mapping.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
                  onClick={() => void loadPdfFormFields()}
                  disabled={pdfFormLoading || !documentId}
                >
                  {pdfFormLoading ? "Loading…" : "Reload fields"}
                </button>
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
                    No AcroForm fields found. Use <strong>Printed text</strong> or <strong>Regions</strong> (fallback tabs).
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
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Grouped setup fields: pick the field and option chip in the catalog, then click an unmapped widget. Details
                  are in the right panel.
                </p>
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
        ) : tab === "text" ? (
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="ui-title text-xs text-muted-foreground">Printed text (secondary)</div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1 text-muted-foreground">
                  Line ε
                  <input
                    type="number"
                    step={0.5}
                    min={1}
                    max={12}
                    className="w-14 rounded border border-border bg-muted/60 px-1 py-0.5"
                    value={epsilon}
                    onChange={(e) => setEpsilon(Number(e.target.value) || 2.5)}
                  />
                </label>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
                  onClick={() => void loadStructure()}
                  disabled={structureLoading || !documentId}
                >
                  {structureLoading ? "Loading…" : "Reload"}
                </button>
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
            ) : structureError ? (
              <div className="space-y-2 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-3 text-xs text-rose-200">
                <div>Could not build printed text structure.</div>
                <div className="font-mono text-[10px] text-rose-100/90">{structureError}</div>
              </div>
            ) : structureLoading && !structure ? (
              <div className="text-xs text-muted-foreground">Parsing printed text…</div>
            ) : structure ? (
              <>
                <div className="mb-2 flex flex-wrap gap-2 text-xs">
                  <label className="flex items-center gap-1">
                    <span className="text-muted-foreground">Page</span>
                    <select
                      className="rounded border border-border bg-card px-2 py-1"
                      value={inspectPage}
                      onChange={(e) => setInspectPage(Number(e.target.value))}
                    >
                      {structure.pages.map((p) => (
                        <option key={p.pageNumber} value={p.pageNumber}>
                          {p.pageNumber} ({p.lines.length} lines)
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    className="min-w-[12rem] flex-1 rounded border border-border bg-muted/60 px-2 py-1"
                    placeholder="Filter lines…"
                    value={lineFilter}
                    onChange={(e) => setLineFilter(e.target.value)}
                  />
                </div>
                <div className="max-h-[65vh] space-y-2 overflow-auto rounded border border-border/60 bg-muted/20 p-2">
                  {linesForInspect.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No lines match filter.</div>
                  ) : (
                    linesForInspect.map((line) => (
                      <div
                        key={`${inspectPage}-${line.lineIndex}`}
                        className="rounded border border-border/50 bg-card/80 p-2 text-[11px]"
                      >
                        <div className="mb-1 font-mono text-muted-foreground">
                          p{inspectPage} · L{line.lineIndex} · y≈{line.yBucket.toFixed(1)}
                        </div>
                        <div className="mb-1 break-words text-foreground/90">{line.text || "—"}</div>
                        <div className="flex flex-wrap gap-1">
                          {line.tokens.map((tok, ti) => (
                            <button
                              key={`${line.lineIndex}-${ti}-${tok.x}`}
                              type="button"
                              disabled={!activeSetupFieldKey}
                              className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] hover:border-sky-500/60 hover:bg-sky-500/10 disabled:opacity-40"
                              title={`Token ${ti}`}
                              onClick={() => bindToken(inspectPage, line.lineIndex, ti)}
                            >
                              {tok.text || "·"}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Optional anchor + token for printed labels. Prefer <strong>Form fields</strong> when the PDF is a real
                  fillable sheet.
                </p>
              </>
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="ui-title text-xs text-muted-foreground">Region fallback</div>
              <div className="flex items-center gap-2 text-xs">
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
              </div>
            </div>
            {!previewUrl ? (
              <div className="space-y-2 rounded border border-border/70 bg-muted/40 px-3 py-6 text-xs text-muted-foreground">
                <div>No example PDF attached to this calibration yet.</div>
                <button
                  type="button"
                  className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-muted"
                  onClick={openExamplePdfPicker}
                >
                  Link example PDF…
                </button>
              </div>
            ) : (
              <div
                className="relative overflow-auto rounded border border-border bg-muted/30"
                onMouseDown={(e) => {
                  if (!activeSetupFieldKey || !renderedPageSize) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDrawStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                  setDrawCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseMove={(e) => {
                  if (!drawStart) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDrawCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseUp={() => {
                  if (!drawStart || !drawCurrent || !pdfPageSize || !renderedPageSize || !inProgressRect || !activeSetupFieldKey) return;
                  if (inProgressRect.width < 6 || inProgressRect.height < 6) {
                    setDrawStart(null);
                    setDrawCurrent(null);
                    return;
                  }
                  const next: CalibrationFieldRegion = {
                    page: currentPage,
                    x: (inProgressRect.x / renderedPageSize.width) * pdfPageSize.width,
                    y: (inProgressRect.y / renderedPageSize.height) * pdfPageSize.height,
                    width: (inProgressRect.width / renderedPageSize.width) * pdfPageSize.width,
                    height: (inProgressRect.height / renderedPageSize.height) * pdfPageSize.height,
                  };
                  setFields((prev) => ({ ...prev, [activeSetupFieldKey]: next }));
                  setDrawStart(null);
                  setDrawCurrent(null);
                }}
              >
                <PdfPreviewClient
                  fileUrl={resolvedFileUrl || previewUrl}
                  pageNumber={currentPage}
                  width={900}
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
                    const renderedWidth = 900;
                    const renderedHeight = viewport.height * (renderedWidth / viewport.width);
                    setRenderedPageSize({ width: renderedWidth, height: renderedHeight });
                  }}
                />
                {Object.entries(fields)
                  .filter(([, region]) => region.page === currentPage)
                  .map(([key, region]) => (
                    <div
                      key={key}
                      className="pointer-events-none absolute border border-amber-400/80 bg-amber-400/15"
                      style={{
                        left: renderedPageSize && pdfPageSize ? (region.x / pdfPageSize.width) * renderedPageSize.width : 0,
                        top: renderedPageSize && pdfPageSize ? (region.y / pdfPageSize.height) * renderedPageSize.height : 0,
                        width: renderedPageSize && pdfPageSize ? (region.width / pdfPageSize.width) * renderedPageSize.width : 0,
                        height: renderedPageSize && pdfPageSize ? (region.height / pdfPageSize.height) * renderedPageSize.height : 0,
                      }}
                      title={key}
                    />
                  ))}
                {inProgressRect ? (
                  <div
                    className="pointer-events-none absolute border border-sky-400/90 bg-sky-400/20"
                    style={inProgressRect}
                  />
                ) : null}
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">Last resort when form fields and printed text are not usable.</p>
          </div>
        )}

        <div className="rounded-lg border border-border bg-card p-3">
          {tab === "form" ? (
            <>
              <div className="mb-3 rounded border border-sky-500/35 bg-sky-500/10 p-3 text-xs">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Selected setup field</div>
                  {activeSetupFieldKey ? (
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                      onClick={clearActiveSetupFieldEditor}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                {activeSetupFieldKey ? (
                  <>
                    <div className="mt-1 font-medium text-foreground">{mergedLabelMap[activeSetupFieldKey] ?? activeSetupFieldKey}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{activeSetupFieldKey}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {customFieldKeySet.has(activeSetupFieldKey) ? (
                        <>
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-100">Custom</span>
                          {(() => {
                            const d = customFieldDefinitions.find((c) => c.key === activeSetupFieldKey);
                            if (!d) return null;
                            return (
                              <>
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{d.fieldDomain}</span>
                                {d.showInSetupSheet === false ? (
                                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-100">hidden · sheet</span>
                                ) : null}
                                {d.showInAnalysis === false ? (
                                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-100">hidden · analysis</span>
                                ) : null}
                              </>
                            );
                          })()}
                        </>
                      ) : (
                        <>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Base field</span>
                          {fieldDisplayOverrides[activeSetupFieldKey]?.showInSetupSheet === false ? (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-100">hidden · sheet</span>
                          ) : null}
                          {fieldDisplayOverrides[activeSetupFieldKey]?.showInAnalysis === false ? (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-100">hidden · analysis</span>
                          ) : null}
                        </>
                      )}
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          mappingLabel(activeSetupFieldKey) !== "—" ? "bg-emerald-500/20 text-emerald-100" : "bg-rose-500/15 text-rose-100"
                        }`}
                      >
                        {mappingLabel(activeSetupFieldKey) !== "—" ? "mapped" : "unmapped"}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    No setup field selected for editing. Click a mapped PDF widget or a catalog field to open the editor — or
                    select unmapped PDF widgets to create a new field.
                  </p>
                )}
              </div>

              {showCreateFieldForm ? (
                <div className="mb-3">
                  <SetupFieldDefinitionForm
                    mode={createFieldEditKey ? "edit" : "create"}
                    fieldScope={setupFieldFormScope === "template" ? "template" : createFieldEditKey ? "custom" : "new"}
                    error={createFieldError}
                    onApplyRecipe={
                      setupFieldFormScope === "template"
                        ? undefined
                        : (recipe) => {
                            applyCalibrationFieldRecipe(recipe, {
                              cfFieldDomain,
                              setCfFieldDomain,
                              cfIsMetadata,
                              setCfIsMetadata,
                              cfUiType,
                              setCfUiType,
                              cfValueType,
                              setCfValueType,
                              cfSectionId,
                              setCfSectionId,
                            });
                          }
                    }
                    sectionOptions={mergedSectionOptions}
                    cfKey={cfKey}
                    setCfKey={setCfKey}
                    cfLabel={cfLabel}
                    setCfLabel={setCfLabel}
                    cfSectionId={cfSectionId}
                    setCfSectionId={setCfSectionId}
                    cfFieldDomain={cfFieldDomain}
                    setCfFieldDomain={setCfFieldDomain}
                    cfValueType={cfValueType}
                    setCfValueType={setCfValueType}
                    cfUiType={cfUiType}
                    setCfUiType={setCfUiType}
                    cfIsMetadata={cfIsMetadata}
                    setCfIsMetadata={setCfIsMetadata}
                    cfShowInSetupSheet={cfShowInSetupSheet}
                    setCfShowInSetupSheet={setCfShowInSetupSheet}
                    cfShowInAnalysis={cfShowInAnalysis}
                    setCfShowInAnalysis={setCfShowInAnalysis}
                    cfPdfExportable={cfPdfExportable}
                    setCfPdfExportable={setCfPdfExportable}
                    cfUnit={cfUnit}
                    setCfUnit={setCfUnit}
                    cfCheckedValue={cfCheckedValue}
                    setCfCheckedValue={setCfCheckedValue}
                    cfUncheckedValue={cfUncheckedValue}
                    setCfUncheckedValue={setCfUncheckedValue}
                    cfGroupKey={cfGroupKey}
                    setCfGroupKey={setCfGroupKey}
                    cfOptionValue={cfOptionValue}
                    setCfOptionValue={setCfOptionValue}
                    cfNotes={cfNotes}
                    setCfNotes={setCfNotes}
                    cfSubsectionId={cfSubsectionId}
                    setCfSubsectionId={setCfSubsectionId}
                    cfLayoutPlacement={cfLayoutPlacement}
                    setCfLayoutPlacement={setCfLayoutPlacement}
                    cfPairGroupId={cfPairGroupId}
                    setCfPairGroupId={setCfPairGroupId}
                    cfSortOrder={cfSortOrder}
                    setCfSortOrder={setCfSortOrder}
                    fieldKindHint={
                      activeSetupFieldKey
                        ? `${getLogicalFieldKind(activeSetupFieldKey)} · ${getCalibrationFieldCategory(activeSetupFieldKey)}`
                        : undefined
                    }
                    onCommit={commitCreateField}
                    onCancel={() => {
                      setShowCreateFieldForm(false);
                      setCreateFieldEditKey(null);
                      setCreateFieldError(null);
                      setPendingGroupedSourceKeys(null);
                      clearGroupedEditorState();
                      setSetupFieldFormScope("new");
                      setEditorMode(acroSelection.keys.length > 0 ? "sourceSelection" : "idle");
                    }}
                  />
                </div>
              ) : null}

              {showCreateFieldForm
              && groupedEditorSourceKeys
              && groupedEditorSourceKeys.length >= 2
              && !(
                setupFieldFormScope === "template"
                && activeSetupFieldKey
                && usesSingleSelectChipWorkflow(activeSetupFieldKey)
              ) ? (
                <div className="mb-3 space-y-3 rounded border border-fuchsia-500/35 bg-fuchsia-500/5 p-3 text-xs">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-fuchsia-100/90">
                    {isSingleSelectGroupedBehavior(groupBehaviorType)
                      ? "Single-select field"
                      : groupBehaviorType === "visualMulti"
                        ? "Visual multi-select field"
                        : "Multi-select field"}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {isSingleSelectGroupedBehavior(groupBehaviorType)
                      ? "Same class as chassis / front bumper / top deck: one canonical setup value, mutually exclusive PDF sources. The stored import value is the “Stored value” column; display name is for humans only."
                      : groupBehaviorType === "visualMulti"
                        ? "For screw strips and other position-based multi-select (e.g. motor mount screws). Multiple selections are valid."
                        : "Many independent checkboxes can be on at once; values are combined for import."}
                  </p>
                  <div className="rounded border border-border/60 bg-card/50 p-2">
                    <div className="text-[10px] font-medium text-muted-foreground">Field behavior</div>
                    <label className="mt-2 block text-[11px] text-muted-foreground">
                      Type
                      <select
                        className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                        value={isSingleSelectGroupedBehavior(groupBehaviorType) ? "singleSelect" : groupBehaviorType}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "singleSelect") setGroupBehaviorType("singleSelect");
                          else setGroupBehaviorType(v as "visualMulti" | "multiChoiceGroup");
                        }}
                      >
                        <option value="singleSelect">Single-select · one canonical value (chassis, body, …)</option>
                        <option value="visualMulti">Visual multi · screws / positions</option>
                        <option value="multiChoiceGroup">Multi-select · many independent boxes</option>
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
                    <div className="text-[10px] font-medium text-muted-foreground">Option mapping</div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className={`rounded border px-2 py-0.5 text-[10px] ${
                          groupedMappingPanelMode === "table"
                            ? "border-fuchsia-500/60 bg-fuchsia-500/15"
                            : "border-border hover:bg-muted/50"
                        }`}
                        onClick={() => setGroupedMappingPanelMode("table")}
                      >
                        Table
                      </button>
                      <button
                        type="button"
                        className={`rounded border px-2 py-0.5 text-[10px] ${
                          groupedMappingPanelMode === "chips"
                            ? "border-fuchsia-500/60 bg-fuchsia-500/15"
                            : "border-border hover:bg-muted/50"
                        }`}
                        onClick={() => setGroupedMappingPanelMode("chips")}
                      >
                        Map on PDF (chips)
                      </button>
                    </div>
                  </div>
                  {groupedMappingPanelMode === "chips" ? (
                    <div className="rounded border border-border/60 bg-card/50 p-2">
                      <p className="text-[10px] text-muted-foreground">
                        Arm a <strong>stored value</strong> with a chip, then click the matching control on the PDF. Switch
                        to <strong>Table</strong> to edit display names and keep each stored value unique.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(() => {
                          const seen = new Set<string>();
                          const chips: { value: string; label: string }[] = [];
                          for (const sk of groupedEditorSourceKeys) {
                            const ref = parseAcroKey(sk);
                            const r = pdfRowByName.get(ref.pdfFieldName);
                            const d = groupedOptionDrafts[sk] ?? {
                              optionLabel: r?.name ?? ref.pdfFieldName,
                              optionValue: inferOptionValueFromPdfName(r?.name ?? ref.pdfFieldName),
                              notes: "",
                            };
                            const v = d.optionValue.trim();
                            if (!v || seen.has(v)) continue;
                            seen.add(v);
                            chips.push({ value: v, label: d.optionLabel?.trim() ? d.optionLabel : v });
                          }
                          return chips;
                        })().map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            className={`max-w-full truncate rounded border px-2 py-0.5 text-[10px] ${
                              pendingGroupOption === value
                                ? "border-blue-500/90 bg-blue-500/25 text-foreground"
                                : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                            }`}
                            title={label !== value ? `Stored: ${value}` : value}
                            onClick={() => setPendingGroupOption((c) => (c === value ? null : value))}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded border border-border/60 bg-card/50 p-2">
                      <div className="text-[10px] font-medium text-muted-foreground">
                        Options ({groupedEditorSourceKeys.length} PDF sources)
                      </div>
                      <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                        {groupedEditorSourceKeys.map((sourceKey) => {
                          const ref = parseAcroKey(sourceKey);
                          const row = pdfRowByName.get(ref.pdfFieldName);
                          const draft = groupedOptionDrafts[sourceKey] ?? {
                            optionLabel: row?.name ?? ref.pdfFieldName,
                            optionValue: inferOptionValueFromPdfName(row?.name ?? ref.pdfFieldName),
                            notes: "",
                          };
                          return (
                            <div key={sourceKey} className="rounded border border-border/60 bg-muted/20 p-2">
                              <details className="text-[10px] text-muted-foreground">
                                <summary className="cursor-pointer text-foreground/80">AcroForm source (advanced)</summary>
                                <div className="mt-1 break-all font-mono text-[9px] text-foreground/80">{sourceKey}</div>
                              </details>
                              <div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-2">
                                <label className="block text-[10px] text-muted-foreground md:col-span-2">
                                  Display label
                                  <input
                                    className="mt-0.5 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                                    value={draft.optionLabel}
                                    onChange={(e) => setGroupedOptionDrafts((prev) => ({
                                      ...prev,
                                      [sourceKey]: { ...draft, optionLabel: e.target.value },
                                    }))}
                                    placeholder="e.g. Technical"
                                  />
                                </label>
                                <label className="block text-[10px] text-muted-foreground md:col-span-2">
                                  Stored value (canonical)
                                  <input
                                    className="mt-0.5 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
                                    value={draft.optionValue}
                                    onChange={(e) => setGroupedOptionDrafts((prev) => ({
                                      ...prev,
                                      [sourceKey]: { ...draft, optionValue: e.target.value },
                                    }))}
                                    placeholder="e.g. technical"
                                  />
                                </label>
                                <label className="block text-[10px] text-muted-foreground md:col-span-2">
                                  Notes (optional)
                                  <input
                                    className="mt-0.5 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                                    value={draft.notes}
                                    onChange={(e) => setGroupedOptionDrafts((prev) => ({
                                      ...prev,
                                      [sourceKey]: { ...draft, notes: e.target.value },
                                    }))}
                                    placeholder=""
                                  />
                                </label>
                              </div>
                              <button
                                type="button"
                                className="mt-2 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-100 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={!draft.optionValue.trim()}
                                onClick={() => {
                                  if (!draft.optionValue.trim()) return;
                                  setPendingGroupOption(draft.optionValue.trim());
                                  setStatus("Click the matching PDF control to link this stored value…");
                                }}
                              >
                                Link: arm value, then click PDF
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="ui-title text-xs text-muted-foreground">AcroForm source</div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Unmapped widgets: click to toggle selection (multi-select). Mapped widgets: click opens that setup field in
                the editor. With two or more unmapped widgets selected, create one grouped setup field and assign option
                labels per checkbox.
              </p>
              {acroSelection.keys.length >= 2 ? (
                <div className="mt-3 space-y-2 rounded border border-fuchsia-500/40 bg-fuchsia-500/5 p-2 text-[11px]">
                  <div className="font-medium text-fuchsia-100/90">
                    Multi-select ({acroSelection.keys.length} PDF widgets)
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    This creates one parent setup field and maps each selected source checkbox as a child option row.
                    Choose behavior and option details in the grouped editor after opening it.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded border border-fuchsia-500/60 bg-fuchsia-500/15 px-3 py-1.5 text-xs font-medium text-fuchsia-50 hover:bg-fuchsia-500/25"
                      onClick={beginCreateGroupedFromSelection}
                    >
                      Create grouped setup field…
                    </button>
                    <button
                      type="button"
                      className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted"
                      onClick={() => {
                        setAcroSelection({ keys: [], activeKey: null });
                        clearGroupedEditorState();
                        setPendingGroupedSourceKeys(null);
                        setEditorMode("idle");
                      }}
                    >
                      Clear PDF selection
                    </button>
                  </div>
                </div>
              ) : null}
              {!selectedAcroField ? (
                <div className="mt-3 rounded border border-border/60 bg-muted/20 px-3 py-6 text-xs text-muted-foreground">
                  {activeSetupFieldKey ? (
                    <p>
                      No PDF widget highlighted. Click the map to select a source, or add a mapping below.{" "}
                      {formFieldMappings[activeSetupFieldKey]
                        ? "A form mapping exists but could not resolve a widget — check the rule type."
                        : "This setup field has no AcroForm mapping yet."}
                    </p>
                  ) : (
                    <p>No field selected. Click a highlighted region on the PDF or choose a setup field in the catalog.</p>
                  )}
                </div>
              ) : (
                <div className="mt-3 space-y-3 text-xs">
                  <div className="rounded border border-border/60 bg-muted/20 p-2 font-mono text-[10px]">
                    <div className="text-muted-foreground">Source id</div>
                    <div className="break-all text-foreground">{acroSourceKey(selectedAcroField)}</div>
                  </div>
                  {selectedAcroPdfRow ? (
                    <div className="space-y-1 text-[11px] text-muted-foreground">
                      <div>
                        <span className="text-muted-foreground">Name </span>
                        <span className="font-mono text-foreground">{selectedAcroPdfRow.name}</span>
                      </div>
                      <div>Type {selectedAcroPdfRow.type}</div>
                      {selectedAcroPdfRow.pageNumber != null ? <div>Page {selectedAcroPdfRow.pageNumber}</div> : null}
                      <div>
                        Value <span className="font-mono text-foreground">{formatPdfFieldDisplayValue(selectedAcroPdfRow)}</span>
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <span className="text-muted-foreground">Status: </span>
                    {selectedAcroAppKeys.length > 0 ? (
                      <span className="font-medium text-emerald-300">Mapped</span>
                    ) : (
                      <span className="text-amber-200/90">Unmapped</span>
                    )}
                  </div>

                  {selectedAcroAppKeys.length > 0 ? (
                    <div className="space-y-2 border-t border-border pt-2">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">App mapping</div>
                      {selectedAcroAppKeys.map((k) => {
                        const rule = formFieldMappings[k];
                        const label = mergedLabelMap[k] ?? k;
                        return (
                          <div key={k} className="rounded border border-border/60 bg-card/60 p-2">
                            <div className="font-medium text-foreground">{label}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">{k}</div>
                            {rule && selectedAcroPdfRow ? (
                              <div className="mt-1 text-[10px] text-muted-foreground">
                                {summarizeFormRuleForPanel(rule, selectedAcroPdfRow)} · {formatPdfFieldDisplayValue(selectedAcroPdfRow)}
                              </div>
                            ) : null}
                            <button
                              type="button"
                              className="mt-2 w-full rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[11px] font-medium text-sky-100 hover:bg-sky-500/20"
                              onClick={() => openEditSetupFieldUnified(k)}
                            >
                              Edit setup field
                            </button>
                          </div>
                        );
                      })}
                      <label className="block text-[11px] text-muted-foreground">
                        Change linked setup field
                        <select
                          className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                          value={newMappingCanonicalKey}
                          onChange={(e) => setNewMappingCanonicalKey(e.target.value)}
                        >
                          {sortedCatalog.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="w-full rounded border border-rose-500/40 px-2 py-1.5 text-xs text-rose-200 hover:bg-rose-500/10"
                        onClick={clearMappingsForSelectedAcroWidget}
                      >
                        Clear mapping
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 border-t border-border pt-2">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Map this PDF field</div>
                      {!activeSetupFieldKey && !showAddMappingForm && !showCreateFieldForm ? (
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            className="w-full rounded border border-sky-500/60 bg-sky-500/10 px-3 py-2 text-left text-xs font-medium hover:bg-sky-500/20"
                            onClick={() => {
                              setShowAddMappingForm(true);
                              setShowCreateFieldForm(false);
                              setNewMappingCanonicalKey(sortedCatalog[0]?.key || "");
                              setNewMappingNotes("");
                            }}
                          >
                            Link to existing setup field…
                          </button>
                          <button
                            type="button"
                            className="w-full rounded border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-left text-xs font-medium hover:bg-emerald-500/20"
                            onClick={openCreateFieldFromSelection}
                          >
                            Create new setup field…
                          </button>
                        </div>
                      ) : null}

                      {showAddMappingForm && !showCreateFieldForm && !activeSetupFieldKey ? (
                        <div className="space-y-2 rounded border border-border/60 bg-muted/20 p-2">
                          <div className="text-[10px] font-medium text-muted-foreground">Link to existing field</div>
                          <label className="block text-[11px] text-muted-foreground">
                            Setup field (canonical key)
                            <select
                              className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                              value={newMappingCanonicalKey}
                              onChange={(e) => setNewMappingCanonicalKey(e.target.value)}
                            >
                              {sortedCatalog.map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-[11px] text-muted-foreground">
                            Notes (optional)
                            <textarea
                              className="mt-1 min-h-10 w-full resize-y rounded border border-border bg-card px-2 py-1 text-xs"
                              value={newMappingNotes}
                              onChange={(e) => setNewMappingNotes(e.target.value)}
                            />
                          </label>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded border border-sky-500/60 bg-sky-500/15 px-3 py-1.5 text-xs font-medium hover:bg-sky-500/25"
                              onClick={() => {
                                if (!selectedAcroField) return;
                                applyWidgetToCanonicalKey(newMappingCanonicalKey, selectedAcroField.pdfFieldName, selectedAcroField.instanceIndex);
                              }}
                            >
                              Save mapping
                            </button>
                            <button
                              type="button"
                              className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted"
                              onClick={() => setShowAddMappingForm(false)}
                            >
                              Cancel
                            </button>
                          </div>
                          {unmappedCanonicalKeys.length > 0 ? (
                            <div className="border-t border-border/60 pt-2">
                              <label className="block text-[11px] text-muted-foreground">
                                Quick link (unmapped keys only)
                                <select
                                  className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                                  value={linkTargetCanonicalKey}
                                  onChange={(e) => setLinkTargetCanonicalKey(e.target.value)}
                                >
                                  {unmappedCanonicalKeys.map((k) => (
                                    <option key={k} value={k}>
                                      {mergedLabelMap[k] ?? k}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button
                                type="button"
                                className="mt-1 w-full rounded border border-border px-2 py-1.5 text-xs hover:bg-muted"
                                onClick={() => {
                                  if (!selectedAcroField) return;
                                  applyWidgetToCanonicalKey(linkTargetCanonicalKey, selectedAcroField.pdfFieldName, selectedAcroField.instanceIndex);
                                }}
                              >
                                Link to selected key
                              </button>
                            </div>
                          ) : (
                            <p className="text-[10px] text-muted-foreground">
                              All known keys are mapped; use <strong>Create new setup field</strong> for additional PDF fields.
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              <details className="mt-4 border-t border-border pt-3" open>
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Setup field catalog &amp; groups</summary>
                <div className="mt-3 space-y-3">
                  {activeSetupFieldKey && effectiveWidgetGroupKind(activeSetupFieldKey) ? (
                    <div className="rounded border border-blue-500/40 bg-blue-500/10 p-2 text-[11px]">
                      <div className="text-[10px] font-medium text-blue-100/90">
                        {effectiveWidgetGroupKind(activeSetupFieldKey) === "single" ? "Single-select" : "Visual multi-select"}
                        <span className="ml-2 font-normal text-muted-foreground">
                          ({getLogicalFieldKind(activeSetupFieldKey)})
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Pick an option chip, then click an <strong>unmapped</strong> widget on the PDF (chassis, track layout,
                        traction, bodyshell, … share this workflow).
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {chipOptionEntriesForField(activeSetupFieldKey).map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            className={`max-w-full truncate rounded border px-2 py-0.5 text-[10px] ${
                              customFieldByKey.get(activeSetupFieldKey) ? "font-sans" : "font-mono"
                            } ${
                              pendingGroupOption === value
                                ? "border-blue-500/90 bg-blue-500/25 text-foreground"
                                : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                            }`}
                            title={label !== value ? `Stored: ${value}` : value}
                            onClick={() =>
                              setPendingGroupOption((cur) => (cur === value ? null : value))
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="max-h-[45vh] space-y-3 overflow-auto">
            {catalogByGroup.order.map((groupTitle) => (
              <div key={groupTitle} className="space-y-1">
                <div className="sticky top-0 z-[1] bg-card/95 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
                  {groupTitle}
                </div>
                <div className="space-y-1">
                  {(catalogByGroup.map.get(groupTitle) ?? []).map((field) => {
                    const isSelected = activeSetupFieldKey === field.key;
                    const mapped = mappingLabel(field.key);
                    const formRule = formFieldMappings[field.key];
                    const pdfRow =
                      formRule && "pdfFieldName" in formRule
                        ? pdfRowByName.get(formRule.pdfFieldName)
                        : undefined;
                    const cf = customFieldByKey.get(field.key);
                    const tmplHiddenSheet = !cf && fieldDisplayOverrides[field.key]?.showInSetupSheet === false;
                    const tmplHiddenAnalysis = !cf && fieldDisplayOverrides[field.key]?.showInAnalysis === false;
                    return (
                      <button
                        key={field.key}
                        type="button"
                        onClick={() => selectCanonicalField(field.key)}
                        className={`flex w-full flex-col gap-0.5 rounded border px-2 py-1.5 text-left text-xs ${
                          isSelected ? "border-sky-400/70 bg-sky-400/10" : "border-border bg-muted/30"
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="min-w-0 truncate">{field.label}</span>
                          <span
                            className={`shrink-0 text-[10px] ${mapped !== "—" ? "text-emerald-300" : "text-muted-foreground"}`}
                          >
                            {mapped}
                          </span>
                        </div>
                        {cf ? (
                          <div className="text-[9px] text-muted-foreground">
                            {cf.fieldDomain}
                            {cf.showInSetupSheet === false ? " · hidden · sheet" : ""}
                            {cf.showInAnalysis === false ? " · hidden · analysis" : ""}
                          </div>
                        ) : tmplHiddenSheet || tmplHiddenAnalysis ? (
                          <div className="text-[9px] text-amber-200/80">
                            {tmplHiddenSheet ? "hidden · sheet " : ""}
                            {tmplHiddenAnalysis ? "hidden · analysis" : ""}
                          </div>
                        ) : null}
                        {formRule && pdfRow ? (
                          <div className="text-[10px] text-muted-foreground">
                            <span className="font-mono text-foreground/80">{summarizeFormRuleForPanel(formRule, pdfRow)}</span>
                            <span className="mx-1">·</span>
                            <span>{formatPdfFieldDisplayValue(pdfRow)}</span>
                          </div>
                        ) : formRule ? (
                          <div className="text-[10px] text-muted-foreground">
                            <span className="font-mono text-foreground/80">{rulePdfFieldName(formRule)}</span>
                            <span className="mx-1">·</span>
                            <span className="text-amber-200/80">value not loaded</span>
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
                  </div>
                </div>
              </details>
            </>
          ) : (
            <>
              <div className="ui-title text-xs text-muted-foreground">Setup fields</div>
              {tab === "text" ? (
                <div className="mt-2 space-y-2 rounded border border-border/60 bg-muted/30 p-2 text-[11px]">
                  <div className="text-muted-foreground">Anchor (optional)</div>
                  <input
                    className="w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
                    placeholder='Printed line contains…'
                    value={anchorInput}
                    onChange={(e) => setAnchorInput(e.target.value)}
                  />
                  {anchorInput.trim() ? (
                    <label className="flex items-center gap-2 text-muted-foreground">
                      Match index
                      <input
                        className="w-12 rounded border border-border bg-card px-1 py-0.5 font-mono"
                        value={occurrenceInput}
                        onChange={(e) => setOccurrenceInput(e.target.value)}
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-2 max-h-[60vh] space-y-3 overflow-auto">
                {catalogByGroup.order.map((groupTitle) => (
                  <div key={groupTitle} className="space-y-1">
                    <div className="sticky top-0 z-[1] bg-card/95 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
                      {groupTitle}
                    </div>
                    <div className="space-y-1">
                      {(catalogByGroup.map.get(groupTitle) ?? []).map((field) => {
                        const isSelected = activeSetupFieldKey === field.key;
                        const mapped = mappingLabel(field.key);
                        const formRule = formFieldMappings[field.key];
                        const pdfRow =
                          formRule && "pdfFieldName" in formRule
                            ? pdfRowByName.get(formRule.pdfFieldName)
                            : undefined;
                        return (
                          <button
                            key={field.key}
                            type="button"
                            onClick={() => selectCanonicalField(field.key)}
                            className={`flex w-full flex-col gap-0.5 rounded border px-2 py-1.5 text-left text-xs ${
                              isSelected ? "border-sky-400/70 bg-sky-400/10" : "border-border bg-muted/30"
                            }`}
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <span className="min-w-0 truncate">{field.label}</span>
                              <span
                                className={`shrink-0 text-[10px] ${mapped !== "—" ? "text-emerald-300" : "text-muted-foreground"}`}
                              >
                                {mapped}
                              </span>
                            </div>
                            {formRule && pdfRow ? (
                              <div className="text-[10px] text-muted-foreground">
                                <span className="font-mono text-foreground/80">{summarizeFormRuleForPanel(formRule, pdfRow)}</span>
                                <span className="mx-1">·</span>
                                <span>{formatPdfFieldDisplayValue(pdfRow)}</span>
                              </div>
                            ) : formRule ? (
                              <div className="text-[10px] text-muted-foreground">
                                <span className="font-mono text-foreground/80">{rulePdfFieldName(formRule)}</span>
                                <span className="mx-1">·</span>
                                <span className="text-amber-200/80">value not loaded</span>
                              </div>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
              onClick={clearSelectedMapping}
              disabled={!activeSetupFieldKey || mappingLabel(activeSetupFieldKey) === "—"}
            >
              Clear selected field
            </button>
            {documentId ? (
              <Link href={`/setup-documents/${documentId}`} className="text-xs text-muted-foreground hover:text-foreground">
                Back to document review
              </Link>
            ) : (
              <Link href="/setup-documents" className="text-xs text-muted-foreground hover:text-foreground">
                Open setup documents
              </Link>
            )}
          </div>
        </div>
      </div>

      {pdfMappingConflict ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pdf-map-conflict-title"
        >
          <div className="max-w-md rounded-lg border border-border bg-card p-4 shadow-lg">
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
          </div>
        </div>
      ) : null}
    </section>
  );
}

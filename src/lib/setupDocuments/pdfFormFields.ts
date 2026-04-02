import "server-only";

import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import { normalizeTemplateExtractedValue } from "@/lib/setupCalibrations/applyTextTemplate";
import type { SetupSnapshotData } from "@/lib/runSetup";
import { AWESOMATIX_MULTI_SELECT_GROUPS, AWESOMATIX_SINGLE_CHOICE_GROUPS } from "@/lib/setupDocuments/awesomatixWidgetGroups";
import { applyAwesomatixSanitizer } from "@/lib/setupDocuments/awesomatixImportPostProcess";
import { canonicalSetupFieldKey } from "@/lib/setupDocuments/normalize";
import { getCalibrationFieldKind } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { normalizeMultiSelectValue } from "@/lib/setup/multiSelect";
import { rewriteImportedCalculatedDisplayKey } from "@/lib/setup/derivedFields";
import { isPresetWithOtherCompanionKey } from "@/lib/setup/presetWithOther";

/**
 * Widget rectangle in **viewer space**: origin top-left, y increases downward.
 * `instanceIndex` is stable for this field: sort by page, y, x then assign 0..n-1.
 */
export type PdfFormFieldWidgetRect = {
  instanceIndex: number;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Btn/checkbox widget: from annotation /AS vs /AP on-states */
  checked?: boolean;
};

export type PdfFormFieldEntry = {
  name: string;
  type: string;
  value: string;
  booleanValue?: boolean | null;
  widgets: PdfFormFieldWidgetRect[];
  pageNumber: number | null;
  readError?: string;
};

export type PdfFormFieldsExtraction = {
  hasFormFields: boolean;
  fields: PdfFormFieldEntry[];
  loadError?: string;
};

export type PdfFormImportDebugRow = {
  appKey: string;
  pdfFieldName?: string;
  /** Value passed into the interpreter (often AcroForm read, normalized). */
  rawExtracted?: string;
  finalValue: string;
  rawNote: string;
  warning?: string;
};

/** pdf-lib widget annotation — use structural typing (not all builds export this class). */
type AcroWidget = {
  getRectangle(): { x: number; y: number; width: number; height: number };
  P(): { toString(): string } | undefined;
  getAppearanceState(): unknown;
  getOnValue(): unknown;
};

function widgetAppearanceIsOn(widget: AcroWidget): boolean {
  try {
    const as = widget.getAppearanceState();
    const off = PDFName.of("Off");
    if (!as || as === off) return false;
    const on = widget.getOnValue();
    if (on && as === on) return true;
    return false;
  } catch {
    return false;
  }
}

function readFieldValue(field: PDFField): { value: string; readError?: string } {
  try {
    if (field instanceof PDFTextField) {
      const t = field.getText();
      return { value: t ?? "" };
    }
    if (field instanceof PDFCheckBox) {
      return { value: field.isChecked() ? "1" : "" };
    }
    if (field instanceof PDFDropdown) {
      const sel = field.getSelected();
      return { value: sel.length ? sel.join(", ") : "" };
    }
    if (field instanceof PDFOptionList) {
      const sel = field.getSelected();
      return { value: sel.length ? sel.join(", ") : "" };
    }
    if (field instanceof PDFRadioGroup) {
      const s = field.getSelected();
      return { value: s ?? "" };
    }
    return { value: "" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { value: "", readError: msg };
  }
}

function fieldSupportsPerWidgetToggle(field: PDFField): boolean {
  return field instanceof PDFCheckBox || field instanceof PDFRadioGroup;
}

/**
 * Sorted widget layouts + per-widget checked state (checkbox / radio appearances).
 */
export function collectWidgetLayouts(pdfDoc: PDFDocument, field: PDFField): PdfFormFieldWidgetRect[] {
  try {
    const pages = pdfDoc.getPages();
    const refToIndex = new Map<string, number>();
    for (let i = 0; i < pages.length; i++) {
      refToIndex.set(pages[i]!.ref.toString(), i);
    }

    const perWidget = fieldSupportsPerWidgetToggle(field);
    const acroWidgets = field.acroField.getWidgets() as AcroWidget[];
    const items: PdfFormFieldWidgetRect[] = [];

    for (const w of acroWidgets) {
      const rect = w.getRectangle();
      const pageRef = w.P();
      const pageIdx = pageRef ? refToIndex.get(pageRef.toString()) : undefined;
      if (pageIdx === undefined) continue;

      const page = pages[pageIdx]!;
      const pageHeight = page.getHeight();
      const x = rect.x;
      const yTop = pageHeight - rect.y - rect.height;
      const checked = perWidget ? widgetAppearanceIsOn(w) : undefined;

      items.push({
        instanceIndex: 0,
        pageNumber: pageIdx + 1,
        x,
        y: yTop,
        width: rect.width,
        height: rect.height,
        checked,
      });
    }

    items.sort((a, b) => {
      if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
      if (a.y !== b.y) return a.y - b.y;
      if (a.x !== b.x) return a.x - b.x;
      return 0;
    });
    items.forEach((it, i) => {
      it.instanceIndex = i;
    });
    return items;
  } catch {
    return [];
  }
}

function summarizeCheckedWidgets(fieldName: string, widgets: PdfFormFieldWidgetRect[]): string {
  const on = widgets.filter((w) => w.checked).map((w) => w.instanceIndex);
  if (on.length === 0) return `${fieldName}: none on`;
  return `${fieldName}: #${on.join(", #")}`;
}

function interpretSingleChoiceAwesomatix(input: {
  appKey: string;
  pdfFieldName: string;
  options: Record<string, { widgetInstanceIndex: number }>;
  widgets: PdfFormFieldWidgetRect[];
}): { value: string; rawNote: string; warning?: string } {
  const allowed = AWESOMATIX_SINGLE_CHOICE_GROUPS[input.appKey] ?? Object.keys(input.options);
  const rawParts: string[] = [];
  const checkedLabels: string[] = [];

  for (const label of allowed) {
    const ref = input.options[label];
    if (!ref) continue;
    const w = input.widgets[ref.widgetInstanceIndex];
    const on = Boolean(w?.checked);
    rawParts.push(`${label}→#${ref.widgetInstanceIndex}${on ? "✓" : "·"}`);
    if (on) checkedLabels.push(label);
  }

  const rawNote = `${input.pdfFieldName} widgets: ${summarizeCheckedWidgets(input.pdfFieldName, input.widgets)} · map ${rawParts.join(" ")}`;

  if (checkedLabels.length > 1) {
    return {
      value: "",
      rawNote,
      warning: `Multiple options appear on (${checkedLabels.join(", ")}); expected at most one.`,
    };
  }
  if (checkedLabels.length === 0) {
    return { value: "", rawNote };
  }
  return { value: checkedLabels[0]!, rawNote };
}

function interpretMultiSelectAwesomatix(input: {
  appKey: string;
  pdfFieldName: string;
  options: Record<string, { widgetInstanceIndex: number }>;
  widgets: PdfFormFieldWidgetRect[];
}): { value: string; rawNote: string; warning?: string } {
  const order = AWESOMATIX_MULTI_SELECT_GROUPS[input.appKey] ?? Object.keys(input.options);
  const picked: string[] = [];
  const rawParts: string[] = [];

  for (const label of order) {
    const ref = input.options[label];
    if (!ref) continue;
    const w = input.widgets[ref.widgetInstanceIndex];
    const on = Boolean(w?.checked);
    rawParts.push(`${label}→#${ref.widgetInstanceIndex}${on ? "✓" : "·"}`);
    if (on) picked.push(label);
  }

  const rawNote = `${input.pdfFieldName} widgets: ${summarizeCheckedWidgets(input.pdfFieldName, input.widgets)} · map ${rawParts.join(" ")}`;
  return { value: picked.join(", "), rawNote };
}

function optionFieldRefState(input: {
  pdfDoc: PDFDocument;
  form: ReturnType<PDFDocument["getForm"]>;
  pdfFieldName: string;
  widgetInstanceIndex?: number;
}): { on: boolean; debug: string } {
  const field = input.form.getFieldMaybe(input.pdfFieldName);
  if (!field) return { on: false, debug: `${input.pdfFieldName}: missing` };
  const widgets = collectWidgetLayouts(input.pdfDoc, field);
  const idx = input.widgetInstanceIndex;
  if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) {
    if (idx != null) {
      const on = Boolean(widgets[idx]?.checked);
      return { on, debug: `${input.pdfFieldName}#${idx}${on ? "✓" : "·"}` };
    }
    if (widgets.length > 1) {
      const onIdx = widgets.filter((w) => w.checked).map((w) => w.instanceIndex);
      return { on: onIdx.length > 0, debug: `${input.pdfFieldName}[${onIdx.join(",") || "-"}]` };
    }
    const on = field instanceof PDFCheckBox ? field.isChecked() : Boolean(field.getSelected());
    return { on, debug: `${input.pdfFieldName}${on ? "✓" : "·"}` };
  }
  const { value } = readFieldValue(field);
  const on = normalizeTemplateExtractedValue(value).trim() !== "";
  return { on, debug: `${input.pdfFieldName}=${JSON.stringify(value)}` };
}

function inferSingleChoiceFromSimpleMultiWidget(input: {
  appKey: string;
  pdfFieldName: string;
  widgets: PdfFormFieldWidgetRect[];
}): { value: string; rawNote: string; warning?: string } | null {
  const allowed = AWESOMATIX_SINGLE_CHOICE_GROUPS[input.appKey];
  if (!allowed || allowed.length === 0) return null;
  const checked = input.widgets.filter((w) => w.checked).map((w) => w.instanceIndex);
  const raw = `${input.pdfFieldName}: ${checked.length ? `on #${checked.join(", #")}` : "none on"} · inferred labels ${allowed.join("/")}`;
  if (checked.length === 0) return { value: "", rawNote: raw };
  if (checked.length > 1) {
    return { value: "", rawNote: raw, warning: `Multiple widgets on for ${input.appKey}` };
  }
  const label = allowed[checked[0]];
  return label ? { value: label, rawNote: raw } : { value: "", rawNote: raw, warning: "Checked widget index is out of mapped label range." };
}

function inferMultiSelectFromSimpleMultiWidget(input: {
  appKey: string;
  pdfFieldName: string;
  widgets: PdfFormFieldWidgetRect[];
}): { value: string; rawNote: string } | null {
  const allowed = AWESOMATIX_MULTI_SELECT_GROUPS[input.appKey];
  if (!allowed || allowed.length === 0) return null;
  const checked = input.widgets.filter((w) => w.checked).map((w) => w.instanceIndex);
  const picked = checked
    .map((idx) => allowed[idx])
    .filter((v): v is string => Boolean(v));
  const raw = `${input.pdfFieldName}: ${checked.length ? `on #${checked.join(", #")}` : "none on"} · inferred labels ${allowed.join("/")}`;
  return { value: picked.join(", "), rawNote: raw };
}

export async function extractPdfFormFields(buffer: Buffer): Promise<PdfFormFieldsExtraction> {
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const rawFields = form.getFields();
    const fields: PdfFormFieldEntry[] = rawFields.map((field) => {
      const name = field.getName();
      const { value, readError } = readFieldValue(field);
      const type = field.constructor.name.replace(/^PDF/, "").replace(/Field$/, "") || "Field";
      const widgets = collectWidgetLayouts(pdfDoc, field);
      const perWidget = fieldSupportsPerWidgetToggle(field);
      const anyChecked = perWidget ? widgets.some((w) => w.checked) : null;
      const booleanValue = field instanceof PDFCheckBox ? field.isChecked() : perWidget ? Boolean(anyChecked) : null;
      const pageNumber = widgets.length ? Math.min(...widgets.map((w) => w.pageNumber)) : null;

      let displayValue = value;
      if (perWidget && widgets.length > 1) {
        const onIdx = widgets.filter((w) => w.checked).map((w) => w.instanceIndex);
        displayValue = onIdx.length ? `on: #${onIdx.join(", #")}` : "all off";
      }

      return {
        name,
        type,
        value: displayValue,
        booleanValue,
        widgets,
        pageNumber,
        readError,
      };
    });
    return {
      hasFormFields: fields.length > 0,
      fields,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      hasFormFields: false,
      fields: [],
      loadError: msg,
    };
  }
}

function finalizeAwesomatixStringImport(
  appKey: string,
  rawExtracted: string,
  baseRawNote: string,
  inheritedWarning: string | undefined,
  parsedData: SetupSnapshotData,
  importedKeys: string[],
  debugRows: PdfFormImportDebugRow[],
  pdfFieldName?: string
): void {
  const canonicalKey = canonicalSetupFieldKey(appKey);
  const targetKey = rewriteImportedCalculatedDisplayKey(canonicalKey);
  if (getCalibrationFieldKind(canonicalKey) === "visualMulti") {
    const options = AWESOMATIX_MULTI_SELECT_GROUPS[canonicalKey as keyof typeof AWESOMATIX_MULTI_SELECT_GROUPS];
    const deduped = normalizeMultiSelectValue(canonicalKey, rawExtracted);
    const unknown = options
      ? deduped.filter((item) => !options.some((o) => o.toLowerCase() === item.toLowerCase()))
      : [];
    const normalized = deduped;
    const rawNote = [baseRawNote, `multi=${JSON.stringify(normalized)}`].filter(Boolean).join(" · ");
    debugRows.push({
      appKey: targetKey,
      pdfFieldName,
      rawExtracted: rawExtracted.trim() || "(blank)",
      finalValue: normalized.length ? JSON.stringify(normalized) : "(blank)",
      rawNote,
      warning: unknown.length > 0
        ? `${inheritedWarning ? `${inheritedWarning} · ` : ""}Unknown options: ${unknown.join(", ")}`
        : inheritedWarning,
    });
    if (normalized.length > 0) {
      parsedData[targetKey] = normalized;
      importedKeys.push(targetKey);
    }
    return;
  }
  const san = applyAwesomatixSanitizer(appKey, rawExtracted);
  const final = san.value.trim();
  const rawNote = [baseRawNote, san.note].filter(Boolean).join(" · ");
  const warning = inheritedWarning ?? san.warning;
  debugRows.push({
    appKey: targetKey,
    pdfFieldName,
    rawExtracted: rawExtracted.trim() || "(blank)",
    finalValue: final || "(blank)",
    rawNote,
    warning,
  });
  if (final) {
    parsedData[targetKey] = final;
    importedKeys.push(targetKey);
  }
}

export async function applyPdfFormFieldMappings(input: {
  buffer: Buffer;
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
}): Promise<{ parsedData: SetupSnapshotData; importedKeys: string[]; debugRows: PdfFormImportDebugRow[] }> {
  const parsedData: SetupSnapshotData = {};
  const importedKeys: string[] = [];
  const debugRows: PdfFormImportDebugRow[] = [];

  if (Object.keys(input.formFieldMappings).length === 0) {
    return { parsedData, importedKeys, debugRows };
  }

  const pdfDoc = await PDFDocument.load(input.buffer, { ignoreEncryption: true });
  const form = pdfDoc.getForm();

  for (const [appKeyRaw, rule] of Object.entries(input.formFieldMappings)) {
    if (!rule || typeof rule !== "object") continue;
    const appKey = canonicalSetupFieldKey(appKeyRaw);

    if ("mode" in rule && rule.mode === "singleChoiceNamedFields") {
      const checks: string[] = [];
      const onLabels: string[] = [];
      for (const [label, ref] of Object.entries(rule.options)) {
        const s = optionFieldRefState({
          pdfDoc,
          form,
          pdfFieldName: ref.pdfFieldName,
          widgetInstanceIndex: ref.widgetInstanceIndex,
        });
        checks.push(`${label}→${s.debug}`);
        if (s.on) onLabels.push(label);
      }
      const rawNote = `named single-choice: ${checks.join(" ")}`;
      const warning =
        onLabels.length > 1 ? `Multiple options appear on (${onLabels.join(", ")}); expected at most one.` : undefined;
      const value = onLabels.length === 1 ? onLabels[0]! : "";
      finalizeAwesomatixStringImport(appKey, value, rawNote, warning, parsedData, importedKeys, debugRows);
      continue;
    }

    if ("mode" in rule && rule.mode === "multiSelectNamedFields") {
      const checks: string[] = [];
      const onLabels: string[] = [];
      for (const [label, ref] of Object.entries(rule.options)) {
        const s = optionFieldRefState({
          pdfDoc,
          form,
          pdfFieldName: ref.pdfFieldName,
          widgetInstanceIndex: ref.widgetInstanceIndex,
        });
        checks.push(`${label}→${s.debug}`);
        if (s.on) onLabels.push(label);
      }
      const rawNote = `named multi-select: ${checks.join(" ")}`;
      finalizeAwesomatixStringImport(appKey, onLabels.join(", "), rawNote, undefined, parsedData, importedKeys, debugRows);
      continue;
    }

    if ("mode" in rule && rule.mode === "singleChoiceWidgetGroup") {
      const field = form.getFieldMaybe(rule.pdfFieldName);
      if (!field) {
        debugRows.push({
          appKey,
          pdfFieldName: rule.pdfFieldName,
          finalValue: "",
          rawNote: `Missing field ${rule.pdfFieldName}`,
          warning: "PDF field not found",
        });
        continue;
      }
      const widgets = collectWidgetLayouts(pdfDoc, field);
      const { value, rawNote, warning } = interpretSingleChoiceAwesomatix({
        appKey,
        pdfFieldName: rule.pdfFieldName,
        options: rule.options,
        widgets,
      });
      finalizeAwesomatixStringImport(
        appKey,
        value,
        rawNote,
        warning,
        parsedData,
        importedKeys,
        debugRows,
        rule.pdfFieldName
      );
      continue;
    }

    if ("mode" in rule && rule.mode === "multiSelectWidgetGroup") {
      const field = form.getFieldMaybe(rule.pdfFieldName);
      if (!field) {
        debugRows.push({
          appKey,
          pdfFieldName: rule.pdfFieldName,
          finalValue: "",
          rawNote: `Missing field ${rule.pdfFieldName}`,
          warning: "PDF field not found",
        });
        continue;
      }
      const widgets = collectWidgetLayouts(pdfDoc, field);
      const { value, rawNote, warning } = interpretMultiSelectAwesomatix({
        appKey,
        pdfFieldName: rule.pdfFieldName,
        options: rule.options,
        widgets,
      });
      finalizeAwesomatixStringImport(
        appKey,
        value.trim(),
        rawNote,
        warning,
        parsedData,
        importedKeys,
        debugRows,
        rule.pdfFieldName
      );
      continue;
    }

    const simple = rule as { pdfFieldName: string; widgetInstanceIndex?: number };
    const pdfFieldName = simple.pdfFieldName?.trim();
    if (!pdfFieldName) continue;
    const field = form.getFieldMaybe(pdfFieldName);
    if (!field) continue;

    const widgets = collectWidgetLayouts(pdfDoc, field);
    const idx = simple.widgetInstanceIndex;
    const multiWidgetToggle = fieldSupportsPerWidgetToggle(field) && widgets.length > 1;

    if (multiWidgetToggle) {
      const inferredMulti = inferMultiSelectFromSimpleMultiWidget({
        appKey,
        pdfFieldName,
        widgets,
      });
      if (inferredMulti) {
        finalizeAwesomatixStringImport(
          appKey,
          inferredMulti.value,
          inferredMulti.rawNote,
          undefined,
          parsedData,
          importedKeys,
          debugRows,
          pdfFieldName
        );
        continue;
      }
    }

    if (multiWidgetToggle && idx !== undefined && idx >= 0 && idx < widgets.length) {
      const w = widgets[idx]!;
      const on = Boolean(w.checked);
      const rawNote = `${pdfFieldName} widget #${idx} (${field.constructor.name.replace(/^PDF/, "")}) ${on ? "on" : "off"}`;

      if (field instanceof PDFCheckBox) {
        const v = on ? "1" : "";
        debugRows.push({ appKey, finalValue: v || "(blank)", rawNote });
        parsedData[appKey] = v;
        importedKeys.push(appKey);
        continue;
      }

      if (field instanceof PDFRadioGroup) {
        const v = on ? normalizeTemplateExtractedValue(field.getSelected() ?? "") : "";
        finalizeAwesomatixStringImport(appKey, v, rawNote, undefined, parsedData, importedKeys, debugRows, pdfFieldName);
        continue;
      }
    }

    if (multiWidgetToggle && idx === undefined) {
      const inferred = inferSingleChoiceFromSimpleMultiWidget({
        appKey,
        pdfFieldName,
        widgets,
      });
      if (inferred) {
        finalizeAwesomatixStringImport(
          appKey,
          inferred.value,
          inferred.rawNote,
          inferred.warning,
          parsedData,
          importedKeys,
          debugRows,
          pdfFieldName
        );
        continue;
      }
      debugRows.push({
        appKey,
        pdfFieldName,
        finalValue: "",
        rawNote: `${pdfFieldName}: ${widgets.length} widgets — need per-widget calibration (legacy name-only mapping).`,
        warning: "Ambiguous shared field name; open calibration and map widget instances.",
      });
      continue;
    }

    if (field instanceof PDFCheckBox && widgets.length === 1) {
      try {
        const w0 = widgets[0]!;
        const on = w0.checked !== undefined ? Boolean(w0.checked) : field.isChecked();
        const v = on ? "1" : "";
        debugRows.push({
          appKey,
          finalValue: v || "(blank)",
          rawNote: `${pdfFieldName} single widget ${on ? "on" : "off"}`,
        });
        parsedData[appKey] = v;
        importedKeys.push(appKey);
      } catch {
        /* skip */
      }
      continue;
    }

    if (field instanceof PDFCheckBox) {
      try {
        const v = field.isChecked() ? "1" : "";
        debugRows.push({
          appKey,
          finalValue: v || "(blank)",
          rawNote: `${pdfFieldName} field.isChecked()`,
        });
        parsedData[appKey] = v;
        importedKeys.push(appKey);
      } catch {
        /* skip */
      }
      continue;
    }

    const { value: raw, readError } = readFieldValue(field);
    if (readError) continue;
    // Some fields are intentionally "text + numeric" on the sheet (e.g. "Speciale 0.4").
    // `normalizeTemplateExtractedValue` would strip that down to just the numeric token.
    const keepFullText =
      appKey === "bodyshell"
      || appKey === "wing"
      || appKey === "battery"
      || isPresetWithOtherCompanionKey(appKey);
    const v = keepFullText ? raw.trim() : normalizeTemplateExtractedValue(raw);
    finalizeAwesomatixStringImport(
      appKey,
      v,
      `${pdfFieldName} ${field.constructor.name.replace(/^PDF/, "")}: ${JSON.stringify(raw)}`,
      undefined,
      parsedData,
      importedKeys,
      debugRows,
      pdfFieldName
    );
  }

  return { parsedData, importedKeys, debugRows };
}

function fieldEntryByName(extraction: PdfFormFieldsExtraction): Map<string, PdfFormFieldEntry> {
  const m = new Map<string, PdfFormFieldEntry>();
  for (const f of extraction.fields) {
    if (!f?.name) continue;
    m.set(f.name, f);
  }
  return m;
}

function optionFieldRefStateFromExtraction(input: {
  byName: Map<string, PdfFormFieldEntry>;
  pdfFieldName: string;
  widgetInstanceIndex?: number;
}): { on: boolean; debug: string } {
  const entry = input.byName.get(input.pdfFieldName);
  if (!entry) return { on: false, debug: `${input.pdfFieldName}: missing` };

  const idx = input.widgetInstanceIndex;
  const widgets = entry.widgets ?? [];
  if (idx != null) {
    const on = Boolean(widgets[idx]?.checked);
    return { on, debug: `${input.pdfFieldName}#${idx}${on ? "✓" : "·"}` };
  }

  if (widgets.length > 1) {
    const onIdx = widgets.filter((w) => w.checked).map((w) => w.instanceIndex);
    return { on: onIdx.length > 0, debug: `${input.pdfFieldName}[${onIdx.join(",") || "-"}]` };
  }

  const on = entry.booleanValue != null ? Boolean(entry.booleanValue) : normalizeTemplateExtractedValue(entry.value).trim() !== "";
  return { on, debug: `${input.pdfFieldName}=${JSON.stringify(entry.value)}` };
}

function resolveSingleChoiceNamedFieldsFromExtraction(
  byName: Map<string, PdfFormFieldEntry>,
  rule: { options: Record<string, { pdfFieldName: string; widgetInstanceIndex?: number }> }
): { value: string; rawNote: string; warning?: string } {
  const checks: string[] = [];
  const onLabels: string[] = [];
  for (const [canonicalKey, ref] of Object.entries(rule.options)) {
    const s = optionFieldRefStateFromExtraction({
      byName,
      pdfFieldName: ref.pdfFieldName,
      widgetInstanceIndex: ref.widgetInstanceIndex,
    });
    checks.push(`${canonicalKey}→${s.debug}`);
    if (s.on) onLabels.push(canonicalKey);
  }
  const rawNote = `named single-choice: ${checks.join(" ")}`;
  const warning =
    onLabels.length > 1 ? `Multiple options appear on (${onLabels.join(", ")}); expected at most one.` : undefined;
  const value = onLabels.length === 1 ? onLabels[0]! : "";
  return { value, rawNote, warning };
}

/**
 * Shared resolver for mutually exclusive checkbox mappings (named fields or one AcroForm with multiple widgets).
 * Import snapshot value is the option **key** (canonical stored value), e.g. "technical" or "C01B-RAF".
 */
export function resolveSingleSelectFormRule(
  appKey: string,
  rule: PdfFormFieldMappingRule,
  byName: Map<string, PdfFormFieldEntry>
): { value: string; rawNote: string; warning?: string } | null {
  if (!("mode" in rule)) return null;
  if (rule.mode === "singleChoiceNamedFields") {
    return resolveSingleChoiceNamedFieldsFromExtraction(byName, rule);
  }
  if (rule.mode === "singleChoiceWidgetGroup") {
    const entry = byName.get(rule.pdfFieldName);
    if (!entry) {
      return { value: "", rawNote: `Missing field ${rule.pdfFieldName}`, warning: "PDF field not found" };
    }
    return interpretSingleChoiceAwesomatix({
      appKey,
      pdfFieldName: rule.pdfFieldName,
      options: rule.options,
      widgets: entry.widgets ?? [],
    });
  }
  return null;
}

/**
 * Pure mapping implementation that does NOT reload the PDF.
 * Uses extracted widget checked states + field values from `extractPdfFormFields`.
 */
export async function applyPdfFormFieldMappingsFromExtraction(input: {
  extraction: PdfFormFieldsExtraction;
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
}): Promise<{ parsedData: SetupSnapshotData; importedKeys: string[]; debugRows: PdfFormImportDebugRow[] }> {
  const parsedData: SetupSnapshotData = {};
  const importedKeys: string[] = [];
  const debugRows: PdfFormImportDebugRow[] = [];

  if (Object.keys(input.formFieldMappings).length === 0) {
    return { parsedData, importedKeys, debugRows };
  }

  const byName = fieldEntryByName(input.extraction);

  for (const [appKeyRaw, rule] of Object.entries(input.formFieldMappings)) {
    if (!rule || typeof rule !== "object") continue;
    const appKey = canonicalSetupFieldKey(appKeyRaw);

    const singleResolved = resolveSingleSelectFormRule(appKey, rule, byName);
    if (singleResolved) {
      if (
        singleResolved.warning === "PDF field not found"
        && "mode" in rule
        && rule.mode === "singleChoiceWidgetGroup"
      ) {
        debugRows.push({
          appKey,
          pdfFieldName: rule.pdfFieldName,
          finalValue: "",
          rawNote: singleResolved.rawNote,
          warning: singleResolved.warning,
        });
        continue;
      }
      finalizeAwesomatixStringImport(
        appKey,
        singleResolved.value,
        singleResolved.rawNote,
        singleResolved.warning,
        parsedData,
        importedKeys,
        debugRows,
        "mode" in rule && rule.mode === "singleChoiceWidgetGroup" ? rule.pdfFieldName : undefined
      );
      continue;
    }

    if ("mode" in rule && rule.mode === "multiSelectNamedFields") {
      const checks: string[] = [];
      const onLabels: string[] = [];
      for (const [label, ref] of Object.entries(rule.options)) {
        const s = optionFieldRefStateFromExtraction({
          byName,
          pdfFieldName: ref.pdfFieldName,
          widgetInstanceIndex: ref.widgetInstanceIndex,
        });
        checks.push(`${label}→${s.debug}`);
        if (s.on) onLabels.push(label);
      }
      const rawNote = `named multi-select: ${checks.join(" ")}`;
      finalizeAwesomatixStringImport(appKey, onLabels.join(", "), rawNote, undefined, parsedData, importedKeys, debugRows);
      continue;
    }

    if ("mode" in rule && rule.mode === "multiSelectWidgetGroup") {
      const entry = byName.get(rule.pdfFieldName);
      if (!entry) {
        debugRows.push({
          appKey,
          pdfFieldName: rule.pdfFieldName,
          finalValue: "",
          rawNote: `Missing field ${rule.pdfFieldName}`,
          warning: "PDF field not found",
        });
        continue;
      }
      const widgets = entry.widgets ?? [];
      const { value, rawNote, warning } = interpretMultiSelectAwesomatix({
        appKey,
        pdfFieldName: rule.pdfFieldName,
        options: rule.options,
        widgets,
      });
      finalizeAwesomatixStringImport(
        appKey,
        value.trim(),
        rawNote,
        warning,
        parsedData,
        importedKeys,
        debugRows,
        rule.pdfFieldName
      );
      continue;
    }

    const simple = rule as { pdfFieldName: string; widgetInstanceIndex?: number };
    const pdfFieldName = simple.pdfFieldName?.trim();
    if (!pdfFieldName) continue;
    const entry = byName.get(pdfFieldName);
    if (!entry) continue;

    const widgets = entry.widgets ?? [];
    const idx = simple.widgetInstanceIndex;
    const multiWidgetToggle = widgets.length > 1 && widgets.some((w) => w.checked !== undefined);

    if (multiWidgetToggle) {
      const inferredMulti = inferMultiSelectFromSimpleMultiWidget({
        appKey,
        pdfFieldName,
        widgets,
      });
      if (inferredMulti) {
        finalizeAwesomatixStringImport(
          appKey,
          inferredMulti.value,
          inferredMulti.rawNote,
          undefined,
          parsedData,
          importedKeys,
          debugRows,
          pdfFieldName
        );
        continue;
      }
    }

    if (multiWidgetToggle && idx !== undefined && idx >= 0 && idx < widgets.length) {
      const w = widgets[idx]!;
      const on = Boolean(w.checked);
      const rawNote = `${pdfFieldName} widget #${idx} (${entry.type}) ${on ? "on" : "off"}`;
      const v = on ? "1" : "";
      debugRows.push({ appKey, finalValue: v || "(blank)", rawNote });
      parsedData[appKey] = v;
      importedKeys.push(appKey);
      continue;
    }

    if (multiWidgetToggle && idx === undefined) {
      const inferred = inferSingleChoiceFromSimpleMultiWidget({
        appKey,
        pdfFieldName,
        widgets,
      });
      if (inferred) {
        finalizeAwesomatixStringImport(
          appKey,
          inferred.value,
          inferred.rawNote,
          inferred.warning,
          parsedData,
          importedKeys,
          debugRows,
          pdfFieldName
        );
        continue;
      }
      debugRows.push({
        appKey,
        pdfFieldName,
        finalValue: "",
        rawNote: `${pdfFieldName}: ${widgets.length} widgets — need per-widget calibration (legacy name-only mapping).`,
        warning: "Ambiguous shared field name; open calibration and map widget instances.",
      });
      continue;
    }

    const keepFullText =
      appKey === "bodyshell"
      || appKey === "wing"
      || appKey === "battery"
      || isPresetWithOtherCompanionKey(appKey);
    const raw = entry.value ?? "";
    const v = keepFullText ? raw.trim() : normalizeTemplateExtractedValue(raw);
    finalizeAwesomatixStringImport(
      appKey,
      v,
      `${pdfFieldName} ${entry.type}: ${JSON.stringify(raw)}`,
      undefined,
      parsedData,
      importedKeys,
      debugRows,
      pdfFieldName
    );
  }

  return { parsedData, importedKeys, debugRows };
}

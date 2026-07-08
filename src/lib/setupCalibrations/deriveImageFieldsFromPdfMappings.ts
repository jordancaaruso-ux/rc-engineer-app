import {
  normalizeCalibrationData,
  type ImageCalibrationField,
  type ImageRegion,
  type PdfFormFieldMappingRule,
} from "@/lib/setupCalibrations/types";
import { getCalibrationFieldKind } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import type {
  PdfFormFieldsExtraction,
  PdfFormFieldWidgetRect,
} from "@/lib/setupDocuments/pdfFormFields";

/**
 * Deterministic AcroForm → image-region derivation. Given a calibration's `formFieldMappings`
 * and the extracted PDF widget geometry, produce the equivalent image-region fields. Shared by
 * the calibrate-image derive flow and the one-click "derive image map" action on an AcroForm
 * calibration. No AI — pure geometry.
 */

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function regionFromPdfWidget(widget: PdfFormFieldWidgetRect, pageRegion?: ImageRegion): ImageRegion | null {
  if (widget.pageNumber !== 1) return null;
  if (widget.pageWidth <= 0 || widget.pageHeight <= 0 || widget.width <= 0 || widget.height <= 0) return null;
  const pageRelative = {
    xPct: clamp01(widget.x / widget.pageWidth),
    yPct: clamp01(widget.y / widget.pageHeight),
    wPct: clamp01(widget.width / widget.pageWidth),
    hPct: clamp01(widget.height / widget.pageHeight),
  };
  if (!pageRegion) return pageRelative;
  return {
    xPct: clamp01(pageRegion.xPct + pageRelative.xPct * pageRegion.wPct),
    yPct: clamp01(pageRegion.yPct + pageRelative.yPct * pageRegion.hPct),
    wPct: clamp01(pageRelative.wPct * pageRegion.wPct),
    hPct: clamp01(pageRelative.hPct * pageRegion.hPct),
  };
}

function findWidget(
  extracted: PdfFormFieldsExtraction,
  pdfFieldName: string,
  widgetInstanceIndex?: number
): PdfFormFieldWidgetRect | null {
  const row = extracted.fields.find((f) => f.name === pdfFieldName);
  if (!row) return null;
  const index = widgetInstanceIndex ?? 0;
  return row.widgets.find((w) => w.instanceIndex === index) ?? row.widgets[index] ?? null;
}

function simpleImageFieldFromRule(input: {
  key: string;
  rule: { pdfFieldName: string; widgetInstanceIndex?: number };
  extracted: PdfFormFieldsExtraction;
  warnings: string[];
  pageRegion?: ImageRegion;
}): ImageCalibrationField | null {
  const widget = findWidget(input.extracted, input.rule.pdfFieldName, input.rule.widgetInstanceIndex);
  if (!widget) {
    input.warnings.push(`missing_widget:${input.key}:${input.rule.pdfFieldName}#${input.rule.widgetInstanceIndex ?? 0}`);
    return null;
  }
  const region = regionFromPdfWidget(widget, input.pageRegion);
  if (!region) {
    input.warnings.push(`unsupported_widget_region:${input.key}:${input.rule.pdfFieldName}#${widget.instanceIndex}`);
    return null;
  }
  const kind = getCalibrationFieldKind(input.key);
  if (kind === "boolean") {
    return { kind: "checkbox", key: input.key, region, checkedValue: "1", uncheckedValue: "" };
  }
  return { kind: "text", key: input.key, region, numericOnly: kind === "number" || undefined };
}

export function deriveImageFieldsFromPdfMappings(input: {
  calibrationDataJson: unknown;
  extracted: PdfFormFieldsExtraction;
  pageRegion?: ImageRegion;
}): { fields: ImageCalibrationField[]; warnings: string[] } {
  const calibrationData = normalizeCalibrationData(input.calibrationDataJson);
  const mappings = calibrationData.formFieldMappings ?? {};
  const fields: ImageCalibrationField[] = [];
  const warnings: string[] = [];

  const optionRegion = (key: string, value: string, pdfFieldName: string, widgetInstanceIndex?: number) => {
    const widget = findWidget(input.extracted, pdfFieldName, widgetInstanceIndex);
    if (!widget) {
      warnings.push(`missing_widget:${key}:${value}:${pdfFieldName}#${widgetInstanceIndex ?? 0}`);
      return null;
    }
    const region = regionFromPdfWidget(widget, input.pageRegion);
    if (!region) {
      warnings.push(`unsupported_widget_region:${key}:${value}:${pdfFieldName}#${widget.instanceIndex}`);
      return null;
    }
    return { value, region };
  };

  for (const [key, rule] of Object.entries(mappings)) {
    if ("mode" in rule && rule.mode === "singleChoiceWidgetGroup") {
      const options = Object.entries(rule.options)
        .map(([value, ref]) => optionRegion(key, value, rule.pdfFieldName, ref.widgetInstanceIndex))
        .filter(Boolean) as Array<{ value: string; region: ImageRegion }>;
      if (options.length > 0) fields.push({ kind: "singleChoiceGroup", key, options });
      continue;
    }
    if ("mode" in rule && rule.mode === "multiSelectWidgetGroup") {
      const options = Object.entries(rule.options)
        .map(([value, ref]) => optionRegion(key, value, rule.pdfFieldName, ref.widgetInstanceIndex))
        .filter(Boolean) as Array<{ value: string; region: ImageRegion }>;
      if (options.length > 0) fields.push({ kind: "multiSelectGroup", key, options });
      continue;
    }
    if ("mode" in rule && rule.mode === "singleChoiceNamedFields") {
      const options = Object.entries(rule.options)
        .map(([value, ref]) => optionRegion(key, value, ref.pdfFieldName, ref.widgetInstanceIndex))
        .filter(Boolean) as Array<{ value: string; region: ImageRegion }>;
      if (options.length > 0) fields.push({ kind: "singleChoiceGroup", key, options });
      continue;
    }
    if ("mode" in rule && rule.mode === "multiSelectNamedFields") {
      const options = Object.entries(rule.options)
        .map(([value, ref]) => optionRegion(key, value, ref.pdfFieldName, ref.widgetInstanceIndex))
        .filter(Boolean) as Array<{ value: string; region: ImageRegion }>;
      if (options.length > 0) fields.push({ kind: "multiSelectGroup", key, options });
      continue;
    }

    const simple = simpleImageFieldFromRule({
      key,
      rule: rule as PdfFormFieldMappingRule & { pdfFieldName: string; widgetInstanceIndex?: number },
      extracted: input.extracted,
      warnings,
      pageRegion: input.pageRegion,
    });
    if (simple) fields.push(simple);
  }

  return { fields, warnings };
}

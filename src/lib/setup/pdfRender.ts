import "server-only";

import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFFont,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  rgb,
} from "pdf-lib";
import type { SetupSnapshotData } from "@/lib/runSetup";
import {
  readSetupField,
  readSetupMultiSelection,
  readSetupScrewSelection,
  readSetupSingleChoiceForPdf,
} from "@/lib/a800rrSetupRead";
import { canonicalSetupFieldKey } from "@/lib/setupDocuments/normalize";
import { collectWidgetLayouts } from "@/lib/setupDocuments/pdfFormFields";
import type { CalibrationFieldRegion, PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import { AWESOMATIX_MULTI_SELECT_GROUPS } from "@/lib/setupDocuments/awesomatixWidgetGroups";
import { SETUP_PDF_RENDER_PIPELINE_VERSION, type SetupPdfRenderResult } from "@/lib/setup/renderTypes";

function supportsPerWidgetToggle(field: PDFField): boolean {
  return field instanceof PDFCheckBox || field instanceof PDFRadioGroup;
}

/** collectWidgetLayouts uses viewer top-left; pdf-lib draws in PDF user space (bottom-left). */
function viewerRectToPdfRect(
  w: { x: number; y: number; width: number; height: number },
  pageHeight: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: w.x,
    y: pageHeight - w.y - w.height,
    width: w.width,
    height: w.height,
  };
}

function normLabel(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * True when the snapshot’s current choice matches a calibration option label, ignoring
 * case/edge whitespace (import may store C07R vs c07R vs calibration key “C07R”).
 */
function singleChoiceLabelMatchesCurrent(current: string, optionLabel: string): boolean {
  if (!current.trim()) return false;
  return normLabel(current) === normLabel(optionLabel);
}

function optionMatchesSelection(appKey: string, label: string, selected: string[]): boolean {
  const target = normLabel(label);
  if (appKey === "top_deck_screws" || appKey === "top_deck_cuts") return selected.map(normLabel).includes(target);
  return selected.map(normLabel).includes(target);
}

/**
 * Cover the template PDF’s baked-in checkbox / radio art so unselected options do not
 * show false ticks. Widget-group modes do not use AcroForm check/uncheck (only X marks);
 * the base file often still draws every position as “on”.
 */
function coverWidgetWithWhite(
  page: ReturnType<PDFDocument["getPages"]>[number],
  pageHeight: number,
  rect: { x: number; y: number; width: number; height: number }
): void {
  const r = viewerRectToPdfRect(rect, pageHeight);
  const pad = 1.2;
  try {
    page.drawRectangle({
      x: r.x - pad,
      y: r.y - pad,
      width: r.width + 2 * pad,
      height: r.height + 2 * pad,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });
  } catch {
    /* ignore */
  }
}

function drawSelectionMark(
  page: ReturnType<PDFDocument["getPages"]>[number],
  pageHeight: number,
  rect: { x: number; y: number; width: number; height: number }
): void {
  const r = viewerRectToPdfRect(rect, pageHeight);
  // Draw a clean, flattened “X” mark inside the widget bounds.
  // This avoids blue boxes / widget borders and does not rely on PDF form appearance streams.
  const pad = Math.max(0.8, Math.min(2.2, Math.min(r.width, r.height) * 0.12));
  const x1 = r.x + pad;
  const y1 = r.y + pad;
  const x2 = r.x + r.width - pad;
  const y2 = r.y + r.height - pad;
  try {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1.6, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: x1, y: y2 }, end: { x: x2, y: y1 }, thickness: 1.6, color: rgb(0, 0, 0) });
  } catch {
    /* ignore */
  }
}

/**
 * Applies structured setup values onto a loaded PDF using the same calibration rules as import.
 * Mutates `pdfDoc` in memory (caller saves bytes); never writes the original upload path.
 */
export async function applySetupValuesToPdfDocument(
  pdfDoc: PDFDocument,
  calibrationRaw: unknown,
  setup: SetupSnapshotData
): Promise<void> {
  const cal = normalizeCalibrationData(calibrationRaw);
  const mappings = cal.formFieldMappings ?? {};
  if (Object.keys(mappings).length === 0) return;

  const form = pdfDoc.getForm();
  const pages = pdfDoc.getPages();

  for (const [appKeyRaw, rule] of Object.entries(mappings)) {
    if (!rule || typeof rule !== "object") continue;
    const appKey = canonicalSetupFieldKey(appKeyRaw);

    try {
      if ("mode" in rule && rule.mode === "singleChoiceNamedFields") {
        const current = readSetupSingleChoiceForPdf(setup, appKey).trim();
        for (const [label, ref] of Object.entries(rule.options)) {
          const field = form.getFieldMaybe(ref.pdfFieldName);
          if (!field || !(field instanceof PDFCheckBox)) continue;
          if (singleChoiceLabelMatchesCurrent(current, label)) field.check();
          else field.uncheck();
        }
        continue;
      }

      if ("mode" in rule && rule.mode === "multiSelectNamedFields") {
        const selected =
          appKey === "motor_mount_screws" || appKey === "top_deck_screws" || appKey === "top_deck_cuts"
            ? readSetupScrewSelection(setup, appKey)
            : readSetupMultiSelection(setup, appKey);
        for (const [label, ref] of Object.entries(rule.options)) {
          const field = form.getFieldMaybe(ref.pdfFieldName);
          if (!field || !(field instanceof PDFCheckBox)) continue;
          if (optionMatchesSelection(appKey, label, selected)) field.check();
          else field.uncheck();
        }
        continue;
      }

      if ("mode" in rule && rule.mode === "singleChoiceWidgetGroup") {
        const current = readSetupSingleChoiceForPdf(setup, appKey).trim();
        const field = form.getFieldMaybe(rule.pdfFieldName);
        if (!field) continue;
        const widgets = collectWidgetLayouts(pdfDoc, field);
        for (const [label, ref] of Object.entries(rule.options)) {
          const w = widgets[ref.widgetInstanceIndex];
          if (!w) continue;
          const page = pages[w.pageNumber - 1];
          if (!page) continue;
          const ph = page.getHeight();
          coverWidgetWithWhite(page, ph, w);
          if (singleChoiceLabelMatchesCurrent(current, label)) drawSelectionMark(page, ph, w);
        }
        continue;
      }

      if ("mode" in rule && rule.mode === "multiSelectWidgetGroup") {
        const selected =
          appKey === "motor_mount_screws" || appKey === "top_deck_screws" || appKey === "top_deck_cuts"
            ? readSetupScrewSelection(setup, appKey)
            : readSetupMultiSelection(setup, appKey);
        const field = form.getFieldMaybe(rule.pdfFieldName);
        if (!field) continue;
        const widgets = collectWidgetLayouts(pdfDoc, field);
        for (const [label, ref] of Object.entries(rule.options)) {
          const w = widgets[ref.widgetInstanceIndex];
          if (!w) continue;
          const page = pages[w.pageNumber - 1];
          if (!page) continue;
          const ph = page.getHeight();
          coverWidgetWithWhite(page, ph, w);
          if (optionMatchesSelection(appKey, label, selected)) drawSelectionMark(page, ph, w);
        }
        continue;
      }

      applySimpleMappingRule(pdfDoc, form, pages, appKey, rule as PdfFormFieldMappingRule, setup);
    } catch {
      /* skip broken mapping */
    }
  }

  await drawRegionOverlays(pdfDoc, cal.fields ?? {}, setup);
}

function applySimpleMappingRule(
  pdfDoc: PDFDocument,
  form: ReturnType<PDFDocument["getForm"]>,
  pages: ReturnType<PDFDocument["getPages"]>,
  appKey: string,
  rule: PdfFormFieldMappingRule,
  setup: SetupSnapshotData
): void {
  if ("mode" in rule && rule.mode && rule.mode !== "acroField" && rule.mode !== undefined) return;
  const simple = rule as { pdfFieldName: string; widgetInstanceIndex?: number };
  const pdfFieldName = simple.pdfFieldName?.trim();
  if (!pdfFieldName) return;

  const field = form.getFieldMaybe(pdfFieldName);
  if (!field) return;

  const widgets = collectWidgetLayouts(pdfDoc, field);
  const multi = supportsPerWidgetToggle(field) && widgets.length > 1;
  const idx = simple.widgetInstanceIndex;

  if (multi && idx != null && idx >= 0 && idx < widgets.length) {
    const selected =
      appKey === "motor_mount_screws" || appKey === "top_deck_screws" || appKey === "top_deck_cuts"
        ? readSetupScrewSelection(setup, appKey)
        : [];
    const w = widgets[idx]!;
    const page = pages[w.pageNumber - 1];
    if (!page) return;
    const ph = page.getHeight();
    coverWidgetWithWhite(page, ph, w);
    const order = AWESOMATIX_MULTI_SELECT_GROUPS[appKey];
    const label = order?.[idx] ?? String(idx);
    if (selected.length > 0 && optionMatchesSelection(appKey, label, selected)) {
      drawSelectionMark(page, ph, w);
    }
    return;
  }

  if (field instanceof PDFTextField) {
    const text = readSetupField(setup, appKey);
    try {
      field.setText(text);
    } catch {
      /* read-only or locked */
    }
    return;
  }

  if (field instanceof PDFCheckBox && widgets.length <= 1) {
    const v = readSetupField(setup, appKey).trim();
    const on = v === "1" || /^yes|true|on$/i.test(v);
    try {
      if (on) field.check();
      else field.uncheck();
    } catch {
      /* ignore */
    }
    return;
  }

  if (field instanceof PDFRadioGroup) {
    const v = readSetupField(setup, appKey).trim();
    try {
      if (v) field.select(v);
    } catch {
      /* invalid export value */
    }
    return;
  }

  if (field instanceof PDFDropdown) {
    const v = readSetupField(setup, appKey).trim();
    try {
      if (v) field.select(v);
    } catch {
      /* ignore */
    }
  }
}

async function drawRegionOverlays(
  pdfDoc: PDFDocument,
  regions: Record<string, CalibrationFieldRegion>,
  setup: SetupSnapshotData
): Promise<void> {
  let font: PDFFont;
  try {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  } catch {
    return;
  }

  for (const [keyRaw, region] of Object.entries(regions)) {
    const key = canonicalSetupFieldKey(keyRaw);
    if (key === "motor_mount_screws" || key === "top_deck_screws" || key === "top_deck_cuts") continue;
    const text = readSetupField(setup, key).trim();
    if (!text) continue;
    const page = pdfDoc.getPages()[region.page - 1];
    if (!page) continue;
    const pageHeight = page.getHeight();
    const r = viewerRectToPdfRect(region, pageHeight);
    const size = Math.max(6, Math.min(11, region.height * 0.65));
    try {
      const line = text.length > 120 ? `${text.slice(0, 117)}…` : text;
      page.drawText(line, {
        x: r.x + 1,
        y: r.y + r.height - size - 1,
        size,
        font,
        color: rgb(0, 0, 0),
        maxWidth: Math.max(20, r.width - 2),
      });
    } catch {
      /* ignore */
    }
  }
}

export async function renderSetupPdfSnapshot(input: {
  basePdfBytes: Uint8Array;
  calibrationJson: unknown;
  setupValues: SetupSnapshotData;
}): Promise<SetupPdfRenderResult | null> {
  try {
    const pdfDoc = await PDFDocument.load(input.basePdfBytes, { ignoreEncryption: true });
    await applySetupValuesToPdfDocument(pdfDoc, input.calibrationJson, input.setupValues);
    try {
      const form = pdfDoc.getForm();
      const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
      try {
        form.updateFieldAppearances(helv);
      } catch {
        /* optional; some PDFs omit appearance streams */
      }
      form.flatten();
    } catch {
      /* some PDFs flatten poorly; still return bytes */
    }
    const pdfBytes = await pdfDoc.save();
    return { pdfBytes, pipelineVersion: SETUP_PDF_RENDER_PIPELINE_VERSION };
  } catch {
    return null;
  }
}

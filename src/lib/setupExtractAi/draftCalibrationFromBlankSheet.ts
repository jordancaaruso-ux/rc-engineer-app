import sharp from "sharp";
import { PDFDocument, PDFCheckBox, PDFRadioGroup } from "pdf-lib";
import {
  suggestUniversalParameterId,
  universalParameterCatalogForPrompt,
} from "@/lib/setupSheetModels/matchUniversalParameter";
import { buildImageTiles, DEFAULT_SETUP_EXTRACT_MODEL } from "@/lib/setupExtractAi/extractSetupFromImage";
import type { DraftedField, DraftedSchema } from "@/lib/setupExtractAi/draftSetupSheetModelSchema";
import type {
  ImageCalibration,
  ImageCalibrationAnchor,
  ImageCalibrationField,
  ImageRegion,
} from "@/lib/setupCalibrations/types";

/**
 * Stage 2A (SETUP_UPLOAD_NORTH_STAR.md): build a sheet-model schema AND an auto-generated
 * ImageCalibration from a manufacturer's *blank* setup sheet — the editable AcroForm PDF
 * supplies exact per-field geometry (widget rectangles) and stable field names, so the LLM
 * only does semantics: label, section, universal id, and which widget means which option.
 *
 * Compared to drafting from a filled sheet, this kills all three observed failure classes:
 * schema mis-structure (a checkbox group is one AcroForm field, never N phantoms), missed
 * marks (regions enable darkness mark-detection), and value misattribution (geometry is exact).
 *
 * No "server-only" import (API key is a parameter) so scripts can exercise it.
 */

export type BlankWidgetGeometry = {
  widgetIndex: number;
  /** Normalized top-left-origin rectangle on the rendered page. */
  region: ImageRegion;
};

export type BlankFieldGeometry = {
  /** AcroForm field name, e.g. "fr-shock-oil". */
  name: string;
  kind: "text" | "checkbox";
  widgets: BlankWidgetGeometry[];
};

export type BlankAcroFormGeometry = {
  pageWidthPt: number;
  pageHeightPt: number;
  fields: BlankFieldGeometry[];
};

export async function parseBlankAcroFormGeometry(pdfBytes: Buffer): Promise<BlankAcroFormGeometry> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = doc.getPage(0);
  const { width: pageWidthPt, height: pageHeightPt } = page.getSize();
  const fields: BlankFieldGeometry[] = [];
  for (const field of doc.getForm().getFields()) {
    const kind: BlankFieldGeometry["kind"] =
      field instanceof PDFCheckBox || field instanceof PDFRadioGroup ? "checkbox" : "text";
    const widgets: BlankWidgetGeometry[] = field.acroField.getWidgets().map((w, widgetIndex) => {
      const r = w.getRectangle();
      return {
        widgetIndex,
        region: {
          xPct: r.x / pageWidthPt,
          // PDF y-origin is bottom-left; image regions are top-left.
          yPct: (pageHeightPt - (r.y + r.height)) / pageHeightPt,
          wPct: r.width / pageWidthPt,
          hPct: r.height / pageHeightPt,
        },
      };
    });
    if (widgets.length === 0) continue;
    fields.push({ name: field.getName(), kind, widgets });
  }
  return { pageWidthPt, pageHeightPt, fields };
}

type LabeledOption = { widgetIndex: number; label: string };

type LabeledField = {
  name: string;
  displayLabel: string;
  section: string;
  fieldKind: "text" | "choice" | "multi";
  universalParameterId?: string;
  options?: LabeledOption[];
};

/** GPT-5 / o-series reject custom temperature and use max_completion_tokens. */
function isReasoningModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("gpt-5") || /^o[0-9]/.test(m);
}

function buildLabelingSystemPrompt(): string {
  const registry = universalParameterCatalogForPrompt()
    .map((p) => `  ${p.id} — ${p.label}`)
    .join("\n");
  return `You are labeling the input fields of a BLANK RC touring-car setup sheet. You get the sheet image (plus zoomed tiles) and a list of form fields, each with its exact position: normalized coordinates with x growing right and y growing DOWN from the top-left, so {x:0.5, y:0.1} is top-centre. Use the coordinates to find each field's box on the image and read the PRINTED labels around it.

For each field return:
- name: echo the given field name exactly.
- displayLabel: a label a driver understands WITHOUT the sheet. Include front/rear or corner when the position implies it. Generic printed words ("HEIGHT", "SHIM") must be resolved from the diagram the box sits in — follow the leader line and name the part ("Rear hub shim (mm)"), never a bare "Shim (Rear)". Keep units when printed.
- section: the printed section heading the box sits under (e.g. "Front suspension", "Shocks", "Top view").
- fieldKind: "text" for written values. For checkbox fields: "choice" when exactly one box gets marked, "multi" when drivers commonly mark more than one (rare — e.g. track layout descriptors).
- options: REQUIRED for checkbox fields — one entry per given widget, mapping each widgetIndex to the printed label next to THAT box (match by coordinates; e.g. the widget at x≈0.20 is "Carpet" if "CARPET" is printed beside it, the one at x≈0.27 is "Asphalt"). Every widgetIndex must appear exactly once, as an OBJECT with both keys, e.g. "options":[{"widgetIndex":0,"label":"Carpet"},{"widgetIndex":1,"label":"Asphalt"}] — never a plain string array. When the printed option is a symbol/icon rather than text, describe it tersely ("hex small", "position 2").
- universalParameterId: REQUIRED when the field is one of these canonical cross-car concepts (reuse the id EXACTLY); omit for car-specific fields.

Canonical universal parameters:
${registry}

Return JSON: {"fields":[{"name","displayLabel","section","fieldKind","options"?,"universalParameterId"?}, ...]} covering every listed field.`;
}

function describeFieldForPrompt(f: BlankFieldGeometry): Record<string, unknown> {
  return {
    name: f.name,
    kind: f.kind,
    widgets: f.widgets.map((w) => ({
      widgetIndex: w.widgetIndex,
      x: +w.region.xPct.toFixed(3),
      y: +w.region.yPct.toFixed(3),
      w: +w.region.wPct.toFixed(3),
      h: +w.region.hPct.toFixed(3),
    })),
  };
}

async function runLabelingBatch(input: {
  apiKey: string;
  model: string;
  imageDataUrls: string[];
  carName: string;
  batch: BlankFieldGeometry[];
}): Promise<LabeledField[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 240000);
  let raw: unknown;
  try {
    const modelParams = isReasoningModel(input.model)
      ? { max_completion_tokens: 16384, reasoning_effort: "low" }
      : { temperature: 0, max_tokens: 16384 };
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: input.model,
        ...modelParams,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildLabelingSystemPrompt() },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `Car: ${input.carName}. Image 1 is the full blank sheet; the rest are zoomed tiles `
                  + `(top-left, top-right, bottom-left, bottom-right, with overlap). Label these fields:\n`
                  + JSON.stringify(input.batch.map(describeFieldForPrompt)),
              },
              ...input.imageDataUrls.map((url) => ({
                type: "image_url" as const,
                image_url: { url, detail: "high" as const },
              })),
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Blank-sheet labeling failed: ${res.status} ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    raw = JSON.parse(json.choices?.[0]?.message?.content?.trim() ?? "{}");
  } finally {
    clearTimeout(timeoutId);
  }

  const rawFields = Array.isArray((raw as { fields?: unknown })?.fields)
    ? (raw as { fields: unknown[] }).fields
    : [];
  const out: LabeledField[] = [];
  for (const item of rawFields) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const name = typeof f.name === "string" ? f.name.trim() : "";
    if (!name) continue;
    // Tolerant option parsing: the contract asks for {widgetIndex,label} objects, but models
    // regularly return plain string arrays (in the widget order they were given) or use
    // alternate index/value key names — accept all three rather than dropping the labels.
    const optionsRaw = Array.isArray(f.options) ? f.options : [];
    const options: LabeledOption[] = [];
    optionsRaw.forEach((o, idx) => {
      if (typeof o === "string") {
        if (o.trim()) options.push({ widgetIndex: idx, label: o.trim() });
        return;
      }
      if (!o || typeof o !== "object") return;
      const oo = o as Record<string, unknown>;
      const indexCandidate = [oo.widgetIndex, oo.index, oo.widget, oo.i].find(
        (v) => typeof v === "number" && Number.isFinite(v)
      );
      const label =
        typeof oo.label === "string" && oo.label.trim()
          ? oo.label.trim()
          : typeof oo.value === "string" && oo.value.trim()
            ? oo.value.trim()
            : "";
      if (label) options.push({ widgetIndex: typeof indexCandidate === "number" ? indexCandidate : idx, label });
    });
    out.push({
      name,
      displayLabel:
        typeof f.displayLabel === "string" && f.displayLabel.trim() ? f.displayLabel.trim() : name,
      section: typeof f.section === "string" ? f.section.trim() : "",
      fieldKind: f.fieldKind === "choice" || f.fieldKind === "multi" ? f.fieldKind : "text",
      universalParameterId:
        typeof f.universalParameterId === "string" && f.universalParameterId.trim()
          ? f.universalParameterId.trim()
          : undefined,
      ...(options.length ? { options } : {}),
    });
  }
  return out;
}

function keyFromAcroName(name: string, seen: Set<string>): string {
  let key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!key) key = "field";
  while (seen.has(key)) key = `${key}_2`;
  seen.add(key);
  return key;
}

function expandTextRegion(r: ImageRegion): ImageRegion {
  // Written values regularly overhang the printed box a little; pad crops so OCR sees the
  // whole value while staying far from neighbouring boxes.
  const padX = r.wPct * 0.08;
  const padY = r.hPct * 0.3;
  const x = Math.max(0, r.xPct - padX);
  const y = Math.max(0, r.yPct - padY);
  const right = Math.min(1, r.xPct + r.wPct + padX);
  const bottom = Math.min(1, r.yPct + r.hPct + padY);
  return { xPct: x, yPct: y, wPct: Math.max(0, right - x), hPct: Math.max(0, bottom - y) };
}

/** 9x8 dHash, hex — same algorithm as imageFingerprint/imageExtractPipeline. */
async function dHashOfBuffer(buf: Buffer): Promise<string> {
  const { data } = await sharp(buf)
    .removeAlpha()
    .grayscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bits: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[y * 9 + x] ?? 0;
      const right = data[y * 9 + x + 1] ?? 0;
      bits.push(left < right ? 1 : 0);
    }
  }
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i]! << 3) | (bits[i + 1]! << 2) | (bits[i + 2]! << 1) | bits[i + 3]!;
    hex += nibble.toString(16);
  }
  return hex;
}

/** Fixed printed-chrome strips (title bars / section areas) used as alignment anchors. */
const ANCHOR_STRIPS: ImageRegion[] = [
  { xPct: 0.02, yPct: 0.005, wPct: 0.28, hPct: 0.022 },
  { xPct: 0.68, yPct: 0.005, wPct: 0.3, hPct: 0.022 },
  { xPct: 0.02, yPct: 0.31, wPct: 0.2, hPct: 0.02 },
  { xPct: 0.55, yPct: 0.5, wPct: 0.25, hPct: 0.018 },
];

async function buildAnchors(blankImage: Buffer, widthPx: number, heightPx: number): Promise<ImageCalibrationAnchor[]> {
  const anchors: ImageCalibrationAnchor[] = [];
  for (const strip of ANCHOR_STRIPS) {
    const left = Math.round(strip.xPct * widthPx);
    const top = Math.round(strip.yPct * heightPx);
    const width = Math.round(strip.wPct * widthPx);
    const height = Math.round(strip.hPct * heightPx);
    if (width <= 0 || height <= 0 || left + width > widthPx || top + height > heightPx) continue;
    try {
      const crop = await sharp(blankImage).extract({ left, top, width, height }).png().toBuffer();
      anchors.push({ ...strip, pHash: await dHashOfBuffer(crop) });
    } catch {
      // Skip anchors that fail to crop; alignment falls back to the whole-image pHash.
    }
  }
  return anchors;
}

export type BlankSheetDraftResult = {
  draftedSchema: DraftedSchema;
  imageCalibration: ImageCalibration;
  /** Raw geometry, kept for admin review UI / debugging. */
  geometry: BlankAcroFormGeometry;
  warnings: string[];
};

export const BLANK_REFERENCE_DOCUMENT_ID = "blank-sheet-reference";

export async function draftCalibrationFromBlankSheet(input: {
  apiKey: string;
  /** The manufacturer's editable (AcroForm) blank setup-sheet PDF. */
  editablePdfBytes: Buffer;
  /** Raster of the same blank sheet — becomes the calibration reference image. */
  blankImageBytes: Buffer;
  blankImageMime: "image/png" | "image/jpeg";
  carName: string;
  model?: string;
  /** SetupDocument id of the stored blank, when one exists. */
  referenceDocumentId?: string;
  batchSize?: number;
}): Promise<BlankSheetDraftResult> {
  const model = input.model?.trim() || DEFAULT_SETUP_EXTRACT_MODEL;
  const warnings: string[] = [];

  const geometry = await parseBlankAcroFormGeometry(input.editablePdfBytes);
  if (geometry.fields.length === 0) {
    throw new Error("Editable PDF has no AcroForm fields — blank-sheet drafting needs the editable blank.");
  }

  const meta = await sharp(input.blankImageBytes).metadata();
  const widthPx = meta.width ?? 0;
  const heightPx = meta.height ?? 0;
  if (widthPx <= 0 || heightPx <= 0) throw new Error("Could not read blank image dimensions");
  const pageAspect = geometry.pageWidthPt / geometry.pageHeightPt;
  const imageAspect = widthPx / heightPx;
  if (Math.abs(pageAspect - imageAspect) / pageAspect > 0.03) {
    warnings.push(`aspect_mismatch pdf=${pageAspect.toFixed(3)} image=${imageAspect.toFixed(3)}`);
  }

  const imageDataUrls = [`data:${input.blankImageMime};base64,${input.blankImageBytes.toString("base64")}`];
  try {
    for (const t of await buildImageTiles(input.blankImageBytes)) {
      imageDataUrls.push(`data:image/png;base64,${t.toString("base64")}`);
    }
  } catch {
    warnings.push("tiling_failed_full_image_only");
  }

  const batchSize = input.batchSize && input.batchSize > 0 ? input.batchSize : 60;
  const batches: BlankFieldGeometry[][] = [];
  for (let i = 0; i < geometry.fields.length; i += batchSize) {
    batches.push(geometry.fields.slice(i, i + batchSize));
  }
  const labeledByName = new Map<string, LabeledField>();
  for (const batch of batches) {
    const labeled = await runLabelingBatch({
      apiKey: input.apiKey,
      model,
      imageDataUrls,
      carName: input.carName,
      batch,
    });
    for (const f of labeled) {
      if (!labeledByName.has(f.name)) labeledByName.set(f.name, f);
    }
  }

  // Repair pass: one focused retry for fields a batch dropped (truncated JSON tails) or
  // returned with incomplete option coverage — these otherwise land as raw acro-name labels
  // and synthetic option_N values the admin has to fix by hand.
  const needsRepair = geometry.fields.filter((geo) => {
    const l = labeledByName.get(geo.name);
    if (!l) return true;
    if (geo.kind !== "checkbox") return false;
    const covered = new Set((l.options ?? []).map((o) => o.widgetIndex));
    return !geo.widgets.every((w) => covered.has(w.widgetIndex));
  });
  if (needsRepair.length > 0) {
    try {
      const repaired = await runLabelingBatch({
        apiKey: input.apiKey,
        model,
        imageDataUrls,
        carName: input.carName,
        batch: needsRepair,
      });
      for (const f of repaired) {
        const existing = labeledByName.get(f.name);
        if (!existing || (f.options?.length ?? 0) > (existing.options?.length ?? 0)) {
          labeledByName.set(f.name, f);
        }
      }
    } catch {
      warnings.push(`repair_pass_failed:${needsRepair.length}_fields`);
    }
  }

  const seenKeys = new Set<string>();
  const draftedFields: DraftedField[] = [];
  const calibrationFields: ImageCalibrationField[] = [];

  for (const geo of geometry.fields) {
    const labeled = labeledByName.get(geo.name);
    if (!labeled) warnings.push(`unlabeled_field:${geo.name}`);
    const key = keyFromAcroName(geo.name, seenKeys);
    const displayLabel = labeled?.displayLabel || geo.name;
    const section = labeled?.section || "";
    const universalParameterId =
      labeled?.universalParameterId || suggestUniversalParameterId(key, displayLabel) || undefined;

    if (geo.kind === "text") {
      draftedFields.push({
        key,
        displayLabel,
        section,
        valueType: "text",
        ...(universalParameterId ? { universalParameterId } : {}),
      });
      calibrationFields.push({ kind: "text", key, region: expandTextRegion(geo.widgets[0]!.region) });
      continue;
    }

    // Checkbox field: enforce structure from geometry — exactly one option label per widget.
    const byWidget = new Map<number, string>();
    for (const o of labeled?.options ?? []) {
      if (!byWidget.has(o.widgetIndex)) byWidget.set(o.widgetIndex, o.label);
    }
    const optionLabels: string[] = geo.widgets.map((w) => {
      const label = byWidget.get(w.widgetIndex);
      if (!label) {
        warnings.push(`option_label_missing:${geo.name}#${w.widgetIndex}`);
        return `option_${w.widgetIndex + 1}`;
      }
      return label;
    });
    const dedupedLabels = new Set(optionLabels.map((l) => l.toLowerCase()));
    if (dedupedLabels.size !== optionLabels.length) warnings.push(`option_labels_duplicated:${geo.name}`);

    if (geo.widgets.length === 1) {
      draftedFields.push({
        key,
        displayLabel,
        section,
        valueType: "choice",
        options: [optionLabels[0]!],
        ...(universalParameterId ? { universalParameterId } : {}),
      });
      calibrationFields.push({
        kind: "checkbox",
        key,
        region: geo.widgets[0]!.region,
        checkedValue: optionLabels[0]!,
        uncheckedValue: "",
      });
      continue;
    }

    draftedFields.push({
      key,
      displayLabel,
      section,
      valueType: "choice",
      options: optionLabels,
      ...(universalParameterId ? { universalParameterId } : {}),
    });
    // Gates measured on a real filled X4'26 (2026-07-07): marked boxes read ~0.33–0.41 mean
    // darkness (red X + printed border), unmarked ~0.24–0.30, real-mark margins ≥ 0.05.
    // The legacy defaults (0.45 / 0.08) would reject every mark on that sheet.
    if (labeled?.fieldKind === "multi") {
      calibrationFields.push({
        kind: "multiSelectGroup",
        key,
        options: geo.widgets.map((w, i) => ({ value: optionLabels[i]!, region: w.region })),
        minWinnerDarkness: 0.32,
      });
    } else {
      calibrationFields.push({
        kind: "singleChoiceGroup",
        key,
        options: geo.widgets.map((w, i) => ({ value: optionLabels[i]!, region: w.region })),
        minWinnerDarkness: 0.3,
        minMargin: 0.05,
      });
    }
  }

  const anchors = await buildAnchors(input.blankImageBytes, widthPx, heightPx);
  const imageCalibration: ImageCalibration = {
    reference: {
      exampleDocumentId: input.referenceDocumentId?.trim() || BLANK_REFERENCE_DOCUMENT_ID,
      widthPx,
      heightPx,
      pHash64: await dHashOfBuffer(input.blankImageBytes),
      // Header tokens are an auto-pick tiebreaker; the blank-sheet path links calibrations to
      // the sheet model directly, so they are not computed here.
      headerTokens: [],
      anchors: anchors.length ? anchors : undefined,
    },
    fields: calibrationFields,
  };

  const universalMappedCount = draftedFields.filter((f) => f.universalParameterId).length;
  const draftedSchema: DraftedSchema = {
    version: 1,
    carName: input.carName,
    fields: draftedFields,
    universalMappedCount,
    model,
    warnings,
  };

  return { draftedSchema, imageCalibration, geometry, warnings };
}

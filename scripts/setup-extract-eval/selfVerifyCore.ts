/**
 * Generalized self-verify loop core (any AcroForm-calibrated model, full-sheet images only).
 *
 * Fill the model's blank AcroForm with known values -> render page 1 server-side (same rasterizer
 * real uploads use) -> read through the REAL production image pipeline -> diff vs the filled gold.
 * Ground truth is free (we know what we filled). Unlike the MTC3 loop this calls the production
 * pipeline directly (no hand-mirror) and drops all the screenshot/degradation machinery.
 *
 * Runs only under the react-server condition (imports the server-only image pipeline):
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx <script>
 */
import { PDFDocument, PDFCheckBox, PDFTextField, PDFName, StandardFonts } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { normalizeCalibrationData, type ImageCalibration, type ImageRegion } from "@/lib/setupCalibrations/types";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { getCalibrationFieldKind } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { renderPdfFirstPageToPng } from "@/lib/setupDocuments/pdfServerRaster";
import { buildDerivedImageCalibration } from "@/lib/setupCalibrations/deriveImageMap";
import {
  extractImageRawDataFromFile,
  mapExtractedImageWithCalibration,
} from "@/lib/setupCalibrations/imageExtractPipeline";
import {
  extractPdfRawDataFromFile,
  mapExtractedPdfWithCalibration,
} from "@/lib/setupCalibrations/pdfExtractPipeline";
import {
  loadAcroGeometry,
  regionsMatch,
  extractGoldFromFilledPdf,
  compareField,
  type LiveCalibration,
  type AcroFieldInfo,
  type GoldCase,
  type FieldVerdict,
} from "./mtc3-loop/mtc3-common";

export type { GoldCase, FieldVerdict } from "./mtc3-loop/mtc3-common";

/** Live calibration + the blank AcroForm bytes, loaded for any calibration id. */
export type VerifyCalibration = LiveCalibration & { calId: string; blankPdfBytes: Buffer };

export async function loadCalibrationForVerify(calId: string): Promise<VerifyCalibration> {
  const cal = await prisma.setupSheetCalibration.findUnique({
    where: { id: calId },
    select: {
      id: true,
      calibrationDataJson: true,
      setupSheetModelId: true,
      exampleDocument: { select: { storagePath: true, mimeType: true } },
    },
  });
  if (!cal) throw new Error(`Calibration ${calId} not found`);
  const rawData = cal.calibrationDataJson as Record<string, unknown>;
  const data = normalizeCalibrationData(rawData);
  if (!data.imageCalibration) throw new Error(`Calibration ${calId} has no imageCalibration (derive the image map first)`);
  if (!cal.exampleDocument || cal.exampleDocument.mimeType !== "application/pdf") {
    throw new Error(`Calibration ${calId} needs an editable PDF example document`);
  }
  const blankPdfBytes = await readBytesFromStorageRef(cal.exampleDocument.storagePath);

  let labelByKey = new Map<string, string>();
  if (cal.setupSheetModelId) {
    const model = await prisma.setupSheetModel.findUnique({ where: { id: cal.setupSheetModelId } });
    const schema = model ? parseSetupSheetModelSchema(model.schemaJson) : null;
    if (schema) labelByKey = new Map(schema.fields.map((f) => [f.key, f.displayLabel] as const));
  }

  return {
    calId,
    imageCalibration: data.imageCalibration,
    rawData,
    mappings: (rawData.formFieldMappings ?? {}) as Record<string, { pdfFieldName?: string }>,
    labelByKey,
    blankPdfBytes,
  };
}

/**
 * Rebuild + persist the calibration's imageCalibration from its blank AcroForm using the SAME
 * builder the derive-image-map route uses (server render + content-box + widget geometry). Lets the
 * loop test a freshly-derived map (e.g. one that now carries a contentBox) without the in-app step.
 * Returns the new imageCalibration and mutates `live` in place.
 */
export async function rederiveImageMap(live: VerifyCalibration): Promise<{ contentBoxDetected: boolean; derivedFields: number }> {
  const built = await buildDerivedImageCalibration({
    pdfBytes: new Uint8Array(live.blankPdfBytes),
    calibrationDataJson: live.rawData,
    exampleDocumentId: (live.imageCalibration.reference.exampleDocumentId as string) || null,
  });
  if (!built.ok) throw new Error(`re-derive failed: ${built.error}`);
  const merged = { ...live.rawData, imageCalibration: built.imageCalibration };
  await prisma.setupSheetCalibration.update({
    where: { id: live.calId },
    data: { calibrationDataJson: merged as object },
  });
  live.imageCalibration = built.imageCalibration;
  live.rawData = merged;
  return { contentBoxDetected: built.contentBoxDetected, derivedFields: built.derivedFields };
}

// ---------- Synthetic fill (generalized, no model-specific string pools) ----------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Short, cell-fitting fill values. Setup-sheet cells are small; a long string overflows and
// mis-OCRs regardless of calibration quality, so keep every value ~1-4 chars to isolate REAL
// region/detection issues. Any legible value works — gold is whatever we fill.
const SHORT_TOKENS = ["Kit", "STD", "Alu", "V5", "A2", "Med"];

function syntheticValueForField(key: string, rnd: () => number): string {
  void getCalibrationFieldKind; // kept for future field-aware tuning
  void key;
  const roll = rnd();
  if (roll < 0.5) return (Math.round(rnd() * 90) / 10).toFixed(1); // "4.5"
  if (roll < 0.78) return String(1 + Math.round(rnd() * 40)); // "1".."41"
  if (roll < 0.9) return (Math.round(rnd() * 900) / 100).toFixed(2); // "2.75"
  return SHORT_TOKENS[Math.floor(rnd() * SHORT_TOKENS.length)]!; // occasional short text
}

/**
 * Fill the blank AcroForm for one seeded case: clear all fields, fill ~80% of text fields, mark
 * ~75% of single-choice groups and ~85% of multi groups. Choice options map to widgets by exact
 * region geometry (same as gen-synthetics). Returns the saved (still-AcroForm) PDF bytes; gold is
 * read back from these bytes by extractGoldFromFilledPdf.
 */
export async function fillSyntheticCase(input: {
  caseIndex: number;
  live: LiveCalibration;
  blankPdfBytes: Buffer;
  geo: Map<string, AcroFieldInfo>;
}): Promise<Buffer> {
  const rnd = mulberry32(1000 + input.caseIndex * 77);
  const pdf = await PDFDocument.load(input.blankPdfBytes, { ignoreEncryption: true });
  const form = pdf.getForm();

  for (const f of form.getFields()) {
    try {
      if (f instanceof PDFTextField) f.setText("");
      else if (f instanceof PDFCheckBox) f.uncheck();
    } catch { /* leave as-is */ }
  }

  for (const calField of input.live.imageCalibration.fields) {
    if (calField.kind !== "text") continue;
    const pdfName = input.live.mappings[calField.key]?.pdfFieldName;
    if (!pdfName) continue;
    if (rnd() < 0.2) continue; // deliberately blank; gold records "".
    try {
      const f = form.getField(pdfName);
      if (f instanceof PDFTextField) f.setText(syntheticValueForField(calField.key, rnd));
    } catch { /* gold self-corrects from the saved pdf */ }
  }

  const markWidget = (region: ImageRegion): void => {
    for (const acro of input.geo.values()) {
      if (acro.kind !== "checkbox") continue;
      for (const w of acro.widgets) {
        if (!regionsMatch(w.region, region) || !w.onValue) continue;
        try {
          const f = form.getField(acro.name);
          if (f instanceof PDFCheckBox) { f.acroField.setValue(PDFName.of(w.onValue)); return; }
        } catch { return; }
      }
    }
  };

  for (const calField of input.live.imageCalibration.fields) {
    if (calField.kind !== "singleChoiceGroup" && calField.kind !== "multiSelectGroup") continue;
    const opts = (calField as { options: Array<{ value: string; region: ImageRegion }> }).options;
    if (opts.length === 0) continue;
    if (calField.kind === "singleChoiceGroup") {
      if (rnd() < 0.25) continue; // unmarked: must import nothing.
      markWidget(opts[Math.floor(rnd() * opts.length)]!.region);
    } else {
      if (rnd() < 0.15) continue;
      const n = rnd() < 0.6 ? 1 : 2;
      const picked = new Set<number>();
      while (picked.size < Math.min(n, opts.length)) picked.add(Math.floor(rnd() * opts.length));
      for (const i of picked) markWidget(opts[i]!.region);
    }
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  return Buffer.from(await pdf.save());
}

// ---------- Read through the REAL production pipeline ----------

export type ReadResult = { parsedData: Record<string, string>; anchorMatchScore: number; diagnostic: unknown };

export async function readThroughProductionPipeline(
  pngBytes: Buffer,
  imageCalibration: ImageCalibration,
  rawData: Record<string, unknown>,
  opts?: { skipOcr?: boolean }
): Promise<ReadResult> {
  const calibrationDataJson = { ...rawData, imageCalibration } as unknown;
  const file = new File([new Uint8Array(pngBytes)], "synthetic.png", { type: "image/png" });
  const raw = await extractImageRawDataFromFile({ file, calibrationDataJsonForMeta: calibrationDataJson });
  const mapped = await mapExtractedImageWithCalibration({
    extracted: raw,
    calibrationDataJson,
    // "none": measure pure image-read accuracy vs the filled gold, before any convention rewrite.
    postProcess: "none",
  });
  const parsedData: Record<string, string> = {};
  for (const [k, v] of Object.entries(mapped.parsedData)) parsedData[k] = v == null ? "" : String(v);
  void opts; // skipOcr handled by the caller filtering to non-text verdicts (production always OCRs).
  return { parsedData, anchorMatchScore: raw.anchorMatchScore, diagnostic: mapped.diagnostic };
}

/**
 * Read the filled AcroForm PDF through the REAL production PDF pipeline (no rendering, no OCR —
 * values come straight out of the form fields). This is the other half of "upload a setup sheet":
 * an editable PDF should round-trip essentially exactly, so anything less than ~100% here is a
 * field-mapping bug, not a reading bug.
 */
export async function readThroughAcroFormPipeline(
  pdfBytes: Buffer,
  rawData: Record<string, unknown>
): Promise<ReadResult> {
  const file = new File([new Uint8Array(pdfBytes)], "synthetic.pdf", { type: "application/pdf" });
  const raw = await extractPdfRawDataFromFile({ file, calibrationDataJsonForMeta: rawData });
  const mapped = await mapExtractedPdfWithCalibration({
    extracted: raw,
    calibrationDataJson: rawData,
    postProcess: "none",
  });
  const parsedData: Record<string, string> = {};
  for (const [k, v] of Object.entries(mapped.parsedData)) parsedData[k] = v == null ? "" : String(v);
  return { parsedData, anchorMatchScore: 1, diagnostic: mapped.diagnostic };
}

// ---------- Scoring (no interpret: compare raw read vs raw filled gold) ----------

function normalizeForCompare(v: string): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function scoreCaseRaw(gold: GoldCase, read: ReadResult, cal: ImageCalibration): FieldVerdict[] {
  const verdicts: FieldVerdict[] = [];
  for (const field of cal.fields) {
    if (gold.unscoredKeys.includes(field.key)) continue;
    const goldV = String(gold.values[field.key] ?? "");
    const readV = String(read.parsedData[field.key] ?? "");
    const kind: FieldVerdict["kind"] =
      field.kind === "text" ? "text" : field.kind === "checkbox" ? "checkbox"
      : field.kind === "singleChoiceGroup" ? "choice" : "multi";
    let ok: boolean;
    if (kind === "multi") {
      const gSet = new Set(goldV ? goldV.split(",").map(normalizeForCompare) : []);
      const rSet = new Set(readV ? readV.split(",").map(normalizeForCompare) : []);
      ok = gSet.size === rSet.size && [...gSet].every((x) => rSet.has(x));
    } else {
      ok = compareField(goldV, readV);
    }
    const failMode = ok ? undefined : goldV === "" ? "hallucination" : readV === "" ? "miss" : "wrong";
    verdicts.push({ key: field.key, kind, gold: goldV, read: readV, ok, ...(failMode ? { failMode } : {}) });
  }
  return verdicts;
}

export { loadAcroGeometry, extractGoldFromFilledPdf, renderPdfFirstPageToPng };

/**
 * Shared machinery for the MTC3 image-accuracy convergence loop
 * (fill AcroForm -> render -> read through live calibration -> diff vs ground truth).
 *
 * The reader here MIRRORS src/lib/setupCalibrations/imageExtractPipeline.ts exactly
 * (that file is server-only and cannot be imported from tsx): same alignment (plain
 * resize; MTC3 ref pageRegion is full-page), same crop OCR prompt/model/chunking (8),
 * same normalization chain, same darkness gates, same interpret step. Keep in sync.
 */
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { PDFDocument, PDFCheckBox, PDFRadioGroup, PDFTextField, PDFName } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import type { ImageCalibration, ImageRegion } from "@/lib/setupCalibrations/types";
import { getCalibrationFieldKind } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { parseNumericFromSetupString } from "@/lib/setup/parseSetupNumeric";
import { interpretAwesomatixSetupSnapshot } from "@/lib/setupDocuments/awesomatixImportPostProcess";

export const MTC3_MODEL_ID = "cmpor11xo0001jj04j420ik83";
export const MTC3_CAL_ID = "cmpotp4qv0001l5043rtj9q70";
const GOLD_FILES = "scripts/setup-extract-eval/gold/mugen-mtc3/files";
export const EDITABLE_PDF = `${GOLD_FILES}/MTC3_EditableSetupSheet_CW.pdf`;
export const SOREN_PDF = `${GOLD_FILES}/soren-test.pdf`;
export const REAL_TEST_JPG = `${GOLD_FILES}/mugen-test-setup.jpg`;

// ---------- Live calibration / schema ----------

export type LiveCalibration = {
  imageCalibration: ImageCalibration;
  rawData: Record<string, unknown>;
  mappings: Record<string, { pdfFieldName?: string }>;
  labelByKey: Map<string, string>;
};

export async function loadLiveCalibration(): Promise<LiveCalibration> {
  const cal = await prisma.setupSheetCalibration.findUnique({ where: { id: MTC3_CAL_ID } });
  const rawData = cal!.calibrationDataJson as Record<string, unknown>;
  const data = normalizeCalibrationData(rawData);
  const model = await prisma.setupSheetModel.findUnique({ where: { id: MTC3_MODEL_ID } });
  const schema = parseSetupSheetModelSchema(model!.schemaJson);
  return {
    imageCalibration: data.imageCalibration!,
    rawData,
    mappings: (rawData.formFieldMappings ?? {}) as Record<string, { pdfFieldName?: string }>,
    labelByKey: new Map(schema?.fields.map((f) => [f.key, f.displayLabel] as const)),
  };
}

export async function saveLiveImageCalibration(imageCalibration: ImageCalibration, rawData: Record<string, unknown>) {
  const merged = { ...rawData, imageCalibration };
  await prisma.setupSheetCalibration.update({
    where: { id: MTC3_CAL_ID },
    data: { calibrationDataJson: merged as object },
  });
}

// ---------- AcroForm geometry ----------

export type AcroWidget = { widgetIndex: number; region: ImageRegion; onValue: string | null };
export type AcroFieldInfo = { name: string; kind: "text" | "checkbox"; widgets: AcroWidget[] };

export async function loadAcroGeometry(pdfBytes: Buffer): Promise<Map<string, AcroFieldInfo>> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = doc.getPage(0);
  const { width: PW, height: PH } = page.getSize();
  const out = new Map<string, AcroFieldInfo>();
  for (const field of doc.getForm().getFields()) {
    const kind: AcroFieldInfo["kind"] =
      field instanceof PDFCheckBox || field instanceof PDFRadioGroup ? "checkbox" : "text";
    const widgets: AcroWidget[] = field.acroField.getWidgets().map((w, widgetIndex) => {
      const r = w.getRectangle();
      let onValue: string | null = null;
      try {
        const ov = w.getOnValue();
        onValue = ov ? ov.decodeText() : null;
      } catch { onValue = null; }
      return {
        widgetIndex,
        region: { xPct: r.x / PW, yPct: (PH - (r.y + r.height)) / PH, wPct: r.width / PW, hPct: r.height / PH },
        onValue,
      };
    });
    out.set(field.getName(), { name: field.getName(), kind, widgets });
  }
  return out;
}

export function regionsMatch(a: ImageRegion, b: ImageRegion, tol = 1e-4): boolean {
  return (
    Math.abs(a.xPct - b.xPct) < tol && Math.abs(a.yPct - b.yPct) < tol &&
    Math.abs(a.wPct - b.wPct) < tol && Math.abs(a.hPct - b.hPct) < tol
  );
}

// ---------- Ground truth from a filled AcroForm PDF ----------

export type GoldCase = {
  /** schemaKey -> expected value; "" means the field is blank and MUST NOT import. */
  values: Record<string, string>;
  /** Keys we could not score (e.g. geometry unmatchable) — excluded from accuracy. */
  unscoredKeys: string[];
};

/**
 * Extract ground truth from a FILLED editable PDF:
 *  - text fields via formFieldMappings (schemaKey -> pdfFieldName -> getText()),
 *  - choice/multi groups by geometry (checked widget rect -> calibration option with same rect).
 */
export async function extractGoldFromFilledPdf(pdfBytes: Buffer, live: LiveCalibration): Promise<GoldCase> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const page = doc.getPage(0);
  const { width: PW, height: PH } = page.getSize();
  const values: Record<string, string> = {};
  const unscoredKeys: string[] = [];

  // Collect every CHECKED checkbox widget rect.
  const checkedRects: ImageRegion[] = [];
  for (const field of form.getFields()) {
    if (!(field instanceof PDFCheckBox || field instanceof PDFRadioGroup)) continue;
    let current: string | null = null;
    try {
      const v = field.acroField.getValue();
      current = v && v !== PDFName.of("Off") ? v.decodeText() : null;
    } catch { current = null; }
    if (!current) continue;
    for (const w of field.acroField.getWidgets()) {
      let on: string | null = null;
      try { on = w.getOnValue()?.decodeText() ?? null; } catch { on = null; }
      if (on !== current) continue;
      const r = w.getRectangle();
      checkedRects.push({ xPct: r.x / PW, yPct: (PH - (r.y + r.height)) / PH, wPct: r.width / PW, hPct: r.height / PH });
    }
  }

  for (const calField of live.imageCalibration.fields) {
    if (calField.kind === "text") {
      const pdfName = live.mappings[calField.key]?.pdfFieldName;
      if (!pdfName) { unscoredKeys.push(calField.key); continue; }
      let text = "";
      try {
        const f = form.getField(pdfName);
        text = f instanceof PDFTextField ? (f.getText() ?? "") : "";
      } catch { unscoredKeys.push(calField.key); continue; }
      values[calField.key] = text.replace(/\s+/g, " ").trim();
    } else if (calField.kind === "checkbox") {
      const hit = checkedRects.some((r) => regionsMatch(r, calField.region));
      values[calField.key] = hit ? ((calField as { checkedValue?: string }).checkedValue ?? "1") : "";
    } else {
      const opts = (calField as { options: Array<{ value: string; region: ImageRegion }> }).options;
      const hits = opts.filter((o) => checkedRects.some((r) => regionsMatch(r, o.region)));
      if (calField.kind === "singleChoiceGroup") values[calField.key] = hits[0]?.value ?? "";
      else values[calField.key] = hits.map((h) => h.value).join(",");
    }
  }
  return { values, unscoredKeys };
}

// ---------- Production-mirror reader ----------

/** Verbatim replica of applyTextTemplate.normalizeTemplateExtractedValue (server-only). */
function normalizeTemplateExtractedValue(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (/^(yes|true)$/i.test(cleaned)) return "1";
  if (/^(no|false)$/i.test(cleaned)) return "";
  if (/^[ivx]+$/i.test(cleaned)) return cleaned.toUpperCase();
  if (/^(low|high|\+1)$/i.test(cleaned)) return cleaned.toLowerCase();
  return cleaned;
}

function applyFieldKindNormalization(rawValue: string, fieldKey: string): string {
  const cleaned = rawValue.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const kind = getCalibrationFieldKind(fieldKey);
  if (kind === "text" || kind === "documentMetadata") return cleaned;
  return normalizeTemplateExtractedValue(cleaned);
}

function regionToPixels(region: ImageRegion, widthPx: number, heightPx: number) {
  const left = Math.round(region.xPct * widthPx);
  const top = Math.round(region.yPct * heightPx);
  const width = Math.round(region.wPct * widthPx);
  const height = Math.round(region.hPct * heightPx);
  if (width <= 0 || height <= 0 || left < 0 || top < 0 || left + width > widthPx || top + height > heightPx) return null;
  return { left, top, width, height };
}

async function regionDarkness(aligned: Buffer, region: ImageRegion, widthPx: number, heightPx: number): Promise<number | null> {
  const s = await regionInk(aligned, region, widthPx, heightPx);
  return s?.darkness ?? null;
}

/**
 * darkness: 1 - mean brightness (any ink). redness: mean(max(0, R - (G+B)/2)) — high only for
 * red marks; black print, white paper, and blue typed values all score ~0. The MTC3 editable
 * PDF renders its checkbox appearance in red, so redness is a near-deterministic mark signal.
 */
async function regionInk(
  aligned: Buffer, region: ImageRegion, widthPx: number, heightPx: number
): Promise<{ darkness: number; redness: number } | null> {
  const px = regionToPixels(region, widthPx, heightPx);
  if (!px) return null;
  try {
    const { data, info } = await sharp(aligned).extract(px).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let sum = 0, redSum = 0, count = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i] ?? 0, g = data[i + 1] ?? r, b = data[i + 2] ?? r;
      sum += (r + g + b) / 3;
      redSum += Math.max(0, r - (g + b) / 2);
      count++;
    }
    if (count === 0) return { darkness: 0, redness: 0 };
    return { darkness: 1 - sum / count / 255, redness: redSum / count / 255 };
  } catch { return null; }
}

type TextRequest = { key: string; numericOnly: boolean; cropPng: Buffer };

/**
 * Erase printed fill-in lines from a text crop: any pixel row that is dark across >=70% of
 * the crop width is form furniture (the value line), not the value — OCR consistently reads
 * it as a minus sign. Whitening the row is deterministic and model-free.
 */
export async function removeFillInLines(cropPng: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(cropPng).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const rowsToClear: number[] = [];
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const lum = ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3;
      if (lum < 140) dark++;
    }
    if (dark / width >= 0.7) rowsToClear.push(y);
  }
  if (rowsToClear.length === 0) return cropPng;
  for (const y of rowsToClear) {
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let x = 0; x < width; x++) {
        const i = (yy * width + x) * channels;
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      }
    }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

const OCR_SYSTEM_PROMPT =
  "You are reading cropped cells from a setup sheet. Each cell is preceded by a label like [key]. Return ONLY a single JSON object mapping each key to the exact text content of the cell below its label. Values often sit on a printed horizontal fill-in line; that line is part of the form, NOT part of the value — never read it as a minus sign or underscore. Only include a minus sign when a short dash glyph clearly precedes the digits. Ignore any partial glyph cut off at the crop edge. Use empty string when the cell is blank. Do not invent values.";

async function ocrBatch(requests: TextRequest[], apiKey: string, model = "gpt-4o-mini"): Promise<Record<string, string>> {
  if (requests.length === 0) return {};
  // Neutral aliases (f1, f2, …) instead of semantic keys: a label like [camber_rear] primes
  // the model's domain prior (camber is usually negative) and it hallucinates minus signs
  // onto positive values — measured to survive re-chunking AND solo gpt-4o tiebreaks.
  const alias = new Map<string, string>();
  requests.forEach((r, i) => alias.set(r.key, `f${i + 1}`));
  const labelHeight = 24, padding = 8;
  const composed: Array<{ input: Buffer; top: number; left: number }> = [];
  let y = 0, maxWidth = 0;
  for (const req of requests) {
    const meta = await sharp(req.cropPng).metadata();
    const w = meta.width ?? 0, h = meta.height ?? 0;
    const labelSvg = Buffer.from(
      `<svg width="${Math.max(160, w)}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="100%" height="100%" fill="white"/>` +
        `<text x="4" y="17" font-family="monospace" font-size="14" fill="black">[${alias.get(req.key)}]</text></svg>`
    );
    composed.push({ input: labelSvg, top: y, left: 0 });
    y += labelHeight + 2;
    composed.push({ input: req.cropPng, top: y, left: 0 });
    y += h + padding;
    maxWidth = Math.max(maxWidth, w, 160);
  }
  const sheet = await sharp({
    create: { width: Math.max(maxWidth, 200), height: Math.max(y, 200), channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).composite(composed).png().toBuffer();
  const body = JSON.stringify({
    model, temperature: 0, response_format: { type: "json_object" },
    messages: [
      { role: "system", content: OCR_SYSTEM_PROMPT },
      { role: "user", content: [
        { type: "text", text: `Return JSON with keys: ${requests.map((r) => alias.get(r.key)).join(", ")}. Use empty strings when unreadable.` },
        { type: "image_url", image_url: { url: `data:image/png;base64,${sheet.toString("base64")}`, detail: "high" } },
      ] },
    ],
  });
  // Retry on rate limits / transient errors — the loop fires many chunks against a 30k-TPM org.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 7; attempt++) {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
    });
    if (res.ok) break;
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 3000 * Math.pow(1.8, attempt) + Math.random() * 1000));
      continue;
    }
    break;
  }
  if (!res || !res.ok) {
    console.error(`  ocrBatch failed after retries: ${res?.status}`);
    return {};
  }
  const json = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return {}; }
  if (!parsed || typeof parsed !== "object") return {};
  const out: Record<string, string> = {};
  const keyByAlias = new Map<string, string>();
  for (const [k, a] of alias) keyByAlias.set(a, k);
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const realKey = keyByAlias.get(k);
    if (!realKey) continue;
    out[realKey] = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  }
  return out;
}

async function ocrPass(requests: TextRequest[], apiKey: string, chunkOffset: number): Promise<Record<string, string>> {
  const CHUNK = 8;
  const chunks: TextRequest[][] = [];
  // Offset shifts every chunk boundary so the two passes never share a stack composition.
  if (chunkOffset > 0) chunks.push(requests.slice(0, Math.min(chunkOffset, requests.length)));
  for (let i = chunkOffset; i < requests.length; i += CHUNK) chunks.push(requests.slice(i, i + CHUNK));
  // Bounded concurrency (2) — full parallel fan-out trips the 30k-TPM org cap.
  const merged: Record<string, string> = {};
  for (let i = 0; i < chunks.length; i += 2) {
    const results = await Promise.all(chunks.slice(i, i + 2).map((chunk) => ocrBatch(chunk, apiKey)));
    for (const r of results) Object.assign(merged, r);
  }
  return merged;
}

export type OcrConsensusMeta = { disagreements: string[]; tiebroken: string[] };

/**
 * Consensus OCR — the accuracy mechanism (and the runtime self-check design):
 * two gpt-4o-mini passes with SHIFTED chunk boundaries (stack-composition errors are
 * chunk-dependent, so they don't repeat across passes); fields where the passes disagree
 * get a solo re-read on gpt-4o, and the tiebreak answer wins.
 */
async function batchOcrTextRegions(
  requests: TextRequest[], apiKey: string, meta?: OcrConsensusMeta
): Promise<Record<string, string>> {
  if (requests.length === 0) return {};
  // Sequential passes keep peak token throughput inside the 30k-TPM org cap.
  const passA = await ocrPass(requests, apiKey, 0);
  const passB = await ocrPass(requests, apiKey, 4);
  const merged: Record<string, string> = {};
  const disagreed: TextRequest[] = [];
  for (const req of requests) {
    const a = (passA[req.key] ?? "").replace(/\s+/g, " ").trim();
    const b = (passB[req.key] ?? "").replace(/\s+/g, " ").trim();
    if (a === b) { merged[req.key] = a; continue; }
    disagreed.push(req);
    meta?.disagreements.push(req.key);
  }
  // Solo tiebreaks on the stronger model, sequential (few of them, avoids TPM spikes).
  for (const req of disagreed) {
    const solo = await ocrBatch([req], apiKey, "gpt-4o");
    merged[req.key] = (solo[req.key] ?? passA[req.key] ?? "").trim();
    meta?.tiebroken.push(`${req.key}="${merged[req.key]}"`);
  }
  return merged;
}

/**
 * Detect the sheet's printed content box (outer table border): the first/last row and column
 * whose dark-pixel fraction is high enough to be a border line. Deterministic; used to map an
 * upload with different outer margins onto the calibration reference frame.
 */
export async function detectContentBox(image: Buffer): Promise<ImageRegion | null> {
  const SAMPLE_W = 800;
  const meta = await sharp(image).metadata();
  const W0 = meta.width ?? 0, H0 = meta.height ?? 0;
  if (W0 <= 0 || H0 <= 0) return null;
  const sampleH = Math.max(1, Math.round((SAMPLE_W * H0) / W0));
  const { data, info } = await sharp(image)
    .removeAlpha().grayscale().resize(SAMPLE_W, sampleH, { fit: "fill" })
    .raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  // Find the sheet's OUTER BORDER LINES: within each edge band, the row/column with the
  // highest dark fraction is the printed frame line. Threshold-free argmax stays put when
  // JPEG compression fades a thin line; a bare dark-pixel bbox does not (it jumps to the
  // first text row once the line dips under a fixed threshold).
  const rowFrac = new Array<number>(height).fill(0);
  const colFrac = new Array<number>(width).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[y * width + x] ?? 255) < 200) { rowFrac[y]!++; colFrac[x]!++; }
    }
  }
  for (let y = 0; y < height; y++) rowFrac[y]! /= width;
  for (let x = 0; x < width; x++) colFrac[x]! /= height;
  const band = 0.18;
  const argmaxIn = (arr: number[], from: number, to: number): { idx: number; val: number } => {
    let idx = -1, val = -1;
    for (let i = Math.max(0, from); i < Math.min(arr.length, to); i++) {
      if (arr[i]! > val) { val = arr[i]!; idx = i; }
    }
    return { idx, val };
  };
  const top = argmaxIn(rowFrac, 0, Math.round(height * band));
  const bottom = argmaxIn(rowFrac, Math.round(height * (1 - band)), height);
  const left = argmaxIn(colFrac, 0, Math.round(width * band));
  const right = argmaxIn(colFrac, Math.round(width * (1 - band)), width);
  const MIN_LINE_FRAC = 0.35;
  if (top.val < MIN_LINE_FRAC || bottom.val < MIN_LINE_FRAC || left.val < MIN_LINE_FRAC || right.val < MIN_LINE_FRAC) return null;
  if (bottom.idx <= top.idx || right.idx <= left.idx) return null;
  return {
    xPct: left.idx / width,
    yPct: top.idx / height,
    wPct: (right.idx - left.idx + 1) / width,
    hPct: (bottom.idx - top.idx + 1) / height,
  };
}

/** Map the upload's content box onto the reference's: crop, scale, and place on a white canvas. */
export async function alignToReference(
  imageBytes: Buffer,
  ref: { widthPx: number; heightPx: number; contentBox?: ImageRegion }
): Promise<Buffer> {
  const plain = async () =>
    sharp(imageBytes).removeAlpha().resize(ref.widthPx, ref.heightPx, { fit: "fill" }).png().toBuffer();
  if (!ref.contentBox) return plain();
  const uploadBox = await detectContentBox(imageBytes);
  if (!uploadBox) return plain();
  // Snap to identity when the upload already matches the reference geometry (same renderer):
  // plain resize is bit-exact there, while box-mapping adds ±1px detection quantization.
  const rb = ref.contentBox;
  const close = (a: number, b: number) => Math.abs(a - b) < 0.005;
  if (close(uploadBox.xPct, rb.xPct) && close(uploadBox.yPct, rb.yPct) && close(uploadBox.wPct, rb.wPct) && close(uploadBox.hPct, rb.hPct)) {
    return plain();
  }
  const meta = await sharp(imageBytes).metadata();
  const W0 = meta.width ?? 0, H0 = meta.height ?? 0;
  const src = {
    left: Math.max(0, Math.round(uploadBox.xPct * W0)),
    top: Math.max(0, Math.round(uploadBox.yPct * H0)),
    width: Math.min(W0, Math.round(uploadBox.wPct * W0)),
    height: Math.min(H0, Math.round(uploadBox.hPct * H0)),
  };
  const dst = {
    left: Math.round(ref.contentBox.xPct * ref.widthPx),
    top: Math.round(ref.contentBox.yPct * ref.heightPx),
    width: Math.max(1, Math.round(ref.contentBox.wPct * ref.widthPx)),
    height: Math.max(1, Math.round(ref.contentBox.hPct * ref.heightPx)),
  };
  if (src.width <= 0 || src.height <= 0) return plain();
  try {
    const cropped = await sharp(imageBytes).removeAlpha()
      .extract(src).resize(dst.width, dst.height, { fit: "fill" }).png().toBuffer();
    return await sharp({
      create: { width: ref.widthPx, height: ref.heightPx, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).composite([{ input: cropped, left: dst.left, top: dst.top }]).png().toBuffer();
  } catch {
    return plain();
  }
}

export type ReadResult = {
  parsedData: Record<string, string>;
  /** Per-choice-group darkness detail for diagnosis. */
  groupDetail: Record<string, { scores: Array<{ value: string; darkness: number }>; pass: boolean; gate: string }>;
  aligned: Buffer;
};

/** Mirror of production: align (plain resize for full-page ref) -> crop OCR + darkness -> normalize -> interpret. */
export async function readImageThroughCalibration(
  imageBytes: Buffer,
  cal: ImageCalibration,
  apiKey: string,
  opts?: { skipOcr?: boolean }
): Promise<ReadResult> {
  const ref = cal.reference;
  const aligned = await alignToReference(imageBytes, ref);
  const W = ref.widthPx, H = ref.heightPx;

  const parsedData: Record<string, string> = {};
  const groupDetail: ReadResult["groupDetail"] = {};
  const textRequests: TextRequest[] = [];

  for (const field of cal.fields) {
    if (field.kind === "text") {
      const px = regionToPixels(field.region, W, H);
      if (!px) continue;
      textRequests.push({
        key: field.key,
        numericOnly: Boolean((field as { numericOnly?: boolean }).numericOnly),
        cropPng: await removeFillInLines(await sharp(aligned).extract(px).png().toBuffer()),
      });
    } else if (field.kind === "checkbox") {
      const darkness = await regionDarkness(aligned, field.region, W, H);
      if (darkness == null) continue;
      const threshold = (field as { threshold?: number }).threshold ?? 0.5;
      const checked = darkness >= threshold;
      const value = checked ? (field as { checkedValue?: string }).checkedValue ?? "1" : (field as { uncheckedValue?: string }).uncheckedValue ?? "";
      if (value !== "") parsedData[field.key] = value;
    } else {
      const opts = (field as { options: Array<{ value: string; region: ImageRegion }> }).options;
      const scores: Array<{ value: string; darkness: number; redness: number }> = [];
      for (const opt of opts) {
        const ink = await regionInk(aligned, opt.region, W, H);
        if (ink != null) scores.push({ value: opt.value, ...ink });
      }
      if (scores.length === 0) continue;
      // Mark detection, two tiers:
      //  1) REDNESS — the editable PDF's checkbox appearance renders red; red ink is a
      //     near-deterministic signal (black print/blue text/white paper all score ~0).
      //  2) Fallback: largest-GAP clustering on darkness within the group (absolute
      //     thresholds don't transfer across render resolutions).
      const RED_FLOOR = 0.008;
      const maxRed = Math.max(...scores.map((s) => s.redness));
      const medianRed = [...scores.map((s) => s.redness)].sort((a, b) => a - b)[Math.floor(scores.length / 2)] ?? 0;
      let marked: typeof scores;
      let gate: string;
      // Dominance guard: a real mark towers over the group's (noise) median; uniform
      // JPEG chroma noise raises all options together and fails the 3x test.
      if (maxRed >= RED_FLOOR && maxRed >= 3 * Math.max(medianRed, 0.002)) {
        const cut = Math.max(RED_FLOOR, maxRed * 0.4);
        marked = scores.filter((s) => s.redness >= cut).sort((a, b) => b.redness - a.redness);
        gate = `red>=${cut.toFixed(3)}`;
      } else {
        scores.sort((a, b) => b.darkness - a.darkness);
        const MIN_GAP = 0.025;
        let splitIdx = -1, largestGap = 0;
        for (let i = 0; i < scores.length - 1; i++) {
          const gap = scores[i]!.darkness - scores[i + 1]!.darkness;
          if (gap > largestGap) { largestGap = gap; splitIdx = i; }
        }
        marked = largestGap >= MIN_GAP && splitIdx >= 0 ? scores.slice(0, splitIdx + 1) : [];
        gate = `gap>=${MIN_GAP}`;
      }
      const detail = [...scores]
        .sort((a, b) => b.redness - a.redness || b.darkness - a.darkness)
        .map((s) => ({ value: s.value, darkness: Number(s.darkness.toFixed(3)), redness: Number(s.redness.toFixed(3)) })) as unknown as Array<{ value: string; darkness: number }>;
      if (field.kind === "singleChoiceGroup") {
        const pass = marked.length >= 1;
        groupDetail[field.key] = { scores: detail, pass, gate };
        if (pass) parsedData[field.key] = marked[0]!.value;
      } else {
        const pass = marked.length > 0;
        groupDetail[field.key] = { scores: detail, pass, gate };
        if (pass) parsedData[field.key] = [...marked].sort((a, b) => opts.findIndex((o) => o.value === a.value) - opts.findIndex((o) => o.value === b.value)).map((s) => s.value).join(",");
      }
    }
  }

  const ocrResults = opts?.skipOcr ? {} : await batchOcrTextRegions(textRequests, apiKey);
  for (const req of textRequests) {
    const raw = ocrResults[req.key];
    if (raw == null) continue;
    const normalized = applyFieldKindNormalization(raw, req.key);
    if (!normalized) continue;
    if (req.numericOnly) {
      const m = normalized.match(/-?\d+(?:\.\d+)?/);
      if (!m) continue;
      parsedData[req.key] = m[0];
    } else {
      parsedData[req.key] = normalized;
    }
  }

  const interpreted = interpretAwesomatixSetupSnapshot(parsedData as never) as unknown as Record<string, string>;
  return { parsedData: interpreted, groupDetail, aligned };
}

// ---------- Tolerant comparison ----------

export type FieldVerdict = {
  key: string;
  kind: "text" | "choice" | "multi" | "checkbox";
  gold: string;
  read: string;
  ok: boolean;
  failMode?: "miss" | "wrong" | "hallucination";
};

function normalizeForCompare(v: string): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function compareField(gold: string, read: string): boolean {
  const g = normalizeForCompare(gold);
  const r = normalizeForCompare(read);
  if (g === r) return true;
  // Numeric tolerance: "5.0" == "5", "+20" == "20", "4,25" == "4.25".
  const gn = parseNumericFromSetupString(gold, { allowKSuffix: true });
  const rn = parseNumericFromSetupString(read, { allowKSuffix: true });
  if (gn != null && rn != null) return Math.abs(gn - rn) < 1e-9;
  return false;
}

export function scoreCase(gold: GoldCase, read: ReadResult, cal: ImageCalibration): FieldVerdict[] {
  const verdicts: FieldVerdict[] = [];
  // Canonicalize gold through the SAME interpret step production applies to reads
  // (sign conventions: front toe/camber stored negative; both PDF and image paths do this,
  // so raw AcroForm values must be transformed before comparison).
  const goldCanon = interpretAwesomatixSetupSnapshot(gold.values as never) as unknown as Record<string, unknown>;
  for (const field of cal.fields) {
    if (gold.unscoredKeys.includes(field.key)) continue;
    const goldV = String(goldCanon[field.key] ?? "");
    const readV = String(read.parsedData[field.key] ?? "");
    const kind: FieldVerdict["kind"] =
      field.kind === "text" ? "text" : field.kind === "checkbox" ? "checkbox" : field.kind === "singleChoiceGroup" ? "choice" : "multi";
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

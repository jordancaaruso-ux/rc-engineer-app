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

/** Shrink a region toward its center (keep the inner `f` fraction of each dimension). Checkbox
 *  marks (dot/X) concentrate in the box center; printed labels and diagram lines that clip a
 *  box edge sit at the periphery. Measuring the center cancels that edge bias and turns faint
 *  black marks (full-box gap ~0.02) into large center gaps (~0.12), cleanly separable from noise. */
function shrinkRegion(r: ImageRegion, f: number): ImageRegion {
  const dw = (r.wPct * (1 - f)) / 2;
  const dh = (r.hPct * (1 - f)) / 2;
  return { xPct: r.xPct + dw, yPct: r.yPct + dh, wPct: r.wPct * f, hPct: r.hPct * f };
}
const GROUP_OPTION_CENTER_FRACTION = 0.55;

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
  // Per-attempt abort: a hung connection without it wedges the whole run indefinitely.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 7; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    try {
      res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body,
      });
    } catch {
      res = null; // aborted/hung — retry
    } finally {
      clearTimeout(timeoutId);
    }
    if (res?.ok) break;
    if (!res || res.status === 429 || res.status >= 500) {
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

export type DetectContentBoxOpts = {
  /** Expected sheet width/height (from calibration reference content box). */
  expectedAspect?: number;
  /**
   * `auto` (default): strip browser chrome if present → dark-desktop paper island → lines → ink bbox.
   * `lines`: line/ink only (used when refining a paper crop — avoids recursion).
   */
  phase?: "auto" | "lines";
  /** Set after chrome has been cropped away so we don't strip twice. */
  skipChromeStrip?: boolean;
};

/** Aspect of the calibration's content box in pixels (fallback: full reference canvas). */
export function expectedAspectFromRef(ref: {
  widthPx: number;
  heightPx: number;
  contentBox?: ImageRegion;
}): number | undefined {
  if (ref.widthPx <= 0 || ref.heightPx <= 0) return undefined;
  if (ref.contentBox && ref.contentBox.wPct > 0 && ref.contentBox.hPct > 0) {
    return (ref.contentBox.wPct * ref.widthPx) / (ref.contentBox.hPct * ref.heightPx);
  }
  return ref.widthPx / ref.heightPx;
}

function aspectError(aspect: number, expected?: number): number {
  if (!expected || expected <= 0) return 0;
  return Math.abs(aspect - expected) / expected;
}

/**
 * Find the printed setup-sheet frame inside a screenshot (full-bleed or small-in-frame).
 * Handles moderate letterboxing and sheets that only fill ~1/3 of a desktop screenshot.
 * Keep in sync with src/lib/setupCalibrations/imageExtractPipeline.ts.
 */
export async function detectContentBox(
  image: Buffer,
  opts?: DetectContentBoxOpts
): Promise<ImageRegion | null> {
  const meta = await sharp(image).metadata();
  const W0 = meta.width ?? 0;
  const H0 = meta.height ?? 0;
  if (W0 <= 0 || H0 <= 0) return null;

  // Higher sample for small-in-frame sheets: at 800px a 1/3-screen border becomes sub-pixel grey.
  const SAMPLE_W = Math.min(1600, Math.max(800, W0));
  const sampleH = Math.max(1, Math.round((SAMPLE_W * H0) / W0));
  const { data, info } = await sharp(image)
    .removeAlpha()
    .grayscale()
    .resize(SAMPLE_W, sampleH, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const DARK = 200;
  const PAPER = 175;
  const expected = opts?.expectedAspect;
  const phase = opts?.phase ?? "auto";

  const brightInt = new Float64Array((width + 1) * (height + 1));
  const darkInt = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowB = 0;
    let rowD = 0;
    for (let x = 0; x < width; x++) {
      const p = data[y * width + x] ?? 255;
      rowB += p;
      rowD += p < DARK ? 1 : 0;
      const i = (y + 1) * (width + 1) + (x + 1);
      brightInt[i] = brightInt[y * (width + 1) + (x + 1)]! + rowB;
      darkInt[i] = darkInt[y * (width + 1) + (x + 1)]! + rowD;
    }
  }
  const rectSum = (integ: Float64Array, l: number, t: number, r: number, b: number) => {
    const A = integ[t * (width + 1) + l]!;
    const B = integ[t * (width + 1) + (r + 1)]!;
    const C = integ[(b + 1) * (width + 1) + l]!;
    const D = integ[(b + 1) * (width + 1) + (r + 1)]!;
    return D - B - C + A;
  };
  const rectMeanBright = (l: number, t: number, r: number, b: number) => {
    const area = (r - l + 1) * (b - t + 1);
    return area <= 0 ? 0 : rectSum(brightInt, l, t, r, b) / area;
  };
  const edgeDarkFrac = (l: number, t: number, r: number, b: number) => {
    const top = rectSum(darkInt, l, t, r, t) / (r - l + 1);
    const bot = rectSum(darkInt, l, b, r, b) / (r - l + 1);
    const left = rectSum(darkInt, l, t, l, b) / (b - t + 1);
    const right = rectSum(darkInt, r, t, r, b) / (b - t + 1);
    return (top + bot + left + right) / 4;
  };

  const corner = Math.max(4, Math.round(Math.min(width, height) * 0.04));
  const cornerBright =
    (rectMeanBright(0, 0, corner - 1, corner - 1) +
      rectMeanBright(width - corner, 0, width - 1, corner - 1) +
      rectMeanBright(0, height - corner, corner - 1, height - 1) +
      rectMeanBright(width - corner, height - corner, width - 1, height - 1)) /
    4;

  // Browser-window screenshots (PetitRC in Chrome): dark tab/URL bar on top, sheet below.
  // Without this, content-box locks onto the whole window and every field crop is wrong.
  if (phase === "auto" && !opts?.skipChromeStrip) {
    const topH = Math.max(8, Math.round(height * 0.12));
    const topMean = rectMeanBright(0, 0, width - 1, topH - 1);
    const bodyMean = rectMeanBright(
      Math.round(width * 0.08),
      Math.round(height * 0.28),
      Math.round(width * 0.92) - 1,
      Math.round(height * 0.88) - 1
    );
    if (topMean < 115 && bodyMean > 170) {
      let cutY = -1;
      // First sustained bright paper row below the chrome (not a single anti-aliased speck).
      for (let y = Math.round(height * 0.04); y < Math.round(height * 0.45); y++) {
        const rowMean = rectMeanBright(Math.round(width * 0.05), y, Math.round(width * 0.95) - 1, y);
        if (rowMean < 200) continue;
        let ok = true;
        for (let k = 1; k <= 3; k++) {
          if (rectMeanBright(Math.round(width * 0.05), y + k, Math.round(width * 0.95) - 1, y + k) < 190) {
            ok = false;
            break;
          }
        }
        if (ok) {
          cutY = y;
          break;
        }
      }
      if (cutY > Math.round(height * 0.03) && cutY < Math.round(height * 0.4)) {
        const src = {
          left: 0,
          top: Math.max(0, Math.round((cutY / height) * H0) - 2),
          width: W0,
          height: 0,
        };
        src.height = H0 - src.top;
        if (src.height > 64) {
          try {
            const crop = await sharp(image).extract(src).png().toBuffer();
            const inner = await detectContentBox(crop, {
              expectedAspect: expected,
              phase: "auto",
              skipChromeStrip: true,
            });
            if (inner) {
              return {
                xPct: src.left / W0 + inner.xPct * (src.width / W0),
                yPct: src.top / H0 + inner.yPct * (src.height / H0),
                wPct: inner.wPct * (src.width / W0),
                hPct: inner.hPct * (src.height / H0),
              };
            }
          } catch {
            /* fall through */
          }
        }
      }
    }
  }

  // Dark desktop: sheet = bright paper island. Refine with a lines pass on that crop so we
  // lock to the printed frame (not the JPEG’s outer white margin).
  if (phase === "auto" && cornerBright < 120) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((data[y * width + x] ?? 0) >= PAPER) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX > minX && maxY > minY) {
      const islandW = maxX - minX + 1;
      const islandH = maxY - minY + 1;
      if (islandW / width >= 0.12 && islandH / height >= 0.12) {
        const src = {
          left: Math.max(0, Math.round((minX / width) * W0)),
          top: Math.max(0, Math.round((minY / height) * H0)),
          width: Math.min(W0, Math.round((islandW / width) * W0)),
          height: Math.min(H0, Math.round((islandH / height) * H0)),
        };
        if (src.width > 16 && src.height > 16) {
          try {
            const crop = await sharp(image).extract(src).png().toBuffer();
            const inner = await detectContentBox(crop, { expectedAspect: expected, phase: "lines" });
            if (inner) {
              return {
                xPct: src.left / W0 + inner.xPct * (src.width / W0),
                yPct: src.top / H0 + inner.yPct * (src.height / H0),
                wPct: inner.wPct * (src.width / W0),
                hPct: inner.hPct * (src.height / H0),
              };
            }
          } catch {
            /* fall through */
          }
        }
        // Fallback: island itself when aspect is close enough.
        if (aspectError(islandW / islandH, expected) <= 0.25) {
          return {
            xPct: minX / width,
            yPct: minY / height,
            wPct: islandW / width,
            hPct: islandH / height,
          };
        }
      }
    }
  }

  // Line-peak scoring (local edge ink — not diluted by desktop margins).
  const rowFrac = new Array<number>(height).fill(0);
  const colFrac = new Array<number>(width).fill(0);
  let inkMinX = width;
  let inkMinY = height;
  let inkMaxX = -1;
  let inkMaxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[y * width + x] ?? 255) < DARK) {
        rowFrac[y]!++;
        colFrac[x]!++;
        if (x < inkMinX) inkMinX = x;
        if (y < inkMinY) inkMinY = y;
        if (x > inkMaxX) inkMaxX = x;
        if (y > inkMaxY) inkMaxY = y;
      }
    }
  }
  for (let y = 0; y < height; y++) rowFrac[y]! /= width;
  for (let x = 0; x < width; x++) colFrac[x]! /= height;

  const collectPeaks = (frac: number[], minFrac: number, maxCount: number): number[] => {
    const peaks: Array<{ i: number; v: number }> = [];
    for (let i = 0; i < frac.length; i++) {
      const v = frac[i]!;
      if (v < minFrac) continue;
      const prev = i > 0 ? frac[i - 1]! : 0;
      const next = i + 1 < frac.length ? frac[i + 1]! : 0;
      if (v >= prev && v >= next) peaks.push({ i, v });
    }
    peaks.sort((a, b) => b.v - a.v);
    return peaks
      .slice(0, maxCount)
      .map((p) => p.i)
      .sort((a, b) => a - b);
  };

  // Diluted 1/3-screen borders sit ~0.10–0.17 globally; full-bleed borders are much stronger.
  const hPeaks = collectPeaks(rowFrac, 0.06, 36);
  const vPeaks = collectPeaks(colFrac, 0.06, 36);
  const minW = Math.max(8, Math.round(width * 0.12));
  const minH = Math.max(8, Math.round(height * 0.12));
  let best: { score: number; box: ImageRegion } | null = null;

  if (hPeaks.length >= 2 && vPeaks.length >= 2) {
    for (let ti = 0; ti < hPeaks.length; ti++) {
      const top = hPeaks[ti]!;
      for (let bi = ti + 1; bi < hPeaks.length; bi++) {
        const bottom = hPeaks[bi]!;
        const hPx = bottom - top + 1;
        if (hPx < minH) continue;
        for (let li = 0; li < vPeaks.length; li++) {
          const left = vPeaks[li]!;
          for (let ri = li + 1; ri < vPeaks.length; ri++) {
            const right = vPeaks[ri]!;
            const wPx = right - left + 1;
            if (wPx < minW) continue;

            const aErr = aspectError(wPx / hPx, expected);
            if (expected && aErr > 0.22) continue;

            const insetX = Math.max(1, Math.round(wPx * 0.06));
            const insetY = Math.max(1, Math.round(hPx * 0.06));
            const iL = left + insetX;
            const iT = top + insetY;
            const iR = right - insetX;
            const iB = bottom - insetY;
            if (iR <= iL || iB <= iT) continue;
            const interior = rectMeanBright(iL, iT, iR, iB);
            if (interior < PAPER) continue;

            const border = edgeDarkFrac(left, top, right, bottom);
            if (border < 0.28) continue;

            const area = (wPx * hPx) / (width * height);
            const score = border * 2.2 + interior / 255 + (1 - aErr) * 1.5 + area * 0.35;
            if (!best || score > best.score) {
              best = {
                score,
                box: {
                  xPct: left / width,
                  yPct: top / height,
                  wPct: wPx / width,
                  hPct: hPx / height,
                },
              };
            }
          }
        }
      }
    }
  }
  if (best) return best.box;

  // Light-desktop fallback: on a bright wallpaper the only dark pixels are sheet ink/frame.
  // Their bounding box is the sheet even when thin borders vanish after downscale.
  if (inkMaxX > inkMinX && inkMaxY > inkMinY && cornerBright >= 120) {
    const pad = Math.max(1, Math.round(Math.min(width, height) * 0.004));
    const left = Math.max(0, inkMinX - pad);
    const top = Math.max(0, inkMinY - pad);
    const right = Math.min(width - 1, inkMaxX + pad);
    const bottom = Math.min(height - 1, inkMaxY + pad);
    const wPx = right - left + 1;
    const hPx = bottom - top + 1;
    if (wPx >= minW && hPx >= minH) {
      const aErr = aspectError(wPx / hPx, expected);
      const interior = rectMeanBright(
        left + Math.round(wPx * 0.05),
        top + Math.round(hPx * 0.05),
        right - Math.round(wPx * 0.05),
        bottom - Math.round(hPx * 0.05)
      );
      if (aErr <= 0.25 && interior >= PAPER) {
        return {
          xPct: left / width,
          yPct: top / height,
          wPct: wPx / width,
          hPct: hPx / height,
        };
      }
    }
  }

  return null;
}

/** Map the upload's content box onto the reference's: crop, scale, and place on a white canvas. */
export async function alignToReference(
  imageBytes: Buffer,
  ref: { widthPx: number; heightPx: number; contentBox?: ImageRegion }
): Promise<Buffer> {
  const plain = async () =>
    sharp(imageBytes).removeAlpha().resize(ref.widthPx, ref.heightPx, { fit: "fill" }).png().toBuffer();
  if (!ref.contentBox) return plain();
  const uploadBox = await detectContentBox(imageBytes, {
    expectedAspect: expectedAspectFromRef(ref),
  });
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
/**
 * Build the text-field crops exactly as the reader would (same alignment + fill-in-line removal),
 * without running any OCR. Used by the local-OCR (Tesseract) bench to measure a cloud-free reader.
 */
export async function buildTextRequests(imageBytes: Buffer, cal: ImageCalibration): Promise<TextRequest[]> {
  const ref = cal.reference;
  const aligned = await alignToReference(imageBytes, ref);
  const W = ref.widthPx, H = ref.heightPx;
  const out: TextRequest[] = [];
  for (const field of cal.fields) {
    if (field.kind !== "text") continue;
    const px = regionToPixels(field.region, W, H);
    if (!px) continue;
    out.push({
      key: field.key,
      numericOnly: Boolean((field as { numericOnly?: boolean }).numericOnly),
      cropPng: await removeFillInLines(await sharp(aligned).extract(px).png().toBuffer()),
    });
  }
  return out;
}

export type { TextRequest };

/** Otsu threshold over an option-darkness histogram — the sheet-adaptive marked/unmarked split
 *  for black-style sheets. Renderer-independent (adapts to each sheet's own mark/blank levels),
 *  unlike a fixed floor. Returns null when the distribution is nearly unimodal (all-blank or
 *  all-marked) so the caller can fall back to the per-group gap heuristic. */
export function otsuDarknessThreshold(values: number[]): number | null {
  if (values.length < 8) return null;
  const bins = 64;
  const hist = new Array(bins).fill(0);
  for (const v of values) hist[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = 0, thr = 0;
  for (let t = 0; t < bins; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = (t + 0.5) / bins; }
  }
  return best > 0 ? thr : null;
}

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

  // First pass over groups: measure ink and detect the SHEET'S MARK STYLE. Marks on one
  // digital sheet are homogeneous: either the red editable-PDF appearance or a black
  // rendering (PetitRC style). If several groups fire the red test, the sheet is
  // red-style and any group without red ink is simply unmarked — which lets the
  // black-style gap threshold drop low enough to catch faint black marks without
  // false-marking unmarked groups on red-style sheets.
  type GroupScores = Array<{ value: string; darkness: number; redness: number }>;
  const RED_FLOOR = 0.008;
  const groupInk = new Map<string, GroupScores>();
  let redStyleGroups = 0;
  for (const field of cal.fields) {
    if (field.kind !== "singleChoiceGroup" && field.kind !== "multiSelectGroup") continue;
    const opts = (field as { options: Array<{ value: string; region: ImageRegion }> }).options;
    const scores: GroupScores = [];
    for (const opt of opts) {
      const ink = await regionInk(aligned, shrinkRegion(opt.region, GROUP_OPTION_CENTER_FRACTION), W, H);
      if (ink == null) continue;
      scores.push({ value: opt.value, ...ink });
    }
    groupInk.set(field.key, scores);
    if (scores.length > 0) {
      const maxRed = Math.max(...scores.map((s) => s.redness));
      const minRed = Math.min(...scores.map((s) => s.redness));
      // Compare against the group MINIMUM: chroma noise is uniform (max ~ min), real marks
      // tower over the cleanest unmarked option. A median lands ON a mark when half the
      // group is marked and wrongly rejects it.
      if (maxRed >= RED_FLOOR && maxRed >= 3 * Math.max(minRed, 0.002)) redStyleGroups++;
    }
  }
  const sheetIsRedStyle = redStyleGroups >= 3;
  // Black-style sheets: one sheet-adaptive darkness threshold beats per-group gap-splitting.
  // Marks and blanks form a bimodal distribution across the whole sheet; the per-group largest-gap
  // heuristic both false-POSITIVES (a group with no mark still has a "biggest gap" so it marks the
  // darkest option) and false-NEGATIVES (the biggest gap lands between two strong marks, dropping a
  // faint-but-real one). Otsu over all option darknesses splits them once, renderer-independently.
  // Real case 2026-07-15: recovered a dropped multi-select mark (b=0.238) and killed a false
  // positive (bypass=0.173) at T=0.227, both of which the gap heuristic got wrong.
  const blackThreshold = sheetIsRedStyle
    ? null
    : otsuDarknessThreshold([...groupInk.values()].flat().map((s) => s.darkness));

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
      const scores = groupInk.get(field.key) ?? [];
      if (scores.length === 0) continue;
      // Mark detection, style-aware:
      //  1) REDNESS — the editable PDF's checkbox appearance renders red; red ink is a
      //     near-deterministic signal (black print/blue text/white paper all score ~0).
      //  2) Red-style sheet, group without red → unmarked (marks are homogeneous per sheet).
      //  3) Black-style sheet → largest-GAP clustering on darkness. Threshold measured:
      //     black marks gap >= 0.014 over their group; unmarked groups spread <= ~0.005 on
      //     black-style sheets (red-style sheets' larger unmarked spreads are excluded by 2).
      const maxRed = Math.max(...scores.map((s) => s.redness));
      const minRed = Math.min(...scores.map((s) => s.redness));
      let marked: typeof scores;
      let gate: string;
      // Dominance guard vs the group MINIMUM: uniform JPEG chroma noise raises all options
      // together (max ~ min) and fails the 3x test; real marks tower over the cleanest
      // unmarked option. On an established red-style sheet even a fully-marked group is
      // legitimate — bypass dominance but demand a firmer absolute floor (real marks
      // measure >= 0.088; noise <= 0.004).
      const redDominant = maxRed >= RED_FLOOR && maxRed >= 3 * Math.max(minRed, 0.002);
      if (redDominant || (sheetIsRedStyle && maxRed >= 0.03)) {
        const cut = Math.max(sheetIsRedStyle && !redDominant ? 0.015 : RED_FLOOR, maxRed * 0.4);
        marked = scores.filter((s) => s.redness >= cut).sort((a, b) => b.redness - a.redness);
        gate = `red>=${cut.toFixed(3)}`;
      } else if (sheetIsRedStyle) {
        marked = [];
        gate = "red-style-sheet:no-red-in-group";
      } else if (blackThreshold != null) {
        scores.sort((a, b) => b.darkness - a.darkness);
        marked = scores.filter((s) => s.darkness >= blackThreshold);
        gate = `otsu>=${blackThreshold.toFixed(3)}`;
      } else {
        // Fallback: per-group largest-gap split (nearly-unimodal sheet → no global threshold).
        scores.sort((a, b) => b.darkness - a.darkness);
        const MIN_GAP = 0.05;
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

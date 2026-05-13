import "server-only";

import sharp from "sharp";
import type { SetupSnapshotData } from "@/lib/runSetup";
import {
  normalizeCalibrationData,
  type ImageCalibrationField,
  type ImageRegion,
  type SetupSheetCalibrationData,
} from "@/lib/setupCalibrations/types";
import { normalizeTemplateExtractedValue } from "@/lib/setupCalibrations/applyTextTemplate";
import { getCalibrationFieldKind } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { interpretAwesomatixSetupSnapshot } from "@/lib/setupDocuments/awesomatixImportPostProcess";
import { getOpenAiApiKey } from "@/lib/openaiServerEnv";
import {
  fingerprintImageBytes,
  hammingDistanceHex,
} from "@/lib/setupCalibrations/imageFingerprint";

type StageHook = (
  stage: string,
  event: "start" | "finish",
  data?: Record<string, unknown>
) => void | Promise<void>;

async function withStageTimeout<T>(
  stage: string,
  ms: number,
  fn: () => Promise<T>,
  onStage?: StageHook
): Promise<T> {
  const t0 = Date.now();
  await onStage?.(stage, "start");
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`Timeout after ${ms}ms (${stage})`)), ms);
    });
    const out = await Promise.race([fn(), timeout]);
    await onStage?.(stage, "finish", { ms: Date.now() - t0 });
    return out;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type ImageRawExtraction = {
  version: 1;
  /** PNG bytes of the upload after alignment (or the original after standardisation). */
  alignedImage: Buffer;
  widthPx: number;
  heightPx: number;
  /** 0..1, 1 = perfect anchor match. ≥0.6 is the soft "trustworthy" threshold. */
  anchorMatchScore: number;
  /** Hamming distance to the calibration's reference whole-image pHash (0..64). */
  pHashHamming: number | null;
};

function regionToPixels(region: ImageRegion, widthPx: number, heightPx: number): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  const left = Math.round(region.xPct * widthPx);
  const top = Math.round(region.yPct * heightPx);
  const width = Math.round(region.wPct * widthPx);
  const height = Math.round(region.hPct * heightPx);
  if (width <= 0 || height <= 0) return null;
  if (left < 0 || top < 0) return null;
  if (left + width > widthPx || top + height > heightPx) return null;
  return { left, top, width, height };
}

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

/**
 * Decode the upload, optionally resize to the calibration reference dimensions, and score
 * anchor alignment. We don't currently warp the image (no full template-match step) — instead we
 * resize-to-fit so percentage regions land in the right place, and report an alignment score so
 * the caller can lower confidence for borderline matches.
 */
export async function extractImageRawDataFromFile(input: {
  file: File;
  calibrationDataJsonForMeta?: unknown;
  onStage?: StageHook;
}): Promise<ImageRawExtraction> {
  const calibrationData = normalizeCalibrationData(input.calibrationDataJsonForMeta ?? {});
  const ref = calibrationData.imageCalibration?.reference;
  const buf = Buffer.from(await input.file.arrayBuffer());

  return withStageTimeout(
    "image_align",
    20000,
    async () => {
      const meta = await sharp(buf).metadata();
      const inWidth = meta.width ?? 0;
      const inHeight = meta.height ?? 0;
      if (inWidth <= 0 || inHeight <= 0) {
        throw new Error("Could not read image dimensions");
      }

      const targetWidth = ref?.widthPx ?? inWidth;
      const targetHeight = ref?.heightPx ?? inHeight;
      const aligned = await sharp(buf)
        .removeAlpha()
        .resize(targetWidth, targetHeight, { fit: "fill" })
        .png()
        .toBuffer();

      let pHashHamming: number | null = null;
      let anchorMatchScore = 1;
      if (ref?.pHash64) {
        try {
          const hash = await dHashOfBuffer(aligned);
          pHashHamming = hammingDistanceHex(hash, ref.pHash64);
        } catch {
          pHashHamming = null;
        }
      }
      if (ref?.anchors && ref.anchors.length > 0) {
        const distances: number[] = [];
        for (const anchor of ref.anchors) {
          const px = regionToPixels(
            { xPct: anchor.xPct, yPct: anchor.yPct, wPct: anchor.wPct, hPct: anchor.hPct },
            targetWidth,
            targetHeight
          );
          if (!px) continue;
          try {
            const crop = await sharp(aligned)
              .extract(px)
              .png()
              .toBuffer();
            const cropHash = await dHashOfBuffer(crop);
            distances.push(hammingDistanceHex(cropHash, anchor.pHash));
          } catch {
            distances.push(64);
          }
        }
        if (distances.length > 0) {
          const avg = distances.reduce((s, d) => s + d, 0) / distances.length;
          anchorMatchScore = Math.max(0, Math.min(1, 1 - avg / 32));
        }
      } else if (pHashHamming != null) {
        anchorMatchScore = Math.max(0, Math.min(1, 1 - pHashHamming / 32));
      }

      return {
        version: 1 as const,
        alignedImage: aligned,
        widthPx: targetWidth,
        heightPx: targetHeight,
        anchorMatchScore,
        pHashHamming,
      };
    },
    input.onStage
  );
}

/** Mean luminance of an RGB(A) raw buffer, 0..255 -> 0..1 inverted (1 = darkest = "filled"). */
function meanDarkness01(raw: Buffer, channels: number): number {
  if (raw.length === 0) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < raw.length; i += channels) {
    const r = raw[i] ?? 0;
    const g = raw[i + 1] ?? r;
    const b = raw[i + 2] ?? r;
    sum += (r + g + b) / 3;
    count++;
  }
  if (count === 0) return 0;
  const meanBrightness = sum / count / 255;
  return 1 - meanBrightness;
}

async function regionDarkness(aligned: Buffer, region: ImageRegion, widthPx: number, heightPx: number): Promise<number | null> {
  const px = regionToPixels(region, widthPx, heightPx);
  if (!px) return null;
  try {
    const { data, info } = await sharp(aligned)
      .extract(px)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return meanDarkness01(data, info.channels);
  } catch {
    return null;
  }
}

type TextRequest = { key: string; numericOnly: boolean; cropPng: Buffer };

/**
 * Batch OCR all text regions in a single OpenAI call by stacking labelled crops vertically.
 * One call per import is dramatically cheaper than one call per field. When OPENAI_API_KEY is
 * missing, returns an empty map and the caller leaves text fields unset.
 */
async function batchOcrTextRegions(requests: TextRequest[]): Promise<Record<string, string>> {
  if (requests.length === 0) return {};
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return {};

  const labelHeight = 24;
  const padding = 8;
  const composed: Array<{ input: Buffer; top: number; left: number }> = [];
  let y = 0;
  let maxWidth = 0;
  for (const req of requests) {
    const meta = await sharp(req.cropPng).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const labelSvg = Buffer.from(
      `<svg width="${Math.max(160, w)}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="100%" height="100%" fill="white"/>` +
        `<text x="4" y="17" font-family="monospace" font-size="14" fill="black">[${req.key}]</text>` +
        `</svg>`
    );
    composed.push({ input: labelSvg, top: y, left: 0 });
    y += labelHeight + 2;
    composed.push({ input: req.cropPng, top: y, left: 0 });
    y += h + padding;
    maxWidth = Math.max(maxWidth, w, 160);
  }
  const sheet = await sharp({
    create: {
      width: Math.max(maxWidth, 200),
      height: Math.max(y, 200),
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composed)
    .png()
    .toBuffer();

  const dataUrl = `data:image/png;base64,${sheet.toString("base64")}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are reading cropped cells from a setup sheet. Each cell is preceded by a label like [key]. Return ONLY a single JSON object mapping each key to the exact text content of the cell below its label. Use empty string when unreadable. Do not invent values.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Return JSON with keys: ${requests.map((r) => r.key).join(", ")}. Use empty strings when unreadable.`,
              },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return {};
    const json = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return {};
    }
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    const requested = new Set(requests.map((r) => r.key));
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!requested.has(k)) continue;
      out[k] = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
    }
    return out;
  } catch {
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
}

function applyFieldKindNormalization(rawValue: string, fieldKey: string): string {
  const cleaned = rawValue.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const kind = getCalibrationFieldKind(fieldKey);
  if (kind === "text" || kind === "documentMetadata") return cleaned;
  return normalizeTemplateExtractedValue(cleaned);
}

export type ImageMappingDiagnostic = {
  calibrationProfileId?: string;
  templateType?: string;
  expected: { textFields: number; checkboxFields: number; groupFields: number };
  matched: { keys: number; keysSample: string[] };
  alignment: { anchorMatchScore: number; pHashHamming: number | null };
  warnings?: string[];
};

export async function mapExtractedImageWithCalibration(input: {
  extracted: ImageRawExtraction;
  calibrationDataJson: unknown;
  calibrationProfileId?: string;
  onStage?: StageHook;
}): Promise<{
  parsedData: SetupSnapshotData;
  importedKeys: string[];
  calibrationData: SetupSheetCalibrationData;
  diagnostic: ImageMappingDiagnostic;
}> {
  const calibrationData = normalizeCalibrationData(input.calibrationDataJson);
  const fields = calibrationData.imageCalibration?.fields ?? [];
  const parsedData: SetupSnapshotData = {};
  const importedKeys: string[] = [];
  const warnings: string[] = [];

  let textFields = 0;
  let checkboxFields = 0;
  let groupFields = 0;
  const textRequests: TextRequest[] = [];
  const aligned = input.extracted.alignedImage;
  const widthPx = input.extracted.widthPx;
  const heightPx = input.extracted.heightPx;

  for (const field of fields) {
    if (field.kind === "text") {
      textFields++;
      const px = regionToPixels(field.region, widthPx, heightPx);
      if (!px) {
        warnings.push(`region_oob:${field.key}`);
        continue;
      }
      try {
        const crop = await sharp(aligned).extract(px).png().toBuffer();
        textRequests.push({ key: field.key, numericOnly: Boolean(field.numericOnly), cropPng: crop });
      } catch (e) {
        warnings.push(`crop_error:${field.key}:${(e as Error).message?.slice(0, 60)}`);
      }
    } else if (field.kind === "checkbox") {
      checkboxFields++;
      const darkness = await regionDarkness(aligned, field.region, widthPx, heightPx);
      if (darkness == null) {
        warnings.push(`region_oob:${field.key}`);
        continue;
      }
      const threshold = field.threshold ?? 0.5;
      const checked = darkness >= threshold;
      const value = checked ? field.checkedValue ?? "1" : field.uncheckedValue ?? "";
      if (value !== "") {
        parsedData[field.key] = value;
        importedKeys.push(field.key);
      } else if (!checked && field.uncheckedValue === "") {
        // Explicit empty unchecked — leave the key unset.
      }
    } else if (field.kind === "singleChoiceGroup" || field.kind === "multiSelectGroup") {
      groupFields++;
      const scores: Array<{ value: string; darkness: number }> = [];
      for (const opt of field.options) {
        const darkness = await regionDarkness(aligned, opt.region, widthPx, heightPx);
        if (darkness == null) continue;
        scores.push({ value: opt.value, darkness });
      }
      if (scores.length === 0) {
        warnings.push(`group_no_options:${field.key}`);
        continue;
      }
      if (field.kind === "singleChoiceGroup") {
        scores.sort((a, b) => b.darkness - a.darkness);
        const winner = scores[0]!;
        const runnerUp = scores[1]?.darkness ?? 0;
        if (winner.darkness >= 0.45 && winner.darkness - runnerUp >= 0.08) {
          parsedData[field.key] = winner.value;
          importedKeys.push(field.key);
        } else {
          warnings.push(`group_low_confidence:${field.key}`);
        }
      } else {
        const picked = scores.filter((s) => s.darkness >= 0.5).map((s) => s.value);
        if (picked.length > 0) {
          parsedData[field.key] = picked.join(",");
          importedKeys.push(field.key);
        }
      }
    }
  }

  if (textRequests.length > 0) {
    const ocrResults = await withStageTimeout(
      "image_ocr_text_regions",
      35000,
      () => batchOcrTextRegions(textRequests),
      input.onStage
    );
    if (Object.keys(ocrResults).length === 0 && !getOpenAiApiKey()) {
      warnings.push("ocr_unavailable_no_openai_key");
    }
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
      if (!importedKeys.includes(req.key)) importedKeys.push(req.key);
    }
  }

  const interpreted = interpretAwesomatixSetupSnapshot(parsedData);

  const diagnostic: ImageMappingDiagnostic = {
    calibrationProfileId: input.calibrationProfileId,
    templateType: calibrationData.templateType,
    expected: { textFields, checkboxFields, groupFields },
    matched: { keys: importedKeys.length, keysSample: importedKeys.slice(0, 50) },
    alignment: {
      anchorMatchScore: input.extracted.anchorMatchScore,
      pHashHamming: input.extracted.pHashHamming,
    },
    warnings: warnings.length ? warnings : undefined,
  };

  return { parsedData: interpreted, importedKeys, calibrationData, diagnostic };
}

export { fingerprintImageBytes };

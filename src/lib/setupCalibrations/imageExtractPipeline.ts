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
  /** Page crop used when the calibration is PDF-page-normalized. */
  detectedPageRegion?: ImageRegion;
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

function expandRegion(region: ImageRegion, amount: number): ImageRegion {
  const x = Math.max(0, region.xPct - amount);
  const y = Math.max(0, region.yPct - amount);
  const right = Math.min(1, region.xPct + region.wPct + amount);
  const bottom = Math.min(1, region.yPct + region.hPct + amount);
  return { xPct: x, yPct: y, wPct: Math.max(0, right - x), hPct: Math.max(0, bottom - y) };
}

async function detectLikelyPageRegion(input: {
  buf: Buffer;
  widthPx: number;
  heightPx: number;
  expectedAspect: number;
  fallback: ImageRegion;
}): Promise<ImageRegion> {
  if (input.widthPx <= 0 || input.heightPx <= 0 || input.expectedAspect <= 0) return input.fallback;
  const sampleWidth = Math.min(480, input.widthPx);
  const sampleHeight = Math.max(1, Math.round(sampleWidth * input.heightPx / input.widthPx));
  try {
    const { data, info } = await sharp(input.buf)
      .removeAlpha()
      .resize(sampleWidth, sampleHeight, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? r;
        const b = data[i + 2] ?? r;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const whiteish = max >= 185 && min >= 170 && max - min <= 55;
        if (!whiteish) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        count++;
      }
    }
    const area = info.width * info.height;
    const coverage = area > 0 ? count / area : 0;
    if (maxX < minX || maxY < minY || coverage < 0.12) return input.fallback;
    const region = expandRegion(
      {
        xPct: minX / info.width,
        yPct: minY / info.height,
        wPct: (maxX - minX + 1) / info.width,
        hPct: (maxY - minY + 1) / info.height,
      },
      0.01
    );
    const aspect = (region.wPct * input.widthPx) / Math.max(1, region.hPct * input.heightPx);
    const aspectRatio = aspect / input.expectedAspect;
    if (aspectRatio < 0.65 || aspectRatio > 1.55) return input.fallback;
    if (region.wPct * region.hPct < 0.35) return input.fallback;
    return region;
  } catch {
    return input.fallback;
  }
}

/**
 * Find the sheet's OUTER BORDER LINES: within each edge band, the row/column with the highest
 * dark fraction is the printed frame line. Threshold-free argmax stays put when JPEG
 * compression fades a thin line. Used with `reference.contentBox` to map uploads from other
 * renderers (different outer margins) onto the calibration reference frame — measured to fix
 * a whole one-row-down misread class on real screenshots while staying identity for uploads
 * that already match the reference geometry.
 */
async function detectContentBox(image: Buffer): Promise<ImageRegion | null> {
  const SAMPLE_W = 800;
  try {
    const meta = await sharp(image).metadata();
    const W0 = meta.width ?? 0;
    const H0 = meta.height ?? 0;
    if (W0 <= 0 || H0 <= 0) return null;
    const sampleH = Math.max(1, Math.round((SAMPLE_W * H0) / W0));
    const { data, info } = await sharp(image)
      .removeAlpha()
      .grayscale()
      .resize(SAMPLE_W, sampleH, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const rowFrac = new Array<number>(height).fill(0);
    const colFrac = new Array<number>(width).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((data[y * width + x] ?? 255) < 200) {
          rowFrac[y]!++;
          colFrac[x]!++;
        }
      }
    }
    for (let y = 0; y < height; y++) rowFrac[y]! /= width;
    for (let x = 0; x < width; x++) colFrac[x]! /= height;
    const band = 0.18;
    const argmaxIn = (arr: number[], from: number, to: number): { idx: number; val: number } => {
      let idx = -1;
      let val = -1;
      for (let i = Math.max(0, from); i < Math.min(arr.length, to); i++) {
        if (arr[i]! > val) {
          val = arr[i]!;
          idx = i;
        }
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
  } catch {
    return null;
  }
}

/** Map the upload's content box onto the reference's: crop, scale, and place on a white canvas. */
async function alignByContentBox(
  imageBytes: Buffer,
  ref: { widthPx: number; heightPx: number; contentBox: ImageRegion }
): Promise<Buffer | null> {
  const uploadBox = await detectContentBox(imageBytes);
  if (!uploadBox) return null;
  // Snap to identity when the upload already matches the reference geometry (same renderer):
  // plain resize is bit-exact there, while box-mapping adds ±1px detection quantization.
  const rb = ref.contentBox;
  const close = (a: number, b: number) => Math.abs(a - b) < 0.005;
  if (close(uploadBox.xPct, rb.xPct) && close(uploadBox.yPct, rb.yPct) && close(uploadBox.wPct, rb.wPct) && close(uploadBox.hPct, rb.hPct)) {
    return null;
  }
  const meta = await sharp(imageBytes).metadata();
  const W0 = meta.width ?? 0;
  const H0 = meta.height ?? 0;
  const src = {
    left: Math.max(0, Math.round(uploadBox.xPct * W0)),
    top: Math.max(0, Math.round(uploadBox.yPct * H0)),
    width: Math.min(W0, Math.round(uploadBox.wPct * W0)),
    height: Math.min(H0, Math.round(uploadBox.hPct * H0)),
  };
  const dst = {
    left: Math.round(rb.xPct * ref.widthPx),
    top: Math.round(rb.yPct * ref.heightPx),
    width: Math.max(1, Math.round(rb.wPct * ref.widthPx)),
    height: Math.max(1, Math.round(rb.hPct * ref.heightPx)),
  };
  if (src.width <= 0 || src.height <= 0) return null;
  try {
    const cropped = await sharp(imageBytes)
      .removeAlpha()
      .extract(src)
      .resize(dst.width, dst.height, { fit: "fill" })
      .png()
      .toBuffer();
    return await sharp({
      create: { width: ref.widthPx, height: ref.heightPx, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([{ input: cropped, left: dst.left, top: dst.top }])
      .png()
      .toBuffer();
  } catch {
    return null;
  }
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

      // Content-box alignment (preferred when the calibration carries one): maps uploads with
      // different outer margins onto the reference frame; returns null when the upload already
      // matches the reference geometry (fall through to the plain resize below).
      if (ref?.contentBox && ref.widthPx > 0 && ref.heightPx > 0) {
        const boxAligned = await alignByContentBox(buf, {
          widthPx: ref.widthPx,
          heightPx: ref.heightPx,
          contentBox: ref.contentBox,
        });
        if (boxAligned) {
          let pHashHamming: number | null = null;
          try {
            pHashHamming = ref.pHash64 ? hammingDistanceHex(await dHashOfBuffer(boxAligned), ref.pHash64) : null;
          } catch {
            pHashHamming = null;
          }
          return {
            version: 1 as const,
            alignedImage: boxAligned,
            widthPx: ref.widthPx,
            heightPx: ref.heightPx,
            detectedPageRegion: undefined,
            anchorMatchScore: pHashHamming != null ? Math.max(0, Math.min(1, 1 - pHashHamming / 32)) : 1,
            pHashHamming,
          };
        }
      }

      const refPage = ref?.pageRegion;
      let detectedPageRegion: ImageRegion | undefined;
      let targetWidth = ref?.widthPx ?? inWidth;
      let targetHeight = ref?.heightPx ?? inHeight;
      let inputForAlignment = sharp(buf).removeAlpha();
      if (refPage) {
        const fallback = refPage;
        const expectedAspect = (refPage.wPct * (ref?.widthPx ?? inWidth)) / Math.max(1, refPage.hPct * (ref?.heightPx ?? inHeight));
        detectedPageRegion = await detectLikelyPageRegion({
          buf,
          widthPx: inWidth,
          heightPx: inHeight,
          expectedAspect,
          fallback,
        });
        const crop = regionToPixels(detectedPageRegion, inWidth, inHeight);
        if (crop) inputForAlignment = inputForAlignment.extract(crop);
        targetWidth = Math.max(1, Math.round(refPage.wPct * (ref?.widthPx ?? inWidth)));
        targetHeight = Math.max(1, Math.round(refPage.hPct * (ref?.heightPx ?? inHeight)));
      }
      const aligned = await inputForAlignment
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
        detectedPageRegion,
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
  const ink = await regionInk(aligned, region, widthPx, heightPx);
  return ink?.darkness ?? null;
}

/**
 * darkness: 1 - mean brightness (any ink). redness: mean(max(0, R - (G+B)/2)) — high only for
 * red marks; black print, white paper, and blue typed values all score ~0. Editable-PDF
 * checkbox appearances render red on the sheets we calibrate, so redness is a
 * near-deterministic mark signal (validated to 100% on the MTC3 synthetic gold set).
 */
async function regionInk(
  aligned: Buffer,
  region: ImageRegion,
  widthPx: number,
  heightPx: number
): Promise<{ darkness: number; redness: number } | null> {
  const px = regionToPixels(region, widthPx, heightPx);
  if (!px) return null;
  try {
    const { data, info } = await sharp(aligned)
      .extract(px)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let redSum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? r;
      const b = data[i + 2] ?? r;
      redSum += Math.max(0, r - (g + b) / 2);
      count++;
    }
    return {
      darkness: meanDarkness01(data, info.channels),
      redness: count === 0 ? 0 : redSum / count / 255,
    };
  } catch {
    return null;
  }
}

/**
 * Erase printed fill-in lines from a text crop: a pixel row dark across >=70% of the crop
 * width is form furniture (the value line), not the value — left in place, OCR reads it as
 * a minus sign or underscore. Whitening the row is deterministic and model-free.
 */
async function removeFillInLines(cropPng: Buffer): Promise<Buffer> {
  try {
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
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
        }
      }
    }
    return await sharp(data, { raw: { width, height, channels } }).png().toBuffer();
  } catch {
    return cropPng;
  }
}

type TextRequest = { key: string; numericOnly: boolean; cropPng: Buffer };

const OCR_SYSTEM_PROMPT =
  "You are reading cropped cells from a setup sheet. Each cell is preceded by a label like [key]. Return ONLY a single JSON object mapping each key to the exact text content of the cell below its label. Values often sit on a printed horizontal fill-in line; that line is part of the form, NOT part of the value — never read it as a minus sign or underscore. Only include a minus sign when a short dash glyph clearly precedes the digits. Ignore any partial glyph cut off at the crop edge. Use empty string when the cell is blank. Do not invent values.";

/**
 * OCR one stacked batch of labelled crops. Crops are labelled with NEUTRAL aliases (f1, f2, …)
 * instead of semantic keys: a label like [camber_rear] primes the model's domain prior (camber
 * is usually negative) and it hallucinates minus signs onto positive values.
 */
async function ocrBatch(requests: TextRequest[], apiKey: string, model = "gpt-4o-mini"): Promise<Record<string, string>> {
  if (requests.length === 0) return {};

  const alias = new Map<string, string>();
  requests.forEach((r, i) => alias.set(r.key, `f${i + 1}`));

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
        `<text x="4" y="17" font-family="monospace" font-size="14" fill="black">[${alias.get(req.key)}]</text>` +
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
  const body = JSON.stringify({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: OCR_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Return JSON with keys: ${requests.map((r) => alias.get(r.key)).join(", ")}. Use empty strings when unreadable.`,
          },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
  });
  try {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          signal: controller.signal,
          body,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (res.ok) break;
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * Math.pow(1.8, attempt) + Math.random() * 500));
        continue;
      }
      break;
    }
    if (!res || !res.ok) return {};
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
    const keyByAlias = new Map<string, string>();
    for (const [k, a] of alias) keyByAlias.set(a, k);
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const realKey = keyByAlias.get(k);
      if (!realKey) continue;
      out[realKey] = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
    }
    return out;
  } catch {
    return {};
  }
}

async function ocrPass(requests: TextRequest[], apiKey: string, chunkOffset: number): Promise<Record<string, string>> {
  const CHUNK = 8;
  const chunks: TextRequest[][] = [];
  // Offset shifts every chunk boundary so the two passes never share a stack composition.
  if (chunkOffset > 0) chunks.push(requests.slice(0, Math.min(chunkOffset, requests.length)));
  for (let i = chunkOffset; i < requests.length; i += CHUNK) chunks.push(requests.slice(i, i + CHUNK));
  // Bounded concurrency — full parallel fan-out trips low org TPM caps.
  const merged: Record<string, string> = {};
  for (let i = 0; i < chunks.length; i += 3) {
    const results = await Promise.all(chunks.slice(i, i + 3).map((chunk) => ocrBatch(chunk, apiKey)));
    for (const r of results) Object.assign(merged, r);
  }
  return merged;
}

export type OcrConsensusMeta = { disagreements: string[]; tiebroken: string[] };

/**
 * Consensus OCR — the self-check that carries the accuracy bar. Stacking every crop into one
 * call makes gpt-4o-mini mis-map [key]->value labels (measured on the MTC3 sheet: 73 crops in
 * one stack scrambled numeric values — spring 4.5 read as "Medium", shock oil 500 as "30wt").
 * Stack-composition errors are chunk-dependent, so: two passes with SHIFTED chunk boundaries;
 * fields where the passes disagree get a solo re-read on gpt-4o, whose answer wins. Validated
 * to 99.7–100% field accuracy on the MTC3 synthetic gold set.
 */
async function batchOcrTextRegions(requests: TextRequest[], meta?: OcrConsensusMeta): Promise<Record<string, string>> {
  if (requests.length === 0) return {};
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return {};

  const passA = await ocrPass(requests, apiKey, 0);
  const passB = await ocrPass(requests, apiKey, 4);
  const merged: Record<string, string> = {};
  const disagreed: TextRequest[] = [];
  for (const req of requests) {
    const a = (passA[req.key] ?? "").replace(/\s+/g, " ").trim();
    const b = (passB[req.key] ?? "").replace(/\s+/g, " ").trim();
    if (a === b) {
      merged[req.key] = a;
      continue;
    }
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
  alignment: { anchorMatchScore: number; pHashHamming: number | null; detectedPageRegion?: ImageRegion };
  /** Self-check trail: fields where the two OCR passes disagreed + the tiebreak verdicts. */
  ocrConsensus?: OcrConsensusMeta;
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
        const crop = await removeFillInLines(await sharp(aligned).extract(px).png().toBuffer());
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
      const scores: Array<{ value: string; darkness: number; redness: number }> = [];
      for (const opt of field.options) {
        const ink = await regionInk(aligned, opt.region, widthPx, heightPx);
        if (ink == null) continue;
        scores.push({ value: opt.value, ...ink });
      }
      if (scores.length === 0) {
        warnings.push(`group_no_options:${field.key}`);
        continue;
      }
      // Mark detection, two tiers (validated to 100% on the MTC3 synthetic gold set):
      //  1) REDNESS — editable-PDF checkbox appearances render red; red ink is a
      //     near-deterministic signal (black print / blue text / white paper all score ~0).
      //     Dominance guard: a real mark towers over the group's noise median.
      //  2) Fallback: largest-GAP clustering on darkness within the group — absolute
      //     thresholds do not transfer across render resolutions (unmarked boxes on a crisp
      //     1400px render read darker than marked boxes on a soft 1210px screenshot).
      const RED_FLOOR = 0.008;
      const MIN_GAP = 0.025;
      const maxRed = Math.max(...scores.map((s) => s.redness));
      const medianRed = [...scores.map((s) => s.redness)].sort((a, b) => a - b)[Math.floor(scores.length / 2)] ?? 0;
      let marked: typeof scores;
      if (maxRed >= RED_FLOOR && maxRed >= 3 * Math.max(medianRed, 0.002)) {
        const cut = Math.max(RED_FLOOR, maxRed * 0.4);
        marked = scores.filter((s) => s.redness >= cut).sort((a, b) => b.redness - a.redness);
      } else {
        scores.sort((a, b) => b.darkness - a.darkness);
        let splitIdx = -1;
        let largestGap = 0;
        for (let i = 0; i < scores.length - 1; i++) {
          const gap = scores[i]!.darkness - scores[i + 1]!.darkness;
          if (gap > largestGap) {
            largestGap = gap;
            splitIdx = i;
          }
        }
        marked = largestGap >= MIN_GAP && splitIdx >= 0 ? scores.slice(0, splitIdx + 1) : [];
      }
      if (field.kind === "singleChoiceGroup") {
        if (marked.length >= 1) {
          parsedData[field.key] = marked[0]!.value;
          importedKeys.push(field.key);
        } else {
          warnings.push(`group_low_confidence:${field.key}`);
        }
      } else if (marked.length > 0) {
        const optionOrder = field.options.map((o) => o.value);
        parsedData[field.key] = [...marked]
          .sort((a, b) => optionOrder.indexOf(a.value) - optionOrder.indexOf(b.value))
          .map((s) => s.value)
          .join(",");
        importedKeys.push(field.key);
      }
    }
  }

  const ocrMeta: OcrConsensusMeta = { disagreements: [], tiebroken: [] };
  if (textRequests.length > 0) {
    const ocrResults = await withStageTimeout(
      "image_ocr_text_regions",
      120000,
      () => batchOcrTextRegions(textRequests, ocrMeta),
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
      detectedPageRegion: input.extracted.detectedPageRegion,
    },
    ocrConsensus: ocrMeta.disagreements.length ? ocrMeta : undefined,
    warnings: warnings.length ? warnings : undefined,
  };

  return { parsedData: interpreted, importedKeys, calibrationData, diagnostic };
}

export { fingerprintImageBytes };

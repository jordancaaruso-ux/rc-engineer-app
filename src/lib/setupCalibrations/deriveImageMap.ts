import "server-only";

import sharp from "sharp";

import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { deriveImageFieldsFromPdfMappings } from "@/lib/setupCalibrations/deriveImageFieldsFromPdfMappings";
import { fingerprintImageBytes } from "@/lib/setupCalibrations/imageFingerprint";
import { renderPdfFirstPageToPng } from "@/lib/setupDocuments/pdfServerRaster";
import { detectContentBox, removeFillInLines } from "@/lib/setupCalibrations/imageExtractPipeline";
import type { ImageCalibration, ImageRegion } from "@/lib/setupCalibrations/types";

/** Never shrink a text region below this fraction of a dimension — a value must never be clipped. */
const MIN_KEEP = 0.5;
/** Grey level below which a blank-render pixel counts as printed ink. */
const INK = 165;

/** Longest run of indices whose profile value is 0 (no printed ink). */
function longestClearRun(profile: number[]): { start: number; len: number } {
  let bestStart = 0;
  let bestLen = 0;
  let runStart = -1;
  for (let i = 0; i <= profile.length; i++) {
    const clear = i < profile.length && profile[i] === 0;
    if (clear) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      if (i - runStart > bestLen) {
        bestLen = i - runStart;
        bestStart = runStart;
      }
      runStart = -1;
    }
  }
  return { start: bestStart, len: bestLen };
}

/**
 * Shrink one text region away from printed form furniture, using the BLANK render as ground truth
 * for what is printed.
 *
 * A derived region is the raw AcroForm widget rect, which routinely overlaps furniture the typed
 * value never occupies — a unit label beside the box ("/mm"), the sheet footer under a tall notes
 * cell, a stray rule tick. OCR then reads that furniture as part of the value ("STD" -> "STD /mm")
 * or invents a value in a cell the driver left blank ("" -> "/mm"). Fill-in rules and cell borders
 * are erased first (the read path erases those too), so what remains really is furniture.
 *
 * Conservative by construction: trims along the single axis that keeps more of the cell, and only
 * when the clean window still keeps at least MIN_KEEP of that dimension. Returns null to leave the
 * region untouched.
 */
async function trimRegionToClearWindow(
  blankPng: Buffer,
  region: ImageRegion,
  widthPx: number,
  heightPx: number
): Promise<ImageRegion | null> {
  const left = Math.round(region.xPct * widthPx);
  const top = Math.round(region.yPct * heightPx);
  const width = Math.max(1, Math.round(region.wPct * widthPx));
  const height = Math.max(1, Math.round(region.hPct * heightPx));
  if (left < 0 || top < 0 || left + width > widthPx || top + height > heightPx) return null;
  if (width < 8 || height < 8) return null;

  const cell = await sharp(blankPng).extract({ left, top, width, height }).png().toBuffer();
  const cleaned = await removeFillInLines(cell);
  const { data, info } = await sharp(cleaned).removeAlpha().grayscale().raw().toBuffer({ resolveWithObject: true });

  const colInk = new Array<number>(info.width).fill(0);
  const rowInk = new Array<number>(info.height).fill(0);
  let anyInk = false;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if ((data[y * info.width + x] ?? 255) < INK) {
        colInk[x]!++;
        rowInk[y]!++;
        anyInk = true;
      }
    }
  }
  if (!anyInk) return null; // nothing printed inside the cell — already clean

  const cols = longestClearRun(colInk);
  const rows = longestClearRun(rowInk);
  const colKeep = cols.len / info.width;
  const rowKeep = rows.len / info.height;

  if (colKeep >= rowKeep && colKeep >= MIN_KEEP && cols.len < info.width) {
    return { xPct: (left + cols.start) / widthPx, yPct: region.yPct, wPct: cols.len / widthPx, hPct: region.hPct };
  }
  if (rowKeep >= MIN_KEEP && rows.len < info.height) {
    return { xPct: region.xPct, yPct: (top + rows.start) / heightPx, wPct: region.wPct, hPct: rows.len / heightPx };
  }
  return null;
}

export type DeriveImageMapResult =
  | { ok: true; imageCalibration: ImageCalibration; contentBoxDetected: boolean; derivedFields: number; warnings: string[] }
  | { ok: false; error: string; warnings?: string[] };

/**
 * Build the `imageCalibration` for an AcroForm calibration: render the blank PDF server-side (same
 * rasterizer real uploads use), derive image regions from `formFieldMappings` widget geometry,
 * fingerprint the render, and detect the sheet's content box for robust alignment. Pure (no DB) —
 * callers persist the result. Shared by the derive-image-map route and the self-verify loop.
 */
export async function buildDerivedImageCalibration(input: {
  pdfBytes: Uint8Array;
  calibrationDataJson: unknown;
  exampleDocumentId: string | null;
}): Promise<DeriveImageMapResult> {
  const extracted = await extractPdfFormFields(Buffer.from(input.pdfBytes));
  if (!extracted.hasFormFields) {
    return { ok: false, error: extracted.loadError || "The example PDF has no AcroForm fields." };
  }

  const derived = deriveImageFieldsFromPdfMappings({
    calibrationDataJson: input.calibrationDataJson,
    extracted,
  });
  if (derived.fields.length === 0) {
    return {
      ok: false,
      error: "No image fields could be derived — map this AcroForm's fields to parameters first.",
      warnings: derived.warnings,
    };
  }

  const renderedPng = await renderPdfFirstPageToPng(input.pdfBytes, { scale: 2 });
  const fingerprint = await fingerprintImageBytes(new Uint8Array(renderedPng));
  if (fingerprint.widthPx <= 0 || fingerprint.heightPx <= 0) {
    return { ok: false, error: "Could not read the rendered page dimensions." };
  }
  const contentBox = await detectContentBox(renderedPng).catch(() => null);

  // Trim text regions off printed furniture (unit labels, footers) now that we have the blank
  // render — choice/checkbox regions are mark boxes and must keep their exact widget geometry.
  let trimmedCount = 0;
  const fields = await Promise.all(
    derived.fields.map(async (field) => {
      if (field.kind !== "text") return field;
      const trimmed = await trimRegionToClearWindow(
        renderedPng,
        field.region,
        fingerprint.widthPx,
        fingerprint.heightPx
      ).catch(() => null);
      if (!trimmed) return field;
      trimmedCount++;
      return { ...field, region: trimmed };
    })
  );

  const imageCalibration: ImageCalibration = {
    reference: {
      exampleDocumentId: input.exampleDocumentId ?? "",
      widthPx: fingerprint.widthPx,
      heightPx: fingerprint.heightPx,
      pageRegion: { xPct: 0, yPct: 0, wPct: 1, hPct: 1 },
      ...(contentBox ? { contentBox } : {}),
      pHash64: fingerprint.pHash64,
      headerTokens: fingerprint.headerTokens,
    },
    fields,
  };
  if (trimmedCount > 0) derived.warnings.push(`trimmed_text_regions:${trimmedCount}`);

  return {
    ok: true,
    imageCalibration,
    contentBoxDetected: Boolean(contentBox),
    derivedFields: derived.fields.length,
    warnings: derived.warnings,
  };
}

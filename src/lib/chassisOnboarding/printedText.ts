import { createRequire } from "node:module";
import path from "node:path";
import type { ImageRegion } from "@/lib/setupCalibrations/types";

/**
 * The words actually printed on a blank setup sheet, positioned, straight out of the PDF.
 *
 * This is the signal that makes onboarding work across manufacturers. AcroForm *field names* only
 * carry meaning when the sheet's author bothered — Xray names a box `fr-shock-oil`, but Mugen and
 * Awesomatix ship Acrobat defaults (`Text47`, `Check Box11`) that say nothing at all. What every
 * printed sheet has is the caption beside the box, and in a vector PDF that caption is real text at
 * exact coordinates. Reading it is deterministic: no OCR, no vision model, no invented words.
 *
 * Read through pdfjs rather than pdf2json because glyph widths must be exact — with approximate
 * widths, "COUNTRY", "CLASS" and "TRACTION" merge into one phrase and every caption after them is
 * attributed to the wrong box.
 *
 * A sheet whose text was flattened to outlines (Mugen MTC3) yields nothing here. That is reported,
 * not papered over.
 */

export type PrintedPhrase = {
  text: string;
  /** Normalized to the page, top-left origin — the same space as widget regions. */
  region: ImageRegion;
};

export type PrintedTextPage = {
  pageNumber: number;
  phrases: PrintedPhrase[];
};

type PdfTextItem = {
  str: string;
  width: number;
  height: number;
  transform: number[];
};

type PositionedGlyph = {
  text: string;
  /** Points, top-left origin. */
  x: number;
  yTop: number;
  width: number;
  height: number;
};

/** Gap under this fraction of the text height is intra-word ("S" + "UR" + "F" → "SURF"). */
const GLUE_RATIO = 0.28;
/** Gap under this fraction is a word space within one caption. */
const WORD_RATIO = 1.1;

function standardFontDataUrl(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("pdfjs-dist/package.json");
    return path.join(path.dirname(pkg), "standard_fonts/").replace(/\\/g, "/");
  } catch {
    return undefined;
  }
}

function mergeRowIntoPhrases(row: PositionedGlyph[]): PrintedPhrase[] {
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const phrases: PrintedPhrase[] = [];
  let buffer: PositionedGlyph[] = [];
  let text = "";

  const flush = () => {
    if (buffer.length > 0) {
      const first = buffer[0]!;
      const last = buffer[buffer.length - 1]!;
      const clean = text.replace(/\s+/g, " ").trim();
      const height = Math.max(...buffer.map((g) => g.height));
      if (clean) {
        phrases.push({
          text: clean,
          region: {
            xPct: first.x,
            yPct: Math.min(...buffer.map((g) => g.yTop)),
            wPct: Math.max(last.x + last.width - first.x, 0.0005),
            hPct: height,
          },
        });
      }
    }
    buffer = [];
    text = "";
  };

  for (const glyph of sorted) {
    if (buffer.length === 0) {
      buffer = [glyph];
      text = glyph.text;
      continue;
    }
    const prev = buffer[buffer.length - 1]!;
    const gap = glyph.x - (prev.x + prev.width);
    const scale = Math.max(prev.height, glyph.height, 0.0001);
    if (gap <= scale * GLUE_RATIO) {
      buffer.push(glyph);
      text += glyph.text;
    } else if (gap <= scale * WORD_RATIO) {
      buffer.push(glyph);
      text += ` ${glyph.text}`;
    } else {
      flush();
      buffer = [glyph];
      text = glyph.text;
    }
  }
  flush();
  return phrases;
}

export async function extractPrintedText(pdfBytes: Buffer): Promise<PrintedTextPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    standardFontDataUrl: standardFontDataUrl(),
    useSystemFonts: true,
  }).promise;

  const pages: PrintedTextPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const pageWidth = viewport.width || 1;
      const pageHeight = viewport.height || 1;

      const glyphs: PositionedGlyph[] = [];
      for (const raw of content.items as unknown as PdfTextItem[]) {
        if (typeof raw?.str !== "string" || raw.str.trim() === "") continue;
        const tr = raw.transform;
        if (!Array.isArray(tr) || tr.length < 6) continue;
        const height = raw.height || Math.abs(tr[3] ?? 8);
        glyphs.push({
          text: raw.str,
          // PDF text origin is the baseline, bottom-left; regions are top-left.
          x: (tr[4] ?? 0) / pageWidth,
          yTop: (pageHeight - (tr[5] ?? 0) - height) / pageHeight,
          width: (raw.width || 0) / pageWidth,
          height: height / pageHeight,
        });
      }

      // Bucket by row using each glyph's own height, so a sheet mixing 8pt captions and 15pt
      // headings still groups correctly.
      const medianHeight =
        glyphs.length > 0
          ? [...glyphs].sort((a, b) => a.height - b.height)[Math.floor(glyphs.length / 2)]!.height
          : 0.01;
      const rowEpsilon = Math.max(medianHeight * 0.6, 0.002);
      const rows = new Map<number, PositionedGlyph[]>();
      for (const glyph of glyphs) {
        const bucket = Math.round(glyph.yTop / rowEpsilon);
        const list = rows.get(bucket);
        if (list) list.push(glyph);
        else rows.set(bucket, [glyph]);
      }

      const phrases: PrintedPhrase[] = [];
      for (const row of rows.values()) phrases.push(...mergeRowIntoPhrases(row));
      pages.push({ pageNumber, phrases });
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}

export type LabelCandidate = {
  text: string;
  /** Where it sits relative to the box — a caption's usual homes, in order of trust. */
  placement: "left" | "above" | "right";
  distance: number;
};

/**
 * Printed text that states the unit a box is measured in, not what the box is.
 *
 * Sheets set these right against the box ("[ ] MM", "[ ] /Cst"), so without this test the nearest
 * caption to half the boxes on the Awesomatix sheet is "MM" — a label that names every one of them
 * identically and none of them usefully. Recognized as a unit it becomes the field's unit instead,
 * which is information the sheet was giving away for free.
 */
const UNIT_CAPTION = /^[/]?\s*(mm|cm|deg|°|°c|c|cst|cSt|wt|g|gf|gr|%|t|sec|s|ml|cc|kg|gf\s*\/\s*mm|mm\s*\/\s*sec)\s*$/i;

export function isUnitCaption(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 8) return false;
  return UNIT_CAPTION.test(t) || /^[/][a-z°%]{1,4}$/i.test(t);
}

/** Vertical band, as a fraction of page height, counted as "the same row" as the box. */
const SAME_ROW_BAND = 0.008;
/** How far to look for a caption before concluding the box is unlabelled. */
const MAX_LEFT = 0.22;
const MAX_ABOVE = 0.035;
const MAX_RIGHT = 0.06;

/**
 * Printed captions that could name a box, nearest first.
 *
 * Left-of-row and directly-above are how setup sheets caption value boxes; right-of is how they
 * caption tick-boxes ("☐ CARPET"). Each candidate is only ever a suggestion fed to label matching —
 * nothing here decides what a field is.
 */
export function labelCandidatesForRegion(
  phrases: PrintedPhrase[],
  region: ImageRegion,
  limit = 4
): LabelCandidate[] {
  const boxLeft = region.xPct;
  const boxRight = region.xPct + region.wPct;
  const boxTop = region.yPct;
  const boxMidY = region.yPct + region.hPct / 2;

  const candidates: LabelCandidate[] = [];
  for (const phrase of phrases) {
    if (isUnitCaption(phrase.text)) continue;
    const pLeft = phrase.region.xPct;
    const pRight = phrase.region.xPct + phrase.region.wPct;
    const pMidY = phrase.region.yPct + phrase.region.hPct / 2;
    const sameRow = Math.abs(pMidY - boxMidY) <= SAME_ROW_BAND;

    if (sameRow && pRight <= boxLeft + region.wPct * 0.2) {
      const d = boxLeft - pRight;
      if (d <= MAX_LEFT) candidates.push({ text: phrase.text, placement: "left", distance: d });
      continue;
    }
    if (sameRow && pLeft >= boxRight - region.wPct * 0.2) {
      const d = pLeft - boxRight;
      if (d <= MAX_RIGHT) candidates.push({ text: phrase.text, placement: "right", distance: d });
      continue;
    }
    const horizontallyOverlaps = pRight > boxLeft && pLeft < boxRight;
    if (horizontallyOverlaps && pMidY < boxTop) {
      const d = boxTop - pMidY;
      if (d <= MAX_ABOVE) candidates.push({ text: phrase.text, placement: "above", distance: d });
    }
  }

  // Left captions win ties: on every sheet examined, a value box's own name sits to its left, while
  // the text above is usually a column or section heading shared by many boxes.
  const placementRank = { left: 0, above: 1, right: 2 } as const;
  candidates.sort((a, b) => {
    if (a.placement !== b.placement) return placementRank[a.placement] - placementRank[b.placement];
    return a.distance - b.distance;
  });
  return candidates.slice(0, limit);
}

/** The unit printed immediately beside a box, when there is one ("mm", "/Cst"). */
export function unitHintForRegion(phrases: PrintedPhrase[], region: ImageRegion): string | undefined {
  const boxRight = region.xPct + region.wPct;
  const boxMidY = region.yPct + region.hPct / 2;
  let best: { text: string; distance: number } | undefined;

  for (const phrase of phrases) {
    if (!isUnitCaption(phrase.text)) continue;
    const pMidY = phrase.region.yPct + phrase.region.hPct / 2;
    if (Math.abs(pMidY - boxMidY) > SAME_ROW_BAND) continue;
    const d = phrase.region.xPct - boxRight;
    if (d < 0 || d > MAX_RIGHT) continue;
    if (!best || d < best.distance) best = { text: phrase.text.replace(/^\//, "").trim(), distance: d };
  }
  return best?.text || undefined;
}

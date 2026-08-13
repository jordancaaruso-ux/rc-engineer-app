import "server-only";

import sharp from "sharp";
import { CARD_WIDTH } from "@/lib/share/shareCardModel";
import { ensureRenderedSetupSnapshotPdf } from "@/lib/setup/ensureRunSetupPdf";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { renderPdfFirstPageToPng } from "@/lib/setupDocuments/pdfServerRaster";

/**
 * A setup, as a picture of its own sheet.
 *
 * Nothing here is drawn: the app already turns a snapshot into a filled PDF
 * (`ensureRenderedSetupSnapshotPdf`) and a PDF page into a PNG (`renderPdfFirstPageToPng`,
 * pdfjs + `@napi-rs/canvas`, no headless browser). This resizes it to a predictable width and
 * hands it over. What lands in a group chat is the driver's own paper, unmarked.
 *
 * **No brand footer, by founder call (2026-08-13.)** An earlier version stamped one along the
 * bottom. It is off the setup only — the run card keeps its footer, so the mark still travels
 * with anything the app itself draws. A sheet is the driver's document, not a billboard.
 *
 * **The sheet is the only thing a setup share may ever look like** ("the pdf appearance is what
 * should surface always"). There is deliberately no fallback picture for a chassis with no sheet;
 * where there is none there is no share, and the route says which thing is missing.
 *
 * A PNG rather than the PDF file, deliberately: a picture previews inline in every messaging app,
 * while a PDF arrives as a file chip most people never open. The appearance is the sheet either way.
 *
 * Note for anyone adding a route here: pdfjs asks for its canvas with a bare runtime `require`,
 * so `/api/setup-snapshots/**` must stay in `outputFileTracingIncludes` — see the comment there.
 * A local build compiles fine without it and the lambda 500s on `DOMMatrix is not defined`.
 */

/**
 * The driver's sheet as a PNG, or `null` when this chassis has no sheet the app can draw.
 *
 * Null is a real answer, not a failure to handle: the caller turns it into a sentence naming what
 * is missing. Measured 2026-08-13 on scratch-dev, 112 of 1,203 snapshots (9%) land here — every
 * one of them on a car with no chassis-model link, which is the thing to fix.
 */
export async function renderSetupSheetImage(params: {
  userId: string;
  setupSnapshotId: string;
}): Promise<Buffer | null> {
  const ensured = await ensureRenderedSetupSnapshotPdf({
    userId: params.userId,
    setupSnapshotId: params.setupSnapshotId,
  });
  if (!ensured) return null;

  try {
    const pdf = await readBytesFromStorageRef(ensured.relativePath);
    const sheet = await renderPdfFirstPageToPng(pdf);
    // One predictable width for every chassis, and a smaller file over a club's wifi.
    return await sharp(sheet).resize({ width: CARD_WIDTH }).png().toBuffer();
  } catch {
    // An unreadable render is the same answer as no render: there is no sheet to send.
    return null;
  }
}

import "server-only";

import sharp from "sharp";
import { CARD_WIDTH } from "@/lib/share/shareCardModel";
import { ensureRenderedSetupSnapshotPdf } from "@/lib/setup/ensureRunSetupPdf";
import { renderPdfFirstPageToPng } from "@/lib/setupDocuments/pdfServerRaster";
import { composeSheetStory, type SheetStoryHeading } from "@/lib/share/renderSetupStory";

/**
 * A setup, as a picture of its own sheet.
 *
 * Nothing here is drawn: the app already turns a snapshot into a filled PDF
 * (`ensureRenderedSetupSnapshotPdf`) and a PDF page into a PNG (`renderPdfFirstPageToPng`,
 * pdfjs + `@napi-rs/canvas`, no headless browser). This resizes it to a predictable width and
 * hands it over. What lands in a group chat is the driver's own paper, unmarked.
 *
 * **No brand footer on the plain sheet, by founder call (2026-08-13.)** A sheet is the driver's
 * document, not a billboard. The STORY page (2026-09-25, founder: "sheet on a story page") frames
 * the same untouched raster on the app's paper with the car and the day above it — see
 * `renderSetupStory.tsx`; the sheet's own pixels are still never drawn over.
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
 * is missing. Measured 2026-08-13 on scratch-dev, 112 of 1,203 snapshots (9%) landed here, every one
 * on a car with no chassis-model link. Since 2026-08-14 the PDF is filled from the CHASSIS's own
 * blank rather than the driver's upload, so a car WITH a chassis model always has paper now; what
 * is left here is genuinely the cars linked to no model at all.
 */
export async function renderSetupSheetImage(params: {
  userId: string;
  setupSnapshotId: string;
}): Promise<Buffer | null> {
  const sheet = await rasterSetupSheet(params);
  if (!sheet) return null;
  /*
   * One predictable width for every chassis, and a smaller file over a club's wifi.
   *
   * A 256-colour PNG: a sheet is black line art with values in one or two inks, which a palette
   * holds without visible loss, and it lands at ~0.33 MB where full colour was ~0.76 MB
   * (A800RR, 2026-09-25). It is the file the driver sends from the track.
   */
  return sharp(sheet).resize({ width: CARD_WIDTH }).png({ palette: true, quality: 90, effort: 4 }).toBuffer();
}

/** The same sheet framed as a 1080 × 1920 story page, or `null` exactly when the plain one is. */
export async function renderSetupSheetStory(params: {
  userId: string;
  setupSnapshotId: string;
  heading: SheetStoryHeading;
}): Promise<Buffer | null> {
  const sheet = await rasterSetupSheet(params);
  if (!sheet) return null;
  try {
    return await composeSheetStory(sheet, params.heading);
  } catch {
    return null;
  }
}

/** The filled sheet's first page at raster size (A4 → 1190 × 1683), or `null`. */
async function rasterSetupSheet(params: { userId: string; setupSnapshotId: string }): Promise<Buffer | null> {
  const ensured = await ensureRenderedSetupSnapshotPdf({
    userId: params.userId,
    setupSnapshotId: params.setupSnapshotId,
  });
  if (!ensured) return null;

  try {
    // Already in hand — `ensureRenderedSetupSnapshotPdf` had to read the file to know its cache was
    // warm, so fetching it again here was a second download of the same PDF on every share.
    const pdf = ensured.bytes;
    /*
     * Rasterized with its form layer LIVE, not flattened.
     *
     * Since 2026-08-14 the exported PDF keeps its values in real form fields so a driver can carry
     * on filling it. pdfjs draws those widgets ONLY when asked (`withFormValues`): its default
     * leaves form fields to a browser's HTML layer, so without it every shared sheet went out with
     * the driver's values missing (found 2026-09-25). With it, pdfjs draws the widgets, marks and
     * all — and the FLATTENED copy is the worse picture, because a box the sheet sizes
     * automatically (Xray's comments line) gets its text burnt in at the wrong size. So the live
     * file is the better source as well as the simpler one.
     */
    return await renderPdfFirstPageToPng(pdf, { withFormValues: true });
  } catch {
    // An unreadable render is the same answer as no render: there is no sheet to send.
    return null;
  }
}

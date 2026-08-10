import "server-only";

import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { renderPdfPageToPng } from "@/lib/setupDocuments/pdfServerRaster";
import { readBytesFromStorageRef, storeSheetPageImage } from "@/lib/setupDocuments/storage";
import { blankPdfFormValues } from "@/lib/setupDocuments/pdfBlankForm";

/**
 * The picture of one page of a chassis's setup sheet.
 *
 * ============================== WHY A PICTURE AND NOT THE PDF ==============================
 *
 * The phone showing the sheet never loads a PDF engine. A driver at a track opens this on club
 * wifi, on a mid-range phone, while holding a car — the page has to appear, not decode.
 *
 * Lossless WebP rather than PNG or lossy: an A4 sheet is around a megabyte as PNG, and lossy
 * compression softens exactly the thing that makes showing the real sheet worth doing, which is
 * that the driver can read the caption printed beside a box when they zoom into it.
 *
 * ============================== WHY IT IS CACHED PER CHASSIS ==============================
 *
 * Rendering is the slowest thing in this whole feature and its result never changes: a sheet is a
 * sheet. So the first driver to open a chassis pays for it once, and every driver after that gets a
 * stored image. Cached against the CHASSIS rather than the uploaded document, because the uploader
 * may delete their account and take the PDF with them — after which the page cannot be re-rendered
 * at all, and the stored picture is the only copy the other drivers on that chassis have.
 *
 * That is also why a failure to store is not a failure to serve: the driver gets their page either
 * way, and the next open tries again.
 */

/** Twice print size. Enough to zoom into a box and still read the printed caption beside it. */
const RENDER_SCALE = 2;

function storedPageRefs(pageImagesJson: unknown): Record<string, string> {
  if (!pageImagesJson || typeof pageImagesJson !== "object" || Array.isArray(pageImagesJson)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pageImagesJson as Record<string, unknown>)) {
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

export type SheetPageImage = { bytes: Buffer; cached: boolean };

/**
 * Serve a page, rendering and storing it the first time anyone asks.
 *
 * Returns null when this chassis has no blank sheet behind it, or its PDF has gone — both of which
 * mean there is nothing to draw, and the caller should fall back to the ordinary form rather than
 * show a broken picture.
 */
export async function getSheetPageImage(
  setupSheetModelId: string,
  pageNumber: number
): Promise<SheetPageImage | null> {
  const blank = await prisma.setupSheetBlank.findUnique({
    where: { setupSheetModelId },
    select: {
      id: true,
      pageImagesJson: true,
      setupDocument: { select: { storagePath: true } },
    },
  });
  if (!blank) return null;

  const refs = storedPageRefs(blank.pageImagesJson);
  const cachedRef = refs[String(pageNumber)];
  if (cachedRef) {
    try {
      return { bytes: await readBytesFromStorageRef(cachedRef), cached: true };
    } catch {
      // The stored picture has gone. Fall through and draw it again rather than fail — a missing
      // cache entry must never be the reason a driver cannot see their own sheet.
    }
  }

  const source = blank.setupDocument?.storagePath;
  if (!source) return null;

  let webp: Buffer;
  try {
    const pdfBytes = await readBytesFromStorageRef(source);
    /*
     * Empty the boxes before drawing the page.
     *
     * The file that created a chassis is very often somebody's FINISHED sheet, and this picture is
     * the background every driver on that chassis fills over. Rendered as-is, the first uploader's
     * setup — and their name — is printed under everyone else's values. See `pdfBlankForm`.
     */
    const blanked = await blankPdfFormValues(new Uint8Array(pdfBytes));
    const png = await renderPdfPageToPng(blanked, pageNumber, { scale: RENDER_SCALE });
    webp = await sharp(png).webp({ lossless: true, effort: 4 }).toBuffer();
  } catch (e) {
    console.error("[sheet-page] render failed", { setupSheetModelId, pageNumber, e });
    return null;
  }

  // Storing is best effort. The driver already has their page; a bucket that refused the write
  // costs the next driver a re-render, not this one their sheet.
  try {
    const ref = await storeSheetPageImage(setupSheetModelId, pageNumber, webp);
    await prisma.setupSheetBlank.update({
      where: { id: blank.id },
      data: { pageImagesJson: { ...refs, [String(pageNumber)]: ref } },
    });
  } catch (e) {
    console.error("[sheet-page] caching failed, serving anyway", { setupSheetModelId, pageNumber, e });
  }

  return { bytes: webp, cached: false };
}

import "server-only";

import { createRequire } from "node:module";
import path from "node:path";
import { pdf } from "pdf-to-img";

/**
 * pdfjs can't fetch its data files over HTTP in Node, so point it at the on-disk copies that ship
 * with pdfjs-dist. Resolved once; the trailing slash is required.
 *
 * - `standard_fonts/`: without it, sheets that rely on non-embedded standard fonts render with
 *   blank/fallback glyphs, which costs OCR reads.
 * - `cmaps/`: the character maps a CJK font needs to turn its codes into glyphs. Without them the
 *   whole font fails to load ("Unable to load CMap data at: cmaps/Adobe-Japan1-UCS2.bcmap") and
 *   every word set in it is dropped — English too, on a bilingual sheet. The Yokomo MS2.0 page
 *   picture came out as drawings and empty boxes with no captions (found 2026-09-24; four more
 *   sheets the same: Destiny RX-10FF, Yokomo MS1.0FWD, Mugen MTC2 FWD, G-Force Genova).
 *
 * These are the top-level pdfjs-dist's copies, not the copy nested under `pdf-to-img` that does
 * the drawing; both folders are byte-identical data files. The build must ship them: see
 * `RASTER_NATIVE_FILES` in next.config.mjs.
 */
function pdfjsDataDir(name: "standard_fonts" | "cmaps"): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("pdfjs-dist/package.json");
    // pdfjs's Node loaders read these with fs — pass a plain path (forward slashes, trailing
    // slash), not a file:// URL (Node's fetch rejects file://).
    return path.join(path.dirname(pkg), `${name}/`).replace(/\\/g, "/");
  } catch {
    return undefined;
  }
}

const STANDARD_FONT_DATA_URL = pdfjsDataDir("standard_fonts");
const CMAP_URL = pdfjsDataDir("cmaps");

/** What every document opened here passes to pdfjs so it can find its fonts and character maps. */
const DOC_INIT_PARAMS = {
  ...(STANDARD_FONT_DATA_URL ? { standardFontDataUrl: STANDARD_FONT_DATA_URL } : {}),
  ...(CMAP_URL ? { cMapUrl: CMAP_URL, cMapPacked: true } : {}),
};

/**
 * pdfjs's `AnnotationMode.ENABLE`, as the number it is: importing the enum would load a second
 * copy of pdfjs next to the one `pdf-to-img` pins.
 *
 * pdfjs's DEFAULT is `ENABLE_FORMS`, which leaves every form field off the canvas, because a
 * browser viewer draws those as HTML on top. Here there is no HTML on top, so a filled setup sheet
 * came out with its values missing: on an A800RR setup with 139 values, the shared picture showed
 * 3 computed numbers and none of the driver's own (2026-09-25). `ENABLE` draws each field's
 * appearance, which is what `fillPdfForm` bakes.
 */
const PDFJS_ANNOTATION_MODE_ENABLE = 1;

/**
 * Server-side flattened-PDF rasterizer (serverless-safe).
 *
 * A setup sheet uploaded as a PDF whose page is an *image* (a flattened/scanned sheet with zero
 * AcroForm fields) can't be read by the form pipeline. Rendering page 1 to a PNG lets it flow
 * through the calibrated image pipeline instead. `pdf-to-img` runs pdfjs workerless on the Node
 * main thread and rasterizes via pdfjs-dist's `@napi-rs/canvas` (prebuilt binaries — same class of
 * native dep as onnxruntime-node), so this works on Vercel with no headless browser.
 *
 * `scale: 2` matches the resolution the derived `imageCalibration.reference` is built at
 * (A4 → 1190×1683), so alignment is near-identity.
 */
export async function renderPdfFirstPageToPng(
  bytes: Uint8Array,
  opts?: RasterOptions
): Promise<Buffer> {
  return renderPdfPageToPng(bytes, 1, opts);
}

/**
 * Any page of a PDF, as a PNG.
 *
 * Added for the driver-facing fill surface, which shows a driver their own setup sheet. Rendering
 * here rather than in the browser means a phone never downloads pdf.js or its 1.2 MB worker to
 * look at a sheet — it downloads a picture. That matters trackside, where the connection is a
 * club's wifi or nothing, and it removes the whole PDF engine from the page a driver uses most.
 *
 * `pageCountOf` exists alongside it because the caller needs to know how many pages to offer
 * before it can ask for one.
 */
/** How many pages the file has — parse only, no rasterising. */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await pdf(Buffer.from(bytes), { docInitParams: DOC_INIT_PARAMS });
  try {
    return doc.length;
  } finally {
    await doc.destroy().catch(() => {});
  }
}

type RasterOptions = {
  scale?: number;
  timeoutMs?: number;
  /**
   * Draw the form fields' values. On for a FILLED sheet a driver is meant to read (the share
   * picture, the in-app PDF viewer). Off for a blank that the app draws its own boxes over (the
   * fill surface's page picture) and for the calibration tools, which read the paper itself.
   */
  withFormValues?: boolean;
};

export async function renderPdfPageToPng(
  bytes: Uint8Array,
  pageNumber: number,
  opts?: RasterOptions
): Promise<Buffer> {
  const scale = opts?.scale ?? 2;
  const timeoutMs = opts?.timeoutMs ?? 30_000;

  const render = (async (): Promise<Buffer> => {
    // pdf-to-img mutates the input buffer's backing store; hand it a copy so the caller's bytes
    // (used for storage) stay intact.
    const doc = await pdf(Buffer.from(bytes), {
      scale,
      docInitParams: DOC_INIT_PARAMS,
      ...(opts?.withFormValues ? { renderParams: { annotationMode: PDFJS_ANNOTATION_MODE_ENABLE } } : {}),
    });
    try {
      if (doc.length < 1) throw new Error("PDF has no pages");
      const page = Math.min(Math.max(Math.trunc(pageNumber) || 1, 1), doc.length);
      const png = await doc.getPage(page); // 1-indexed; returns a PNG Buffer
      if (png.byteLength > 40 * 1024 * 1024) throw new Error("Rasterized PNG too large");
      return png;
    } finally {
      await doc.destroy().catch(() => {});
    }
  })();

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      render,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`PDF raster timed out (${timeoutMs}ms)`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

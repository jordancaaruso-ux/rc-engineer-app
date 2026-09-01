import "server-only";

import { createRequire } from "node:module";
import path from "node:path";
import { pdf } from "pdf-to-img";

/**
 * pdfjs can't fetch its standard fonts over HTTP in Node, so point it at the on-disk copy that
 * ships with pdfjs-dist. Without this, sheets that rely on non-embedded standard fonts render with
 * blank/fallback glyphs, which costs OCR reads. Resolved once; the trailing slash is required.
 */
function standardFontDataUrl(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("pdfjs-dist/package.json");
    // pdfjs's Node font loader reads this with fs — pass a plain path (forward slashes, trailing
    // slash), not a file:// URL (Node's fetch rejects file://).
    return path.join(path.dirname(pkg), "standard_fonts/").replace(/\\/g, "/");
  } catch {
    return undefined;
  }
}

const STANDARD_FONT_DATA_URL = standardFontDataUrl();

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
  opts?: { scale?: number; timeoutMs?: number }
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
  const doc = await pdf(Buffer.from(bytes), {
    ...(STANDARD_FONT_DATA_URL ? { docInitParams: { standardFontDataUrl: STANDARD_FONT_DATA_URL } } : {}),
  });
  try {
    return doc.length;
  } finally {
    await doc.destroy().catch(() => {});
  }
}

export async function renderPdfPageToPng(
  bytes: Uint8Array,
  pageNumber: number,
  opts?: { scale?: number; timeoutMs?: number }
): Promise<Buffer> {
  const scale = opts?.scale ?? 2;
  const timeoutMs = opts?.timeoutMs ?? 30_000;

  const render = (async (): Promise<Buffer> => {
    // pdf-to-img mutates the input buffer's backing store; hand it a copy so the caller's bytes
    // (used for storage) stay intact.
    const doc = await pdf(Buffer.from(bytes), {
      scale,
      ...(STANDARD_FONT_DATA_URL ? { docInitParams: { standardFontDataUrl: STANDARD_FONT_DATA_URL } } : {}),
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

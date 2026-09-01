import "server-only";

import { createRequire } from "node:module";
import path from "node:path";
import type { MyRcmPdfCell } from "./myRcmPdf";

/**
 * Positioned-text extraction for MyRCM run-result PDFs.
 *
 * Split from `myRcmPdf.ts` so the parsing stays pure and unit-testable: this file owns the one
 * native-ish dependency (pdfjs) and hands back plain `{page, x, y, text}` cells.
 *
 * **Text only — no rasterizing.** `setupDocuments/pdfServerRaster.ts` renders pages to PNGs and so
 * has to drag `@napi-rs/canvas` and `pdf-to-img`'s nested pdfjs onto the lambda; two production
 * outages came from exactly those hops being invisible to the file tracer. `getTextContent()`
 * needs none of it, so this path deliberately imports the top-level `pdfjs-dist` directly and
 * touches no canvas. The one thing it does read by runtime path is the standard font directory,
 * which is already pinned in `outputFileTracingIncludes`.
 */

/** pdfjs cannot fetch its standard fonts over HTTP in Node; point it at the on-disk copy. */
function standardFontDataUrl(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("pdfjs-dist/package.json");
    return path.join(path.dirname(pkg), "standard_fonts/").replace(/\\/g, "/");
  } catch {
    return undefined;
  }
}

const STANDARD_FONT_DATA_URL = standardFontDataUrl();

/**
 * A run report is a handful of pages. A file with far more than this is not one, and parsing it
 * would be a slow way to find that out.
 */
const MAX_PAGES = 60;

export class MyRcmPdfReadError extends Error {
  readonly code: "not_a_pdf" | "unreadable" | "password_protected" | "damaged" | "too_many_pages";

  constructor(code: MyRcmPdfReadError["code"], message: string) {
    super(message);
    this.name = "MyRcmPdfReadError";
    this.code = code;
  }
}

/** `%PDF-` — checked before handing anything to the parser. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsLoad: Promise<PdfjsModule> | null = null;

/**
 * pdf.js, bound to ITS OWN worker — not whichever one happens to be lying around.
 *
 * This app runs two copies of pdf.js on the server on purpose: this one (5.4, pinned to what
 * the browser preview needs) and the one `pdf-to-img` nests for rasterising setup sheets
 * (5.6, its own pin). In Node, both look for a worker in the same place first —
 * `globalThis.pdfjsWorker` — and each remembers what it found there forever. So whichever
 * copy ran first in a process quietly hijacked the other:
 *
 *   - a setup sheet rendered, then a lap sheet uploaded → "API 5.4 does not match Worker 5.6"
 *     (the message a driver read on 2026-08-27);
 *   - a lap sheet uploaded FIRST → every setup sheet in that process failed the same way.
 *
 * Neither shows in a test that runs one of them. The fix is to settle the question before
 * anyone asks it: load our own worker, let this copy's cache take it while it is on the
 * global, then put the global back exactly as it was so the other copy still finds its own.
 * The cache is computed synchronously on first read, which is what makes the restore safe.
 *
 * `_setupFakeWorkerGlobal` is underscore-private but shipped in pdf.js's own type
 * definitions; the exact-version pin on `pdfjs-dist` is what keeps this honest, and the
 * ordering test beside this file fails loudly if a bump changes the mechanism.
 */
function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsLoad ??= (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const g = globalThis as { pdfjsWorker?: unknown };
    const before = g.pdfjsWorker;
    const hadBefore = "pdfjsWorker" in g;

    // Importing the worker module assigns the global as a side effect; set it explicitly too,
    // because a module is only ever evaluated once and a second call must still see ours.
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    g.pdfjsWorker = { WorkerMessageHandler: worker.WorkerMessageHandler };
    void pdfjs.PDFWorker._setupFakeWorkerGlobal;

    if (hadBefore) g.pdfjsWorker = before;
    else delete g.pdfjsWorker;
    return pdfjs;
  })();
  return pdfjsLoad;
}

/** Every run of text in the document, with the position it was drawn at. */
export async function extractMyRcmPdfCells(
  bytes: Uint8Array
): Promise<Array<MyRcmPdfCell & { page: number }>> {
  if (!looksLikePdf(bytes)) {
    throw new MyRcmPdfReadError(
      "not_a_pdf",
      "That file isn't a PDF. Use MyRCM's “Download PDF” button on the run you raced."
    );
  }

  const pdfjs = await loadPdfjs();

  /* pdfjs takes ownership of the buffer and detaches it, so the size has to be read first —
     asked for afterwards it answers 0, which made the failure log say nothing useful. */
  const byteLength = bytes.length;

  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: bytes,
      useSystemFonts: true,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      isEvalSupported: false,
      /*
       * Plenty of report generators stamp a PDF with an OWNER password — no password to open
       * it, only a flag saying "don't let people edit this". Offering the empty user password
       * up front opens those; a file that genuinely needs a password still refuses, and now
       * says which of the two it is.
       */
      password: "",
    }).promise;
  } catch (error) {
    /*
     * This used to be a bare `catch {}` guessing "damaged or password-protected" at a driver
     * who could open the file perfectly well on their phone (reported 2026-08-27). pdfjs names
     * its own failures; the name goes to the logs either way, so a file we refuse can be
     * diagnosed from the outside instead of asked about.
     */
    const name = error instanceof Error ? error.name : "";
    const detail = error instanceof Error ? error.message : String(error);
    console.warn("[myrcm-pdf]", "getdocument_failed", { name, detail, bytes: byteLength });

    if (name === "PasswordException") {
      throw new MyRcmPdfReadError(
        "password_protected",
        "This PDF needs a password to open. Download the run again from MyRCM — its own PDFs never ask for one."
      );
    }
    if (name === "InvalidPDFException") {
      throw new MyRcmPdfReadError(
        "damaged",
        "This file is a PDF but its contents are incomplete — usually a download that stopped early. Download it from MyRCM again and re-send it."
      );
    }
    throw new MyRcmPdfReadError(
      "unreadable",
      `This PDF wouldn't open (${detail || name || "no reason given"}). If it opens fine elsewhere, send it over and it can be looked at directly.`
    );
  }

  if (doc.numPages > MAX_PAGES) {
    throw new MyRcmPdfReadError(
      "too_many_pages",
      `That PDF has ${doc.numPages} pages, which is far more than a run report. Download a single run rather than a whole event.`
    );
  }

  const cells: Array<MyRcmPdfCell & { page: number }> = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const text = item.str.trim();
      if (!text) continue;
      const transform = item.transform as number[];
      cells.push({
        page: pageNumber,
        x: transform[4] as number,
        y: transform[5] as number,
        text,
      });
    }
    page.cleanup();
  }

  await doc.destroy();
  return cells;
}

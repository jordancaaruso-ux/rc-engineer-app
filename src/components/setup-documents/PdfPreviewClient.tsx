"use client";

import { useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";

/**
 * The pdf.js worker, bundled with the app rather than fetched from a CDN.
 *
 * WHY. This used to point at `unpkg.com`. Rendering a PDF therefore needed the open internet at the
 * moment of rendering — and this app is used trackside, inside a WKWebView, on club wifi or no
 * signal at all. The failure is silent and indistinguishable from a broken file: no worker, no
 * page, an empty box where the sheet should be. Now that a driver (not just an admin in the
 * calibration workbench) can open their own setup sheet, that is a guaranteed field bug.
 *
 * `new URL(..., import.meta.url)` makes the bundler emit the worker as a build asset and hand back
 * its local path. Deliberately not a copy into `public/`: a copied worker silently drifts out of
 * step when `pdfjs-dist` is upgraded, and pdf.js answers a version mismatch by refusing to render.
 * Resolved through the bundler, the worker and the library cannot disagree.
 */
const PDF_WORKER_SRC = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
}

/**
 * Shared PDF preview for setup/calibration flows.
 *
 * Layer policy (explicit — avoids react-pdf “TextLayer styles not found” when the text layer is left on by default):
 * - `renderTextLayer`: default **false**. Calibration/AcroForm mapping uses server-provided widget bounds + HTML overlays,
 *   not selectable PDF text. Enable only if you need copy/select text; then import pdf.js text (and annotation) CSS once
 *   in `src/app/globals.css` from `react-pdf` / `pdfjs-dist` as per react-pdf docs.
 * - `renderAnnotationLayer`: default **false** (same half-config warning risk; we draw our own hit targets).
 */
export function PdfPreviewClient(props: {
  fileUrl: string;
  pageNumber: number;
  width: number;
  /** Default false. Set true only if you add pdf.js annotation layer CSS globally. */
  renderAnnotationLayer?: boolean;
  /** Default false. Set true only if you add pdf.js text layer CSS globally (see file comment). */
  renderTextLayer?: boolean;
  onDocumentLoadSuccess?: (input: { numPages: number }) => void;
  onPageLoadSuccess?: (page: { getViewport: (input: { scale: number }) => { width: number; height: number } }) => void;
  onSourceError?: (err: unknown) => void;
  onLoadError?: (err: unknown) => void;
  error?: React.ReactNode;
}) {
  // Ensure workerSrc is set even if this module is hot-reloaded.
  useEffect(() => {
    if (typeof window === "undefined") return;
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
  }, []);

  return (
    <Document
      file={props.fileUrl}
      error={props.error}
      onSourceError={props.onSourceError}
      onLoadError={props.onLoadError}
      onLoadSuccess={props.onDocumentLoadSuccess}
    >
      <Page
        pageNumber={props.pageNumber}
        width={props.width}
        renderTextLayer={props.renderTextLayer ?? false}
        renderAnnotationLayer={props.renderAnnotationLayer ?? false}
        onLoadSuccess={props.onPageLoadSuccess}
      />
    </Document>
  );
}


"use client";

import { useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
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
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
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


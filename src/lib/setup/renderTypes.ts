/**
 * Version of the setup-PDF pipeline (one pipeline for view, download and share image).
 *
 * Persisted on `Run.setupPdfRenderVersion` / `SetupSnapshot.setupPdfRenderVersion`; a cached PDF
 * whose version doesn't match is re-made on the next request. Bump it whenever what comes out
 * changes.
 *
 * 3 — 2026-08-14: fill the manufacturer's blank through `fillPdfForm` instead of whiting out every
 *     widget and drawing over the top. Every cached PDF from the old engine is a flattened picture
 *     and must be replaced.
 */
export const SETUP_PDF_RENDER_PIPELINE_VERSION = 3;

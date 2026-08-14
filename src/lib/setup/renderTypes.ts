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
 * 4 — 2026-08-14, later the same day: the printed header strip (name, race, track, country, class,
 *     date, air/track temp) now has schema fields and therefore reaches the paper, and camber and
 *     toe print unsigned. A PDF cached at 3 has a blank header and a minus sign in front of its
 *     camber, so it has to be re-made even though the engine itself did not change.
 */
export const SETUP_PDF_RENDER_PIPELINE_VERSION = 4;

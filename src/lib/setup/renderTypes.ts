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
 * 5 — 2026-08-31: a setup exports on the paper it was born on (`SetupSnapshot.sheetBlankId` —
 *     founder ruling: the PDF you uploaded is what you see, always). A setup born on an aligned
 *     EDITION cached at 4 was written into the PRIMARY file, so it is the wrong paper and has to
 *     be re-made; primary-born setups re-render to identical bytes.
 * 6 — 2026-09-01: ONE drawing engine writes every value (`pdfValueAppearances`), in the face the
 *     sheet names — the font it embeds where it has one, the standard font it asks for otherwise —
 *     at the size the app uses. pdf-lib's generator, which had been rewriting every `/DA` to
 *     `/Helvetica 10 Tf` during BLANKING, now only touches boxes that wrap. Everything cached at 5
 *     is upright, in the wrong metrics, and clipped wherever the stated size was too big for its
 *     box, so all of it has to be re-made.
 */
export const SETUP_PDF_RENDER_PIPELINE_VERSION = 6;

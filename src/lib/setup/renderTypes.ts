/**
 * Shared types for run setup PDF rendering (single pipeline for view + download).
 */

export type SetupPdfRenderResult = {
  /** Written PDF bytes (derived snapshot; never mutates the original upload). */
  pdfBytes: Uint8Array;
  /** Bump when drawing logic changes; persisted on Run for invalidation. */
  pipelineVersion: number;
};

export const SETUP_PDF_RENDER_PIPELINE_VERSION = 1;

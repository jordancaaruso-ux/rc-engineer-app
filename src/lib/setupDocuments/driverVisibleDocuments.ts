import type { Prisma } from "@prisma/client";

/**
 * The setup sheets a driver should be shown as THEIRS.
 *
 * A chassis built from an uploaded PDF stores that PDF as a `SetupDocument`, because that is what
 * every other part of the app already knows how to keep. But it is not one of the driver's setups
 * — it is the chassis's source file, the thing the boxes were read off. Left in the ordinary
 * listing it appears as "1 sheet not linked to a car", which reads as a loose end they are supposed
 * to tidy up, and there is nothing for them to do with it.
 *
 * Identified by the `SetupSheetBlank` row that points at it rather than by its filename. Filenames
 * are a convention; the row is the fact.
 */
export const DRIVER_VISIBLE_SETUP_DOCUMENT_WHERE = {
  // Bulk-imported published sheets are a dataset, not the driver's library.
  setupImportBatchId: null,
  // The blank a chassis was derived from.
  blankSheet: { is: null },
} satisfies Prisma.SetupDocumentWhereInput;

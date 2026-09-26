import type { Prisma } from "@prisma/client";

/**
 * The setup sheets a driver uploaded — every one of them, for "All uploaded sheets".
 *
 * That includes an upload that became a chassis sheet. A chassis built from an uploaded PDF keeps
 * that PDF as a `SetupDocument` with a `SetupSheetBlank` row pointing at it, and so does an upload
 * that became a new EDITION of its chassis's sheet. Both were left out here (`blankSheet: { is:
 * null }`), so a driver who had uploaded two sheets opened the list onto "No setup documents uploaded
 * yet" (test drive, 2026-09-26). They are the driver's uploads, and the list shows them.
 *
 * What a chassis's source file must still not be is a loose end. It never has a car, and in the
 * Garage's "N sheets not linked to a car" it read as something to tidy up when there is nothing to
 * do with it. That count adds `blankSheet: { is: null }` itself (`src/app/cars/page.tsx`).
 */
export const DRIVER_VISIBLE_SETUP_DOCUMENT_WHERE = {
  // Bulk-imported published sheets are a dataset, not the driver's library.
  setupImportBatchId: null,
} satisfies Prisma.SetupDocumentWhereInput;

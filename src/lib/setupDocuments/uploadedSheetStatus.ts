/**
 * What an uploaded sheet's state reads as to a racer, in plain words: "All uploaded sheets" and the
 * sheet's own page. Admins keep the pipeline's words (PARSED, COMPLETED_WITH_WARNINGS, the stage).
 *
 * Since the list shows every racer all of their uploads (2026-09-26) it printed those words to
 * them: "PARSED · COMPLETED_WITH_WARNINGS (database_save_completed) · setup created", and "PENDING"
 * for an upload that had become their chassis sheet (test drive, 2026-09-26).
 */
export type UploadedSheetState = {
  parseStatus: string;
  importStatus?: string | null;
  createdSetupId?: string | null;
  /**
   * Set when a `SetupSheetBlank` points at the upload. No chassis means it was refused (not
   * fillable, or unreadable), and the founder follows each of those up.
   */
  blankSheet?: { setupSheetModelId: string | null; isEdition?: boolean } | null;
};

/**
 * A blank sheet uploaded to make a chassis (`createModelFromBlank`): it holds no setup and is never
 * read. An EDITION's upload is not one of these: it is a racer's own filled sheet whose layout the
 * chassis learned, and its values were read and saved like any other upload's.
 */
export function isChassisSourceSheet(doc: Pick<UploadedSheetState, "blankSheet">): boolean {
  return Boolean(doc.blankSheet && !doc.blankSheet.isEdition);
}

export function uploadedSheetStatusWords(doc: UploadedSheetState): string {
  if (isChassisSourceSheet(doc)) {
    return doc.blankSheet?.setupSheetModelId ? "Became your chassis sheet" : "Waiting for review";
  }
  const status =
    doc.importStatus === "PROCESSING"
      ? "Reading…"
      : doc.importStatus === "FAILED" || doc.parseStatus === "FAILED"
        ? "Couldn't be read"
        : doc.parseStatus === "PARSED" || doc.parseStatus === "PARTIAL"
          ? "Read"
          : "Waiting for review";
  return doc.createdSetupId ? `${status} · setup saved` : status;
}

/**
 * The upload's name for a racer: the file's, less the "BLANK - " a chassis's source sheet is stored
 * under (`createModelFromBlank`). What is left is the chassis name they typed.
 */
export function uploadedSheetTitle(originalFilename: string): string {
  return originalFilename.replace(/^BLANK - /, "");
}

/** Whether the words say it went wrong, so they can be drawn as an error. */
export function uploadedSheetFailed(doc: UploadedSheetState): boolean {
  return !isChassisSourceSheet(doc) && (doc.importStatus === "FAILED" || doc.parseStatus === "FAILED");
}

import type { PdfFormFieldsExtraction } from "@/lib/setupDocuments/pdfFormFields";
import { SETUP_DOCUMENT_MAX_BYTES } from "@/lib/setupDocuments/types";

/**
 * Whether a blank manufacturer sheet can become a chassis, and what the driver is told when it
 * cannot.
 *
 * Every sentence a driver reads on this path lives here, in one file, for two reasons. The obvious
 * one is that they should read as one voice. The real one is that a refusal is the ONLY thing
 * standing between a driver and the belief that the app is broken — they picked the sheet their
 * manufacturer publishes, and it did not work. So each message has to say what is wrong with the
 * file in a way that does not sound like an accusation, and then leave them somewhere to go.
 *
 * Nothing here is a judgement about quality. A sheet whose every box is called `Text47` is refused
 * by nothing: it derives perfectly, it just needs naming later. The only refusals are files that
 * cannot produce a fillable sheet at all.
 */

export type BlankRefusalCode =
  | "NOT_A_PDF"
  | "TOO_BIG"
  | "EMPTY_FILE"
  | "UNREADABLE"
  | "NOT_FILLABLE"
  | "TOO_MANY_PAGES"
  | "TOO_MANY_BOXES";

export type BlankRefusal = {
  code: BlankRefusalCode;
  /** Shown to the driver, verbatim. */
  message: string;
  /**
   * What to write to `SetupSheetBlank.status`. A refusal we want the founder to act on is
   * NOT_FILLABLE or UNREADABLE; a file that was never a setup sheet is not worth his queue.
   */
  status: "NOT_FILLABLE" | "UNREADABLE" | null;
  /**
   * Whether the driver is offered "add the car without a sheet for now".
   *
   * True whenever the file was plausibly their real setup sheet, because then they have a car to
   * add and we have simply failed to read it. False when they picked the wrong file, where the
   * useful next step is to pick a different one.
   */
  offerCarWithoutSheet: boolean;
};

/**
 * A setup sheet is one or two pages. Eight is already generous, and the limit exists to catch the
 * product manual rather than to police layout.
 */
export const MAX_BLANK_PAGES = 8;

/**
 * More boxes than any real sheet has. The Xray X4 '26 — the busiest blank we have — is 201 fields
 * and 289 parameters, so this is roughly double the worst real case. Past it, every template
 * builder and fill surface downstream is being handed something that was never a setup sheet.
 */
export const MAX_BLANK_FIELDS = 600;

function refusal(
  code: BlankRefusalCode,
  message: string,
  status: BlankRefusal["status"],
  offerCarWithoutSheet: boolean
): BlankRefusal {
  return { code, message, status, offerCarWithoutSheet };
}

/**
 * Checks that need only the file itself. Run before reading a single byte, so an obviously wrong
 * upload never reaches storage.
 */
export function refusalForBlankFile(input: {
  byteSize: number;
  mimeType?: string | null;
}): BlankRefusal | null {
  const mime = (input.mimeType ?? "").trim().toLowerCase();
  // Browsers sometimes send no type at all, which is not evidence of anything. Only a type that
  // positively says "not a PDF" is worth refusing on.
  if (mime && mime !== "application/pdf") {
    return refusal(
      "NOT_A_PDF",
      "A picture of a setup sheet can't be read. It has to be the fillable PDF — the one you can type into.",
      null,
      false
    );
  }
  if (input.byteSize <= 0) {
    return refusal("EMPTY_FILE", "That file is empty. Try picking it again.", null, false);
  }
  if (input.byteSize > SETUP_DOCUMENT_MAX_BYTES) {
    const mb = Math.round(SETUP_DOCUMENT_MAX_BYTES / (1024 * 1024));
    return refusal("TOO_BIG", `That file is too big (max ${mb} MB).`, null, false);
  }
  return null;
}

/**
 * Checks that need the PDF opened. `boxCount` is the derived parameter count — pass it once the
 * derivation has run, since a file can have a form layer whose widgets all sit off-page.
 */
export function refusalForBlankExtraction(input: {
  extraction: PdfFormFieldsExtraction;
  boxCount: number;
}): BlankRefusal | null {
  const { extraction, boxCount } = input;

  if (extraction.loadError) {
    // pdf-lib already loads with `ignoreEncryption`, so anything that still fails to open is a
    // genuinely encrypted or damaged file rather than a merely restricted one.
    return refusal(
      "UNREADABLE",
      "We couldn't open that PDF — it looks password protected or damaged. If it opens on your computer, try re-saving it and uploading again.",
      "UNREADABLE",
      true
    );
  }

  // A sheet with no form layer, and a sheet whose form layer is XFA-only, arrive here looking
  // identical. Say nothing about scanning: a great many of these are perfectly crisp PDFs that
  // simply have no boxes to type in, and telling someone their file is a photo when it isn't reads
  // as the app not knowing what it is looking at.
  //
  // This is the mistake drivers will make most, so the message names the pattern rather than
  // merely refusing. Xray publishes both versions on the same page under almost the same name —
  // one has 201 boxes inside it, the other has none — and nothing on screen tells them apart.
  if (!extraction.hasFormFields || boxCount === 0) {
    return refusal(
      "NOT_FILLABLE",
      "There's nothing to type into in that PDF — it's a picture of a sheet rather than a fillable one. Manufacturers usually publish both, so look for the file with “editable” or “fillable” in its name. If you're not sure which you have, open it and try typing in a box. Or add the car without a sheet for now and we'll sort your chassis out.",
      "NOT_FILLABLE",
      true
    );
  }

  const pageCount = extraction.pageCount ?? 1;
  if (pageCount > MAX_BLANK_PAGES) {
    return refusal(
      "TOO_MANY_PAGES",
      `That's ${pageCount} pages — more than a setup sheet. Check you picked the right file.`,
      null,
      false
    );
  }
  if (extraction.fields.length > MAX_BLANK_FIELDS) {
    return refusal(
      "TOO_MANY_BOXES",
      `That file has ${extraction.fields.length} boxes — far more than a setup sheet. Check you picked the right file.`,
      null,
      false
    );
  }

  return null;
}

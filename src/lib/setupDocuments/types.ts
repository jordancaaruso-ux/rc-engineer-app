import type { SetupSnapshotData } from "@/lib/runSetup";

/**
 * A setup sheet must be a PDF. Founder ruling 2026-08-10: "images should not work. should say so
 * and make it obvious it must be fillable pdf thats uploaded."
 *
 * Photos and screenshots were accepted until then, read by the image pipeline against a
 * hand-drawn calibration. What that bought was a value the app had inferred from pixels; what it
 * cost was that a driver could not tell an inferred value from one their sheet actually states.
 * Reading a PDF's form layer has no such gap — the file says what is in each box — so the rule is
 * now one line a driver can act on rather than a spectrum of confidence.
 *
 * This is the SERVER gate, and it is the one that matters: `api/setup-documents`,
 * `api/setup-documents/quick-create` and `api/setup-documents/client-upload` all check it, so a
 * client that asks for anything else is refused regardless. The file picker's `accept` attribute
 * (`SETUP_SHEET_ACCEPT_MIME`) is only a courtesy on top.
 *
 * Note this admits any PDF, including a flat one with no form layer. That is deliberate: "this PDF
 * has no boxes in it" is a different mistake from "this is a photo", the driver needs to be told
 * which one they made, and only the derive step can tell them apart.
 */
export const SETUP_DOCUMENT_ALLOWED_MIME = new Set<string>(["application/pdf"]);

export const SETUP_DOCUMENT_MAX_BYTES = 12 * 1024 * 1024;

export type SetupDocumentParsedResult = {
  parserType: string;
  parseStatus: "PENDING" | "PARSED" | "PARTIAL" | "FAILED";
  extractedText: string | null;
  parsedData: SetupSnapshotData;
  note: string | null;
  mappedFieldKeys: string[];
  mappedFieldCount: number;
};


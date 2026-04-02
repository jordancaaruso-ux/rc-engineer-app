import type { SetupSnapshotData } from "@/lib/runSetup";

export const SETUP_DOCUMENT_ALLOWED_MIME = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

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


import "server-only";

import { createRequire } from "node:module";

export type PdfRawToken = {
  x: number;
  y: number;
  w: number;
  text: string;
};

export type PdfRawPage = {
  width: number;
  height: number;
  tokens: PdfRawToken[];
};

export type PdfStructuredLineToken = {
  x: number;
  y: number;
  w: number;
  text: string;
};

export type PdfStructuredLine = {
  lineIndex: number;
  yBucket: number;
  text: string;
  tokens: PdfStructuredLineToken[];
};

export type PdfStructuredPage = {
  pageNumber: number;
  width: number;
  height: number;
  lines: PdfStructuredLine[];
};

/** Serializable result for API + template application. */
export type PdfTextStructureDocument = {
  version: 1;
  lineGroupingEpsilon: number;
  pages: PdfStructuredPage[];
};

function safeDecodePdfToken(token: string): string {
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

export async function extractPdfPageContents(buffer: Buffer): Promise<PdfRawPage[]> {
  const require = createRequire(import.meta.url);
  const PDFParser = require("pdf2json") as new () => {
    on: (event: string, cb: (arg: unknown) => void) => void;
    parseBuffer: (buffer: Buffer) => void;
  };
  return await new Promise<PdfRawPage[]>((resolve, reject) => {
    const parser = new PDFParser();
    parser.on("pdfParser_dataError", (err: unknown) => {
      const msg =
        err && typeof err === "object" && "parserError" in err
          ? String((err as { parserError?: unknown }).parserError)
          : "PDF parsing failed";
      reject(new Error(msg));
    });
    parser.on("pdfParser_dataReady", (data: unknown) => {
      const pages =
        data && typeof data === "object" && "Pages" in data
          ? ((data as {
              Pages?: Array<{
                Width?: number;
                Height?: number;
                Texts?: Array<{ x?: number; y?: number; w?: number; R?: Array<{ T?: string }> }>;
              }>;
            }).Pages ?? [])
          : [];
      resolve(
        pages.map((p) => ({
          width: p.Width ?? 0,
          height: p.Height ?? 0,
          tokens: (p.Texts ?? []).map((t) => ({
            x: t.x ?? 0,
            y: t.y ?? 0,
            w: t.w ?? 0,
            text: (t.R ?? []).map((r) => safeDecodePdfToken(r.T ?? "")).join(" ").trim(),
          })),
        }))
      );
    });
    parser.parseBuffer(buffer);
  });
}

function bucketY(y: number, epsilon: number): number {
  return Math.round(y / epsilon) * epsilon;
}

export function buildPdfTextStructure(
  rawPages: PdfRawPage[],
  lineGroupingEpsilon: number
): PdfTextStructureDocument {
  const pages: PdfStructuredPage[] = rawPages.map((p, pageIdx) => {
    const withText = p.tokens.filter((t) => t.text.trim());
    const buckets = new Map<number, PdfRawToken[]>();
    for (const t of withText) {
      const key = bucketY(t.y, lineGroupingEpsilon);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(t);
    }
    const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);
    const lines: PdfStructuredLine[] = [];
    let lineIndex = 0;
    for (const key of sortedKeys) {
      const row = buckets.get(key)!;
      row.sort((a, b) => a.x - b.x);
      const text = row
        .map((r) => r.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      lines.push({
        lineIndex: lineIndex++,
        yBucket: key,
        text,
        tokens: row.map((t) => ({ x: t.x, y: t.y, w: t.w, text: t.text })),
      });
    }
    return {
      pageNumber: pageIdx + 1,
      width: p.width,
      height: p.height,
      lines,
    };
  });
  return { version: 1, lineGroupingEpsilon, pages };
}

export async function extractPdfTextStructureFromBuffer(
  buffer: Buffer,
  lineGroupingEpsilon = 2.5
): Promise<PdfTextStructureDocument> {
  const raw = await extractPdfPageContents(buffer);
  return buildPdfTextStructure(raw, lineGroupingEpsilon);
}

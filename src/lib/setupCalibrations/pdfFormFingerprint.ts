import "server-only";

import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";

export type PdfFormFingerprint = {
  /** Stable, sorted list of AcroForm field names. */
  names: string[];
};

export async function fingerprintPdfFormFieldsFromBytes(bytes: Uint8Array): Promise<PdfFormFingerprint> {
  const extraction = await extractPdfFormFields(Buffer.from(bytes));
  const names = extraction.fields
    .map((f) => (f.name ?? "").trim())
    .filter(Boolean)
    .map((n) => n.toLowerCase())
    .sort();
  // De-dup while preserving sort
  const uniq: string[] = [];
  let prev = "";
  for (const n of names) {
    if (n === prev) continue;
    uniq.push(n);
    prev = n;
  }
  return { names: uniq };
}

export function jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let i = 0;
  let j = 0;
  let inter = 0;
  while (i < a.length && j < b.length) {
    const av = a[i]!;
    const bv = b[j]!;
    if (av === bv) {
      inter++;
      i++;
      j++;
      continue;
    }
    if (av < bv) i++;
    else j++;
  }
  const union = a.length + b.length - inter;
  if (union <= 0) return 0;
  return inter / union;
}


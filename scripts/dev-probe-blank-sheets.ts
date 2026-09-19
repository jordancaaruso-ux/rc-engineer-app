/**
 * Grade a folder of candidate blank sheets before any of them becomes a chassis.
 *
 * For each PDF: does the app accept it, how many boxes does it derive, how many of those boxes
 * arrive with a real name, and what fingerprint would it merge on. The fingerprint matters most —
 * a folder of 1,154 files is not 1,154 chassis, and `ingest-blanks` merges on it silently, so this
 * is the only place the duplicate count is visible before the fact.
 *
 * Reads only. Writes a JSON report beside nothing and touches no database.
 *
 *   node --conditions=react-server --import tsx scripts/dev-probe-blank-sheets.ts <dir> [out.json]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { deriveSchemaFromAcroForm } from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import {
  refusalForBlankExtraction,
  refusalForBlankFile,
} from "@/lib/setupSheetModels/blankUploadDiagnosis";
import {
  derivedSheetFingerprint,
  derivedSheetSlug,
} from "@/lib/setupSheetModels/derivedSheetFingerprint";
import { isPlaceholderLabel } from "@/lib/setupSheetModels/sheetPlan";

type Row = {
  file: string;
  ok: boolean;
  refusal?: string;
  pages?: number;
  boxes?: number;
  fields?: number;
  named?: number;
  namedPct?: number;
  slug?: string;
};

async function grade(dir: string, file: string): Promise<Row> {
  const bytes = readFileSync(join(dir, file));
  const fileRefusal = refusalForBlankFile({ byteSize: bytes.length, mimeType: "application/pdf" });
  if (fileRefusal) return { file, ok: false, refusal: fileRefusal.code };
  const extraction = await extractPdfFormFields(bytes);
  const derived = deriveSchemaFromAcroForm(extraction, file);
  const refusal = refusalForBlankExtraction({ extraction, boxCount: derived.boxes.length });
  if (refusal) return { file, ok: false, refusal: refusal.code };
  const fields = derived.schema.fields;
  const named = fields.filter((f) => !isPlaceholderLabel(f.displayLabel)).length;
  return {
    file,
    ok: true,
    pages: extraction.pageCount ?? 1,
    boxes: derived.boxes.length,
    fields: fields.length,
    named,
    namedPct: Math.round((named / Math.max(fields.length, 1)) * 100),
    slug: derivedSheetSlug(derivedSheetFingerprint(derived)),
  };
}

async function main() {
  const dir = process.argv[2];
  const out = process.argv[3];
  if (!dir) {
    console.error("Usage: dev-probe-blank-sheets.ts <dir> [out.json]");
    process.exit(1);
  }
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  const rows: Row[] = [];
  for (const [i, f] of files.entries()) {
    try {
      rows.push(await grade(dir, f));
    } catch (e) {
      rows.push({ file: f, ok: false, refusal: `ERROR ${e instanceof Error ? e.message : e}` });
    }
    if (i % 100 === 0) console.log(`  ${i}/${files.length}…`);
  }

  const ok = rows.filter((r) => r.ok);
  const bySlug = new Map<string, Row[]>();
  for (const r of ok) bySlug.set(r.slug!, [...(bySlug.get(r.slug!) ?? []), r]);

  const band = (lo: number, hi: number) =>
    ok.filter((r) => r.namedPct! >= lo && r.namedPct! <= hi).length;

  console.log(`\nfiles: ${rows.length}   accepted: ${ok.length}   refused: ${rows.length - ok.length}`);
  console.log(`DISTINCT sheets (fingerprint): ${bySlug.size}`);
  console.log(`\nnaming, of the ${ok.length} accepted:`);
  console.log(`  90-100% named : ${band(90, 100)}`);
  console.log(`  50-89%        : ${band(50, 89)}`);
  console.log(`  10-49%        : ${band(10, 49)}`);
  console.log(`  under 10%     : ${band(0, 9)}`);

  const refusals = new Map<string, number>();
  for (const r of rows.filter((r) => !r.ok)) {
    const k = (r.refusal ?? "?").split(" ")[0];
    refusals.set(k, (refusals.get(k) ?? 0) + 1);
  }
  if (refusals.size) {
    console.log(`\nrefusals: ${[...refusals].map(([k, n]) => `${k}=${n}`).join("  ")}`);
  }
  if (out) {
    writeFileSync(out, JSON.stringify(rows, null, 2));
    console.log(`\nreport -> ${out}`);
  }
}

void main();

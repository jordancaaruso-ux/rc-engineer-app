/**
 * Attach a sheet picture to the EXISTING Awesomatix A800RR chassis — scratch DB only.
 *
 * Creates the SetupSheetBlank row that a derived chassis gets at upload, but with boxes built from
 * the CALIBRATION's mappings (existing schema keys; see boxesFromCalibration.ts) instead of minted
 * ones. The blank's PDF is the calibration's own example document — the exact file the mappings
 * were made against — and the page image pipeline blanks its values before rendering.
 *
 * Idempotent: refuses if the model already has a blank (delete it first to re-run).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { extractPdfFormFields } from "../src/lib/setupDocuments/pdfFormFields";
import { boxesFromCalibrationMappings } from "../src/lib/setupSheetModels/boxesFromCalibration";
import { normalizeSetupSheetModelName } from "../src/lib/setupSheetModels/normalizeModelName";
import { parseSetupSheetModelSchema } from "../src/lib/setupSheetModels/types";
import type { PdfFormFieldMappingRule } from "../src/lib/setupCalibrations/types";

const repo = "c:/Users/Jordan/rc-engineer-app";

function loadDatabaseUrl(): string {
  const raw = readFileSync(resolve(repo, ".env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/);
    if (m) return m[1]!;
  }
  throw new Error("DATABASE_URL not found in .env.local");
}
const url = loadDatabaseUrl();
if (!url.includes("ep-muddy-unit")) throw new Error("Refusing: not the scratch host (ep-muddy-unit).");
const prisma = new PrismaClient({ datasources: { db: { url } } });

/**
 * Printed boxes the calibration never mapped because the import path COMPUTES their values.
 * Confirmed against Jordan's own filled sheet 2026-08-11: Text91/Text93 held the computed
 * spring rates, `ratio` held 4.318, Text17 held his to-test notes.
 */
const EXTRA_SIMPLE_KEYS: Record<string, string> = {
  front_spring_rate_gf_mm: "Text91",
  rear_spring_rate_gf_mm: "Text93",
  final_drive_ratio: "ratio",
  notes: "Text17",
};

async function main() {
  const model = await prisma.setupSheetModel.findUnique({
    where: { slug: "awesomatix_a800rr" },
    select: {
      id: true,
      name: true,
      schemaJson: true,
      derivedFromBlank: { select: { id: true } },
      defaultCalibration: {
        select: {
          id: true,
          calibrationDataJson: true,
          exampleDocument: { select: { id: true, storagePath: true, mimeType: true } },
        },
      },
    },
  });
  if (!model) throw new Error("awesomatix_a800rr model not found");
  if (model.derivedFromBlank) {
    throw new Error(`model already has blank ${model.derivedFromBlank.id} — delete it to re-attach`);
  }
  const calibration = model.defaultCalibration;
  if (!calibration?.exampleDocument?.storagePath) throw new Error("no example document on default calibration");

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  if (!schema) throw new Error("schema failed to parse");

  const { readBytesFromStorageRef } = await import("../src/lib/setupDocuments/storage");
  const pdfBytes = await readBytesFromStorageRef(calibration.exampleDocument.storagePath);
  const extraction = await extractPdfFormFields(Buffer.from(pdfBytes));
  if (!extraction.hasFormFields) throw new Error(`example PDF has no form layer: ${extraction.loadError}`);

  const mappings = ((calibration.calibrationDataJson as Record<string, unknown>).formFieldMappings ??
    {}) as Record<string, PdfFormFieldMappingRule>;

  const result = boxesFromCalibrationMappings({
    extraction,
    formFieldMappings: mappings,
    schema,
    extraSimpleKeys: EXTRA_SIMPLE_KEYS,
  });

  console.log(`boxes: ${result.boxes.length}`);
  console.log(`unresolved keys: ${JSON.stringify(result.unresolvedKeys)}`);
  console.log(`calibration-only keys skipped: ${JSON.stringify(result.skippedCalibrationOnlyKeys)}`);
  const drawableKeys = new Set(result.boxes.map((b) => b.key));
  const missing = schema.fields.filter((f) => !drawableKeys.has(f.key)).map((f) => f.key);
  console.log(`schema fields with no box (hidden on the sheet): ${JSON.stringify(missing)}`);

  if (process.argv.includes("--dry")) {
    console.log("dry run — nothing written");
    return;
  }

  const blank = await prisma.setupSheetBlank.create({
    data: {
      status: "FILLABLE",
      source: "admin",
      setupSheetModelId: model.id,
      setupDocumentId: calibration.exampleDocument.id,
      chassisNameTyped: model.name,
      normalizedName: normalizeSetupSheetModelName(model.name),
      pageCount: extraction.pageCount ?? 1,
      boxesJson: JSON.parse(JSON.stringify(result.boxes)),
      fillSurface: "sheet",
    },
  });
  console.log(`blank created: ${blank.id}`);

  const { prerenderSheetPages } = await import("../src/lib/setupSheetModels/sheetPageImages");
  const drawn = await prerenderSheetPages(model.id);
  console.log(`pages prerendered: ${drawn}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

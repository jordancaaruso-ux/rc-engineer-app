/**
 * Attach a sheet picture to the EXISTING Awesomatix A800RR chassis.
 *
 * Creates the SetupSheetBlank row that a derived chassis gets at upload, but with boxes built from
 * the CALIBRATION's mappings (existing schema keys; see boxesFromCalibration.ts) instead of minted
 * ones. The blank's PDF is the calibration's own example document — the exact file the mappings
 * were made against — and the page image pipeline blanks its values before rendering.
 *
 * Because the boxes land on keys the schema ALREADY uses, every run logged against this chassis
 * renders on the paper the moment the row exists. Nothing about the runs themselves changes.
 *
 *   npm run attach-a800rr                 preflight, writes nothing
 *   npm run attach-a800rr -- --apply
 *   npm run attach-a800rr -- --apply --prod
 *
 * Idempotent: refuses if the model already has a blank (delete it first to re-attach).
 *
 * `--conditions=react-server` is required: the storage and page-image modules import `server-only`.
 */
import { prisma } from "@/lib/prisma";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { boxesFromCalibrationMappings } from "@/lib/setupSheetModels/boxesFromCalibration";
import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";
import { A800RR_EXTRA_SIMPLE_KEYS as EXTRA_SIMPLE_KEYS } from "@/lib/setupSheetModels/a800rrExtraSimpleKeys";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import { guardDatabaseTarget } from "./lib/neonEnvGuard";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  // Storing the pre-rendered page images on prod without a Blob token would write rows pointing at
  // `.local-uploads/` — dead references on Vercel, and a 2.5s re-render on every sheet open.
  guardDatabaseTarget({ apply, prodFlag: args.includes("--prod"), requireBlobOnProd: true });

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

  const { readBytesFromStorageRef } = await import("@/lib/setupDocuments/storage");
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

  if (!apply) {
    console.log("dry run — nothing written. Re-run with --apply.");
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

  const { prerenderSheetPages } = await import("@/lib/setupSheetModels/sheetPageImages");
  const drawn = await prerenderSheetPages(model.id);
  console.log(`pages prerendered: ${drawn}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

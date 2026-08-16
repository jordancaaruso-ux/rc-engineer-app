/**
 * Attach a sheet picture to an EXISTING calibrated chassis.
 *
 * Creates the SetupSheetBlank row that a derived chassis gets at upload, but with boxes built from
 * the CALIBRATION's mappings (existing schema keys; see boxesFromCalibration.ts) instead of minted
 * ones. The blank's PDF is the calibration's own example document — the exact file the mappings
 * were made against — and the page image pipeline blanks its values before rendering.
 *
 * Because the boxes land on keys the schema ALREADY uses, every run logged against this chassis
 * renders on the paper the moment the row exists. Nothing about the runs themselves changes.
 *
 * Generalised from the A800RR-only script (2026-08-14) so MTC3, Mi10 and whatever comes next go
 * sheet-mode the same way. After attaching, run `npm run union-boxes -- --slug <slug>` to add the
 * printed boxes the calibration never mapped.
 *
 *   npm run attach-blank -- --slug mugen_mtc3_10        preflight one chassis, writes nothing
 *   npm run attach-blank -- --all                       preflight every chassis missing a blank
 *   npm run attach-blank -- --all --apply
 *   npm run attach-blank -- --all --apply --prod
 *
 * Idempotent: a model that already has a blank is skipped (delete the blank to re-attach).
 *
 * `--conditions=react-server` is required: the storage and page-image modules import `server-only`.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { boxesFromCalibrationMappings } from "@/lib/setupSheetModels/boxesFromCalibration";
import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";
import { A800RR_EXTRA_SIMPLE_KEYS } from "@/lib/setupSheetModels/a800rrExtraSimpleKeys";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import { guardDatabaseTarget } from "./lib/neonEnvGuard";

const MODEL_SELECT = {
  id: true,
  name: true,
  slug: true,
  schemaJson: true,
  sheetBlanks: { where: { isEdition: false }, take: 1, select: { id: true } },
  defaultCalibration: {
    select: {
      id: true,
      calibrationDataJson: true,
      exampleDocument: { select: { id: true, storagePath: true, mimeType: true } },
    },
  },
} as const;

type ModelRow = Prisma.SetupSheetModelGetPayload<{ select: typeof MODEL_SELECT }>;

/** Attach one chassis's blank. Returns false when the model can't take one (reason printed). */
async function attachOne(model: ModelRow, apply: boolean): Promise<boolean> {
  console.log(`\n=== ${model.name} [${model.slug}] ===`);
  if (model.sheetBlanks[0]) {
    console.log(`already has blank ${model.sheetBlanks[0].id} — skipped (delete it to re-attach)`);
    return false;
  }
  const calibration = model.defaultCalibration;
  if (!calibration?.exampleDocument?.storagePath) {
    console.log("no example document on default calibration — nothing to attach");
    return false;
  }

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  if (!schema) {
    console.log("schema failed to parse — skipped");
    return false;
  }

  const { readBytesFromStorageRef } = await import("@/lib/setupDocuments/storage");
  const pdfBytes = await readBytesFromStorageRef(calibration.exampleDocument.storagePath);
  const extraction = await extractPdfFormFields(Buffer.from(pdfBytes));
  if (!extraction.hasFormFields) {
    console.log(`example PDF has no form layer: ${extraction.loadError} — skipped`);
    return false;
  }

  const mappings = ((calibration.calibrationDataJson as Record<string, unknown>).formFieldMappings ??
    {}) as Record<string, PdfFormFieldMappingRule>;

  const result = boxesFromCalibrationMappings({
    extraction,
    formFieldMappings: mappings,
    schema,
    // Only the A800RR has hand-written supplements; every other chassis passes none.
    extraSimpleKeys: model.slug === "awesomatix_a800rr" ? A800RR_EXTRA_SIMPLE_KEYS : undefined,
  });

  console.log(`boxes: ${result.boxes.length}`);
  console.log(`unresolved keys: ${JSON.stringify(result.unresolvedKeys)}`);
  console.log(`calibration-only keys skipped: ${JSON.stringify(result.skippedCalibrationOnlyKeys)}`);
  const drawableKeys = new Set(result.boxes.map((b) => b.key));
  const missing = schema.fields.filter((f) => !drawableKeys.has(f.key)).map((f) => f.key);
  console.log(`schema fields with no box (hidden on the sheet): ${JSON.stringify(missing)}`);

  if (!apply) {
    console.log("dry run — nothing written.");
    return true;
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
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const all = args.includes("--all");
  const slugIdx = args.indexOf("--slug");
  const slug = slugIdx >= 0 ? args[slugIdx + 1] : undefined;
  if (!all && (!slug || slug.startsWith("--"))) {
    throw new Error("pass --slug <model slug> or --all");
  }
  // Storing the pre-rendered page images on prod without a Blob token would write rows pointing at
  // `.local-uploads/` — dead references on Vercel, and a 2.5s re-render on every sheet open.
  guardDatabaseTarget({ apply, prodFlag: args.includes("--prod"), requireBlobOnProd: true });

  let models: ModelRow[];
  if (all) {
    models = await prisma.setupSheetModel.findMany({
      where: { sheetBlanks: { none: { isEdition: false } } },
      orderBy: { name: "asc" },
      select: MODEL_SELECT,
    });
    if (models.length === 0) {
      console.log("every chassis already has a blank — nothing to do");
      return;
    }
  } else {
    const model = await prisma.setupSheetModel.findUnique({
      where: { slug: slug! },
      select: MODEL_SELECT,
    });
    if (!model) throw new Error(`no chassis with slug ${slug}`);
    models = [model];
  }

  let attached = 0;
  for (const model of models) {
    if (await attachOne(model, apply)) attached += 1;
  }
  console.log(
    `\n${attached}/${models.length} chassis ${apply ? "attached" : "attachable"}.` +
      (apply ? "" : " Re-run with --apply.")
  );
  if (attached > 0) {
    console.log("Next: npm run union-boxes -- --slug <slug> for each, to add the unmapped printed boxes.");
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

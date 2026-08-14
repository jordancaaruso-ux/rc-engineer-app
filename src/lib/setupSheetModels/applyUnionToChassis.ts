import "server-only";

import { prisma } from "@/lib/prisma";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { parseStoredBoxes } from "@/lib/setupSheetModels/sheetPlan";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { unionDerivedWithCalibration } from "@/lib/setupSheetModels/unionDerivedWithCalibration";

/**
 * Give a calibrated chassis every box its sheet prints.
 *
 * Reads the chassis's stored blank PDF, works out which printed boxes the calibration already
 * speaks for, and appends a parameter + box + mapping for each one it doesn't. Run once per chassis;
 * safe to run again — a box that already has a key is claimed and therefore skipped, so a second run
 * over an unchanged blank adds nothing.
 *
 * WHY THE BLANK'S OWN DOCUMENT AND NOT AN UPLOAD. The geometry has to be the same file the sheet
 * PICTURE was rendered from, or the boxes land somewhere the driver's page doesn't have them. That
 * file is `SetupSheetBlank.setupDocument` — for a curated chassis, the calibration's own example
 * document. A driver's filled upload is a different file and may be a revised sheet.
 *
 * Not called on upload. The blank is fixed; re-deriving it on every driver's PDF would be work with
 * no new answer, and would let one driver's revised sheet reshape a chassis everybody shares.
 */

export type UnionApplyResult = {
  /** Boxes that already had a key — nothing to do for these. */
  claimedWidgetCount: number;
  /** Parameters this run created. Zero on a re-run over an unchanged blank. */
  addedFieldCount: number;
  addedBoxCount: number;
  /** Keys that collided with something already on the chassis and were suffixed. Permanent. */
  collidedKeys: string[];
  /** Written, or previewed only. */
  applied: boolean;
};

export async function applyUnionToChassis(input: {
  setupSheetModelId: string;
  /** False previews the counts without writing — the shape every attach script wants first. */
  apply: boolean;
  /** See `boxesFromCalibrationMappings`: printed boxes the import path computes rather than reads. */
  extraSimpleKeys?: Record<string, string>;
}): Promise<UnionApplyResult> {
  const model = await prisma.setupSheetModel.findUnique({
    where: { id: input.setupSheetModelId },
    select: {
      id: true,
      name: true,
      schemaJson: true,
      derivedFromBlank: {
        select: {
          id: true,
          boxesJson: true,
          derivedMappingsJson: true,
          setupDocument: { select: { storagePath: true } },
        },
      },
      defaultCalibration: { select: { calibrationDataJson: true } },
    },
  });
  if (!model) throw new Error(`unknown chassis ${input.setupSheetModelId}`);

  const blank = model.derivedFromBlank;
  if (!blank) throw new Error(`chassis ${model.name} has no blank — nothing to draw boxes on`);
  if (!blank.setupDocument?.storagePath) {
    throw new Error(`blank ${blank.id} has no stored PDF — its uploader's document is gone`);
  }

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  if (!schema) throw new Error(`chassis ${model.name} has an unreadable schema`);

  const { readBytesFromStorageRef } = await import("@/lib/setupDocuments/storage");
  const pdfBytes = await readBytesFromStorageRef(blank.setupDocument.storagePath);
  const extraction = await extractPdfFormFields(Buffer.from(pdfBytes));
  if (!extraction.hasFormFields) {
    throw new Error(`blank ${blank.id} has no form layer: ${extraction.loadError ?? "unknown"}`);
  }

  const calibrationMappings = ((model.defaultCalibration?.calibrationDataJson as
    | Record<string, unknown>
    | null)?.formFieldMappings ?? {}) as Record<string, PdfFormFieldMappingRule>;

  const existingDerived = (blank.derivedMappingsJson ?? {}) as Record<string, PdfFormFieldMappingRule>;

  const union = unionDerivedWithCalibration({
    extraction,
    schema,
    // A previous run's derived mappings claim their boxes too, or a re-run would mint a second
    // parameter for every box the first run created.
    formFieldMappings: { ...calibrationMappings, ...existingDerived },
    extraSimpleKeys: input.extraSimpleKeys,
    label: model.name,
  });

  const result: UnionApplyResult = {
    claimedWidgetCount: union.claimedWidgetCount,
    addedFieldCount: union.fields.length,
    addedBoxCount: union.boxes.length,
    collidedKeys: union.stats.collidedKeys,
    applied: false,
  };
  if (!input.apply || union.fields.length === 0) return result;

  const nextSchema = { ...schema, fields: [...schema.fields, ...union.fields] };
  const nextBoxes = [...parseStoredBoxes(blank.boxesJson), ...union.boxes];
  const nextDerived = { ...existingDerived, ...union.mappings };

  // One transaction: a schema carrying keys whose boxes never landed would draw a sheet with holes
  // in it, and a box pointing at a key the schema doesn't declare is dropped by `buildSheetPlan`.
  await prisma.$transaction([
    prisma.setupSheetModel.update({
      where: { id: model.id },
      data: { schemaJson: JSON.parse(JSON.stringify(nextSchema)) },
    }),
    prisma.setupSheetBlank.update({
      where: { id: blank.id },
      data: {
        boxesJson: JSON.parse(JSON.stringify(nextBoxes)),
        derivedMappingsJson: JSON.parse(JSON.stringify(nextDerived)),
      },
    }),
  ]);

  return { ...result, applied: true };
}

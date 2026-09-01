/**
 * Align the Awesomatix A800RR EDITION ("setup 2.pdf" — the rebuilt sheet Lucas's PDF uses) to the
 * chassis's canonical vocabulary, so a filled copy of that PDF imports exactly like the original.
 *
 * What it writes (only with --apply; default is a dry run that prints the full report):
 *   - the edition CALIBRATION's formFieldMappings become canonical-key rules re-addressed to the
 *     edition's field names (geometric transfer — see `alignEditionByGeometry`);
 *   - the edition BLANK gets boxesJson rebuilt with canonical keys, derivedMappingsJson carrying
 *     the transferred union rules, and schemaFieldsJson cleared so the sheet plan reads the model
 *     schema — the same architecture the primary blank has;
 *   - extra simple keys (computed boxes: spring rates, ratio, notes) are baked into the rebuilt
 *     boxes via their transferred field names.
 *
 * Run: npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx scripts/align-a800rr-edition.ts [--apply]
 * The DB it touches is whatever the env file points at — grep the host first.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { transferMappingsByGeometry } from "@/lib/setupSheetModels/alignEditionByGeometry";
import { boxesFromCalibrationMappings } from "@/lib/setupSheetModels/boxesFromCalibration";
import { A800RR_EXTRA_SIMPLE_KEYS } from "@/lib/setupSheetModels/a800rrExtraSimpleKeys";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";

const APPLY = process.argv.includes("--apply");

/**
 * Pairs settled by reading both printed pages side by side (2026-08-31, rendered at scale 3 and
 * compared row by row). Two regions defeat geometry on this edition:
 *
 *   - the footer/electronics block reflowed: every row moved ~7–18pt, landing each box midway
 *     between two rows of the other file;
 *   - the LOWER DECK (chassis) row gained a fourth option, C01B-RSL, which squeezed the three
 *     existing boxes leftward — nearest-neighbour pairs every box to its right-hand NEIGHBOUR.
 *
 * Widget indexes are stable (page, y, x) but NOT left-to-right here — sub-point y jitter scrambles
 * them (see `dev-print-chassis-widgets.ts` output, 2026-08-31):
 *   OLD Check Box17: #1 = x124 (C01B-RAF), #2 = x167 (C01B-RC), #0 = x205 (C01RS)
 *   NEW Chassis:     #0 = x96  (C01B-RAF), #3 = x136 (C01B-RC), #2 = x176 (C01B-RS), #1 = x219 (C01B-RSL, new)
 */
const MANUAL_PAIRS: Record<string, string> = {
  "Text56#0": "Bodyshell#0",
  "Text52#0": "Rear Wing#0",
  "Text53#0": "ESC#0",
  "Text64#0": "ESC Settings#0",
  "Text57#0": "Battery#0",
  "Text58#0": "Receiver#0",
  "Text59#0": "Radio#0",
  "Text61#0": "Best Lap Time#0",
  "Text62#0": "Qualy Position#0",
  "Text63#0": "Final Position#0",
  "Text50#0": "Inner Wheel Steering Travel#0",
  "Text51#0": "Outer Wheel Steering Travel#0",
  "Texte1#0": "Ackermann Position#0",
  "Text5#0": "Date#0",
  "Text6#0": "Air Temp#0",
  "Text7#0": "Track Temp#0",
  "Text17#0": "Comments#0",
  "Text71#0": "Notes#0",
  "Text7755#0": "Chassis Other#0",
  "Check Box17#1": "Chassis#0",
  "Check Box17#2": "Chassis#3",
  "Check Box17#0": "Chassis#2",
};

async function main() {
  const model = await prisma.setupSheetModel.findFirstOrThrow({
    where: { slug: "awesomatix_a800rr" },
    select: {
      id: true,
      name: true,
      schemaJson: true,
      defaultCalibration: { select: { id: true, name: true, calibrationDataJson: true } },
      sheetBlanks: {
        where: { status: "FILLABLE" },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          isEdition: true,
          derivedMappingsJson: true,
          schemaFieldsJson: true,
          setupDocumentId: true,
          setupDocument: { select: { storagePath: true, originalFilename: true } },
        },
      },
    },
  });

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  if (!schema) throw new Error("model schema unreadable");
  const primaryBlank = model.sheetBlanks.find((b) => !b.isEdition);
  const editionBlanks = model.sheetBlanks.filter((b) => b.isEdition && b.setupDocument?.storagePath);
  if (!primaryBlank?.setupDocument?.storagePath) throw new Error("primary blank has no stored PDF");
  if (!model.defaultCalibration) throw new Error("model has no default calibration");
  if (editionBlanks.length === 0) throw new Error("no edition blank with a stored PDF");

  console.log(`model: ${model.name} (${model.id}) — schema fields: ${schema.fields.length}`);
  console.log(`primary calibration: ${model.defaultCalibration.name} (${model.defaultCalibration.id})`);

  const primaryCalData = model.defaultCalibration.calibrationDataJson as Record<string, unknown>;
  const primaryMappings = (primaryCalData.formFieldMappings ?? {}) as Record<string, PdfFormFieldMappingRule>;
  const primaryDerived = (primaryBlank.derivedMappingsJson ?? {}) as Record<string, PdfFormFieldMappingRule>;
  console.log(
    `primary rules: ${Object.keys(primaryMappings).length} calibration, ${Object.keys(primaryDerived).length} derived, ${Object.keys(A800RR_EXTRA_SIMPLE_KEYS).length} extra`
  );

  const primaryBytes = await readBytesFromStorageRef(primaryBlank.setupDocument.storagePath);
  const primaryExtraction = await extractPdfFormFields(Buffer.from(primaryBytes));
  if (!primaryExtraction.hasFormFields) throw new Error("primary blank PDF has no form layer");

  for (const edition of editionBlanks) {
    const calibration = await prisma.setupSheetCalibration.findFirst({
      where: { setupSheetModelId: model.id, exampleDocumentId: edition.setupDocumentId! },
      select: { id: true, name: true, calibrationDataJson: true },
    });
    if (!calibration) {
      console.log(`\nEDITION ${edition.id}: no calibration found for its example document — skipped`);
      continue;
    }
    console.log(`\nEDITION ${edition.id} — ${edition.setupDocument!.originalFilename}`);
    console.log(`  calibration: ${calibration.name} (${calibration.id})`);

    const editionBytes = await readBytesFromStorageRef(edition.setupDocument!.storagePath!);
    const editionExtraction = await extractPdfFormFields(Buffer.from(editionBytes));
    if (!editionExtraction.hasFormFields) {
      console.log("  edition PDF has no form layer — skipped");
      continue;
    }

    const transfer = transferMappingsByGeometry({
      primary: primaryExtraction,
      edition: editionExtraction,
      formFieldMappings: primaryMappings,
      derivedMappings: primaryDerived,
      extraSimpleKeys: A800RR_EXTRA_SIMPLE_KEYS,
      manualPairs: MANUAL_PAIRS,
    });

    console.log(
      `  transferred: ${Object.keys(transfer.formFieldMappings).length}/${Object.keys(primaryMappings).length} calibration rules, ` +
        `${Object.keys(transfer.derivedMappings).length}/${Object.keys(primaryDerived).length} derived rules, ` +
        `${Object.keys(transfer.extraSimpleKeys).length}/${Object.keys(A800RR_EXTRA_SIMPLE_KEYS).length} extra keys`
    );
    for (const key of ["chassis", "chassis_other", "esc", "receiver", "radio", "bodyshell", "wing", "battery", "date"]) {
      const rule = transfer.formFieldMappings[key] ?? transfer.derivedMappings[key];
      if (rule) console.log(`  RULE ${key}: ${JSON.stringify(rule)}`);
    }
    console.log(`  DROPPED (${transfer.dropped.length}):`);
    for (const d of transfer.dropped) console.log(`    ${d.key}: ${d.reason}`);
    console.log(`  LOOSELY PAIRED — verify against the page pictures (${transfer.looselyPairedKeys.length}):`);
    for (const k of transfer.looselyPairedKeys) console.log(`    ${k.key} (moved ${k.maxDistancePt}pt)`);
    console.log(`  NEW boxes on the edition, unreadable for now (${transfer.unmatchedEditionWidgets.length}):`);
    for (const w of transfer.unmatchedEditionWidgets) {
      console.log(`    ${w.fieldName}#${w.instanceIndex} [${w.fieldType}] @ p${w.pageNumber} (${Math.round(w.cx)}, ${Math.round(w.cy)})`);
    }
    console.log(`  primary widgets with no edition counterpart (${transfer.unmatchedPrimaryWidgets.length}):`);
    for (const w of transfer.unmatchedPrimaryWidgets) {
      console.log(`    ${w.fieldName}#${w.instanceIndex} [${w.fieldType}] @ p${w.pageNumber} (${Math.round(w.cx)}, ${Math.round(w.cy)})`);
    }

    /*
     * The one NEW box that would silently lose a driver's choice: the rebuilt sheet's LOWER DECK
     * row gained C01B-RSL (a real Awesomatix part the original paper predates). The schema's
     * chassis field gains the option (idempotent — every A800RR form gets the chip) and the
     * edition rule reads its tick. BW7/BW8 and "Important Notice" stay unread by choice: no old
     * sheet could record them either, so reading them is a promotion for the founder to call.
     */
    const chassisRule = transfer.formFieldMappings.chassis;
    if (chassisRule && "mode" in chassisRule && chassisRule.mode === "singleChoiceWidgetGroup") {
      chassisRule.options["C01B-RSL"] = { widgetInstanceIndex: 1 };
    }
    const chassisField = schema.fields.find((f) => f.key === "chassis");
    if (
      chassisField?.groupedOptionLabels &&
      chassisField.groupedOptionValues &&
      !chassisField.groupedOptionLabels.includes("C01B-RSL")
    ) {
      const at = chassisField.groupedOptionLabels.indexOf("Other");
      const i = at >= 0 ? at : chassisField.groupedOptionLabels.length;
      chassisField.groupedOptionLabels.splice(i, 0, "C01B-RSL");
      chassisField.groupedOptionValues.splice(i, 0, "c01b_rsl");
      console.log(`  schema: chassis field gains option C01B-RSL (will be written with --apply)`);
    }

    const rebuilt = boxesFromCalibrationMappings({
      extraction: editionExtraction,
      formFieldMappings: { ...transfer.derivedMappings, ...transfer.formFieldMappings },
      schema,
      extraSimpleKeys: transfer.extraSimpleKeys,
    });
    console.log(
      `  rebuilt boxes: ${rebuilt.boxes.length} (unresolved keys: ${rebuilt.unresolvedKeys.length}, calibration-only skipped: ${rebuilt.skippedCalibrationOnlyKeys.length})`
    );
    if (rebuilt.unresolvedKeys.length) console.log(`    unresolved: ${rebuilt.unresolvedKeys.join(", ")}`);
    if (rebuilt.skippedCalibrationOnlyKeys.length) {
      console.log(`    calibration-only: ${rebuilt.skippedCalibrationOnlyKeys.join(", ")}`);
    }

    if (!APPLY) {
      console.log("  DRY RUN — nothing written. Re-run with --apply to write.");
      continue;
    }

    const currentCalData = (calibration.calibrationDataJson ?? {}) as Record<string, unknown>;
    const nextCalData = {
      ...currentCalData,
      templateType: "pdf_form_fields",
      formFieldMappings: transfer.formFieldMappings,
      // The computed boxes' edition-side field names (spring rates, ratio, notes), for the EXPORT
      // fill only — `ensureRunSetupPdf` reads them; the import never does, same doctrine as
      // `A800RR_EXTRA_SIMPLE_KEYS` staying out of `derivedMappingsJson`.
      extraSimpleKeys: transfer.extraSimpleKeys,
    };
    await prisma.$transaction([
      prisma.setupSheetModel.update({
        where: { id: model.id },
        data: { schemaJson: JSON.parse(JSON.stringify(schema)) },
      }),
      prisma.setupSheetCalibration.update({
        where: { id: calibration.id },
        data: { calibrationDataJson: JSON.parse(JSON.stringify(nextCalData)) },
      }),
      prisma.setupSheetBlank.update({
        where: { id: edition.id },
        data: {
          boxesJson: JSON.parse(JSON.stringify(rebuilt.boxes)),
          derivedMappingsJson: JSON.parse(JSON.stringify(transfer.derivedMappings)),
          schemaFieldsJson: Prisma.DbNull,
        },
      }),
    ]);
    console.log(`  APPLIED: calibration ${calibration.id} + blank ${edition.id} now speak the canonical vocabulary.`);
  }
}

main().finally(() => prisma.$disconnect());

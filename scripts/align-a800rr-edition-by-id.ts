/**
 * Align ONE Awesomatix A800RR sheet version (edition) to the chassis's canonical vocabulary by box
 * position, so setups on it read like the main sheet's (Engineer, aggregations, roll-centre strip)
 * while the driver keeps seeing their own PDF (founder ruling 2026-08-31).
 *
 * Generalises `align-a800rr-edition.ts`, which aligned the 2026-08-16 edition and loops over EVERY
 * edition with that edition's hand-pinned pairs and chassis-row fix. Those are wrong for any other
 * rebuilt PDF, so this script takes one edition (--blank=<SetupSheetBlank id>), keeps hand pairs per
 * edition, leaves the model schema alone, and writes a JSON backup of what it touches before applying.
 *
 * Run: npx dotenv-cli -e <env> -- node --conditions=react-server --import tsx \
 *        scripts/align-a800rr-edition-by-id.ts --blank=<id> [--apply]
 * Default is a dry run that prints the full report. The DB is whatever the env file points at.
 * After --apply, re-import the setups born on the edition (migrate-a800rr-edition-snapshots.ts
 * pattern) and rebuild aggregations.
 */
import { mkdirSync, writeFileSync } from "node:fs";
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
const BLANK_ID = process.argv.find((a) => a.startsWith("--blank="))?.slice("--blank=".length);

/** Aligned 2026-08-31 with its own hand pairs by `align-a800rr-edition.ts`; never re-run it here. */
const EDITION_0816 = "cmsvng6nx0005jn04yqmmda56";

/**
 * 2026-09-08 edition: not a rebuild but the main PDF edited (in a French Acrobat): nearly every box
 * kept its field name, the footer moved up 7-18pt, and the LOWER DECK row gained C01B-RSL. Geometry
 * alone paired all three chassis ticks to their neighbour and crossed receiver/radio/ESC setting in
 * the footer (checked 2026-09-25 against both page pictures), so this edition pairs same-named
 * widgets that sit within IDENTITY_TOLERANCE_PT of each other, plus the hand pairs below.
 */
const EDITION_0908 = "cmtsrvmyy000cjv0435f15tg3";
const IDENTITY_BY_NAME = new Set([EDITION_0908]);
const IDENTITY_TOLERANCE_PT = 20;

/** Primary "field#instance" -> edition "field#instance", settled by reading both printed pages. */
const MANUAL_PAIRS: Record<string, Record<string, string>> = {
  [EDITION_0908]: {
    // LOWER DECK, left to right on the edition: #0 C01B-RAF, #3 C01B-RC, #2 C01B-RS, #1 C01B-RSL (new).
    "Check Box17#1": "Check Box17#0", // C01B-RAF
    "Check Box17#2": "Check Box17#3", // C01B-RC
    "Check Box17#0": "Check Box17#2", // C01RS, printed C01B-RS on this sheet
    // Front bumper C07R / C07RF: the second tick is a second widget of Check Box31 on this sheet.
    "Check Box31#0": "Check Box31#0",
    "Check Box42#0": "Check Box31#1",
  },
};

/**
 * Keys left unread on purpose: geometry paired them loosely (~17pt) inside rows whose widget order was
 * renumbered, and nobody has checked them against the page. Unread beats wrong. Both are derived boxes
 * no calibration named.
 */
const DROP_KEYS: Record<string, string[]> = { [EDITION_0908]: ["check_box4712__b1", "check_box4711__b2"] };

/** The edition widget that reads the chassis option C01B-RSL, which only the newer paper prints. */
const RSL_WIDGET: Record<string, number> = { [EDITION_0908]: 1 };

type Extraction = Awaited<ReturnType<typeof extractPdfFormFields>>;
function widgetCentres(ex: Extraction) {
  const out = new Map<string, { page: number; cx: number; cy: number }>();
  for (const f of ex.fields) for (const w of f.widgets) out.set(`${f.name}#${w.instanceIndex}`, { page: w.pageNumber, cx: w.x + w.width / 2, cy: w.y + w.height / 2 });
  return out;
}
/** Same-named widgets that sit together, minus any field the hand pairs already speak for. */
function identityPairs(primary: Extraction, edition: Extraction, hand: Record<string, string>) {
  const p = widgetCentres(primary), e = widgetCentres(edition);
  const handFields = new Set([...Object.keys(hand), ...Object.values(hand)].map((k) => k.slice(0, k.lastIndexOf("#"))));
  const pairs: Record<string, string> = {};
  const far: string[] = [];
  for (const [k, a] of p) {
    if (handFields.has(k.slice(0, k.lastIndexOf("#")))) continue;
    const b = e.get(k);
    if (!b || b.page !== a.page) continue;
    const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    if (d <= IDENTITY_TOLERANCE_PT) pairs[k] = k;
    else far.push(`${k} (${Math.round(d)}pt apart)`);
  }
  return { pairs, far };
}

async function main() {
  if (!BLANK_ID) throw new Error("pass --blank=<SetupSheetBlank id>");
  if (BLANK_ID === EDITION_0816) throw new Error("the 2026-08-16 edition is already aligned (align-a800rr-edition.ts)");

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
          boxesJson: true,
          setupDocumentId: true,
          setupDocument: { select: { storagePath: true, originalFilename: true } },
        },
      },
    },
  });

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  if (!schema) throw new Error("model schema unreadable");
  const primaryBlank = model.sheetBlanks.find((b) => !b.isEdition);
  const edition = model.sheetBlanks.find((b) => b.isEdition && b.id === BLANK_ID);
  if (!primaryBlank?.setupDocument?.storagePath) throw new Error("primary blank has no stored PDF");
  if (!model.defaultCalibration) throw new Error("model has no default calibration");
  if (!edition?.setupDocument?.storagePath) throw new Error(`no A800RR edition ${BLANK_ID} with a stored PDF`);

  const calibration = await prisma.setupSheetCalibration.findFirst({
    where: { setupSheetModelId: model.id, exampleDocumentId: edition.setupDocumentId! },
    select: { id: true, name: true, calibrationDataJson: true },
  });
  if (!calibration) throw new Error("no calibration found for the edition's example document");

  console.log(`model: ${model.name} (${model.id}) — schema fields: ${schema.fields.length}`);
  console.log(`primary calibration: ${model.defaultCalibration.name} (${model.defaultCalibration.id})`);
  console.log(`EDITION ${edition.id}; calibration ${calibration.id}`);

  const primaryCalData = model.defaultCalibration.calibrationDataJson as Record<string, unknown>;
  const primaryMappings = (primaryCalData.formFieldMappings ?? {}) as Record<string, PdfFormFieldMappingRule>;
  const primaryDerived = (primaryBlank.derivedMappingsJson ?? {}) as Record<string, PdfFormFieldMappingRule>;
  const primaryExtraction = await extractPdfFormFields(Buffer.from(await readBytesFromStorageRef(primaryBlank.setupDocument.storagePath)));
  const editionExtraction = await extractPdfFormFields(Buffer.from(await readBytesFromStorageRef(edition.setupDocument.storagePath)));
  if (!primaryExtraction.hasFormFields || !editionExtraction.hasFormFields) throw new Error("a PDF has no form layer");

  const hand = MANUAL_PAIRS[BLANK_ID] ?? {};
  let manualPairs = hand;
  if (IDENTITY_BY_NAME.has(BLANK_ID)) {
    const identity = identityPairs(primaryExtraction, editionExtraction, hand);
    manualPairs = { ...identity.pairs, ...hand };
    console.log(`pinned: ${Object.keys(identity.pairs).length} same-named widgets within ${IDENTITY_TOLERANCE_PT}pt, ${Object.keys(hand).length} by hand`);
    if (identity.far.length) console.log(`same name but too far apart to pin (${identity.far.length}): ${identity.far.join(", ")}`);
  }

  const transfer = transferMappingsByGeometry({
    primary: primaryExtraction,
    edition: editionExtraction,
    formFieldMappings: primaryMappings,
    derivedMappings: primaryDerived,
    extraSimpleKeys: A800RR_EXTRA_SIMPLE_KEYS,
    manualPairs,
  });

  for (const k of DROP_KEYS[BLANK_ID] ?? []) {
    delete transfer.formFieldMappings[k];
    delete transfer.derivedMappings[k];
    console.log(`left unread on purpose: ${k}`);
  }

  const chassisField = schema.fields.find((f) => f.key === "chassis");
  const rsl = RSL_WIDGET[BLANK_ID];
  const chassisRuleNow = transfer.formFieldMappings.chassis;
  if (rsl != null && chassisRuleNow && "mode" in chassisRuleNow && chassisRuleNow.mode === "singleChoiceWidgetGroup") {
    if (chassisField?.groupedOptionLabels?.includes("C01B-RSL")) chassisRuleNow.options["C01B-RSL"] = { widgetInstanceIndex: rsl };
    else console.log("WARNING: the model schema has no C01B-RSL chassis option; that tick stays unread");
  }

  console.log(
    `transferred: ${Object.keys(transfer.formFieldMappings).length}/${Object.keys(primaryMappings).length} calibration rules, ` +
      `${Object.keys(transfer.derivedMappings).length}/${Object.keys(primaryDerived).length} derived rules, ` +
      `${Object.keys(transfer.extraSimpleKeys).length}/${Object.keys(A800RR_EXTRA_SIMPLE_KEYS).length} extra keys`
  );
  const chassisRule = transfer.formFieldMappings.chassis;
  if (chassisRule) console.log(`RULE chassis: ${JSON.stringify(chassisRule)}`);
  console.log(`DROPPED (${transfer.dropped.length}):`);
  for (const d of transfer.dropped) console.log(`  ${d.key}: ${d.reason}`);
  console.log(`LOOSELY PAIRED — verify against the page pictures (${transfer.looselyPairedKeys.length}):`);
  for (const k of transfer.looselyPairedKeys) console.log(`  ${k.key} (moved ${k.maxDistancePt}pt)`);
  console.log(`NEW boxes on the edition, unreadable for now (${transfer.unmatchedEditionWidgets.length}):`);
  for (const w of transfer.unmatchedEditionWidgets) {
    console.log(`  ${w.fieldName}#${w.instanceIndex} [${w.fieldType}] @ p${w.pageNumber} (${Math.round(w.cx)}, ${Math.round(w.cy)})`);
  }
  console.log(`primary widgets with no edition counterpart (${transfer.unmatchedPrimaryWidgets.length}):`);
  for (const w of transfer.unmatchedPrimaryWidgets) {
    console.log(`  ${w.fieldName}#${w.instanceIndex} [${w.fieldType}] @ p${w.pageNumber} (${Math.round(w.cx)}, ${Math.round(w.cy)})`);
  }

  const rebuilt = boxesFromCalibrationMappings({
    extraction: editionExtraction,
    formFieldMappings: { ...transfer.derivedMappings, ...transfer.formFieldMappings },
    schema,
    extraSimpleKeys: transfer.extraSimpleKeys,
  });
  console.log(
    `rebuilt boxes: ${rebuilt.boxes.length} (unresolved keys: ${rebuilt.unresolvedKeys.length}, calibration-only skipped: ${rebuilt.skippedCalibrationOnlyKeys.length})`
  );
  if (rebuilt.unresolvedKeys.length) console.log(`  unresolved: ${rebuilt.unresolvedKeys.join(", ")}`);

  if (!APPLY) {
    console.log("DRY RUN — nothing written. Re-run with --apply to write.");
    return;
  }

  mkdirSync("scripts/tmp", { recursive: true });
  const backupPath = `scripts/tmp/a800rr-edition-${edition.id}-backup-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(
    backupPath,
    JSON.stringify({ takenAt: new Date().toISOString(), calibration, blank: { id: edition.id, boxesJson: edition.boxesJson, derivedMappingsJson: edition.derivedMappingsJson, schemaFieldsJson: edition.schemaFieldsJson } }, null, 1)
  );
  console.log(`backup written: ${backupPath}`);

  const currentCalData = (calibration.calibrationDataJson ?? {}) as Record<string, unknown>;
  const nextCalData = {
    ...currentCalData,
    templateType: "pdf_form_fields",
    formFieldMappings: transfer.formFieldMappings,
    extraSimpleKeys: transfer.extraSimpleKeys,
  };
  await prisma.$transaction([
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
  console.log(`APPLIED: calibration ${calibration.id} + blank ${edition.id} now speak the canonical vocabulary.`);
}

main().finally(() => prisma.$disconnect());

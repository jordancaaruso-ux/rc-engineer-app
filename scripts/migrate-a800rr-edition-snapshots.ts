/**
 * Rewrite the setups saved under the A800RR edition's own vocabulary into the canonical one.
 *
 * Six snapshots on production (2026-08-16: two of Jordan's tests, four of Lucas Urbain's Andernach
 * test day) were imported while the edition still spoke its minted keys (`front_shock_oil`,
 * `chassis__b3`, …). Those keys are invisible to the Engineer, the aggregations and the roll-centre
 * strip. Run AFTER `align-a800rr-edition.ts --apply` — the aligned calibration is what defines the
 * canonical read.
 *
 * HOW, and why not a key-rename table: each snapshot's values are written back into a blanked copy
 * of the edition PDF through the same identity mapping that minted them (`deriveSchemaFromAcroForm`
 * is deterministic), and that filled file is re-imported through the REAL pipeline with the aligned
 * calibration — interpreter, normalisers and derived fields are the production ones, so the result
 * is byte-for-byte what importing the driver's PDF today would store. Hand-mapping keys would mean
 * re-implementing the interpreter's sign conventions and grouped-value shapes, wrongly.
 *
 * Run: npx dotenv-cli -e <env> -- node --conditions=react-server --import tsx scripts/migrate-a800rr-edition-snapshots.ts [--apply]
 */
import { prisma } from "@/lib/prisma";
import { applyCalibrationToPdf } from "@/lib/setupCalibrations/extract";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import { fillPdfForm, type PdfFillMapping } from "@/lib/setupDocuments/fillPdfForm";
import { blankPdfFormValues } from "@/lib/setupDocuments/pdfBlankForm";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { normalizeParsedSetupData } from "@/lib/setupDocuments/normalize";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { applyDerivedFieldsToSnapshot } from "@/lib/setup/deriveRenderValues";
import { deriveSchemaFromAcroForm } from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";

const APPLY = process.argv.includes("--apply");

/** Keys that exist only in the edition's minted vocabulary — the marker of an unmigrated setup. */
const SENTINEL_KEYS = ["front_shock_oil", "ff_inner_top_link_spacer", "front_upper_hub_spacer"];

/**
 * Double-ticked single-choice rows, resolved by history (read on prod, 2026-08-31): the edition's
 * sheet drew each tick as an independent box, so editing a damping mode ADDED the new tick and
 * left the old one standing. The tick already present in the driver's FIRST import is the stale
 * one; the added tick is the run's change (rear damping % moved 80→60 in the same edit). Listed
 * per snapshot so the paper gets exactly one tick — the newer one.
 */
const STALE_TICKS: Record<string, string[]> = {
  cmsvp6s530002l8047cvaqk2c: ["rear_damping_mode__b1"],
  cmsvspo55002bjk04peamv4ha: ["rear_damping_mode__b1"],
  cmsvsrt920036jk04w0pnli2t: ["rear_damping_mode__b1", "front_damping_mode__b2"],
};

function asFillValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() ? v : null;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : null;
  return null; // arrays/objects are canonical-shaped values, never edition-minted ones
}

async function main() {
  const model = await prisma.setupSheetModel.findFirstOrThrow({
    where: { slug: "awesomatix_a800rr" },
    select: { id: true, name: true },
  });
  const edition = await prisma.setupSheetBlank.findFirstOrThrow({
    where: { setupSheetModelId: model.id, isEdition: true, setupDocumentId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      derivedMappingsJson: true,
      setupDocumentId: true,
      setupDocument: { select: { storagePath: true } },
    },
  });
  const calibration = await prisma.setupSheetCalibration.findFirstOrThrow({
    where: { setupSheetModelId: model.id, exampleDocumentId: edition.setupDocumentId! },
    select: { id: true, name: true, calibrationDataJson: true },
  });

  const calData = calibration.calibrationDataJson as { formFieldMappings?: Record<string, unknown> };
  if (!calData.formFieldMappings?.damper_oil_front) {
    throw new Error(
      `calibration ${calibration.name} does not speak the canonical vocabulary yet — run align-a800rr-edition.ts --apply first`
    );
  }

  const editionBytes = await readBytesFromStorageRef(edition.setupDocument!.storagePath!);
  const blanked = await blankPdfFormValues(new Uint8Array(editionBytes));
  const extraction = await extractPdfFormFields(Buffer.from(blanked));
  if (!extraction.hasFormFields) throw new Error("edition PDF has no form layer");

  // The exact minting that created the edition's keys — deterministic, so this IS the mapping the
  // old snapshots were written through.
  const identity = deriveSchemaFromAcroForm(extraction, model.name).formFieldMappings as Record<
    string,
    PdfFillMapping
  >;

  const snapshots = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT s.id FROM "SetupSnapshot" s
     WHERE ${SENTINEL_KEYS.map((_, i) => `s.data ? $${i + 1}`).join(" OR ")}
     ORDER BY s."createdAt" ASC`,
    ...SENTINEL_KEYS,
  );
  console.log(`snapshots holding edition keys: ${snapshots.length}`);

  for (const { id } of snapshots) {
    const snap = await prisma.setupSnapshot.findUniqueOrThrow({
      where: { id },
      select: { id: true, data: true, user: { select: { email: true } } },
    });
    const data = snap.data as Record<string, unknown>;
    console.log(`\n=== snapshot ${snap.id} (${snap.user.email}) — ${Object.keys(data).length} keys`);

    const values: Record<string, string> = {};
    const staleTicks = new Set(STALE_TICKS[snap.id] ?? []);
    for (const key of Object.keys(identity)) {
      if (staleTicks.has(key)) continue;
      const v = asFillValue(data[key]);
      if (v !== null) values[key] = v;
    }
    if (staleTicks.size) console.log(`  stale double-ticks dropped: ${[...staleTicks].join(", ")}`);
    console.log(`  edition-keyed values written back onto the paper: ${Object.keys(values).length}`);

    const filled = await fillPdfForm({ blank: blanked, mappings: identity, values });
    for (const s of filled.skipped) console.log(`  fill skipped: ${s}`);
    for (const c of filled.conflicts) console.log(`  fill conflict: ${c}`);

    const file = new File([new Uint8Array(filled.bytes)], "migration.pdf", { type: "application/pdf" });
    const reimported = await applyCalibrationToPdf({
      file,
      calibrationDataJson: calibration.calibrationDataJson,
      derivedMappings: (edition.derivedMappingsJson ?? {}) as Record<string, PdfFormFieldMappingRule>,
    });
    const next = applyDerivedFieldsToSnapshot(normalizeParsedSetupData(reimported.parsedData));

    // Keys the snapshot holds that are neither the edition's minted vocabulary nor re-produced by
    // the canonical read — hand edits or later additions. They survive untouched.
    const carried: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k in identity) continue;
      if (k in next) continue;
      carried[k] = v;
    }
    const finalData: Record<string, unknown> = { ...carried, ...next };

    const droppedKeys = Object.keys(data).filter((k) => k in identity && !(k in finalData));
    console.log(
      `  result: ${Object.keys(finalData).length} keys (${Object.keys(next).length} read canonically, ${Object.keys(carried).length} carried, ${droppedKeys.length} edition keys retired)`
    );
    console.log(`  carried keys: ${Object.keys(carried).join(", ") || "(none)"}`);
    console.log(`  BEFORE: ${JSON.stringify(data)}`);
    console.log(`  AFTER : ${JSON.stringify(finalData)}`);

    if (APPLY) {
      await prisma.setupSnapshot.update({
        where: { id: snap.id },
        data: { data: JSON.parse(JSON.stringify(finalData)) },
      });
      console.log(`  APPLIED`);
    } else {
      console.log("  DRY RUN — nothing written.");
    }
  }
}

main().finally(() => prisma.$disconnect());

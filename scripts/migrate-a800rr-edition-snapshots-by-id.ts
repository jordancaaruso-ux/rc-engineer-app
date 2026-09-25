/**
 * Re-import the setups saved on ONE Awesomatix A800RR sheet version (edition) through its newly
 * aligned calibration, so their values sit under the car's canonical keys (Engineer, aggregations,
 * roll-centre strip) while the driver keeps seeing their own paper.
 *
 * Generalises `migrate-a800rr-edition-snapshots.ts`, which found the 2026-08-16 edition's setups by
 * that edition's minted keys. This one takes --blank=<SetupSheetBlank id> and picks the setups born on
 * that paper (`SetupSnapshot.sheetBlankId`). Same method, for the same reason: each setup's values are
 * written back into a blanked copy of the edition PDF through the identity mapping that minted them,
 * and that file is re-imported through the real pipeline, so interpreter signs and grouped shapes come
 * out exactly as a fresh import would store them.
 *
 * Run AFTER `align-a800rr-edition-by-id.ts --apply`:
 *   npx dotenv-cli -e <env> -- node --conditions=react-server --import tsx \
 *     scripts/migrate-a800rr-edition-snapshots-by-id.ts --blank=<id> [--apply]
 * With --apply: backs the setups up to scripts/tmp, writes only setups that pass the checks below, then
 * rebuilds aggregations for their owners and the community.
 */
import { mkdirSync, writeFileSync } from "node:fs";
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
import { rebuildSetupAggregationsForUserCars } from "@/lib/setupAggregations/rebuildCarParameterAggregations";
import { rebuildCommunityTemplateAggregations } from "@/lib/setupAggregations/rebuildCommunityTemplateAggregations";

const APPLY = process.argv.includes("--apply");
const BLANK_ID = process.argv.find((a) => a.startsWith("--blank="))?.slice("--blank=".length);

function asFillValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() ? v : null;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : null;
  return null; // arrays/objects are canonical-shaped values, never edition-minted ones
}
function keysIn(json: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(json)) json.forEach((j) => keysIn(j, out));
  else if (json && typeof json === "object") for (const [k, v] of Object.entries(json as Record<string, unknown>)) { if (k === "key" && typeof v === "string") out.add(v); else keysIn(v, out); }
  return out;
}

async function main() {
  if (!BLANK_ID) throw new Error("pass --blank=<SetupSheetBlank id>");
  const model = await prisma.setupSheetModel.findFirstOrThrow({ where: { slug: "awesomatix_a800rr" }, select: { id: true, name: true, schemaJson: true } });
  const canonical = keysIn(model.schemaJson);
  const edition = await prisma.setupSheetBlank.findFirstOrThrow({
    where: { id: BLANK_ID, setupSheetModelId: model.id, isEdition: true },
    select: { id: true, derivedMappingsJson: true, setupDocumentId: true, setupDocument: { select: { storagePath: true } } },
  });
  const calibration = await prisma.setupSheetCalibration.findFirstOrThrow({
    where: { setupSheetModelId: model.id, exampleDocumentId: edition.setupDocumentId! },
    select: { id: true, calibrationDataJson: true },
  });
  const calData = calibration.calibrationDataJson as { formFieldMappings?: Record<string, unknown> };
  if (!calData.formFieldMappings?.damper_oil_front) {
    throw new Error(`calibration ${calibration.id} is not aligned yet — run align-a800rr-edition-by-id.ts --apply first`);
  }

  const blanked = await blankPdfFormValues(new Uint8Array(await readBytesFromStorageRef(edition.setupDocument!.storagePath!)));
  const extraction = await extractPdfFormFields(Buffer.from(blanked));
  if (!extraction.hasFormFields) throw new Error("edition PDF has no form layer");
  // The exact minting that created the edition's keys: deterministic, so this IS the mapping the
  // setups were written through.
  const identity = deriveSchemaFromAcroForm(extraction, model.name).formFieldMappings as Record<string, PdfFillMapping>;

  const snaps = await prisma.setupSnapshot.findMany({ where: { sheetBlankId: edition.id }, orderBy: { createdAt: "asc" }, select: { id: true, userId: true, data: true } });
  console.log(`setups born on this paper: ${snaps.length}`);
  const writes: Array<{ id: string; userId: string; data: Record<string, unknown> }> = [];
  for (const snap of snaps) {
    const data = (snap.data ?? {}) as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const key of Object.keys(identity)) { const v = asFillValue(data[key]); if (v !== null) values[key] = v; }
    const filled = await fillPdfForm({ blank: blanked, mappings: identity, values });
    const file = new File([new Uint8Array(filled.bytes)], "migration.pdf", { type: "application/pdf" });
    const reimported = await applyCalibrationToPdf({
      file,
      calibrationDataJson: calibration.calibrationDataJson,
      derivedMappings: (edition.derivedMappingsJson ?? {}) as Record<string, PdfFormFieldMappingRule>,
    });
    const next = applyDerivedFieldsToSnapshot(normalizeParsedSetupData(reimported.parsedData));
    // Keys that are neither the edition's minted vocabulary nor re-produced by the canonical read (hand
    // edits, later additions) survive untouched.
    const carried: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) { if (k in identity || k in next) continue; carried[k] = v; }
    const finalData: Record<string, unknown> = { ...carried, ...next };
    const before = Object.keys(data).filter((k) => canonical.has(k)).length, after = Object.keys(finalData).filter((k) => canonical.has(k)).length;
    console.log(
      `snapshot ${snap.id}: ${Object.keys(data).length} keys -> ${Object.keys(finalData).length} (${Object.keys(next).length} read through the aligned calibration, ${Object.keys(carried).length} carried); ` +
        `${Object.keys(values).length} values written back, fill skipped ${filled.skipped.length}, conflicts ${filled.conflicts.length}; on the car's own keys: ${before} before, ${after} after`
    );
    console.log(`  carried keys: ${Object.keys(carried).join(", ") || "(none)"}`);
    const problems = [
      filled.conflicts.length ? `${filled.conflicts.length} fill conflicts` : "",
      Object.keys(next).length < 0.6 * Object.keys(values).length ? "fewer than 60% of the written-back values were read again" : "",
      after <= before ? "no gain on the car's own keys" : "",
    ].filter(Boolean);
    if (problems.length) { console.log(`  NOT WRITTEN: ${problems.join("; ")}`); continue; }
    writes.push({ id: snap.id, userId: snap.userId, data: finalData });
  }

  if (!APPLY) { console.log("DRY RUN — nothing written."); return; }
  if (!writes.length) { console.log("nothing passed the checks — nothing written."); return; }
  mkdirSync("scripts/tmp", { recursive: true });
  const backupPath = `scripts/tmp/a800rr-edition-${edition.id}-setups-backup-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(backupPath, JSON.stringify(snaps.map((s) => ({ id: s.id, data: s.data })), null, 1));
  console.log(`backup written: ${backupPath}`);
  for (const w of writes) await prisma.setupSnapshot.update({ where: { id: w.id }, data: { data: JSON.parse(JSON.stringify(w.data)) } });
  console.log(`APPLIED to ${writes.length} setup(s)`);
  for (const userId of new Set(writes.map((w) => w.userId))) {
    const r = await rebuildSetupAggregationsForUserCars(userId);
    console.log(`aggregations rebuilt for user …${userId.slice(-6)}: ${JSON.stringify(r).slice(0, 160)}`);
  }
  const community = await rebuildCommunityTemplateAggregations();
  console.log(`community aggregations: ${JSON.stringify(community).slice(0, 200)}`);
}

main().finally(() => prisma.$disconnect());

/**
 * Stage 2A — make the seeded box-calibration editor reachable for a model.
 *
 * The existing editor at /setup-documents/[id]/calibrate-image draws a calibration's boxes on
 * a document's image and saves edits back. To calibrate a MODEL once (founder direction
 * 2026-07-07), we register the manufacturer's blank sheet as a SetupDocument, attach the
 * model's blank-sheet calibration to it, and point the calibration's reference at that doc.
 * Then opening that doc's calibrate-image page shows all ~201 boxes pre-placed on the blank,
 * editable — the admin confirms/renames/fixes, never draws.
 *
 *   Dry-run: npm run setup-extract:register-blank
 *   Apply:   npm run setup-extract:register-blank -- --apply --owner-email=you@example.com
 *   Flags:   --style=<dir> (default xray-x4-2026) --model-match=<substr> (default "x4'26")
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "@/lib/prisma";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";

const APPLY = process.argv.includes("--apply");

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const style = arg("style") ?? "xray-x4-2026";
  const blankJpg = join(process.cwd(), "scripts", "setup-extract-eval", "gold", style, "files", "x4_2026_set_up_blank.jpg");
  if (!existsSync(blankJpg)) throw new Error(`Blank image not found: ${blankJpg}`);

  const modelMatch = (arg("model-match") ?? "x4'26").toLowerCase();
  const models = (await prisma.setupSheetModel.findMany()).filter((m) => m.name.toLowerCase().includes(modelMatch));
  if (models.length !== 1) {
    console.error(`Need exactly one model (got ${models.length}). Use --model-match / check names.`);
    process.exit(1);
  }
  const model = models[0]!;
  if (!model.defaultCalibrationId) {
    throw new Error("Model has no default calibration — run setup-extract:blank-apply first.");
  }
  const cal = await prisma.setupSheetCalibration.findUnique({ where: { id: model.defaultCalibrationId } });
  if (!cal) throw new Error("Default calibration row not found");
  const imageFieldCount = normalizeCalibrationData(cal.calibrationDataJson).imageCalibration?.fields.length ?? 0;

  const ownerEmail = arg("owner-email");
  const owner = ownerEmail
    ? await prisma.user.findFirst({ where: { email: ownerEmail } })
    : await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!owner) throw new Error("No owner user found");

  // Reuse an existing blank-reference doc for this model if present (idempotent re-runs).
  const existing = await prisma.setupDocument.findFirst({
    where: { setupSheetModelId: model.id, originalFilename: { startsWith: "BLANK REFERENCE" } },
    select: { id: true, storagePath: true },
  });

  console.log(`${APPLY ? "APPLYING" : "DRY-RUN"} blank reference for model ${model.id} (${model.name})`);
  console.log(`  calibration ${cal.id} (${imageFieldCount} regions), owner ${owner.email}`);
  console.log(`  ${existing ? `reuse doc ${existing.id}` : "create new SetupDocument"}`);
  if (!APPLY) {
    console.log("Dry-run only. Re-run with --apply to write.");
    return;
  }

  const bytes = readFileSync(blankJpg);
  const filename = `${new Date().toISOString().slice(0, 10)}-blank-${model.slug}.jpg`;
  const dir = join(process.cwd(), ".local-uploads", "setup-documents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), bytes);
  const storagePath = `/uploads/setup-documents/${filename}`;

  let docId: string;
  if (existing) {
    await prisma.setupDocument.update({
      where: { id: existing.id },
      data: { storagePath, calibrationProfileId: cal.id },
    });
    docId = existing.id;
  } else {
    const doc = await prisma.setupDocument.create({
      data: {
        originalFilename: `BLANK REFERENCE — ${model.name}`,
        storagePath,
        mimeType: "image/jpeg",
        sourceType: "IMAGE",
        parseStatus: "PENDING",
        importStatus: "COMPLETED",
        userId: owner.id,
        setupSheetModelId: model.id,
        calibrationProfileId: cal.id,
      },
    });
    docId = doc.id;
  }

  // Point the calibration's reference at the real blank doc so alignment/anchors are consistent.
  const data = normalizeCalibrationData(cal.calibrationDataJson);
  if (data.imageCalibration) {
    data.imageCalibration.reference.exampleDocumentId = docId;
    await prisma.setupSheetCalibration.update({
      where: { id: cal.id },
      data: { calibrationDataJson: data as object, exampleDocumentId: docId },
    });
  }

  const summary = { modelId: model.id, calibrationId: cal.id, blankDocId: docId, regions: imageFieldCount };
  const outPath = join(process.cwd(), "scripts", "setup-extract-eval", "gold", style, "blank-reference.json");
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`Applied. Seeded editor: /setup-documents/${docId}/calibrate-image`);
  console.log(`  wrote ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

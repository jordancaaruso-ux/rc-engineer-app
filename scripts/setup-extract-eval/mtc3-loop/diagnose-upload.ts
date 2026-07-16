/** Read-only diagnosis of why a live MTC3 image upload imported 0 values. */
import { prisma } from "@/lib/prisma";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import { MTC3_MODEL_ID, MTC3_CAL_ID } from "./mtc3-common";

async function main() {
  // 1. Calibration linkage
  const cal = await prisma.setupSheetCalibration.findUnique({
    where: { id: MTC3_CAL_ID },
    select: { id: true, name: true, setupSheetModelId: true, userId: true, calibrationDataJson: true, sharingScope: true as never },
  }).catch(async () =>
    prisma.setupSheetCalibration.findUnique({
      where: { id: MTC3_CAL_ID },
      select: { id: true, name: true, setupSheetModelId: true, userId: true, calibrationDataJson: true },
    })
  );
  const norm = cal ? normalizeCalibrationData(cal.calibrationDataJson) : null;
  console.log("=== CALIBRATION ===");
  console.log({
    id: cal?.id,
    name: cal?.name,
    setupSheetModelId: cal?.setupSheetModelId,
    userId: cal?.userId,
    hasImageCalibration: Boolean(norm?.imageCalibration),
    imageFieldCount: norm?.imageCalibration?.fields?.length ?? 0,
  });

  // 2. Model + default calibration
  const model = await prisma.setupSheetModel.findUnique({
    where: { id: MTC3_MODEL_ID },
    select: { id: true, name: true, slug: true, defaultCalibrationId: true },
  });
  console.log("\n=== MODEL ===");
  console.log(model);

  // 3. Recent setup documents (any user) with a mugen-ish filename
  const docs = await prisma.setupDocument.findMany({
    where: { sourceType: "IMAGE" },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: {
      id: true,
      createdAt: true,
      userId: true,
      originalFilename: true,
      mimeType: true,
      sourceType: true,
      carId: true,
      setupSheetModelId: true,
      calibrationProfileId: true,
      parseStatus: true,
      importStatus: true,
      importOutcome: true,
      currentStage: true,
      importErrorMessage: true,
      calibrationResolvedDebug: true,
      importDiagnosticJson: true,
      parsedDataJson: true,
    },
  });
  console.log(`\n=== RECENT 'mugen' DOCS (${docs.length}) ===`);
  for (const d of docs) {
    const parsed = d.parsedDataJson && typeof d.parsedDataJson === "object" ? Object.keys(d.parsedDataJson as object) : [];
    const diag = d.importDiagnosticJson && typeof d.importDiagnosticJson === "object" ? (d.importDiagnosticJson as Record<string, unknown>) : {};
    console.log("\n---", d.id, d.createdAt.toISOString(), "---");
    console.log({
      filename: d.originalFilename,
      mimeType: d.mimeType,
      sourceType: d.sourceType,
      carId: d.carId,
      setupSheetModelId: d.setupSheetModelId,
      calibrationProfileId: d.calibrationProfileId,
      parseStatus: d.parseStatus,
      importStatus: d.importStatus,
      importOutcome: d.importOutcome,
      currentStage: d.currentStage,
      importErrorMessage: d.importErrorMessage,
      parsedKeyCount: parsed.length,
      diagKind: diag.kind,
    });
    console.log("resolvedDebug:", d.calibrationResolvedDebug);
    if (diag.mapping) console.log("mapping:", JSON.stringify(diag.mapping).slice(0, 1200));
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

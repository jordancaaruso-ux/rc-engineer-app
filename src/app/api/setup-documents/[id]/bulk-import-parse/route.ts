import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { applyCalibrationToSetupDocument } from "@/lib/setupDocuments/applyCalibrationToDocument";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Explicit parse for documents in a bulk import batch: full replace of parsed snapshot, resets review flags on success.
 */
export async function POST(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const user = await getOrCreateLocalUser();
  const body = (await request.json().catch(() => ({}))) as { calibrationId?: string };

  const calibrationId = body.calibrationId?.trim();
  if (!calibrationId) {
    return NextResponse.json({ error: "calibrationId is required" }, { status: 400 });
  }

  const doc = await prisma.setupDocument.findFirst({
    where: { id, userId: user.id },
    select: { id: true, setupImportBatchId: true },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!doc.setupImportBatchId) {
    return NextResponse.json({ error: "Document is not part of a bulk import batch" }, { status: 400 });
  }

  const cal = await prisma.setupSheetCalibration.findFirst({
    where: { id: calibrationId, userId: user.id },
    select: { id: true, name: true },
  });
  if (!cal) return NextResponse.json({ error: "Calibration not found" }, { status: 404 });

  const result = await applyCalibrationToSetupDocument({
    docId: id,
    userId: user.id,
    calibrationId,
    parsedDataMerge: "replace",
  });

  if (!result.ok) {
    await prisma.setupDocument.update({
      where: { id: doc.id },
      data: {
        parseStatus: "FAILED",
        importStatus: "FAILED",
        importOutcome: "FAILED",
        importErrorMessage: result.error,
        eligibleForAggregationDataset: false,
        importDatasetReviewStatus: "NOT_CONFIRMED",
      },
    });
    const status = result.error.includes("PDF") ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  await prisma.setupDocument.update({
    where: { id: doc.id },
    data: {
      importErrorMessage: null,
      importDatasetReviewStatus: "UNSET",
      eligibleForAggregationDataset: false,
      parsedSetupManuallyEdited: false,
    },
  });

  return NextResponse.json({
    ok: true,
    calibration: { id: cal.id, name: cal.name },
    importedKeys: result.importedKeys,
    importedCount: result.importedKeys.length,
    formImportDebug: result.formImportDebug,
  });
}

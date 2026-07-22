import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getEffectiveCalibrationProfileId } from "@/lib/setup/effectiveCalibration";
import { calibrationReadableByIdWhere } from "@/lib/setupCalibrations/calibrationAccess";
import { applyCalibrationToSetupDocument } from "@/lib/setupDocuments/applyCalibrationToDocument";
import { SetupDocumentImportStages } from "@/lib/setupDocuments/importStages";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { calibrationId?: string };
  // Explicit calibration selection path.
  const effective = await getEffectiveCalibrationProfileId({
    userId: user.id,
    explicitCalibrationId: body.calibrationId ?? null,
    context: `applyCalibration:doc:${id}`,
  });
  if (!effective.calibrationId) {
    return NextResponse.json({ error: "No valid calibration selected" }, { status: 400 });
  }

  const calibration = await prisma.setupSheetCalibration.findFirst({
    where: calibrationReadableByIdWhere(effective.calibrationId),
    select: { id: true, name: true },
  });
  if (!calibration) return NextResponse.json({ error: "Calibration not found" }, { status: 404 });

  const doc = await prisma.setupDocument.findFirst({
    where: { id, userId: user.id },
    select: { id: true, sourceType: true, mimeType: true },
  });
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  // Image extraction only runs inside processImport (extractImageRawDataFromFile +
  // mapExtractedImageWithCalibration); applyCalibrationToSetupDocument is PDF-only. For an image
  // doc we set the sticky calibration and let the caller kick off /process, which reads it — a
  // single OCR pass rather than the misleading PDF-form extraction that always imports 0.
  const isImage = doc.sourceType === "IMAGE" || (doc.mimeType ?? "").startsWith("image/");
  if (isImage) {
    await prisma.setupDocument.update({
      where: { id: doc.id },
      data: {
        calibrationProfileId: effective.calibrationId,
        calibrationResolvedProfileId: effective.calibrationId,
        calibrationResolvedSource: effective.source,
        parsedCalibrationProfileId: null,
        parsedAt: null,
        parseStatus: "PENDING",
        importStatus: "PENDING",
        importOutcome: null,
        currentStage: SetupDocumentImportStages.CALIBRATION_SELECTED,
        parsedSetupManuallyEdited: false,
      },
    });
    console.log(
      `[setup-documents/apply-calibration] doc=${id} calibration=${effective.calibrationId} source=${effective.source} deferToProcess (image)`
    );
    return NextResponse.json(
      {
        calibration: { id: calibration.id, name: calibration.name },
        sourceType: "IMAGE",
        deferToProcess: true,
        importedKeys: [],
        importedCount: null,
        calibrationUsed: effective,
      },
      {
        status: 200,
        headers: {
          "X-Setup-Calibration-Id": effective.calibrationId,
          "X-Setup-Calibration-Source": effective.source,
        },
      }
    );
  }

  const result = await applyCalibrationToSetupDocument({
    docId: id,
    userId: user.id,
    calibrationId: effective.calibrationId,
  });
  if (!result.ok) {
    const status = result.error.includes("not found") ? 404 : result.error.includes("PDF") ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  console.log(
    `[setup-documents/apply-calibration] doc=${id} calibration=${effective.calibrationId} source=${effective.source}`
  );

  return NextResponse.json(
    {
      calibration: { id: calibration.id, name: calibration.name },
      parsedData: result.mergedData,
      importedKeys: result.importedKeys,
      importedCount: result.importedKeys.length,
      formImportDebug: result.formImportDebug,
      calibrationUsed: effective,
    },
    {
      status: 200,
      headers: {
        "X-Setup-Calibration-Id": effective.calibrationId,
        "X-Setup-Calibration-Source": effective.source,
      },
    }
  );
}

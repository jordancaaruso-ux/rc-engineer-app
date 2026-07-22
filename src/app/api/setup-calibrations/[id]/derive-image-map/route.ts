import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  calibrationReadableByIdWhere,
  canManageCalibration,
} from "@/lib/setupCalibrations/calibrationAccess";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { buildDerivedImageCalibration } from "@/lib/setupCalibrations/deriveImageMap";
import {
  diffImageCalibrationFieldKeys,
  normalizeCalibrationData,
} from "@/lib/setupCalibrations/types";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * One-click "derive image map" for an AcroForm calibration that already has field mappings.
 * We render the calibration's example PDF to a PNG **server-side** (same rasterizer real uploads
 * go through, so alignment is identity), derive image regions deterministically from the existing
 * `formFieldMappings` widget geometry (no AI), fingerprint the render + detect the sheet's content
 * box as the reference, and write the `imageCalibration` lane onto the same calibration row. Lets
 * already-calibrated AcroForms accept image/photo/flattened-PDF uploads without redoing any work.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const calibration = await prisma.setupSheetCalibration.findFirst({
    where: calibrationReadableByIdWhere(id),
    select: {
      id: true,
      name: true,
      userId: true,
      calibrationDataJson: true,
      exampleDocumentId: true,
      setupSheetModelId: true,
      exampleDocument: { select: { id: true, storagePath: true, mimeType: true } },
    },
  });
  if (!calibration) return NextResponse.json({ error: "Calibration not found" }, { status: 404 });
  if (!canManageCalibration(user, calibration)) {
    return NextResponse.json({ error: "You can only edit calibrations you created." }, { status: 403 });
  }
  if (!calibration.exampleDocument || calibration.exampleDocument.mimeType !== "application/pdf") {
    return NextResponse.json(
      { error: "This calibration needs an editable PDF example document to derive an image map." },
      { status: 400 }
    );
  }

  let pdfBytes: Buffer;
  try {
    pdfBytes = await readBytesFromStorageRef(calibration.exampleDocument.storagePath);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to read the example PDF." },
      { status: 500 }
    );
  }

  const built = await buildDerivedImageCalibration({
    pdfBytes: new Uint8Array(pdfBytes),
    calibrationDataJson: calibration.calibrationDataJson,
    exampleDocumentId: calibration.exampleDocumentId ?? null,
  });
  if (!built.ok) {
    return NextResponse.json(
      { error: built.error, warnings: built.warnings },
      { status: 400 }
    );
  }
  const imageCalibration = built.imageCalibration;

  const merged = normalizeCalibrationData(calibration.calibrationDataJson);
  // Geometry edits after green-light invalidate just the affected fields (the calibration stays
  // verified/live) — mirror the calibrate-image derive behaviour.
  if (merged.verification?.greenLitAt) {
    const changedKeys = diffImageCalibrationFieldKeys(merged.imageCalibration, imageCalibration);
    if (changedKeys.length) {
      merged.verification.fieldsNeedingRecheck = [
        ...new Set([...(merged.verification.fieldsNeedingRecheck ?? []), ...changedKeys]),
      ];
    }
  }
  merged.imageCalibration = imageCalibration;

  await prisma.setupSheetCalibration.update({
    where: { id: calibration.id },
    data: { calibrationDataJson: merged as unknown as object },
  });

  // Make the derived map discoverable on image upload: resolveModelImageCalibration finds it via
  // the model's default calibration (or any model-linked calibration with an imageCalibration). If
  // this calibration is model-linked and the model has no default yet, adopt it — mirrors the
  // "first calibration becomes the model default" convention in POST /api/setup-calibrations.
  if (calibration.setupSheetModelId) {
    const model = await prisma.setupSheetModel.findUnique({
      where: { id: calibration.setupSheetModelId },
      select: { defaultCalibrationId: true },
    });
    if (model && !model.defaultCalibrationId) {
      await prisma.setupSheetModel.update({
        where: { id: calibration.setupSheetModelId },
        data: { defaultCalibrationId: calibration.id },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    derivedFields: built.derivedFields,
    contentBoxDetected: built.contentBoxDetected,
    warnings: built.warnings.length ? built.warnings : undefined,
  });
}

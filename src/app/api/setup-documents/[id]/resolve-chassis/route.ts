import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import {
  pickCalibrationByFingerprint,
  applyPostFingerprintPickLinks,
} from "@/lib/setupCalibrations/fingerprintPick";
import { applyCalibrationToSetupDocument } from "@/lib/setupDocuments/applyCalibrationToDocument";
import { templateKeyFromModelSlug } from "@/lib/setupSheetModels/resolveModelForCar";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Resolve a cross-chassis-ambiguous upload: the driver answered the "which chassis is this?"
 * tap-to-answer. Set the document's chassis, re-pick the calibration scoped to that chassis, and
 * re-parse so the sheet renders under the correct template. See quick-create's
 * `needs_chassis_disambiguation_v1` path + fingerprintPick's cross-model handling.
 */
export async function POST(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { setupSheetModelId?: string };
  const modelId = body.setupSheetModelId?.trim();
  if (!modelId) {
    return NextResponse.json({ error: "Missing setupSheetModelId" }, { status: 400 });
  }

  const doc = await prisma.setupDocument.findFirst({
    where: { id, userId: userId },
    select: { id: true, storagePath: true, mimeType: true },
  });
  if (!doc) return NextResponse.json({ error: "Setup document not found" }, { status: 404 });

  const model = await prisma.setupSheetModel.findUnique({
    where: { id: modelId },
    select: { id: true, name: true, slug: true },
  });
  if (!model) return NextResponse.json({ error: "Setup sheet model not found" }, { status: 400 });

  // Stamp the chosen chassis and clear the disambiguation marker.
  await prisma.setupDocument.update({
    where: { id: doc.id },
    data: {
      setupSheetModelId: model.id,
      setupSheetTemplate: templateKeyFromModelSlug(model.slug),
      importDiagnosticJson: Prisma.DbNull,
    },
  });

  if (doc.mimeType !== "application/pdf") {
    // Non-PDF (image) resolution just sets the chassis; the car-driven image path handles the rest.
    return NextResponse.json({ ok: true, resolvedModel: { id: model.id, name: model.name }, calibrationId: null });
  }

  // Re-pick the calibration scoped to the chosen chassis, then apply + re-parse.
  const bytes = new Uint8Array(await readBytesFromStorageRef(doc.storagePath));
  const pick = await pickCalibrationByFingerprint({
    userId: userId,
    bytes,
    debugPrefix: "resolveChassis",
    carSetupSheetModelId: model.id,
    carSetupSheetModelName: model.name,
  });

  if (!pick.pickedCalibrationId) {
    return NextResponse.json({
      ok: true,
      resolvedModel: { id: model.id, name: model.name },
      calibrationId: null,
      note: pick.userNote ?? `No calibration exists yet for ${model.name} — pick one or map it below.`,
    });
  }

  await applyPostFingerprintPickLinks({
    userId: userId,
    pickedCalibrationId: pick.pickedCalibrationId,
    carSetupSheetModelId: model.id,
  });
  const result = await applyCalibrationToSetupDocument({
    docId: doc.id,
    userId: userId,
    calibrationId: pick.pickedCalibrationId,
  });
  if (!result.ok) {
    const status = result.error.includes("not found") ? 404 : result.error.includes("PDF") ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  console.log(
    `[setup-documents/resolve-chassis] doc=${doc.id} model=${model.name} calibration=${pick.pickedCalibrationId} imported=${result.importedKeys.length}`
  );
  return NextResponse.json({
    ok: true,
    resolvedModel: { id: model.id, name: model.name },
    calibrationId: pick.pickedCalibrationId,
    importedCount: result.importedKeys.length,
  });
}

import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { processSetupDocumentImport } from "@/lib/setupDocuments/processImport";
import { SetupDocumentImportStages } from "@/lib/setupDocuments/importStages";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const { id } = await ctx.params;

  const doc = await prisma.setupDocument.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      originalFilename: true,
      importStatus: true,
      currentStage: true,
      lastCompletedStage: true,
      calibrationProfileId: true,
    },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!doc.calibrationProfileId) {
    await prisma.setupDocument.update({
      where: { id: doc.id },
      data: {
        importStatus: "PENDING",
        currentStage: SetupDocumentImportStages.AWAITING_CALIBRATION,
      },
    });
    return NextResponse.json(
      {
        ok: false,
        status: "awaiting_calibration",
        error: "Select a calibration before processing.",
      },
      { status: 409 }
    );
  }
  const calibrationExists = await prisma.setupSheetCalibration.findFirst({
    where: { id: doc.calibrationProfileId, userId: user.id },
    select: { id: true },
  });
  if (!calibrationExists) {
    await prisma.setupDocument.update({
      where: { id: doc.id },
      data: {
        calibrationProfileId: null,
        importStatus: "PENDING",
        currentStage: SetupDocumentImportStages.AWAITING_CALIBRATION,
      },
    });
    return NextResponse.json(
      {
        ok: false,
        status: "awaiting_calibration",
        error: "Selected calibration not found. Choose another calibration.",
      },
      { status: 409 }
    );
  }

  try {
    await processSetupDocumentImport({ docId: doc.id, userId: user.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


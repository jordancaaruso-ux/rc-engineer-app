import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { processSetupDocumentImport } from "@/lib/setupDocuments/processImport";
import { tryCreateSetupFromParsedDocument } from "@/lib/setupDocuments/tryCreateSetupFromParsedDocument";
import { SetupDocumentImportStages } from "@/lib/setupDocuments/importStages";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    await prisma.setupDocument.updateMany({
      where: { id: doc.id, userId: user.id },
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
    where: { id: doc.calibrationProfileId },
    select: { id: true },
  });
  if (!calibrationExists) {
    await prisma.setupDocument.updateMany({
      where: { id: doc.id, userId: user.id },
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

  const dbg = process.env.DEBUG_SETUP_PROCESS_TIMING === "1";
  const t0 = dbg ? performance.now() : 0;
  try {
    await processSetupDocumentImport({ docId: doc.id, userId: user.id });
    const auto = await tryCreateSetupFromParsedDocument({ docId: doc.id, userId: user.id });
    if (dbg) console.log(`[setup-process-timing] POST /process handler total ${(performance.now() - t0).toFixed(1)}ms doc=${doc.id}`);
    return NextResponse.json({ ok: true, autoCreateSetup: auto });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


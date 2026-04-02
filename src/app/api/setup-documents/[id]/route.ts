import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeParsedSetupData } from "@/lib/setupDocuments/normalize";
import { SetupDocumentImportStages } from "@/lib/setupDocuments/importStages";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const user = await getOrCreateLocalUser();
  const doc = await prisma.setupDocument.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      originalFilename: true,
      storagePath: true,
      mimeType: true,
      sourceType: true,
      parseStatus: true,
      importStatus: true,
      importOutcome: true,
      currentStage: true,
      lastCompletedStage: true,
      importErrorMessage: true,
      importDiagnosticJson: true,
      parseStartedAt: true,
      parseFinishedAt: true,
      calibrationResolvedProfileId: true,
      calibrationResolvedSource: true,
      calibrationResolvedDebug: true,
      calibrationUsedIsForcedDefault: true,
      parserType: true,
      extractedText: true,
      parsedDataJson: true,
      calibrationProfileId: true,
      parsedCalibrationProfileId: true,
      parsedAt: true,
      parsedSetupManuallyEdited: true,
      createdAt: true,
      updatedAt: true,
      createdSetupId: true,
    },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ document: doc });
}

export async function PATCH(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const user = await getOrCreateLocalUser();
  const body = (await request.json().catch(() => ({}))) as {
    parsedDataJson?: unknown;
    parseStatus?: "PENDING" | "PARSED" | "PARTIAL" | "FAILED";
    calibrationProfileId?: string | null;
    /** When true with parsedDataJson, marks document as manually corrected (not parser output). */
    manualStructuredEdit?: boolean;
  };
  const existing = await prisma.setupDocument.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data: {
    parsedDataJson?: object;
    parseStatus?: "PENDING" | "PARSED" | "PARTIAL" | "FAILED";
    calibrationProfileId?: string | null;
    parsedCalibrationProfileId?: string | null;
    parsedAt?: Date | null;
    importStatus?: "PENDING" | "PROCESSING" | "FAILED" | "COMPLETED" | "COMPLETED_WITH_WARNINGS";
    importOutcome?: "COMPLETED_TRUSTED" | "COMPLETED_WITH_WARNINGS" | "PARTIAL_DIAGNOSTIC" | "FAILED" | null;
    currentStage?: string | null;
    calibrationResolvedProfileId?: string | null;
    calibrationResolvedSource?: string | null;
    calibrationResolvedDebug?: string | null;
    calibrationUsedIsForcedDefault?: boolean | null;
    parsedSetupManuallyEdited?: boolean;
  } = {};
  if (body.parsedDataJson !== undefined) {
    data.parsedDataJson = normalizeParsedSetupData(body.parsedDataJson ?? {}) as object;
    if (body.manualStructuredEdit === true) {
      data.parsedSetupManuallyEdited = true;
    }
  }
  if (body.parseStatus) {
    data.parseStatus = body.parseStatus;
  }
  if (body.calibrationProfileId !== undefined) {
    data.calibrationProfileId =
      typeof body.calibrationProfileId === "string" && body.calibrationProfileId.trim()
        ? body.calibrationProfileId.trim()
        : null;
    data.parsedCalibrationProfileId = null;
    data.parsedAt = null;
    data.importStatus = "PENDING";
    data.parseStatus = "PENDING";
    data.importOutcome = null;
    data.currentStage = data.calibrationProfileId
      ? SetupDocumentImportStages.CALIBRATION_SELECTED
      : SetupDocumentImportStages.AWAITING_CALIBRATION;
    data.calibrationResolvedProfileId = null;
    data.calibrationResolvedSource = null;
    data.calibrationResolvedDebug = null;
    data.calibrationUsedIsForcedDefault = false;
  }
  const next = await prisma.setupDocument.update({
    where: { id },
    data,
    select: {
      id: true,
      parseStatus: true,
      importStatus: true,
      calibrationProfileId: true,
      parsedCalibrationProfileId: true,
      parsedAt: true,
      currentStage: true,
      updatedAt: true,
      parsedSetupManuallyEdited: true,
      parsedDataJson: true,
    },
  });
  return NextResponse.json({ document: next });
}


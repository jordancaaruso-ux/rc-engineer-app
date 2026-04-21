import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { SetupDocumentReviewClient } from "@/components/setup-documents/SetupDocumentReviewClient";
import { ensureSetupDocumentCalibrationProfileId } from "@/lib/setup/effectiveCalibration";

export default async function SetupDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Setup document</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
      </>
    );
  }

  const { id } = await params;
  const user = await requireCurrentUser();
  const [doc, cars, calibrations] = await Promise.all([
    prisma.setupDocument.findFirst({
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
        carId: true,
      },
    }),
    prisma.car.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.setupSheetCalibration.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        sourceType: true,
        calibrationDataJson: true,
        createdAt: true,
      },
    }),
  ]);

  if (!doc) notFound();
  // Resolve effective calibration without forcing defaults.
  const effectiveCalibration = await ensureSetupDocumentCalibrationProfileId({
    userId: user.id,
    setupDocumentId: doc.id,
  });

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Review setup document</h1>
          <p className="page-subtitle">Review parsed values before creating a setup snapshot.</p>
        </div>
      </header>
      <SetupDocumentReviewClient
        doc={{
          ...doc,
          createdAt: doc.createdAt.toISOString(),
          updatedAt: doc.updatedAt.toISOString(),
          parsedAt: doc.parsedAt ? doc.parsedAt.toISOString() : null,
          parseStartedAt: doc.parseStartedAt ? doc.parseStartedAt.toISOString() : null,
          parseFinishedAt: doc.parseFinishedAt ? doc.parseFinishedAt.toISOString() : null,
          effectiveCalibration,
        }}
        cars={cars}
        calibrations={calibrations}
      />
    </>
  );
}


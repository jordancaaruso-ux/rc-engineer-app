import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { calibrationsVisibleToUserWhere } from "@/lib/setupCalibrations/calibrationAccess";
import { ensureCommunitySharedCalibrationsIfEmpty } from "@/lib/setupCalibrations/communitySharedCalibrations";
import { SetupDocumentReviewClient } from "@/components/setup-documents/SetupDocumentReviewClient";
import { ensureSetupDocumentCalibrationProfileId } from "@/lib/setup/effectiveCalibration";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import { loadSetupSheetModelById } from "@/lib/setupSheetModels/resolveModelForCar";
import { buildSetupSheetTemplateFromParsedSchema } from "@/lib/setupSheetModels/buildSetupSheetTemplate";

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
  await ensureCommunitySharedCalibrationsIfEmpty();
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
        setupSheetModelId: true,
        setupSheetTemplate: true,
        setupSheetModel: { select: { id: true, name: true, slug: true } },
      },
    }),
    prisma.car.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.setupSheetCalibration.findMany({
      where: calibrationsVisibleToUserWhere(user.id),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        sourceType: true,
        calibrationDataJson: true,
        createdAt: true,
        communityShared: true,
      },
    }),
  ]);

  if (!doc) notFound();

  let reviewSetupTemplate = null;
  if (doc.setupSheetModelId) {
    const model = await loadSetupSheetModelById(user.id, doc.setupSheetModelId);
    if (model) {
      reviewSetupTemplate = buildSetupSheetTemplateFromParsedSchema(model.id, model.name, model.schema);
    }
  }
  // Resolve effective calibration without forcing defaults.
  const effectiveCalibration = await ensureSetupDocumentCalibrationProfileId({
    userId: user.id,
    setupDocumentId: doc.id,
  });

  const isImage = doc.sourceType === "IMAGE" || (doc.mimeType ?? "").startsWith("image/");
  const linkedCalibrationFields = doc.calibrationProfileId
    ? (() => {
        const cal = calibrations.find((c) => c.id === doc.calibrationProfileId);
        if (!cal) return 0;
        return normalizeCalibrationData(cal.calibrationDataJson).imageCalibration?.fields.length ?? 0;
      })()
    : 0;
  const showImageCalibrateCta = isImage && linkedCalibrationFields === 0;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Review setup document</h1>
          <p className="page-subtitle">Review parsed values before creating a setup snapshot.</p>
        </div>
      </header>
      {showImageCalibrateCta ? (
        <div className="page-body pb-0">
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 flex items-center justify-between gap-3">
            <div className="text-xs">
              <div className="font-medium text-foreground">Teach the app this screenshot</div>
              <div className="text-muted-foreground">
                Draw rectangles around each value once. Future uploads of this template will import
                automatically.
              </div>
            </div>
            <Link
              href={`/setup-documents/${doc.id}/calibrate-image`}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              Open image calibration
            </Link>
          </div>
        </div>
      ) : null}
      <SetupDocumentReviewClient
        doc={{
          ...doc,
          createdAt: doc.createdAt.toISOString(),
          updatedAt: doc.updatedAt.toISOString(),
          parsedAt: doc.parsedAt ? doc.parsedAt.toISOString() : null,
          parseStartedAt: doc.parseStartedAt ? doc.parseStartedAt.toISOString() : null,
          parseFinishedAt: doc.parseFinishedAt ? doc.parseFinishedAt.toISOString() : null,
          effectiveCalibration,
          setupSheetModelSlug: doc.setupSheetModel?.slug ?? null,
        }}
        cars={cars}
        calibrations={calibrations}
        reviewSetupTemplate={reviewSetupTemplate}
      />
    </>
  );
}


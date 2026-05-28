import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalibrationDeleteButton } from "@/components/setup-documents/CalibrationDeleteButton";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { SetupCalibrationEditorClient } from "@/components/setup-documents/SetupCalibrationEditorLazy";

export default async function SetupCalibrationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Calibration</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
      </>
    );
  }
  const user = await requireCurrentUser();
  const { id } = await params;
  const calibration = await prisma.setupSheetCalibration.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      name: true,
      sourceType: true,
      calibrationDataJson: true,
      exampleDocumentId: true,
      setupSheetModelId: true,
      setupSheetModel: { select: { id: true, name: true } },
      exampleDocument: {
        select: { id: true, originalFilename: true },
      },
    },
  });
  if (!calibration) notFound();
  return (
    <>
      <header className="page-header">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <h1 className="page-title">Edit calibration</h1>
            <p className="page-subtitle">
              {calibration.name}
              {calibration.setupSheetModel ? (
                <>
                  {" "}
                  · Car type:{" "}
                  <Link
                    href={`/setup-sheet-models/${calibration.setupSheetModel.id}/schema`}
                    className="text-sky-400 hover:underline"
                  >
                    {calibration.setupSheetModel.name}
                  </Link>
                </>
              ) : (
                <> · Unlinked — assign this calibration to a car type (e.g. Mugen MTC3) from setup review.</>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              Uploads auto-select this profile when the PDF form layout matches the linked example PDF.
            </p>
          </div>
          <CalibrationDeleteButton
            calibrationId={calibration.id}
            calibrationName={calibration.name}
            redirectTo="/setup-calibrations"
          />
        </div>
      </header>
      <SetupCalibrationEditorClient
        calibrationId={calibration.id}
        documentId={calibration.exampleDocumentId ?? ""}
        previewUrl={
          calibration.exampleDocumentId
            ? `/api/setup-documents/${calibration.exampleDocumentId}/file`
            : ""
        }
        exampleDocumentOriginalFilename={calibration.exampleDocument?.originalFilename ?? null}
        initialName={calibration.name}
        initialSourceType={calibration.sourceType}
        initialCalibrationData={calibration.calibrationDataJson}
        setupSheetModelId={calibration.setupSheetModelId}
      />
    </>
  );
}


import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalibrationDeleteButton } from "@/components/setup-documents/CalibrationDeleteButton";
import { CalibrationChassisDefaultPanel } from "@/components/setup-sheet-models/CalibrationChassisDefaultPanel";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import {
  calibrationReadableByIdWhere,
  canManageCalibration,
} from "@/lib/setupCalibrations/calibrationAccess";
import { calibrationMappingCounts, normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import { SetupCalibrationEditorClient } from "@/components/setup-documents/SetupCalibrationEditorLazy";
import { CardPanel } from "@/components/ui/CardPanel";

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
    where: calibrationReadableByIdWhere(id),
    select: {
      id: true,
      name: true,
      sourceType: true,
      calibrationDataJson: true,
      exampleDocumentId: true,
      setupSheetModelId: true,
      userId: true,
      setupSheetModel: { select: { id: true, name: true } },
      exampleDocument: {
        select: { id: true, originalFilename: true },
      },
    },
  });
  if (!calibration) notFound();
  const canManage = canManageCalibration(user, calibration);
  const mappingCounts = calibrationMappingCounts(normalizeCalibrationData(calibration.calibrationDataJson));
  return (
    <>
      <header className="page-header">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <h1 className="page-title">{canManage ? "Edit calibration" : "View calibration"}</h1>
            <p className="page-subtitle">
              {calibration.name}
              {calibration.setupSheetModel ? (
                <>
                  {" "}
                  · Car type:{" "}
                  <Link
                    href={`/setup-sheet-models/${calibration.setupSheetModel.id}/schema`}
                    className="text-accent hover:underline"
                  >
                    {calibration.setupSheetModel.name}
                  </Link>
                </>
              ) : (
                <> · Unlinked — assign this calibration to a car type (e.g. Mugen MTC3) from setup review.</>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              {canManage
                ? "Uploads auto-select this profile when the PDF form layout matches the linked example PDF."
                : "This calibration is read-only for you. Only the creator or an admin can change mappings or delete it."}
            </p>
          </div>
          {canManage ? (
            <CalibrationDeleteButton
              calibrationId={calibration.id}
              calibrationName={calibration.name}
              redirectTo="/setup-calibrations"
            />
          ) : null}
        </div>
      </header>
      <section className="page-body pb-6">
        {canManage ? (
          <>
            <CalibrationChassisDefaultPanel
              calibrationId={calibration.id}
              calibrationName={calibration.name}
              currentModelId={calibration.setupSheetModelId}
              currentModelName={calibration.setupSheetModel?.name ?? null}
            />
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
        ) : (
          <CardPanel className="max-w-2xl" contentClassName="text-sm space-y-3">
            <div className="text-xs text-muted-foreground">
              {calibration.sourceType} · {mappingCounts.formFields} form · {mappingCounts.textFields} text ·{" "}
              {mappingCounts.regionFields} region · {mappingCounts.imageFields} image
            </div>
            {calibration.exampleDocumentId ? (
              <a
                href={`/api/setup-documents/${calibration.exampleDocumentId}/file`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                View example PDF
                {calibration.exampleDocument?.originalFilename
                  ? ` (${calibration.exampleDocument.originalFilename})`
                  : ""}
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">No example PDF linked.</p>
            )}
            <Link href="/setup-calibrations" className="inline-block text-xs text-accent hover:underline">
              Back to calibrations
            </Link>
          </CardPanel>
        )}
      </section>
    </>
  );
}

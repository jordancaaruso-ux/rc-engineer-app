import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
import { DeriveImageMapButton } from "@/components/setup-documents/DeriveImageMapButton";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";

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
        select: { id: true, originalFilename: true, mimeType: true },
      },
    },
  });
  if (!calibration) notFound();
  const canManage = canManageCalibration(user, calibration);
  const normalizedData = normalizeCalibrationData(calibration.calibrationDataJson);
  const mappingCounts = calibrationMappingCounts(normalizedData);
  const exampleIsPdf = (calibration.exampleDocument?.mimeType ?? "") === "application/pdf";
  // Genuine image-region calibrations (image example doc, e.g. blank-sheet auto calibrations) are
  // edited in the image box editor. An AcroForm calibration that merely *derived* an image map
  // keeps a PDF example doc and stays on this editor (two-lane: AcroForm mappings + image map).
  if (normalizedData.imageCalibration && calibration.exampleDocumentId && canManage && !exampleIsPdf) {
    redirect(`/setup-documents/${calibration.exampleDocumentId}/calibrate-image`);
  }
  // Image-only calibration with no editable PDF example — the box editor can't open it. (A PDF
  // AcroForm calibration that derived an image map has a PDF example and falls through to its editor.)
  if (normalizedData.imageCalibration && canManage && !exampleIsPdf) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Image calibration</h1>
            <p className="page-subtitle">
              {calibration.name} — this is an image-region calibration with no example document
              linked, so the box editor can&apos;t open it. Attach it to a reference image
              document to edit its regions.
            </p>
          </div>
        </header>
        <section className="page-body">
          <Link href="/setup-calibrations" className="text-sm text-accent hover:underline">
            Back to calibrations
          </Link>
        </section>
      </>
    );
  }
  // Mapping is parameter-first against a chassis' schema, so an unlinked calibration has no
  // parameter list to map against. Its stored mappings still work at import — it's just not
  // editable here. Link it to a chassis to edit.
  if (!calibration.setupSheetModelId) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Calibration</h1>
            <p className="page-subtitle">{calibration.name} · not linked to a chassis</p>
          </div>
        </header>
        <section className="page-body pb-6">
          <CardPanel contentClassName="space-y-3 text-sm">
            <Eyebrow>Read-only</Eyebrow>
            <p className="text-muted-foreground">
              This calibration isn&apos;t linked to a chassis type, so there are no parameters to
              map against. Its {mappingCounts.formFields} stored mappings still work when a
              matching sheet is uploaded.
            </p>
            <p className="text-muted-foreground">
              To edit it, link it to a chassis below, then reopen.
            </p>
            <CalibrationChassisDefaultPanel
              calibrationId={calibration.id}
              calibrationName={calibration.name}
              currentModelId={calibration.setupSheetModelId}
              currentModelName={calibration.setupSheetModel?.name ?? null}
            />
            <Link href="/setup-calibrations" className="inline-block text-xs text-accent hover:underline">
              Back to calibrations
            </Link>
          </CardPanel>
        </section>
      </>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{canManage ? "Calibration" : "View calibration"}</h1>
          <p className="page-subtitle">
            {calibration.name}
            {calibration.setupSheetModel ? (
              <>
                {" "}
                ·{" "}
                <Link
                  href={`/setup-sheet-models/${calibration.setupSheetModel.id}`}
                  className="text-accent hover:underline"
                >
                  {calibration.setupSheetModel.name}
                </Link>
              </>
            ) : (
              <> · Unlinked</>
            )}
          </p>
        </div>
      </header>
      <section className="page-body pb-6">
        {canManage ? (
          <>
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
            <details className="mt-4 rounded-xl border border-border bg-card px-4 py-3">
              <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
                Advanced — chassis default, image map, delete
              </summary>
              <div className="mt-3 space-y-3">
                <CalibrationChassisDefaultPanel
                  calibrationId={calibration.id}
                  calibrationName={calibration.name}
                  currentModelId={calibration.setupSheetModelId}
                  currentModelName={calibration.setupSheetModel?.name ?? null}
                />
                {exampleIsPdf && calibration.exampleDocumentId && mappingCounts.formFields > 0 ? (
                  <DeriveImageMapButton
                    calibrationId={calibration.id}
                    previewUrl={`/api/setup-documents/${calibration.exampleDocumentId}/file`}
                    hasImageMap={mappingCounts.imageFields > 0}
                  />
                ) : null}
                <CalibrationDeleteButton
                  calibrationId={calibration.id}
                  calibrationName={calibration.name}
                  redirectTo="/setup-calibrations"
                />
              </div>
            </details>
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

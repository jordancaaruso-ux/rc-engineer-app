import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { SetupCalibrationEditorClient } from "@/components/setup-documents/SetupCalibrationEditorClient";

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
  const { id } = await params;
  const user = await getOrCreateLocalUser();
  const calibration = await prisma.setupSheetCalibration.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      name: true,
      sourceType: true,
      calibrationDataJson: true,
      exampleDocumentId: true,
      exampleDocument: {
        select: { id: true, originalFilename: true },
      },
    },
  });
  if (!calibration) notFound();
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Edit calibration</h1>
          <p className="page-subtitle">
            Calibration is the source of truth for PDF-to-setup mapping. Select AcroForm fields first, then map to calibration fields.
          </p>
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
        initialName={calibration.name}
        initialSourceType={calibration.sourceType}
        initialCalibrationData={calibration.calibrationDataJson}
      />
    </>
  );
}


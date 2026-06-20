import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { ImageCalibrationEditorClient } from "@/components/setup-documents/ImageCalibrationEditorClient";
import { buildCalibrationFieldCatalog } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import {
  calibrationMappingCounts,
  normalizeCalibrationData,
  type ImageCalibrationField,
  type ImageRegion,
} from "@/lib/setupCalibrations/types";
import { calibrationsVisibleToUserWhere } from "@/lib/setupCalibrations/calibrationAccess";

export default async function CalibrateImagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <header className="page-header">
        <div>
          <h1 className="page-title">Calibrate image setup sheet</h1>
          <p className="page-subtitle">Database not configured.</p>
        </div>
      </header>
    );
  }
  const { id } = await params;
  const user = await requireCurrentUser();
  const doc = await prisma.setupDocument.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      sourceType: true,
      calibrationProfileId: true,
    },
  });
  if (!doc) notFound();
  if (doc.sourceType !== "IMAGE" && !(doc.mimeType ?? "").startsWith("image/")) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Calibrate image setup sheet</h1>
            <p className="page-subtitle">This document is not an image upload.</p>
          </div>
        </header>
        <section className="page-body">
          <Link href={`/setup-documents/${doc.id}`} className="text-sm underline">
            Back to document
          </Link>
        </section>
      </>
    );
  }

  let initialFields: ImageCalibrationField[] = [];
  let initialAnchors: ImageRegion[] = [];
  let initialPageRegion: ImageRegion | undefined;
  let initialName: string | undefined;
  let initialCalibrationId: string | undefined;
  if (doc.calibrationProfileId) {
    const cal = await prisma.setupSheetCalibration.findFirst({
      where: { id: doc.calibrationProfileId },
      select: { id: true, name: true, calibrationDataJson: true },
    });
    if (cal) {
      const norm = normalizeCalibrationData(cal.calibrationDataJson);
      const ic = norm.imageCalibration;
      if (ic) {
        initialFields = ic.fields;
        initialPageRegion = ic.reference.pageRegion;
        initialAnchors = (ic.reference.anchors ?? []).map((a) => ({
          xPct: a.xPct,
          yPct: a.yPct,
          wPct: a.wPct,
          hPct: a.hPct,
        }));
        initialName = cal.name;
        initialCalibrationId = cal.id;
      }
    }
  }

  const fieldCatalog = buildCalibrationFieldCatalog();
  const calibrationRows = await prisma.setupSheetCalibration.findMany({
    where: calibrationsVisibleToUserWhere(user.id),
    select: {
      id: true,
      name: true,
      calibrationDataJson: true,
      exampleDocument: {
        select: { originalFilename: true, mimeType: true },
      },
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const deriveCalibrationOptions = calibrationRows
    .map((row) => {
      const data = normalizeCalibrationData(row.calibrationDataJson);
      const counts = calibrationMappingCounts(data);
      return {
        id: row.id,
        name: row.name,
        exampleDocumentFilename: row.exampleDocument?.originalFilename ?? null,
        exampleDocumentMimeType: row.exampleDocument?.mimeType ?? null,
        formFieldCount: counts.formFields,
        imageFieldCount: counts.imageFields,
      };
    })
    .filter((row) => row.exampleDocumentMimeType === "application/pdf" && row.formFieldCount > 0)
    .map(({ exampleDocumentMimeType: _exampleDocumentMimeType, ...row }) => row);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Calibrate image setup sheet</h1>
          <p className="page-subtitle">
            Draw a rectangle around each value on the screenshot. Save once and the app will
            auto-import every future paste of this template.
          </p>
        </div>
      </header>
      <section className="page-body">
        <div className="text-xs text-muted-foreground">
          Source: <span className="font-medium text-foreground">{doc.originalFilename}</span> ·{" "}
          <Link href={`/setup-documents/${doc.id}`} className="underline">
            Back to document
          </Link>
        </div>
        <ImageCalibrationEditorClient
          documentId={doc.id}
          documentFilename={doc.originalFilename}
          imageUrl={`/api/setup-documents/${doc.id}/file`}
          fieldCatalog={fieldCatalog}
          initialFields={initialFields}
          initialAnchors={initialAnchors}
          initialPageRegion={initialPageRegion}
          initialName={initialName}
          initialCalibrationId={initialCalibrationId}
          deriveCalibrationOptions={deriveCalibrationOptions}
        />
      </section>
    </>
  );
}

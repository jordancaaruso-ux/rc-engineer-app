import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { BulkImportDocReviewClient } from "@/components/setup/BulkImportDocReviewClient";

export default async function BulkImportDocumentPage({
  params,
}: {
  params: Promise<{ batchId: string; documentId: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <header className="page-header">
        <h1 className="page-title">Review import</h1>
        <p className="page-subtitle">Database not configured.</p>
      </header>
    );
  }

  const { batchId, documentId } = await params;
  const user = await getOrCreateLocalUser();

  const [doc, calibrations] = await Promise.all([
    prisma.setupDocument.findFirst({
      where: {
        id: documentId,
        userId: user.id,
        setupImportBatchId: batchId,
      },
      select: {
        id: true,
        originalFilename: true,
        mimeType: true,
        parseStatus: true,
        importErrorMessage: true,
        importDiagnosticJson: true,
        parsedDataJson: true,
        importDatasetReviewStatus: true,
        eligibleForAggregationDataset: true,
        calibrationProfileId: true,
        parsedCalibrationProfileId: true,
        parsedSetupManuallyEdited: true,
        updatedAt: true,
      },
    }),
    // Calibrations are global/shared; list all for selection (document remains user-scoped above).
    prisma.setupSheetCalibration.findMany({
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { id: true, name: true, sourceType: true, calibrationDataJson: true },
    }),
  ]);
  if (!doc) notFound();

  const calibrationJson =
    doc.calibrationProfileId != null
      ? calibrations.find((c) => c.id === doc.calibrationProfileId)?.calibrationDataJson
      : undefined;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Dataset review</h1>
          <p className="page-subtitle">Confirm parse quality before including this setup in aggregation.</p>
        </div>
        <Link href={`/setup/bulk-import/${batchId}`} className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted self-start">
          Batch
        </Link>
      </header>
      <section className="page-body">
        <BulkImportDocReviewClient
          key={`${batchId}-${doc.id}`}
          batchId={batchId}
          documentId={doc.id}
          originalFilename={doc.originalFilename}
          mimeType={doc.mimeType}
          parseStatus={doc.parseStatus}
          importErrorMessage={doc.importErrorMessage}
          importDiagnosticJson={doc.importDiagnosticJson}
          parsedDataJson={doc.parsedDataJson}
          importDatasetReviewStatus={doc.importDatasetReviewStatus}
          eligibleForAggregationDataset={doc.eligibleForAggregationDataset}
          calibrationDataJson={calibrationJson ?? {}}
          calibrations={calibrations.map(({ calibrationDataJson: _j, ...c }) => c)}
          calibrationProfileId={doc.calibrationProfileId}
          parsedCalibrationProfileId={doc.parsedCalibrationProfileId}
          documentUpdatedAt={doc.updatedAt.toISOString()}
          parsedSetupManuallyEdited={doc.parsedSetupManuallyEdited}
        />
      </section>
    </>
  );
}

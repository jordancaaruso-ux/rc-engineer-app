import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { pickImportDatasetIdentityFields } from "@/lib/setupDocuments/importDatasetDisplay";

type Ctx = { params: Promise<{ batchId: string }> };

export async function GET(_: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const { batchId } = await ctx.params;
  const batch = await prisma.setupImportBatch.findFirst({
    where: { id: batchId, userId: user.id },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      calibrationProfileId: true,
      calibrationProfile: { select: { id: true, name: true, sourceType: true } },
      documents: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          originalFilename: true,
          parseStatus: true,
          importStatus: true,
          importOutcome: true,
          importErrorMessage: true,
          importDiagnosticJson: true,
          parsedDataJson: true,
          calibrationProfileId: true,
          parsedCalibrationProfileId: true,
          calibrationProfile: { select: { id: true, name: true } },
          calibrationResolvedSource: true,
          calibrationResolvedDebug: true,
          importDatasetReviewStatus: true,
          eligibleForAggregationDataset: true,
          createdAt: true,
        },
      },
    },
  });
  if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = batch.documents.map(({ parsedDataJson, ...d }) => ({
    ...d,
    identity: pickImportDatasetIdentityFields(parsedDataJson),
  }));

  const counts = {
    total: batch.documents.length,
    parsed: batch.documents.filter((d) => d.parseStatus === "PARTIAL" || d.parseStatus === "PARSED").length,
    failed: batch.documents.filter((d) => d.parseStatus === "FAILED").length,
    pending: batch.documents.filter((d) => d.parseStatus === "PENDING").length,
    confirmed: batch.documents.filter((d) => d.importDatasetReviewStatus === "CONFIRMED_ACCURATE").length,
    eligibleAggregation: batch.documents.filter((d) => d.eligibleForAggregationDataset).length,
    excludedFromAggregation: batch.documents.filter((d) => !d.eligibleForAggregationDataset).length,
  };

  return NextResponse.json({ batch: { ...batch, documents: rows }, counts });
}

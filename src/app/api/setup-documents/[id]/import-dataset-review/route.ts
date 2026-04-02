import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

type DatasetReviewStatus = "UNSET" | "NOT_CONFIRMED" | "CONFIRMED_ACCURATE";
const REVIEW: DatasetReviewStatus[] = ["UNSET", "NOT_CONFIRMED", "CONFIRMED_ACCURATE"];

export async function PATCH(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    importDatasetReviewStatus?: DatasetReviewStatus;
  };

  if (!body.importDatasetReviewStatus || !REVIEW.includes(body.importDatasetReviewStatus)) {
    return NextResponse.json(
      { error: "importDatasetReviewStatus must be UNSET, NOT_CONFIRMED, or CONFIRMED_ACCURATE" },
      { status: 400 }
    );
  }

  const doc = await prisma.setupDocument.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      setupImportBatchId: true,
      parseStatus: true,
    },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!doc.setupImportBatchId) {
    return NextResponse.json({ error: "Document is not part of a bulk import batch" }, { status: 400 });
  }

  if (body.importDatasetReviewStatus === "CONFIRMED_ACCURATE") {
    if (doc.parseStatus !== "PARSED" && doc.parseStatus !== "PARTIAL") {
      return NextResponse.json(
        { error: "Only successfully parsed documents can be confirmed for the aggregation dataset" },
        { status: 409 }
      );
    }
  }

  const eligible =
    body.importDatasetReviewStatus === "CONFIRMED_ACCURATE"
    && (doc.parseStatus === "PARSED" || doc.parseStatus === "PARTIAL");

  const updated = await prisma.setupDocument.updateMany({
    where: { id: doc.id, userId: user.id },
    data: {
      importDatasetReviewStatus: body.importDatasetReviewStatus,
      eligibleForAggregationDataset: eligible,
    },
  });
  if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const next = await prisma.setupDocument.findFirst({
    where: { id: doc.id, userId: user.id },
    select: { id: true, importDatasetReviewStatus: true, eligibleForAggregationDataset: true },
  });
  return NextResponse.json(next);
}

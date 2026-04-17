import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { rebuildSetupAggregationsForUserCars } from "@/lib/setupAggregations/rebuildCarParameterAggregations";
import { rebuildCommunityTemplateAggregations } from "@/lib/setupAggregations/rebuildCommunityTemplateAggregations";
import { resolveAllowedCalibrationIds } from "@/lib/petitrc/allowedCalibrations";

type Body = {
  batchId?: string;
  /**
   * Which docs in the batch to include. Default "parsed_exact": only PARSED docs whose final stored
   * calibration is one of the allowed PetitRC calibrations (effectively the exact-match picks).
   * This filters out FAILED/PARTIAL rows and the "no_exact_match" survivors that kept a legacy
   * calibration.
   */
  include?: "parsed_exact" | "parsed" | "parsed_partial" | "all";
};

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const body = (await request.json().catch(() => ({}))) as Body;
  const batchId = typeof body.batchId === "string" ? body.batchId.trim() : "";
  if (!batchId) {
    return NextResponse.json({ error: "batchId is required" }, { status: 400 });
  }
  const include = body.include ?? "parsed_exact";

  const batch = await prisma.setupImportBatch.findFirst({
    where: { id: batchId, userId: user.id },
    select: { id: true, name: true },
  });
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const includeWhere: Record<string, unknown> = { userId: user.id, setupImportBatchId: batchId };
  if (include === "parsed_exact") {
    const allowedCalibrationIds = await resolveAllowedCalibrationIds(user.id);
    if (allowedCalibrationIds.length === 0) {
      return NextResponse.json(
        {
          error:
            "No allowed PetitRC calibrations found for this user. Create/link example PDFs for A800RR-Old_V1.0, A800RR_New_V1.0, and A800R Old_V1.1 first.",
        },
        { status: 400 }
      );
    }
    includeWhere.parseStatus = "PARSED";
    includeWhere.calibrationProfileId = { in: allowedCalibrationIds };
  } else if (include === "parsed") {
    includeWhere.parseStatus = "PARSED";
  } else if (include === "parsed_partial") {
    includeWhere.parseStatus = { in: ["PARSED", "PARTIAL"] };
  }

  const before = await prisma.setupDocument.count({
    where: { userId: user.id, eligibleForAggregationDataset: true },
  });
  const qualifying = await prisma.setupDocument.count({ where: includeWhere });

  const disableResult = await prisma.setupDocument.updateMany({
    where: { userId: user.id, eligibleForAggregationDataset: true },
    data: { eligibleForAggregationDataset: false },
  });
  const enableResult = await prisma.setupDocument.updateMany({
    where: includeWhere,
    data: { eligibleForAggregationDataset: true },
  });

  const [userCars, community] = await Promise.all([
    rebuildSetupAggregationsForUserCars(user.id),
    rebuildCommunityTemplateAggregations(),
  ]);

  return NextResponse.json(
    {
      batchId: batch.id,
      batchName: batch.name,
      include,
      eligibilityBefore: before,
      disabledCount: disableResult.count,
      enabledCount: enableResult.count,
      qualifyingInBatch: qualifying,
      userCars,
      community,
    },
    { status: 200 }
  );
}

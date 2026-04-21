import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  ALL_GRIP_BUCKETS,
  GRIP_BUCKET_ANY,
  type GripBucket,
} from "@/lib/setupAggregations/gripBuckets";
import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";

/**
 * Community-wide spread across ALL eligible setups for a template bucket.
 * Used by the Setup Comparison page so the IQR scale reflects population
 * sensitivity, not just the current user's own runs.
 *
 * Bucket key: (setupSheetTemplate, trackSurface, gripLevel). `gripLevel=any`
 * is the broadest pool and is emitted for every eligible document.
 */

const ALLOWED_SURFACES = new Set(["asphalt", "carpet"]);

function coerceGrip(raw: string | null): GripBucket {
  if (!raw) return GRIP_BUCKET_ANY;
  const t = raw.trim().toLowerCase();
  return (ALL_GRIP_BUCKETS as readonly string[]).includes(t)
    ? (t as GripBucket)
    : GRIP_BUCKET_ANY;
}

function coerceSurface(raw: string | null): "asphalt" | "carpet" {
  const t = (raw ?? "").trim().toLowerCase();
  return ALLOWED_SURFACES.has(t) ? (t as "asphalt" | "carpet") : "asphalt";
}

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { searchParams } = new URL(request.url);
  const setupSheetTemplate = (searchParams.get("setupSheetTemplate") ?? "").trim();
  const trackSurface = coerceSurface(searchParams.get("trackSurface"));
  const gripLevel = coerceGrip(searchParams.get("gripLevel"));

  if (!setupSheetTemplate) {
    return NextResponse.json(
      { error: "setupSheetTemplate is required" },
      { status: 400 }
    );
  }

  const templateKey = canonicalSetupSheetTemplateId(setupSheetTemplate) ?? setupSheetTemplate;
  const rows = await prisma.communitySetupParameterAggregation.findMany({
    where: {
      setupSheetTemplate: { equals: templateKey, mode: "insensitive" },
      trackSurface,
      gripLevel,
    },
    orderBy: [{ parameterKey: "asc" }],
    select: {
      parameterKey: true,
      valueType: true,
      sampleCount: true,
      numericStatsJson: true,
    },
  });

  const aggregations = rows.map((r) => ({
    // Synthetic carId so downstream consumers (buildNumericAggregationMapForCar,
    // diagnostics) that key off carId continue to work unchanged.
    carId: "__community__",
    parameterKey: r.parameterKey,
    valueType: r.valueType,
    sampleCount: r.sampleCount,
    numericStatsJson: r.numericStatsJson,
  }));

  return NextResponse.json({
    bucket: { setupSheetTemplate: templateKey, trackSurface, gripLevel },
    aggregations,
  });
}

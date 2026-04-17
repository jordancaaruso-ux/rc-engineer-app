import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import type { NumericStats } from "@/lib/setupAggregations/numericStats";
import {
  ALL_GRIP_BUCKETS,
  GRIP_BUCKETS_EXCLUDING_ANY,
  type GripBucket,
} from "@/lib/setupAggregations/gripBuckets";

type GripStats = {
  sampleCount: number;
  median: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  p25: number | null;
  p75: number | null;
};

type ParameterRow = {
  parameterKey: string;
  per: Record<GripBucket, GripStats | null>;
};

type BucketMeta = {
  gripLevel: GripBucket;
  maxSampleCount: number;
  parameterCount: number;
};

function pickStats(raw: unknown): GripStats | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Partial<NumericStats>;
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) ? x : null;
  const sampleCount = num(s.sampleCount);
  if (sampleCount == null || sampleCount <= 0) return null;
  return {
    sampleCount,
    median: num(s.median),
    mean: num(s.mean),
    min: num(s.min),
    max: num(s.max),
    p25: num(s.p25),
    p75: num(s.p75),
  };
}

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const user = await getOrCreateLocalUser();
  const url = new URL(request.url);
  const carId = url.searchParams.get("carId")?.trim() || null;
  const surfaceParam = url.searchParams.get("surface")?.trim().toLowerCase() || null;

  let setupSheetTemplate: string | null = null;
  if (carId) {
    const car = await prisma.car.findFirst({
      where: { id: carId, userId: user.id },
      select: { setupSheetTemplate: true },
    });
    setupSheetTemplate = car?.setupSheetTemplate?.trim() || null;
  } else {
    const tmpl = url.searchParams.get("template")?.trim() || null;
    setupSheetTemplate = tmpl;
  }

  if (!setupSheetTemplate) {
    return NextResponse.json(
      { error: "Provide ?carId=<id> for a car with a setupSheetTemplate, or ?template=<setupSheetTemplate>." },
      { status: 400 }
    );
  }

  const trackSurface: "asphalt" | "carpet" | null =
    surfaceParam === "asphalt" || surfaceParam === "carpet" ? surfaceParam : null;
  if (!trackSurface) {
    return NextResponse.json(
      { error: "Provide ?surface=asphalt or ?surface=carpet." },
      { status: 400 }
    );
  }

  const rows = await prisma.communitySetupParameterAggregation.findMany({
    where: {
      setupSheetTemplate,
      trackSurface,
      valueType: "NUMERIC",
    },
    select: {
      parameterKey: true,
      gripLevel: true,
      sampleCount: true,
      numericStatsJson: true,
    },
  });

  const byKey = new Map<string, ParameterRow>();
  const bucketMeta = new Map<GripBucket, BucketMeta>(
    ALL_GRIP_BUCKETS.map((b) => [b, { gripLevel: b, maxSampleCount: 0, parameterCount: 0 }])
  );

  for (const r of rows) {
    const gb = r.gripLevel as GripBucket;
    if (!ALL_GRIP_BUCKETS.includes(gb)) continue;
    const stats = pickStats(r.numericStatsJson);
    if (!stats) continue;
    let cur = byKey.get(r.parameterKey);
    if (!cur) {
      cur = {
        parameterKey: r.parameterKey,
        per: {
          any: null,
          low: null,
          medium: null,
          high: null,
        },
      };
      byKey.set(r.parameterKey, cur);
    }
    cur.per[gb] = stats;
    const meta = bucketMeta.get(gb);
    if (meta) {
      meta.parameterCount += 1;
      if (stats.sampleCount > meta.maxSampleCount) meta.maxSampleCount = stats.sampleCount;
    }
  }

  const parameters: ParameterRow[] = [...byKey.values()].sort((a, b) =>
    a.parameterKey.localeCompare(b.parameterKey)
  );

  // Keep only parameters with at least one grip-specific bucket present (so the low/med/high comparison is useful).
  const gripSpecific = parameters.filter((p) =>
    GRIP_BUCKETS_EXCLUDING_ANY.some((g) => p.per[g] != null)
  );

  return NextResponse.json({
    setupSheetTemplate,
    trackSurface,
    bucketMeta: [...bucketMeta.values()],
    parameters: gripSpecific,
  });
}

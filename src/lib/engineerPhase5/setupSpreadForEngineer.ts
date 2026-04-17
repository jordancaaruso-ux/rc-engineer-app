import "server-only";

import { SetupAggregationScopeType, SetupAggregationValueType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { carIdsSharingSetupTemplate } from "@/lib/carSetupScope";
import type { NumericStats } from "@/lib/setupAggregations/numericStats";
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { parseNumericFromSetupString } from "@/lib/setup/parseSetupNumeric";
import {
  GRIP_BUCKET_ANY,
  gripBucketLabel,
  runReadGripBucket,
  type GripBucket,
} from "@/lib/setupAggregations/gripBuckets";
import {
  loadCommunityAggregationsForBucket,
  loadCommunityNumericGripTrendsForBucket,
  type GripTrendBucketStats,
} from "@/lib/setupAggregations/loadCommunityAggregations";

const MAX_PARAMS = 45;

export type SetupSpreadPositionBand =
  | "below_typical"
  | "low"
  | "mid"
  | "high"
  | "above_typical"
  | "not_numeric"
  | "no_spread_data";

function parseNumericStats(raw: unknown): NumericStats | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k] as number) ? (o[k] as number) : null);
  const sampleCount = n("sampleCount");
  const mean = n("mean");
  const median = n("median");
  const stdDev = n("stdDev");
  const min = n("min");
  const max = n("max");
  const p10 = n("p10");
  const p25 = n("p25");
  const p50 = n("p50");
  const p75 = n("p75");
  const p90 = n("p90");
  const iqr = n("iqr");
  const broadRange = n("broadRange");
  if (
    sampleCount == null ||
    mean == null ||
    median == null ||
    stdDev == null ||
    min == null ||
    max == null ||
    p10 == null ||
    p25 == null ||
    p50 == null ||
    p75 == null ||
    p90 == null ||
    iqr == null ||
    broadRange == null
  ) {
    return null;
  }
  return {
    sampleCount,
    mean,
    median,
    stdDev,
    min,
    max,
    p10,
    p25,
    p50,
    p75,
    p90,
    iqr,
    broadRange,
  };
}

function formatSetupVal(v: unknown): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

function tryParseNumericFromSetupValue(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return parseNumericFromSetupString(v, { allowKSuffix: false });
}

function bandForValue(v: number, s: NumericStats): SetupSpreadPositionBand {
  if (v < s.p10) return "below_typical";
  if (v < s.p25) return "low";
  if (v <= s.p75) return "mid";
  if (v <= s.p90) return "high";
  return "above_typical";
}

export type EngineerSetupSpreadRow = {
  parameterKey: string;
  currentDisplay: string;
  valueType: SetupAggregationValueType;
  /** Where numeric spread bands came from: community eligible uploads vs your garage cars sharing the template. */
  spreadSource: "community_eligible_uploads" | "your_garage" | "none";
  /** Which community grip bucket served this row (after fallback). Null when community wasn't used. */
  communityGripLevel: GripBucket | null;
  spread: null | {
    sampleCount: number;
    min: number;
    max: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    median: number;
  };
  /**
   * Per-grip medians (low/medium/high/any) for this numeric parameter when each bucket has
   * >= MIN_GRIP_BUCKET_SAMPLE_COUNT samples. Independent of the primary `spread` above — used by the
   * engineer to describe "does this param trend with grip?" even when the run has no grip tag.
   * Null when the parameter isn't numeric or when no community data is loaded.
   */
  gripTrend: null | Partial<Record<GripBucket, GripTrendBucketStats>>;
  positionBand: SetupSpreadPositionBand;
};

export type EngineerCommunityContext = {
  setupSheetTemplate: string | null;
  trackSurface: "asphalt" | "carpet" | null;
  /** The grip bucket the engineer is reading from (already resolved, with multi-token / unknown collapsing to "any"). */
  gripLevel: GripBucket;
  /** Human-readable summary for the engineer prompt. */
  label: string;
};

/**
 * Per-parameter spread vs historical setups: prefers app-wide community stats from every upload flagged
 * “use for aggregations” (`eligibleForAggregationDataset`) for the car’s `setupSheetTemplate`, materialized
 * in `CommunitySetupParameterAggregation`. Falls back to your garage’s `CAR_PARAMETER` rows (sibling cars
 * sharing the same template) when community data is missing for a key.
 */
export async function buildSetupSpreadForEngineer(params: {
  userId: string;
  carId: string | null;
  setupSnapshotData: unknown;
}): Promise<{
  siblingCarIds: string[];
  setupSheetTemplate: string | null;
  communitySpreadAvailable: boolean;
  /** Community context describing the bucket the engineer is comparing against. */
  communityContext: EngineerCommunityContext;
  rows: EngineerSetupSpreadRow[];
  truncated: boolean;
}> {
  if (!params.carId) {
    return {
      siblingCarIds: [],
      setupSheetTemplate: null,
      communitySpreadAvailable: false,
      communityContext: {
        setupSheetTemplate: null,
        trackSurface: null,
        gripLevel: GRIP_BUCKET_ANY,
        label: "no car context",
      },
      rows: [],
      truncated: false,
    };
  }

  const siblingCarIds = await carIdsSharingSetupTemplate(params.userId, params.carId);
  const carRow = await prisma.car.findFirst({
    where: { id: params.carId, userId: params.userId },
    select: { setupSheetTemplate: true },
  });
  const setupSheetTemplate = carRow?.setupSheetTemplate?.trim() || null;

  const normalized = normalizeSetupData(params.setupSnapshotData as SetupSnapshotData | null);
  const keys = Object.keys(normalized)
    .filter((k) => {
      const v = normalized[k];
      if (v == null) return false;
      if (typeof v === "object" && !Array.isArray(v)) return Object.keys(v as object).length > 0;
      if (Array.isArray(v)) return v.length > 0;
      return true;
    })
    .filter(isTuningComparisonKey)
    .sort((a, b) => a.localeCompare(b));

  const surfaceRaw = String((normalized as Record<string, unknown>)["track_surface"] ?? "").trim().toLowerCase();
  const trackSurface: "asphalt" | "carpet" | null =
    surfaceRaw === "asphalt" || surfaceRaw === "carpet" ? surfaceRaw : null;
  const gripLevel: GripBucket = runReadGripBucket(normalized as Record<string, SetupSnapshotData[string]>);

  const [aggRows, communityRows, gripTrends] = await Promise.all([
    prisma.setupParameterAggregation.findMany({
      where: {
        carId: { in: siblingCarIds },
        scopeType: SetupAggregationScopeType.CAR_PARAMETER,
        parameterKey: { in: keys },
      },
      select: {
        parameterKey: true,
        valueType: true,
        sampleCount: true,
        numericStatsJson: true,
        carId: true,
      },
    }),
    setupSheetTemplate && trackSurface
      ? loadCommunityAggregationsForBucket({
          setupSheetTemplate,
          trackSurface,
          gripLevel,
          parameterKeys: keys,
        })
      : Promise.resolve(
          [] as Awaited<ReturnType<typeof loadCommunityAggregationsForBucket>>
        ),
    setupSheetTemplate && trackSurface
      ? loadCommunityNumericGripTrendsForBucket({
          setupSheetTemplate,
          trackSurface,
          parameterKeys: keys,
        })
      : Promise.resolve(
          new Map() as Awaited<ReturnType<typeof loadCommunityNumericGripTrendsForBucket>>
        ),
  ]);

  const bestGarageByKey = new Map<
    string,
    { parameterKey: string; valueType: SetupAggregationValueType; sampleCount: number; numericStatsJson: unknown }
  >();
  for (const r of aggRows) {
    const prev = bestGarageByKey.get(r.parameterKey);
    if (!prev || r.sampleCount > prev.sampleCount) {
      bestGarageByKey.set(r.parameterKey, {
        parameterKey: r.parameterKey,
        valueType: r.valueType,
        sampleCount: r.sampleCount,
        numericStatsJson: r.numericStatsJson,
      });
    }
  }

  const communityByKey = new Map<
    string,
    {
      valueType: SetupAggregationValueType;
      sampleCount: number;
      numericStatsJson: unknown;
      resolvedGripLevel: GripBucket;
    }
  >();
  for (const r of communityRows) {
    communityByKey.set(r.parameterKey, {
      valueType: r.valueType,
      sampleCount: r.sampleCount,
      numericStatsJson: r.numericStatsJson,
      resolvedGripLevel: r.resolvedGripLevel,
    });
  }

  const communitySpreadAvailable =
    setupSheetTemplate != null && communityRows.some((r) => r.valueType === SetupAggregationValueType.NUMERIC);

  const rows: EngineerSetupSpreadRow[] = [];
  let truncated = false;
  for (const key of keys) {
    if (rows.length >= MAX_PARAMS) {
      truncated = true;
      break;
    }
    const cur = normalized[key];
    const currentDisplay = formatSetupVal(cur);

    const comm = communityByKey.get(key);
    const garage = bestGarageByKey.get(key);
    const numericComm =
      comm?.valueType === SetupAggregationValueType.NUMERIC ? comm : null;
    const numericGarage =
      garage?.valueType === SetupAggregationValueType.NUMERIC ? garage : null;
    const numericChosen = numericComm ?? numericGarage;
    const spreadSource: EngineerSetupSpreadRow["spreadSource"] = numericComm
      ? "community_eligible_uploads"
      : numericGarage
        ? "your_garage"
        : "none";

    const communityGripLevel = numericComm ? numericComm.resolvedGripLevel : null;
    const gripTrendRaw = gripTrends.get(key) ?? null;
    // Only surface the trend when it actually spans multiple grip buckets (otherwise "trend" is misleading).
    const gripTrendBucketCount = gripTrendRaw
      ? Object.keys(gripTrendRaw).filter((k) => k !== "any").length
      : 0;
    const gripTrend = gripTrendBucketCount >= 2 ? gripTrendRaw : null;

    if (!numericChosen) {
      const meta = comm ?? garage;
      rows.push({
        parameterKey: key,
        currentDisplay,
        valueType: meta?.valueType ?? SetupAggregationValueType.NUMERIC,
        spreadSource,
        communityGripLevel,
        spread: null,
        gripTrend,
        positionBand: "no_spread_data",
      });
      continue;
    }
    const stats = parseNumericStats(numericChosen.numericStatsJson);
    const num = tryParseNumericFromSetupValue(cur);
    if (stats == null || num == null) {
      rows.push({
        parameterKey: key,
        currentDisplay,
        valueType: SetupAggregationValueType.NUMERIC,
        spreadSource,
        communityGripLevel,
        spread: null,
        gripTrend,
        positionBand: num == null ? "not_numeric" : "no_spread_data",
      });
      continue;
    }
    rows.push({
      parameterKey: key,
      currentDisplay,
      valueType: SetupAggregationValueType.NUMERIC,
      spreadSource,
      communityGripLevel,
      spread: {
        sampleCount: stats.sampleCount,
        min: stats.min,
        max: stats.max,
        p10: stats.p10,
        p25: stats.p25,
        p50: stats.p50,
        p75: stats.p75,
        p90: stats.p90,
        median: stats.median,
      },
      gripTrend,
      positionBand: bandForValue(num, stats),
    });
  }

  const communityContext: EngineerCommunityContext = {
    setupSheetTemplate,
    trackSurface,
    gripLevel,
    label: describeCommunityContext(setupSheetTemplate, trackSurface, gripLevel),
  };

  return {
    siblingCarIds,
    setupSheetTemplate,
    communitySpreadAvailable,
    communityContext,
    rows,
    truncated,
  };
}

function describeCommunityContext(
  template: string | null,
  surface: "asphalt" | "carpet" | null,
  grip: GripBucket
): string {
  if (!template) return "no template — community stats unavailable";
  const surfaceLabel = surface ?? "unknown surface";
  return `${template} · ${surfaceLabel} · ${gripBucketLabel(grip)}`;
}

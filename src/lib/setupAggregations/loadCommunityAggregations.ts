/**
 * Per-bucket loader for community setup aggregations.
 *
 * The aggregation table stores one row per `(setupSheetTemplate, trackSurface, gripLevel, parameterKey)`.
 * Callers care about the *most specific* bucket for the user's current run. We ALWAYS try the requested
 * grip bucket first; if a parameter has fewer than {@link MIN_GRIP_BUCKET_SAMPLE_COUNT} samples there
 * (or no row at all), we fall back to the `any` bucket for that parameter.
 *
 * This keeps grip-specific context where it's reliable and avoids noisy archetypes from tiny samples.
 */
import { SetupAggregationValueType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  GRIP_BUCKET_ANY,
  type GripBucket,
} from "@/lib/setupAggregations/gripBuckets";

/** Minimum samples in a grip-specific bucket before we use it instead of `any`. */
export const MIN_GRIP_BUCKET_SAMPLE_COUNT = 10;

export type CommunityAggregationRow = {
  parameterKey: string;
  valueType: SetupAggregationValueType;
  sampleCount: number;
  numericStatsJson: Prisma.JsonValue | null;
  categoricalStatsJson: Prisma.JsonValue | null;
  /** Which grip bucket actually served the row (after fallback). */
  resolvedGripLevel: GripBucket;
};

export type LoadCommunityAggregationsArgs = {
  setupSheetTemplate: string;
  trackSurface: string;
  gripLevel: GripBucket;
  /** Optional whitelist. When omitted, returns every parameterKey in the bucket. */
  parameterKeys?: string[];
};

/**
 * Load the best-available aggregation row per parameter for a `(template, surface, grip)` bucket,
 * transparently falling back to the `any` grip bucket when the requested bucket is under-sampled.
 */
export async function loadCommunityAggregationsForBucket(
  args: LoadCommunityAggregationsArgs
): Promise<CommunityAggregationRow[]> {
  const { setupSheetTemplate, trackSurface, gripLevel, parameterKeys } = args;
  if (!setupSheetTemplate || !trackSurface) return [];

  const gripLevelsToQuery: GripBucket[] =
    gripLevel === GRIP_BUCKET_ANY ? [GRIP_BUCKET_ANY] : [gripLevel, GRIP_BUCKET_ANY];

  const rows = await prisma.communitySetupParameterAggregation.findMany({
    where: {
      setupSheetTemplate,
      trackSurface,
      gripLevel: { in: gripLevelsToQuery },
      ...(parameterKeys && parameterKeys.length > 0
        ? { parameterKey: { in: parameterKeys } }
        : {}),
    },
    select: {
      parameterKey: true,
      valueType: true,
      sampleCount: true,
      numericStatsJson: true,
      categoricalStatsJson: true,
      gripLevel: true,
    },
  });

  // Pick preferred grip when sample count is healthy, else fall back to `any`.
  const byKey = new Map<string, CommunityAggregationRow>();
  const anyByKey = new Map<string, CommunityAggregationRow>();
  for (const r of rows) {
    const resolved: CommunityAggregationRow = {
      parameterKey: r.parameterKey,
      valueType: r.valueType,
      sampleCount: r.sampleCount,
      numericStatsJson: r.numericStatsJson ?? null,
      categoricalStatsJson: r.categoricalStatsJson ?? null,
      resolvedGripLevel: r.gripLevel as GripBucket,
    };
    if (r.gripLevel === GRIP_BUCKET_ANY) {
      anyByKey.set(r.parameterKey, resolved);
    } else if (
      r.gripLevel === gripLevel &&
      r.sampleCount >= MIN_GRIP_BUCKET_SAMPLE_COUNT
    ) {
      byKey.set(r.parameterKey, resolved);
    }
  }

  // Merge: preferred wins, otherwise `any`.
  const merged = new Map<string, CommunityAggregationRow>(anyByKey);
  for (const [k, v] of byKey) merged.set(k, v);
  return [...merged.values()];
}

/**
 * Per-parameter low/medium/high/any median summary ("does this param trend with grip?").
 *
 * Distinct from {@link loadCommunityAggregationsForBucket}, which picks ONE bucket per parameter
 * (run-specific grip with fallback to `any`) for the primary spread band. This helper returns the
 * whole strip so the engineer can narrate cross-grip trends even when the anchored run doesn't have
 * a grip tag (in which case the primary band is still `any` per our default policy).
 *
 * Only NUMERIC parameters are included, and only buckets with sampleCount >= {@link MIN_GRIP_BUCKET_SAMPLE_COUNT}.
 */
/** Top-K modal value entry for a bucket. */
export type BucketTopValueEntry = {
  /** Native numeric value (e.g. 7000 for a 7k diff oil). */
  value: number;
  /** Raw count of documents in this bucket with this exact value. */
  count: number;
  /** `count / sampleCount` (0..1). */
  frequency: number;
};

export type GripTrendBucketStats = {
  sampleCount: number;
  median: number;
  mean: number;
  min: number;
  max: number;
  /** 25th percentile (p25). Together with p75 describes where the middle-50% of the bucket sits. */
  p25: number;
  /** 75th percentile (p75). */
  p75: number;
  /** Interquartile range (p75 − p25). Scale used for trend-magnitude scoring. */
  iqr: number;
  /** Sample standard deviation (Bessel-corrected, 0 when n === 1). */
  stdDev: number;
  /** Top-K most common exact values in the bucket (up to 5), with counts and frequencies. */
  topValues: BucketTopValueEntry[];
  /** Count of distinct numeric values observed in the bucket (before the histogram top-K cap). */
  distinctValueCount: number;
  /** Full capped histogram `{ valueKey: count }` — internal use for Cliff's delta computation. */
  valueHistogram: Record<string, number>;
};

export type GripTrendByParameter = Map<
  string,
  Partial<Record<GripBucket, GripTrendBucketStats>>
>;

export async function loadCommunityNumericGripTrendsForBucket(args: {
  setupSheetTemplate: string;
  trackSurface: string;
  parameterKeys?: string[];
}): Promise<GripTrendByParameter> {
  const out: GripTrendByParameter = new Map();
  const { setupSheetTemplate, trackSurface, parameterKeys } = args;
  if (!setupSheetTemplate || !trackSurface) return out;

  const rows = await prisma.communitySetupParameterAggregation.findMany({
    where: {
      setupSheetTemplate,
      trackSurface,
      valueType: SetupAggregationValueType.NUMERIC,
      ...(parameterKeys && parameterKeys.length > 0
        ? { parameterKey: { in: parameterKeys } }
        : {}),
    },
    select: {
      parameterKey: true,
      gripLevel: true,
      sampleCount: true,
      numericStatsJson: true,
    },
  });

  for (const r of rows) {
    if (r.sampleCount < MIN_GRIP_BUCKET_SAMPLE_COUNT) continue;
    const stats = r.numericStatsJson as
      | {
          median?: number;
          mean?: number;
          min?: number;
          max?: number;
          p25?: number;
          p75?: number;
          iqr?: number;
          stdDev?: number;
          valueHistogram?: Record<string, number>;
          distinctValueCount?: number;
        }
      | null;
    if (!stats) continue;
    const median = typeof stats.median === "number" ? stats.median : null;
    const mean = typeof stats.mean === "number" ? stats.mean : null;
    const min = typeof stats.min === "number" ? stats.min : null;
    const max = typeof stats.max === "number" ? stats.max : null;
    const p25 = typeof stats.p25 === "number" ? stats.p25 : null;
    const p75 = typeof stats.p75 === "number" ? stats.p75 : null;
    const iqr =
      typeof stats.iqr === "number"
        ? stats.iqr
        : p25 != null && p75 != null
          ? p75 - p25
          : null;
    const stdDev = typeof stats.stdDev === "number" ? stats.stdDev : null;
    if (
      median == null
      || mean == null
      || min == null
      || max == null
      || p25 == null
      || p75 == null
      || iqr == null
      || stdDev == null
    ) {
      continue;
    }

    // Histogram / topValues are optional: rows built before Phase 1 won't have them, handle as empty.
    const valueHistogram: Record<string, number> = {};
    if (stats.valueHistogram && typeof stats.valueHistogram === "object") {
      for (const [k, v] of Object.entries(stats.valueHistogram)) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0) valueHistogram[k] = v;
      }
    }
    const distinctValueCount =
      typeof stats.distinctValueCount === "number" && Number.isFinite(stats.distinctValueCount)
        ? stats.distinctValueCount
        : Object.keys(valueHistogram).filter((k) => k !== "__other").length;

    const topValues: BucketTopValueEntry[] = [];
    const histEntries = Object.entries(valueHistogram).filter(([k]) => k !== "__other");
    histEntries.sort((a, b) => b[1] - a[1]);
    for (const [k, c] of histEntries.slice(0, 5)) {
      const num = Number(k);
      if (!Number.isFinite(num)) continue;
      topValues.push({ value: num, count: c, frequency: c / r.sampleCount });
    }

    let perParam = out.get(r.parameterKey);
    if (!perParam) {
      perParam = {};
      out.set(r.parameterKey, perParam);
    }
    perParam[r.gripLevel as GripBucket] = {
      sampleCount: r.sampleCount,
      median,
      mean,
      min,
      max,
      p25,
      p75,
      iqr,
      stdDev,
      topValues,
      distinctValueCount,
      valueHistogram,
    };
  }

  return out;
}

export type CommunityBucketSummary = {
  gripLevel: GripBucket;
  sampleDocumentCount: number | null;
};

/**
 * Approximate document count per grip bucket for a `(template, surface)` pair, inferred as the
 * maximum `sampleCount` seen across that bucket's parameter rows. Useful for UI headers.
 */
export async function summarizeCommunityBuckets(
  setupSheetTemplate: string,
  trackSurface: string
): Promise<CommunityBucketSummary[]> {
  if (!setupSheetTemplate || !trackSurface) return [];
  const rows = await prisma.communitySetupParameterAggregation.findMany({
    where: { setupSheetTemplate, trackSurface },
    select: { gripLevel: true, sampleCount: true },
  });
  const maxByGrip = new Map<string, number>();
  for (const r of rows) {
    const prev = maxByGrip.get(r.gripLevel) ?? 0;
    if (r.sampleCount > prev) maxByGrip.set(r.gripLevel, r.sampleCount);
  }
  const out: CommunityBucketSummary[] = [];
  for (const [gl, n] of maxByGrip) {
    out.push({ gripLevel: gl as GripBucket, sampleDocumentCount: n });
  }
  return out;
}

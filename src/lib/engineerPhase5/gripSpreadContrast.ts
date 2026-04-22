import {
  MIN_GRIP_BUCKET_SAMPLE_COUNT,
  type GripTrendBucketStats,
} from "@/lib/setupAggregations/loadCommunityAggregations";
import type { GripBucket } from "@/lib/setupAggregations/gripBuckets";
import { getMinMeaningfulDelta } from "@/lib/setupAggregations/trendMinimumDeltas";

/** Subset of `GripTrendSignal` — avoids circular import from setupSpreadForEngineer. */
export type MedianTrendSignalForSpread = null | { magnitude: "flat" | "slight" | "material" };

const SPREAD_IQR_RATIO_SLIGHT = 1.4;
const SPREAD_IQR_RATIO_MATERIAL = 2.0;
const SKEW_MEAN_MEDIAN_THRESHOLD = 0.35;
const IQR_EPS = 1e-9;

/**
 * Reuse the same endpoint ordering as `computeGripTrendSignal` so spread contrast
 * lines up with median trend endpoints.
 */
function pickSpreadEndpoints(
  trend: Partial<Record<GripBucket, GripTrendBucketStats>>
): [GripBucket, GripBucket] | null {
  const hasLow = trend.low != null;
  const hasMed = trend.medium != null;
  const hasHigh = trend.high != null;
  if (hasLow && hasHigh) return ["low", "high"];
  if (hasLow && hasMed) return ["low", "medium"];
  if (hasMed && hasHigh) return ["medium", "high"];
  return null;
}

function meanMedianSkew(s: GripTrendBucketStats): number {
  return Math.abs(s.mean - s.median) / Math.max(s.iqr, IQR_EPS);
}

export type GripSpreadContrastMagnitude = "slight" | "material";

/**
 * When median shift across grip is small (or gripTrendSignal says "flat" on median) but
 * IQR differs materially between the same two endpoints, surface that for the Engineer.
 */
export type GripSpreadContrast = {
  endpoints: [GripBucket, GripBucket];
  /** max(IQR) / max(min(IQR), floor) between the two endpoint buckets. */
  iqrRatio: number;
  /** Which of the two endpoint grip buckets has the larger IQR. */
  widerIn: GripBucket;
  /** IQR in each endpoint bucket (only these two keys are set). */
  iqrByEndpoint: Record<GripBucket, number | undefined>;
  magnitude: GripSpreadContrastMagnitude;
  /** Set when |mean−median|/IQR is large in one endpoint — which bucket, for skew vs median talk. */
  skewNote: string | null;
};

/**
 * @param parameterKey - for per-parameter min meaningful delta on median
 * @param trend - per-grip stats (at least two grip-specific buckets, same as `gripTrend` on the row)
 * @param signal - from `computeGripTrendSignal` when available; if null, median flatness uses |Δmedian| < minMeaningfulDelta only
 */
export function computeGripSpreadContrast(
  parameterKey: string,
  trend: Partial<Record<GripBucket, GripTrendBucketStats>>,
  signal: MedianTrendSignalForSpread
): GripSpreadContrast | null {
  const endpoints = pickSpreadEndpoints(trend);
  if (!endpoints) return null;
  const [a, b] = endpoints;
  const sA = trend[a]!;
  const sB = trend[b]!;

  if (sA.sampleCount < MIN_GRIP_BUCKET_SAMPLE_COUNT || sB.sampleCount < MIN_GRIP_BUCKET_SAMPLE_COUNT) {
    return null;
  }

  const mmd = getMinMeaningfulDelta(parameterKey);
  const dMed = Math.abs(sB.median - sA.median);
  const medianFlatByDelta = dMed < mmd;
  const medianFlatBySignal = signal != null && signal.magnitude === "flat";
  if (!medianFlatByDelta && !medianFlatBySignal) {
    return null;
  }

  const iqrA = sA.iqr;
  const iqrB = sB.iqr;
  const medianMag = Math.max(Math.abs(sA.median), Math.abs(sB.median));
  const scaleFloor = Math.max(IQR_EPS, medianMag * 0.01);
  const iqrMin = Math.min(iqrA, iqrB);
  const iqrMax = Math.max(iqrA, iqrB);
  if (iqrMax < IQR_EPS) return null;
  const ratio = iqrMax / Math.max(iqrMin, scaleFloor);
  if (ratio < SPREAD_IQR_RATIO_SLIGHT) {
    return null;
  }
  const widerIn = iqrA >= iqrB ? a : b;
  const magnitude: GripSpreadContrastMagnitude =
    ratio >= SPREAD_IQR_RATIO_MATERIAL ? "material" : "slight";

  let skewNote: string | null = null;
  const skA = meanMedianSkew(sA);
  const skB = meanMedianSkew(sB);
  if (skA > SKEW_MEAN_MEDIAN_THRESHOLD || skB > SKEW_MEAN_MEDIAN_THRESHOLD) {
    skewNote = skA >= skB ? `${a}_mean_median_mismatch` : `${b}_mean_median_mismatch`;
  }

  return {
    endpoints: [a, b],
    iqrRatio: ratio,
    widerIn,
    iqrByEndpoint: { [a]: iqrA, [b]: iqrB } as Record<GripBucket, number | undefined>,
    magnitude,
    skewNote,
  };
}

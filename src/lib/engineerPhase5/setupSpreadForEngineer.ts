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
  loadCommunityAggregationsMergedSurfaces,
  loadCommunityNumericGripTrendsForBucket,
  loadCommunityNumericGripTrendsMergedSurfaces,
  type BucketTopValueEntry,
  type GripTrendBucketStats,
} from "@/lib/setupAggregations/loadCommunityAggregations";
import { getMinMeaningfulDelta } from "@/lib/setupAggregations/trendMinimumDeltas";

const MAX_PARAMS = 45;

/**
 * Trend-score thresholds: |delta across grip| divided by the larger of the two endpoint IQRs.
 * We pick low→high when both exist, else whichever adjacent pair is available (low→medium or medium→high).
 *
 * < 0.25 IQR → `flat` (not worth calling a trend).
 * 0.25..0.75 IQR → `slight` (detectable but inside normal within-bucket variation).
 * >= 0.75 IQR → `material` (clear shift relative to spread).
 */
const TREND_SCORE_FLAT_MAX = 0.25;
const TREND_SCORE_SLIGHT_MAX = 0.75;

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
  // Phase 1 extensions — optional so rows built before Phase 1 still parse.
  const valueHistogram: Record<string, number> = {};
  if (o.valueHistogram && typeof o.valueHistogram === "object" && !Array.isArray(o.valueHistogram)) {
    for (const [k, v] of Object.entries(o.valueHistogram as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) valueHistogram[k] = v;
    }
  }
  const distinctValueCount =
    typeof o.distinctValueCount === "number" && Number.isFinite(o.distinctValueCount)
      ? (o.distinctValueCount as number)
      : Object.keys(valueHistogram).filter((k) => k !== "__other").length;
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
    valueHistogram,
    distinctValueCount,
  };
}

/** Derive top-K exact-value entries from a `valueHistogram`, skipping the `__other` lump bucket. */
function topValuesFromHistogram(
  histogram: Record<string, number>,
  sampleCount: number,
  k: number
): BucketTopValueEntry[] {
  const entries = Object.entries(histogram).filter(([key]) => key !== "__other");
  entries.sort((a, b) => b[1] - a[1]);
  const out: BucketTopValueEntry[] = [];
  for (const [key, count] of entries.slice(0, k)) {
    const value = Number(key);
    if (!Number.isFinite(value)) continue;
    out.push({
      value,
      count,
      frequency: sampleCount > 0 ? count / sampleCount : 0,
    });
  }
  return out;
}

/**
 * Cliff's delta between two value histograms (capped frequency maps).
 *
 * Returns a value in [-1, +1]:
 *  - `d > 0`: values in `histHigh` tend to be larger than values in `histLow`.
 *  - `d < 0`: values in `histHigh` tend to be smaller than values in `histLow`.
 *  - `|d|` magnitude maps to effect size (Romano et al.): < 0.147 negligible, < 0.33 small,
 *    < 0.474 medium, ≥ 0.474 large.
 *
 * Ignores the `__other` lump bucket — effect size is slightly conservative when many samples
 * were lumped (acceptable since we only lump when distinctCount > NUMERIC_HISTOGRAM_MAX_BUCKETS).
 */
function cliffsDeltaFromHistograms(
  histLow: Record<string, number>,
  histHigh: Record<string, number>
): number | null {
  const lowEntries: Array<[number, number]> = [];
  const highEntries: Array<[number, number]> = [];
  for (const [k, v] of Object.entries(histLow)) {
    if (k === "__other") continue;
    const num = Number(k);
    if (!Number.isFinite(num) || !Number.isFinite(v) || v <= 0) continue;
    lowEntries.push([num, v]);
  }
  for (const [k, v] of Object.entries(histHigh)) {
    if (k === "__other") continue;
    const num = Number(k);
    if (!Number.isFinite(num) || !Number.isFinite(v) || v <= 0) continue;
    highEntries.push([num, v]);
  }
  const nLow = lowEntries.reduce((s, [, c]) => s + c, 0);
  const nHigh = highEntries.reduce((s, [, c]) => s + c, 0);
  if (nLow === 0 || nHigh === 0) return null;

  let greater = 0;
  let less = 0;
  for (const [vH, cH] of highEntries) {
    for (const [vL, cL] of lowEntries) {
      if (vH > vL) greater += cH * cL;
      else if (vH < vL) less += cH * cL;
    }
  }
  return (greater - less) / (nLow * nHigh);
}

export type CliffsInterpretation = "negligible" | "small" | "medium" | "large";

function cliffsInterpretation(d: number): CliffsInterpretation {
  const abs = Math.abs(d);
  if (abs < 0.147) return "negligible";
  if (abs < 0.33) return "small";
  if (abs < 0.474) return "medium";
  return "large";
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

/**
 * Pick the best endpoint pair from the available grip buckets: prefer `low↔high`, then `low↔medium`,
 * then `medium↔high`. Returns null when fewer than two grip-specific buckets are available
 * (the `any` bucket never participates — it's a pooled summary, not a grip level).
 */
function pickTrendEndpoints(
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

function computeGripTrendSignal(
  parameterKey: string,
  trend: Partial<Record<GripBucket, GripTrendBucketStats>>
): GripTrendSignal | null {
  const endpoints = pickTrendEndpoints(trend);
  if (!endpoints) return null;
  const [lo, hi] = endpoints;
  const loStats = trend[lo]!;
  const hiStats = trend[hi]!;
  const delta = hiStats.median - loStats.median;

  // IQR-ratio score (fallback path when no histogram). Floored to avoid blow-up on tight buckets.
  const rawScale = Math.max(loStats.iqr, hiStats.iqr);
  const medianMag = Math.max(Math.abs(loStats.median), Math.abs(hiStats.median));
  const scaleFloor = Math.max(1e-6, medianMag * 0.01);
  const scale = Math.max(rawScale, scaleFloor);
  const score = delta / scale;

  // Cliff's delta — preferred non-parametric effect size when histograms are present.
  const hasHistograms =
    Object.keys(loStats.valueHistogram).length > 0 && Object.keys(hiStats.valueHistogram).length > 0;
  const cliffsDelta = hasHistograms
    ? cliffsDeltaFromHistograms(loStats.valueHistogram, hiStats.valueHistogram)
    : null;
  const cliffsInterp = cliffsDelta != null ? cliffsInterpretation(cliffsDelta) : null;

  // Quartile-disjoint: middle-50% of one bucket fully above/below the other's middle-50%.
  const quartilesDisjoint =
    loStats.p75 < hiStats.p25 || hiStats.p75 < loStats.p25;

  // Domain-aware minimum meaningful delta (e.g. 1000 cSt for diff_oil).
  const minMeaningfulDelta = getMinMeaningfulDelta(parameterKey);
  const meetsMinMeaningfulDelta = Math.abs(delta) >= minMeaningfulDelta;

  // Magnitude fusion:
  //   * Hard gate: if |delta| < minMeaningfulDelta → "flat" regardless of effect size.
  //   * Preferred path: map Cliff's delta interpretation → magnitude (negligible→flat, small/medium→slight, large→material).
  //   * Bump: if quartilesDisjoint is true, promote one step (flat→slight, slight→material). Cheap way to honour
  //     the strong "middle-50% don't overlap" signal even when Cliff's delta lands mid-range.
  //   * Fallback when no histograms: use the existing IQR-ratio bands.
  let magnitude: GripTrendMagnitude;
  if (!meetsMinMeaningfulDelta) {
    magnitude = "flat";
  } else if (cliffsInterp) {
    const base: GripTrendMagnitude =
      cliffsInterp === "negligible"
        ? "flat"
        : cliffsInterp === "small" || cliffsInterp === "medium"
          ? "slight"
          : "material";
    if (quartilesDisjoint && base === "flat") magnitude = "slight";
    else if (quartilesDisjoint && base === "slight") magnitude = "material";
    else magnitude = base;
  } else {
    // Legacy IQR-ratio fallback (pre-Phase-1 rows).
    const abs = Math.abs(score);
    magnitude =
      abs < TREND_SCORE_FLAT_MAX
        ? "flat"
        : abs < TREND_SCORE_SLIGHT_MAX
          ? "slight"
          : "material";
  }

  const direction: GripTrendDirection =
    magnitude === "flat" ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat";

  // Monotonicity only meaningful when all three grip buckets are present.
  let monotonic: boolean | null = null;
  if (trend.low != null && trend.medium != null && trend.high != null) {
    const a = trend.low.median;
    const b = trend.medium.median;
    const c = trend.high.median;
    monotonic = (a <= b && b <= c) || (a >= b && b >= c);
  }

  return {
    endpoints,
    delta,
    scale,
    score,
    cliffsDelta,
    cliffsInterpretation: cliffsInterp,
    quartilesDisjoint,
    minMeaningfulDelta,
    meetsMinMeaningfulDelta,
    magnitude,
    direction,
    monotonic,
  };
}

/**
 * Categorical verdict summarising how the parameter's median shifts with grip, relative to the
 * bucket IQRs. Derived deterministically from `gripTrend` (see `computeGripTrendSignal`).
 */
export type GripTrendMagnitude = "flat" | "slight" | "material";
export type GripTrendDirection = "up" | "down" | "flat";

export type GripTrendSignal = {
  /** Which two buckets the score compares: e.g. `["low","high"]`, `["low","medium"]`, `["medium","high"]`. */
  endpoints: [GripBucket, GripBucket];
  /** `median(endpointHigh) − median(endpointLow)` in native parameter units (e.g. mm, °, cSt). */
  delta: number;
  /** Denominator used for the IQR-ratio score: `max(iqr_endpointLow, iqr_endpointHigh)` with a tiny floor. */
  scale: number;
  /** `delta / scale`. Signed. Positive = parameter rises from endpointLow to endpointHigh. */
  score: number;
  /**
   * Non-parametric effect size (Cliff's delta) between the two endpoint buckets. `null` when
   * histograms are unavailable (row built before Phase 1). Signed: positive = high-bucket values
   * dominate low-bucket values. `|d|` interpretation: < 0.147 negligible, < 0.33 small,
   * < 0.474 medium, ≥ 0.474 large.
   */
  cliffsDelta: number | null;
  /** Categorical verdict from `|cliffsDelta|`; `null` when `cliffsDelta` is `null`. */
  cliffsInterpretation: CliffsInterpretation | null;
  /**
   * True when the endpoint buckets' middle-50% ranges don't overlap: either `p75_low < p25_high`
   * or `p75_high < p25_low`. A very strong, intuitive "most of one bucket runs above/below most of
   * the other" signal.
   */
  quartilesDisjoint: boolean;
  /** Per-parameter minimum meaningful delta used as a gate. See `trendMinimumDeltas.ts`. */
  minMeaningfulDelta: number;
  /** `|delta| >= minMeaningfulDelta`. When false, the trend is too small to matter regardless of effect size. */
  meetsMinMeaningfulDelta: boolean;
  magnitude: GripTrendMagnitude;
  /** `up` when parameter rises with grip (from endpointLow to endpointHigh), `down` when it falls, `flat` when magnitude === flat. */
  direction: GripTrendDirection;
  /** True when all three buckets present and their medians are monotonically non-decreasing or non-increasing. */
  monotonic: boolean | null;
};

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
    /** Arithmetic mean of the bucket — useful alongside median to spot skew. */
    mean: number;
    /** Interquartile range (p75 − p25) — the robust scale for this parameter. */
    iqr: number;
    /**
     * Top-5 most common exact values in the bucket (modal values), with counts and frequencies
     * (as fraction of `sampleCount`). Empty when the aggregation row predates Phase 1 (no
     * histogram stored). The engineer should prefer the modal value when a parameter clusters
     * tightly (e.g. one diff-oil grade dominates) rather than reporting a misleading median.
     */
    topValues: BucketTopValueEntry[];
    /** Count of distinct numeric values seen in the bucket (before the histogram cap). 0 when unknown. */
    distinctValueCount: number;
  };
  /**
   * Per-grip low/medium/high/any stats for this numeric parameter when each bucket has
   * >= MIN_GRIP_BUCKET_SAMPLE_COUNT samples. Each bucket carries {median, mean, p25, p75, iqr, stdDev,
   * min, max, sampleCount}. Independent of the primary `spread` above — used by the engineer to
   * describe "does this param trend with grip?" even when the run has no grip tag.
   * Null when the parameter isn't numeric or when no community data is loaded.
   */
  gripTrend: null | Partial<Record<GripBucket, GripTrendBucketStats>>;
  /**
   * Deterministic score/verdict that summarises `gripTrend`. Null when fewer than two grip-specific
   * buckets are available (i.e. trend cannot be judged). The engineer should lean on this
   * instead of re-deriving a magnitude from the raw bucket medians.
   */
  gripTrendSignal: GripTrendSignal | null;
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

  const communityFromSnapshotSurface = Boolean(setupSheetTemplate && trackSurface);
  const communityMergedSurfaces = Boolean(setupSheetTemplate && !trackSurface);

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
    communityFromSnapshotSurface
      ? loadCommunityAggregationsForBucket({
          setupSheetTemplate: setupSheetTemplate!,
          trackSurface: trackSurface!,
          gripLevel,
          parameterKeys: keys,
        })
      : communityMergedSurfaces
        ? loadCommunityAggregationsMergedSurfaces({
            setupSheetTemplate: setupSheetTemplate!,
            gripLevel,
            parameterKeys: keys,
          })
        : Promise.resolve(
            [] as Awaited<ReturnType<typeof loadCommunityAggregationsForBucket>>
          ),
    communityFromSnapshotSurface
      ? loadCommunityNumericGripTrendsForBucket({
          setupSheetTemplate: setupSheetTemplate!,
          trackSurface: trackSurface!,
          parameterKeys: keys,
        })
      : communityMergedSurfaces
        ? loadCommunityNumericGripTrendsMergedSurfaces({
            setupSheetTemplate: setupSheetTemplate!,
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
    const gripTrendSignal = gripTrend ? computeGripTrendSignal(key, gripTrend) : null;

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
        gripTrendSignal,
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
        gripTrendSignal,
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
        mean: stats.mean,
        iqr: stats.iqr,
        topValues: topValuesFromHistogram(stats.valueHistogram, stats.sampleCount, 5),
        distinctValueCount: stats.distinctValueCount,
      },
      gripTrend,
      gripTrendSignal,
      positionBand: bandForValue(num, stats),
    });
  }

  const communityContext: EngineerCommunityContext = {
    setupSheetTemplate,
    trackSurface: communityMergedSurfaces ? null : trackSurface,
    gripLevel,
    label: describeCommunityContext(setupSheetTemplate, trackSurface, gripLevel, communityMergedSurfaces),
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
  grip: GripBucket,
  mergedAcrossSurfaces: boolean
): string {
  if (!template) return "no template — community stats unavailable";
  if (mergedAcrossSurfaces) {
    return `${template} · asphalt + carpet merged · ${gripBucketLabel(grip)} (set track_surface on the setup sheet to lock one surface)`;
  }
  const surfaceLabel = surface ?? "unknown surface";
  return `${template} · ${surfaceLabel} · ${gripBucketLabel(grip)}`;
}

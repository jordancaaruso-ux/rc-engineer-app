import {
  MIN_COMMUNITY_AGGREGATION_SAMPLE_COUNT_FOR_IQR_COMPARE,
  parseNumericAggregationCompareSlice,
  type NumericAggregationCompareSlice,
} from "@/lib/setupCompare/numericAggregationCompare";

/** Row shape from GET /api/setup-aggregations. */
export type SetupAggApiRow = {
  carId: string;
  parameterKey: string;
  valueType: string;
  sampleCount: number;
  numericStatsJson: unknown;
};

/** Synthetic carId used on community aggregation rows (see /api/setup-aggregations/community). */
export const COMMUNITY_AGGREGATION_PSEUDO_CAR_ID = "__community__";

/** Same parsing as Setup Comparison: numeric rows for one car → compare-slice map. */
export function buildNumericAggregationMapForCar(
  rows: SetupAggApiRow[],
  carId: string
): Map<string, NumericAggregationCompareSlice> {
  const m = new Map<string, NumericAggregationCompareSlice>();
  for (const r of rows) {
    if (r.carId !== carId || r.valueType !== "NUMERIC") continue;
    const slice = parseNumericAggregationCompareSlice(r.numericStatsJson);
    if (slice) m.set(r.parameterKey, slice);
  }
  return m;
}

/**
 * Community rows (all eligible setups in a template/surface/grip bucket) → compare-slice map.
 * Applies the stricter community sample-count floor so low-n parameter keys don't end up in
 * the compare map (they harmlessly fall through to the non-IQR path in `compareSetupField`).
 */
export function buildNumericAggregationMapFromCommunity(
  rows: SetupAggApiRow[]
): Map<string, NumericAggregationCompareSlice> {
  const m = new Map<string, NumericAggregationCompareSlice>();
  for (const r of rows) {
    if (r.carId !== COMMUNITY_AGGREGATION_PSEUDO_CAR_ID || r.valueType !== "NUMERIC") continue;
    const slice = parseNumericAggregationCompareSlice(r.numericStatsJson);
    if (!slice) continue;
    if (slice.sampleCount < MIN_COMMUNITY_AGGREGATION_SAMPLE_COUNT_FOR_IQR_COMPARE) continue;
    m.set(r.parameterKey, slice);
  }
  return m;
}

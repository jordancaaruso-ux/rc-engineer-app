import {
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

/**
 * Temporary diagnostics: why IQR-scored numeric fields fall back to `unknown`.
 * Remove when root cause is fixed (see Setup comparison ?compareDebug=1).
 */

import type { FieldCompareResult } from "@/lib/setupCompare/types";
import {
  getNumericGradientConfig,
  normalizeNumericForGradientCompare,
  numericGradientEqual,
  NUMERIC_GRADIENT_V1_KEYS,
} from "@/lib/setupCompare/numericGradientConfig";
import {
  MIN_AGGREGATION_SAMPLE_COUNT_FOR_IQR_COMPARE,
  parseNumericAggregationCompareSlice,
  type NumericAggregationCompareSlice,
} from "@/lib/setupCompare/numericAggregationCompare";

export type AggregationRowSummary = {
  parameterKey: string;
  valueType: string;
  sampleCount: number;
};

export type NumericCompareUnknownDiagnostic = {
  uiKey: string;
  compareSeverityReason: string;
  matchedAggregationKey: string | null;
  /** Rows in API response for this car with this exact parameterKey (usually 0 or 1). */
  aggregationRowsForExactKey: number;
  /** valueType from first matching row, if any. */
  aggregationValueType: string | null;
  rawJsonSampleCount: number | null;
  inClientCompareMap: boolean;
  rawJsonParsesToPercentileSlice: boolean;
  effectiveSampleCount: number | null;
  p25: number | null;
  p75: number | null;
  iqr: number | null;
  deltaAbs: number | null;
  normalizedA: string;
  normalizedB: string;
  /** Single machine-readable bucket for aggregation. */
  primaryReason: string;
};

function readRawSampleCount(json: unknown): number | null {
  if (json == null || typeof json !== "object") return null;
  const n = Number((json as Record<string, unknown>).sampleCount);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

/**
 * Summarize API rows for one car (all value types) for key inventory + type mismatches.
 */
export function summarizeAggregationRowsForCar(
  rows: Array<{ carId: string; parameterKey: string; valueType: string; sampleCount: number }>,
  carId: string
): AggregationRowSummary[] {
  return rows
    .filter((r) => r.carId === carId)
    .map((r) => ({
      parameterKey: r.parameterKey,
      valueType: r.valueType,
      sampleCount: r.sampleCount,
    }))
    .sort((a, b) => a.parameterKey.localeCompare(b.parameterKey));
}

export function buildRawNumericStatsJsonMap(
  rows: Array<{ carId: string; parameterKey: string; valueType: string; numericStatsJson: unknown }>,
  carId: string
): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const r of rows) {
    if (r.carId !== carId || r.valueType !== "NUMERIC") continue;
    m.set(r.parameterKey, r.numericStatsJson);
  }
  return m;
}

/**
 * Keys the comparison pipeline attempts to IQR-score (static list).
 */
export function listNumericGradientCompareKeys(): readonly string[] {
  return NUMERIC_GRADIENT_V1_KEYS;
}

function rowsForKey(
  summaries: AggregationRowSummary[],
  key: string
): AggregationRowSummary[] {
  return summaries.filter((s) => s.parameterKey === key);
}

/**
 * Explain `unknown` for a field in NUMERIC_GRADIENT_V1_KEYS using compare result + snapshots + aggregation API shape.
 */
export function diagnoseNumericCompareUnknown(
  uiKey: string,
  compareResult: FieldCompareResult,
  valueA: unknown,
  valueB: unknown,
  numericAggregationByKey: ReadonlyMap<string, NumericAggregationCompareSlice> | null | undefined,
  rawNumericStatsJsonByKey: ReadonlyMap<string, unknown> | null | undefined,
  aggregationSummariesForCar: AggregationRowSummary[],
  aggregationCarId: string | null
): NumericCompareUnknownDiagnostic | null {
  const grad = getNumericGradientConfig(uiKey);
  if (!grad || compareResult.severity !== "unknown") return null;

  const na = normalizeNumericForGradientCompare(uiKey, grad.normalization, valueA);
  const nb = normalizeNumericForGradientCompare(uiKey, grad.normalization, valueB);

  const base: Omit<NumericCompareUnknownDiagnostic, "primaryReason" | "deltaAbs"> & {
    deltaAbs: number | null;
  } = {
    uiKey,
    compareSeverityReason: compareResult.severityReason,
    matchedAggregationKey: null,
    aggregationRowsForExactKey: 0,
    aggregationValueType: null,
    rawJsonSampleCount: null,
    inClientCompareMap: Boolean(numericAggregationByKey?.has(uiKey)),
    rawJsonParsesToPercentileSlice: false,
    effectiveSampleCount: null,
    p25: null,
    p75: null,
    iqr: null,
    deltaAbs: null,
    normalizedA: compareResult.normalizedA,
    normalizedB: compareResult.normalizedB,
  };

  const unparsableReason =
    compareResult.severityReason.includes("unparsable") ||
    compareResult.severityReason.includes("non-numeric");
  if (unparsableReason || na == null || nb == null) {
    return {
      ...base,
      matchedAggregationKey: null,
      primaryReason:
        na == null || nb == null
          ? "compare_unparsable_numeric_or_geometry_normalization_failed"
          : "compare_unknown_non_numeric_path",
      deltaAbs: na != null && nb != null ? Math.abs(na - nb) : null,
    };
  }

  if (numericGradientEqual(na, nb, grad)) {
    return null;
  }

  const deltaAbs = Math.abs(na - nb);
  base.deltaAbs = deltaAbs;

  if (!aggregationCarId) {
    return {
      ...base,
      primaryReason: "no_aggregation_car_context_runs_not_selected_or_no_car_id",
      matchedAggregationKey: null,
    };
  }

  const keyRows = rowsForKey(aggregationSummariesForCar, uiKey);
  base.aggregationRowsForExactKey = keyRows.length;

  if (keyRows.length === 0) {
    return {
      ...base,
      matchedAggregationKey: null,
      primaryReason: "no_aggregation_db_row_for_exact_ui_key",
    };
  }

  const row0 = keyRows[0]!;
  base.aggregationValueType = row0.valueType;
  base.matchedAggregationKey = uiKey;

  if (row0.valueType !== "NUMERIC") {
    return {
      ...base,
      primaryReason: `aggregation_row_exists_value_type_${row0.valueType}_not_NUMERIC_rebuild_bucket_not_all_numeric`,
    };
  }

  const rawJson = rawNumericStatsJsonByKey?.get(uiKey);
  base.rawJsonSampleCount = readRawSampleCount(rawJson);

  if (!rawNumericStatsJsonByKey?.has(uiKey)) {
    return {
      ...base,
      primaryReason:
        "NUMERIC_row_in_api_but_missing_from_client_raw_numeric_map_internal_bug_or_filter_mismatch",
    };
  }

  const reparse = parseNumericAggregationCompareSlice(rawJson);
  base.rawJsonParsesToPercentileSlice = reparse != null;
  if (!reparse) {
    return {
      ...base,
      matchedAggregationKey: uiKey,
      primaryReason:
        "numeric_stats_json_missing_or_invalid_percentiles_or_sample_count_parse_failed",
    };
  }

  base.effectiveSampleCount = reparse.sampleCount;
  base.p25 = reparse.p25;
  base.p75 = reparse.p75;
  base.iqr = reparse.iqr;

  if (reparse.sampleCount < MIN_AGGREGATION_SAMPLE_COUNT_FOR_IQR_COMPARE) {
    return {
      ...base,
      matchedAggregationKey: uiKey,
      primaryReason: `sample_count_${reparse.sampleCount}_below_threshold_${MIN_AGGREGATION_SAMPLE_COUNT_FOR_IQR_COMPARE}`,
    };
  }

  if (!Number.isFinite(reparse.iqr) || reparse.iqr <= 0) {
    return {
      ...base,
      matchedAggregationKey: uiKey,
      primaryReason: "iqr_zero_or_non_positive_identical_or_near_identical_distribution",
    };
  }

  if (!numericAggregationByKey?.has(uiKey)) {
    return {
      ...base,
      matchedAggregationKey: uiKey,
      primaryReason:
        "percentile_parse_ok_but_key_missing_from_client_compare_map_should_not_happen",
    };
  }

  return {
    ...base,
    matchedAggregationKey: uiKey,
    primaryReason: "unexpected_compare_marked_unknown_despite_valid_aggregation_slice",
  };
}

export function collectNumericUnknownDiagnostics(args: {
  compareMap: Map<string, FieldCompareResult>;
  dataA: Record<string, unknown>;
  dataB: Record<string, unknown>;
  numericAggregationByKey: ReadonlyMap<string, NumericAggregationCompareSlice> | null | undefined;
  rawNumericStatsJsonByKey: ReadonlyMap<string, unknown> | null | undefined;
  aggregationSummariesForCar: AggregationRowSummary[];
  aggregationCarId: string | null;
}): NumericCompareUnknownDiagnostic[] {
  const out: NumericCompareUnknownDiagnostic[] = [];
  for (const [key, result] of args.compareMap) {
    if (result.severity !== "unknown") continue;
    if (!getNumericGradientConfig(key)) continue;
    const row = diagnoseNumericCompareUnknown(
      key,
      result,
      args.dataA[key],
      args.dataB[key],
      args.numericAggregationByKey,
      args.rawNumericStatsJsonByKey,
      args.aggregationSummariesForCar,
      args.aggregationCarId
    );
    if (row) out.push(row);
  }
  out.sort((a, b) => a.uiKey.localeCompare(b.uiKey));
  return out;
}

export function tallyPrimaryReasons(rows: NumericCompareUnknownDiagnostic[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.primaryReason, (m.get(r.primaryReason) ?? 0) + 1);
  }
  return m;
}

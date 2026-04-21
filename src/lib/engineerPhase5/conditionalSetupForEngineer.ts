import "server-only";

import { SetupAggregationScopeType, SetupAggregationValueType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { carIdsSharingSetupTemplate } from "@/lib/carSetupScope";
import type { EngineerSetupSpreadRow } from "@/lib/engineerPhase5/setupSpreadForEngineer";
import type { NumericStats } from "@/lib/setupAggregations/numericStats";

const MIN_CONDITION_SAMPLES = 3;

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

export type ConditionalSetupEmpiricalRow = {
  parameterKey: string;
  overallMedian: number;
  conditionMedian: number;
  delta: number;
  overallSampleCount: number;
  conditionSampleCount: number;
};

export type ConditionalSetupEmpiricalV1 = {
  conditionSignature: string;
  minSamplesRequired: number;
  /** True when at least one numeric row met the sample threshold */
  hasEnoughData: boolean;
  note: string;
  rows: ConditionalSetupEmpiricalRow[];
};

function bestByKeyFromAgg<
  T extends { parameterKey: string; sampleCount: number; valueType: SetupAggregationValueType; numericStatsJson: unknown }
>(rows: T[]): Map<string, T> {
  const bestByKey = new Map<string, T>();
  for (const r of rows) {
    const prev = bestByKey.get(r.parameterKey);
    if (!prev || r.sampleCount > prev.sampleCount) {
      bestByKey.set(r.parameterKey, r);
    }
  }
  return bestByKey;
}

/**
 * For the anchored run's track grip/layout signature, compare per-parameter medians from runs in that bucket
 * vs overall `CAR_PARAMETER` medians (same sibling-template scope as setupVsSpread).
 */
export async function buildConditionalSetupEmpiricalV1(params: {
  userId: string;
  carId: string | null;
  conditionSignature: string;
  spreadRows: EngineerSetupSpreadRow[];
}): Promise<ConditionalSetupEmpiricalV1 | null> {
  if (!params.carId?.trim()) return null;

  const siblingCarIds = await carIdsSharingSetupTemplate(params.userId, params.carId);
  const keys = params.spreadRows
    .filter((r) => r.spread != null && r.valueType === SetupAggregationValueType.NUMERIC)
    .map((r) => r.parameterKey);
  if (keys.length === 0) {
    return {
      conditionSignature: params.conditionSignature,
      minSamplesRequired: MIN_CONDITION_SAMPLES,
      hasEnoughData: false,
      note: "No numeric tuning parameters with overall spread data — conditional comparison skipped.",
      rows: [],
    };
  }

  const [overallAgg, condAgg] = await Promise.all([
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
    prisma.setupParameterAggregation.findMany({
      where: {
        carId: { in: siblingCarIds },
        scopeType: SetupAggregationScopeType.CAR_PARAMETER_CONDITION,
        scopeKey: params.conditionSignature,
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
  ]);

  const bestOverall = bestByKeyFromAgg(overallAgg);
  const bestCond = bestByKeyFromAgg(condAgg);

  const outRows: ConditionalSetupEmpiricalRow[] = [];
  for (const key of keys) {
    const o = bestOverall.get(key);
    const c = bestCond.get(key);
    if (!o || !c || o.valueType !== SetupAggregationValueType.NUMERIC || c.valueType !== SetupAggregationValueType.NUMERIC) {
      continue;
    }
    if (c.sampleCount < MIN_CONDITION_SAMPLES) continue;
    const oStats = parseNumericStats(o.numericStatsJson);
    const cStats = parseNumericStats(c.numericStatsJson);
    if (!oStats || !cStats) continue;
    outRows.push({
      parameterKey: key,
      overallMedian: oStats.median,
      conditionMedian: cStats.median,
      delta: cStats.median - oStats.median,
      overallSampleCount: oStats.sampleCount,
      conditionSampleCount: cStats.sampleCount,
    });
  }

  outRows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const hasEnoughData = outRows.length > 0;
  const note = hasEnoughData
    ? `Empirical medians from your logged runs whose track matches this grip/layout signature (${params.conditionSignature}), compared to your overall garage medians for the same setup template. Per-parameter run counts may differ; conditionSampleCount is the bucket depth for that parameter.`
    : `Not enough runs in this track-condition bucket (need at least ${MIN_CONDITION_SAMPLES} samples per parameter for numeric medians). Tag tracks consistently and log more runs to populate conditional stats.`;

  return {
    conditionSignature: params.conditionSignature,
    minSamplesRequired: MIN_CONDITION_SAMPLES,
    hasEnoughData,
    note,
    rows: outRows.slice(0, 35),
  };
}

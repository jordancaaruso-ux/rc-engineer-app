import type {
  TireLifeFocusedCompareNudgeV1,
  TireLifeStepAggV1,
} from "@/lib/engineerPhase5/tireLifePriors/tireLifePriorsTypes";

function sumChainMedians(
  steps: TireLifeStepAggV1[],
  fromRun: number,
  toRun: number,
  metric: "best" | "avg5" | "avg10" | "avg15"
): { sum: number | null; withData: number; total: number } {
  if (toRun <= fromRun) return { sum: null, withData: 0, total: 0 };
  let total = 0;
  let withData = 0;
  let sum = 0;
  for (let k = fromRun; k < toRun; k++) {
    total++;
    const row = steps.find((s) => s.fromTireRun === k && s.toTireRun === k + 1);
    let med: number | null = null;
    if (row) {
      if (metric === "best") med = row.bestLapDeltaMedianSeconds;
      else if (metric === "avg5") med = row.avgTop5DeltaMedianSeconds;
      else if (metric === "avg10") med = row.avgTop10DeltaMedianSeconds;
      else med = row.avgTop15DeltaMedianSeconds;
    }
    if (med != null && Number.isFinite(med)) {
      sum += med;
      withData++;
    }
  }
  if (withData === 0) return { sum: null, withData: 0, total };
  return { sum, withData, total };
}

/**
 * Sum of median pace deltas along consecutive tire-run indices (compare → primary) using pooled k→k+1 steps.
 * Same semantics as historical **focusedCompareNudge** in tire-life priors.
 */
export function buildExpectedWearChainNudge(
  stepsAllTracks: TireLifeStepAggV1[],
  compareTn: number,
  primaryTn: number
): TireLifeFocusedCompareNudgeV1 | null {
  if (primaryTn <= compareTn) return null;
  const totalSteps = primaryTn - compareTn;
  const b = sumChainMedians(stepsAllTracks, compareTn, primaryTn, "best");
  const f5 = sumChainMedians(stepsAllTracks, compareTn, primaryTn, "avg5");
  const f10 = sumChainMedians(stepsAllTracks, compareTn, primaryTn, "avg10");
  const f15 = sumChainMedians(stepsAllTracks, compareTn, primaryTn, "avg15");
  return {
    compareTireRun: compareTn,
    primaryTireRun: primaryTn,
    totalSteps,
    stepsWithDataBest: b.withData,
    stepsWithDataAvgTop5: f5.withData,
    stepsWithDataAvgTop10: f10.withData,
    stepsWithDataAvgTop15: f15.withData,
    summedBestDeltaMedianSeconds: b.sum,
    summedAvgTop5DeltaMedianSeconds: f5.sum,
    summedAvgTop10DeltaMedianSeconds: f10.sum,
    summedAvgTop15DeltaMedianSeconds: f15.sum,
  };
}

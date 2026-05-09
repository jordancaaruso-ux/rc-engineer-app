import assert from "node:assert/strict";
import { buildRunPacingContextV1 } from "@/lib/engineerPhase5/runPacingContext";
import { buildExpectedWearChainNudge } from "@/lib/engineerPhase5/tireLifePriors/tireWearChainMath";
import type { TireLifeStepAggV1 } from "@/lib/engineerPhase5/tireLifePriors/tireLifePriorsTypes";
import type { ImportedSessionFieldStatsEngineerCompactV1 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

const mockFieldStats: ImportedSessionFieldStatsEngineerCompactV1 = {
  version: 1,
  driverCount: 12,
  sessionBestBestLapSeconds: 19.0,
  sessionBestAvgTop5Seconds: 19.2,
  sessionBestAvgTop10Seconds: 19.3,
  fieldMedianBestSeconds: 19.5,
  fieldMedianAvgTop5Seconds: 19.6,
  fieldMedianAvgTop10Seconds: 19.7,
  paceVsFieldMeanAnalysis: [
    {
      metric: "avg_top_10",
      label: "Avg top 10",
      fieldMeanSeconds: 19.8,
      userSeconds: 19.9,
      gapUserMinusFieldMeanSeconds: 0.1,
      rankInField: 4,
      fieldEntrantCountForMetric: 10,
      meaningful: true,
    },
  ],
  matchedYou: null,
};

const step = (
  from: number,
  to: number,
  avg10: number | null,
  pairCount = 4
): TireLifeStepAggV1 => ({
  fromTireRun: from,
  toTireRun: to,
  pairCount,
  confidence: "high",
  bestLapDeltaMedianSeconds: 0.05,
  avgTop5DeltaMedianSeconds: 0.06,
  avgTop10DeltaMedianSeconds: avg10,
  avgTop15DeltaMedianSeconds: null,
});

void (async function main() {
  const a = buildRunPacingContextV1({
    tireSetId: "ts1",
    tireSetLabel: "Test",
    initialRunCount: 2,
    tireRunNumber: 3,
    importedSessionFieldStats: mockFieldStats,
  });
  assert.equal(a.tireWear?.effectiveWearIndex, 5);
  assert.equal(a.fieldPaceAvgTop10?.gapUserMinusFieldMeanSeconds, 0.1);
  assert.equal(a.fieldPaceAvgTop10?.rankInField, 4);

  const noSet = buildRunPacingContextV1({
    tireSetId: null,
    tireSetLabel: null,
    tireRunNumber: 1,
    importedSessionFieldStats: null,
  });
  assert.equal(noSet.tireWear, null);
  assert.equal(noSet.fieldPaceAvgTop10, null);

  const steps: TireLifeStepAggV1[] = [step(1, 2, 0.1), step(2, 3, 0.12)];
  const nudge = buildExpectedWearChainNudge(steps, 1, 3);
  assert.ok(nudge);
  assert.equal(nudge!.summedAvgTop10DeltaMedianSeconds, 0.1 + 0.12);
  assert.equal(nudge!.stepsWithDataAvgTop10, 2);

  const rev = buildExpectedWearChainNudge(steps, 3, 1);
  assert.equal(rev, null);

  const sparse = buildExpectedWearChainNudge([step(5, 6, null, 4)], 5, 6);
  assert.ok(sparse);
  assert.equal(sparse!.summedAvgTop10DeltaMedianSeconds, null);

  console.log("runPacingContext tests ok");
})();

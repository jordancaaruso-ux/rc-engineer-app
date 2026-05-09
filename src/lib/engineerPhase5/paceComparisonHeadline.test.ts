import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computePairVsFieldCrossCheckLine,
  computePaceComparisonHeadline,
} from "@/lib/engineerPhase5/paceComparisonHeadline";
import type { EngineerRunSummaryV2, ImportedSessionFieldStatsEngineerCompactV1 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

function baseSummary(over: Partial<EngineerRunSummaryV2>): EngineerRunSummaryV2 {
  return {
    version: 2,
    currentRunId: "c1",
    referenceRunId: "r1",
    referenceLabel: "Prior run",
    lapOutcome: {
      best: { current: 21.0, reference: 21.1, delta: -0.1, flag: "improved", notMeaningful: false },
      avgTop5: { current: 21.2, reference: 21.25, delta: -0.05, flag: "improved", notMeaningful: false },
      avgTop10: { current: 21.25, reference: 21.4, delta: -0.15, flag: "improved", notMeaningful: false },
      avgTop15: { current: 21.3, reference: 21.5, delta: -0.2, flag: "improved", notMeaningful: true },
      consistencyScore: { current: 90, reference: 88, delta: 2, flag: "improved", notMeaningful: false },
    },
    lapCountIncluded: { current: 12, reference: 12 },
    setupChanges: [],
    interpretation: "",
    notesUsed: { verbatimSnippet: null, role: "none" },
    importedProvenance: null,
    fieldImportSession: null,
    importedSessionFieldStats: null,
    fieldFingerprint: "",
    deepDiveOffered: false,
    softPriors: [],
    ...over,
  };
}

test("computePaceComparisonHeadline prefers avg top 10 vs reference when meaningful", () => {
  const h = computePaceComparisonHeadline(baseSummary({}));
  assert.equal(h.vsReference?.metricKey, "avg_top_10");
  assert.equal(h.vsReference?.deltaSeconds, -0.15);
});

test("computePaceComparisonHeadline falls back to avg top 5 when avg10 not meaningful", () => {
  const lo = baseSummary({}).lapOutcome;
  const h = computePaceComparisonHeadline(
    baseSummary({
      lapOutcome: {
        ...lo,
        avgTop10: { current: 21.25, reference: 21.4, delta: -0.15, flag: "improved", notMeaningful: true },
      },
    })
  );
  assert.equal(h.vsReference?.metricKey, "avg_top_5");
});

test("computePaceComparisonHeadline no reference → vsReference null", () => {
  const h = computePaceComparisonHeadline(
    baseSummary({
      referenceRunId: null,
      referenceLabel: null,
    })
  );
  assert.equal(h.vsReference, null);
});

function sampleFieldStats(
  gap10: number,
  meaningful10 = true
): ImportedSessionFieldStatsEngineerCompactV1 {
  return {
    version: 1,
    driverCount: 3,
    sessionBestBestLapSeconds: 20,
    sessionBestAvgTop5Seconds: null,
    sessionBestAvgTop10Seconds: null,
    fieldMedianBestSeconds: null,
    fieldMedianAvgTop5Seconds: null,
    fieldMedianAvgTop10Seconds: null,
    paceVsFieldMeanAnalysis: [
      {
        metric: "avg_top_5",
        label: "Avg top 5",
        fieldMeanSeconds: 21.1,
        userSeconds: 21.2,
        gapUserMinusFieldMeanSeconds: 0.05,
        rankInField: 2,
        fieldEntrantCountForMetric: 3,
        meaningful: true,
      },
      {
        metric: "avg_top_10",
        label: "Avg top 10",
        fieldMeanSeconds: 21.0,
        userSeconds: 21.25,
        gapUserMinusFieldMeanSeconds: gap10,
        rankInField: 2,
        fieldEntrantCountForMetric: 3,
        meaningful: meaningful10,
      },
    ],
    matchedYou: {
      label: "You",
      rankByBest: 1,
      bestLapSeconds: 21,
      avgTop5Seconds: 21.2,
      avgTop10Seconds: 21.25,
      gapBestToSessionBestSeconds: 0.1,
      gapAvgTop5ToSessionBestAvg5Seconds: null,
      gapAvgTop10ToSessionBestAvg10Seconds: null,
    },
  };
}

test("computePairVsFieldCrossCheckLine when pairwise faster but slower vs field (avg top 10)", () => {
  const s = baseSummary({ importedSessionFieldStats: sampleFieldStats(0.25) });
  const h = computePaceComparisonHeadline(s);
  const line = computePairVsFieldCrossCheckLine(s, h);
  assert.ok(line?.startsWith("Cross-check:"));
  assert.ok(line?.includes("faster"));
  assert.ok(line?.includes("slower"));
});

test("computePairVsFieldCrossCheckLine null when pairwise and field agree in sign", () => {
  const s = baseSummary({ importedSessionFieldStats: sampleFieldStats(-0.05) });
  const h = computePaceComparisonHeadline(s);
  assert.equal(computePairVsFieldCrossCheckLine(s, h), null);
});

test("computePairVsFieldCrossCheckLine null when ladder is best lap only", () => {
  const lo = baseSummary({}).lapOutcome;
  const s = baseSummary({
    importedSessionFieldStats: sampleFieldStats(0.5),
    lapOutcome: {
      ...lo,
      avgTop10: { current: 21.25, reference: 21.4, delta: -0.15, flag: "improved", notMeaningful: true },
      avgTop5: { current: 21.2, reference: 21.25, delta: -0.05, flag: "improved", notMeaningful: true },
    },
  });
  const h = computePaceComparisonHeadline(s);
  assert.equal(h.vsReference?.metricKey, "best");
  assert.equal(computePairVsFieldCrossCheckLine(s, h), null);
});

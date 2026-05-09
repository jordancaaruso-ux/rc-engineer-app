import assert from "node:assert/strict";
import { test } from "node:test";
import { computePaceComparisonHeadline } from "@/lib/engineerPhase5/paceComparisonHeadline";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

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

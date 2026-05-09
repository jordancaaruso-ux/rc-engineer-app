/**
 * Run: `npx tsx src/lib/engineerPhase5/buildTemplateInterpretation.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EngineerLapMetricOutcome, EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { buildTemplateInterpretation, fieldPhrase } from "@/lib/engineerPhase5/buildTemplateInterpretation";

function lapMetric(over?: Partial<EngineerLapMetricOutcome>): EngineerLapMetricOutcome {
  return {
    current: 12.5,
    reference: 12.6,
    delta: -0.1,
    flag: "flat",
    ...over,
  };
}

function baseSummary(over: Partial<EngineerRunSummaryV2> = {}): EngineerRunSummaryV2 {
  return {
    version: 2,
    currentRunId: "cur",
    referenceRunId: "ref",
    referenceLabel: "Reference label",
    lapOutcome: {
      best: lapMetric(),
      avgTop5: lapMetric(),
      avgTop10: lapMetric(),
      avgTop15: lapMetric(),
      consistencyScore: lapMetric({ current: 0.8, reference: 0.8, delta: 0 }),
    },
    lapCountIncluded: { current: 8, reference: 8 },
    setupChanges: [
      { key: "spring", label: "Front spring", before: "3.4", after: "3.6", rankReason: "test", severity: "low" },
    ],
    interpretation: "",
    notesUsed: { verbatimSnippet: null, role: "none" },
    importedProvenance: null,
    fieldImportSession: null,
    importedSessionFieldStats: null,
    fieldFingerprint: "fp",
    deepDiveOffered: false,
    softPriors: [],
    ...over,
  };
}

test("when field phrase is non-empty, it appears before setup phrase", () => {
  const summary = baseSummary({
    fieldImportSession: {
      sessionBestLapSeconds: 12.0,
      ranked: [
        {
          label: "Other",
          isPrimaryUser: false,
          rank: 1,
          bestLapSeconds: 12.0,
          gapToSessionBestSeconds: 0,
          fadeSeconds: null,
        },
        {
          label: "You",
          isPrimaryUser: true,
          rank: 2,
          bestLapSeconds: 12.5,
          gapToSessionBestSeconds: 0.5,
          fadeSeconds: 0.02,
        },
      ],
    },
  });
  assert.ok(fieldPhrase(summary).includes("Imported lap-set field"));
  const out = buildTemplateInterpretation(summary, {});
  const iField = out.indexOf("Imported lap-set field");
  const iSetup = out.indexOf("Setup differs");
  assert.ok(iField >= 0 && iSetup >= 0);
  assert.ok(iField < iSetup);
});

test("when field phrase is empty, setup still follows pace (no field block)", () => {
  const summary = baseSummary({ fieldImportSession: null });
  assert.equal(fieldPhrase(summary).trim(), "");
  const out = buildTemplateInterpretation(summary, {});
  assert.ok(out.startsWith("Compared to the reference run:"));
  assert.ok(out.includes("Setup differs"));
  assert.ok(!out.includes("Imported lap-set field"));
});

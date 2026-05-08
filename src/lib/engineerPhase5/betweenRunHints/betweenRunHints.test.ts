/**
 * Run: `npx tsx src/lib/engineerPhase5/betweenRunHints/betweenRunHints.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { buildBetweenRunHintFingerprint } from "@/lib/engineerPhase5/betweenRunHints/buildBetweenRunHintFingerprint";
import { computeBetweenRunSignals } from "@/lib/engineerPhase5/betweenRunHints/computeBetweenRunSignals";
import type { BetweenRunHintPayloadV1 } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";

function baseSummary(): EngineerRunSummaryV2 {
  return {
    version: 2,
    currentRunId: "r1",
    referenceRunId: "r0",
    referenceLabel: "prior",
    lapOutcome: {
      best: { current: 11.1, reference: 11.0, delta: 0.1, flag: "regressed" },
      avgTop5: { current: 11.2, reference: 11.15, delta: 0.05, flag: "flat" },
      avgTop10: { current: null, reference: null, delta: null, flag: "unknown", notMeaningful: true },
      avgTop15: { current: null, reference: null, delta: null, flag: "unknown", notMeaningful: true },
      consistencyScore: { current: 8, reference: 8, delta: 0, flag: "flat" },
    },
    lapCountIncluded: { current: 12, reference: 10 },
    setupChanges: [
      {
        key: "rear_spring",
        label: "Rear spring",
        before: "4.0",
        after: "4.4",
        rankReason: "",
        severity: "medium",
      },
    ],
    interpretation: "Test interpretation.",
    notesUsed: { verbatimSnippet: null, role: "none" },
    importedProvenance: null,
    fieldImportSession: null,
    importedSessionFieldStats: null,
    fieldFingerprint: "fp1",
    deepDiveOffered: false,
    softPriors: [],
  };
}

test("fingerprint changes when handling json changes", () => {
  const s = baseSummary();
  const a = buildBetweenRunHintFingerprint({
    summary: s,
    handlingAssessmentJson: { version: 3, feelVsLastRun: -1 },
  });
  const b = buildBetweenRunHintFingerprint({
    summary: s,
    handlingAssessmentJson: { version: 3, feelVsLastRun: 1 },
  });
  assert.notEqual(a, b);
});

test("fingerprint stable for identical inputs", () => {
  const s = baseSummary();
  const a = buildBetweenRunHintFingerprint({ summary: s, handlingAssessmentJson: null });
  const b = buildBetweenRunHintFingerprint({ summary: s, handlingAssessmentJson: null });
  assert.equal(a, b);
});

test("signals: regression + setup + feel", () => {
  const s = baseSummary();
  const sig = computeBetweenRunSignals(s, { version: 3, feelVsLastRun: -1 });
  assert.ok(sig.includes("lap_regressed"));
  assert.ok(sig.includes("meaningful_setup_change"));
  assert.ok(sig.includes("feel_worse"));
});

test("BetweenRunHintPayloadV1 shape for notifications compatibility", () => {
  const sample: BetweenRunHintPayloadV1 = {
    version: 1,
    scope: {
      eventId: "e1",
      eventLabel: "Club day",
      carId: "c1",
      carLabel: "Car",
      trackId: "t1",
      trackLabel: "Track",
    },
    basedOnRunIds: { primary: "p", reference: "q" },
    signals: ["lap_regressed"],
    headline: "H",
    bullets: ["a", "b"],
    avoidRepeating: null,
    sourcesNote: "sources",
    engineerHref: "/engineer?runId=p&compareRunId=q",
  };
  const keys = Object.keys(sample).sort();
  assert.deepEqual(keys, [
    "avoidRepeating",
    "basedOnRunIds",
    "bullets",
    "engineerHref",
    "headline",
    "scope",
    "signals",
    "sourcesNote",
    "version",
  ]);
});

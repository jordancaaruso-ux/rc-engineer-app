/**
 * Run: `npx tsx src/lib/engineerPhase5/betweenRunHints/betweenRunHints.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { buildBetweenRunHintFingerprint } from "@/lib/engineerPhase5/betweenRunHints/buildBetweenRunHintFingerprint";
import { computeBetweenRunSignals } from "@/lib/engineerPhase5/betweenRunHints/computeBetweenRunSignals";
import {
  buildGroupedPairwiseSetupChangeLines,
  buildPairwiseSetupDigestForHints,
} from "@/lib/engineerPhase5/betweenRunHints/pairwiseSetupDigestForHints";
import type { BetweenRunHintPayloadV1, BetweenRunHintPayloadV2 } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";

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

test("fingerprint splits when engineer summary reference differs for same pairwise summary", () => {
  const s = baseSummary();
  const a = buildBetweenRunHintFingerprint({
    summary: s,
    handlingAssessmentJson: null,
    engineerSummaryReferenceRunId: "eng-a",
  });
  const b = buildBetweenRunHintFingerprint({
    summary: s,
    handlingAssessmentJson: null,
    engineerSummaryReferenceRunId: "eng-b",
  });
  assert.notEqual(a, b);
});

test("signals: regression + setup + feel", () => {
  const s = baseSummary();
  const sig = computeBetweenRunSignals(s, { version: 3, feelVsLastRun: -1 });
  assert.ok(sig.includes("lap_regressed"));
  assert.ok(sig.includes("meaningful_setup_change"));
  assert.ok(sig.includes("feel_worse"));
});

test("signals: meaningful_setup_change from chronological diff when Engineer setupChanges empty", () => {
  const s = { ...baseSummary(), setupChanges: [] };
  const sig = computeBetweenRunSignals(s, null, { chronologicalTuningChangeCount: 2 });
  assert.ok(sig.includes("meaningful_setup_change"));
});

test("pairwise digest groups equal under lower arm front and rear lowering", () => {
  const s = {
    ...baseSummary(),
    setupChanges: [
      { key: "under_lower_arm_shims_ff", label: "Under lower arm shims FF", before: "2.5", after: "1.5", rankReason: "", severity: "major" },
      { key: "under_lower_arm_shims_fr", label: "Under lower arm shims FR", before: "2.5", after: "1.5", rankReason: "", severity: "major" },
      { key: "under_lower_arm_shims_rf", label: "Under lower arm shims RF", before: "2.5", after: "1.5", rankReason: "", severity: "major" },
      { key: "under_lower_arm_shims_rr", label: "Under lower arm shims RR", before: "2.5", after: "1.5", rankReason: "", severity: "major" },
    ],
  };
  const digest = buildPairwiseSetupDigestForHints(s);
  assert.match(digest ?? "", /front and rear axles lowered/);
  assert.doesNotMatch(digest ?? "", /Under lower arm shims FF:/);
});

test("pairwise digest explains lower arm anti geometry when pair amounts differ", () => {
  const s = {
    ...baseSummary(),
    setupChanges: [
      { key: "under_lower_arm_shims_ff", label: "Under lower arm shims FF", before: "2.5", after: "1.5", rankReason: "", severity: "major" },
      { key: "under_lower_arm_shims_fr", label: "Under lower arm shims FR", before: "2.5", after: "2.0", rankReason: "", severity: "major" },
      { key: "under_lower_arm_shims_rf", label: "Under lower arm shims RF", before: "2.5", after: "2.0", rankReason: "", severity: "major" },
      { key: "under_lower_arm_shims_rr", label: "Under lower arm shims RR", before: "2.5", after: "1.5", rankReason: "", severity: "major" },
    ],
  };
  const grouped = buildGroupedPairwiseSetupChangeLines(s);
  assert.ok(grouped.lines.some((line) => line.includes("anti-dive geometry also changed")));
  assert.ok(grouped.lines.some((line) => line.includes("anti-squat geometry also changed")));
  assert.ok(grouped.kbTerms.includes("anti-dive"));
  assert.ok(grouped.kbTerms.includes("anti-squat"));
});

test("pairwise digest groups upper inner pairs without anti geometry", () => {
  const s = {
    ...baseSummary(),
    setupChanges: [
      { key: "upper_inner_shims_ff", label: "Upper inner shims FF", before: "1.0", after: "2.0", rankReason: "", severity: "major" },
      { key: "upper_inner_shims_fr", label: "Upper inner shims FR", before: "1.0", after: "1.5", rankReason: "", severity: "major" },
      { key: "upper_inner_shims_rf", label: "Upper inner shims RF", before: "1.0", after: "2.0", rankReason: "", severity: "major" },
      { key: "upper_inner_shims_rr", label: "Upper inner shims RR", before: "1.0", after: "2.0", rankReason: "", severity: "major" },
    ],
  };
  const digest = buildPairwiseSetupDigestForHints(s) ?? "";
  assert.match(digest, /Upper inner shims: front axle raised/);
  assert.match(digest, /upper-link angle along the car also changed/);
  assert.match(digest, /Upper inner shims: rear axle raised/);
  assert.doesNotMatch(digest, /anti-dive|anti-squat/);
});

test("pairwise digest combines matching upper inner front and rear axle moves", () => {
  const s = {
    ...baseSummary(),
    setupChanges: [
      { key: "upper_inner_shims_ff", label: "Upper inner shims FF", before: "1.0", after: "2.0", rankReason: "", severity: "major" },
      { key: "upper_inner_shims_fr", label: "Upper inner shims FR", before: "1.0", after: "2.0", rankReason: "", severity: "major" },
      { key: "upper_inner_shims_rf", label: "Upper inner shims RF", before: "1.0", after: "2.0", rankReason: "", severity: "major" },
      { key: "upper_inner_shims_rr", label: "Upper inner shims RR", before: "1.0", after: "2.0", rankReason: "", severity: "major" },
    ],
  };
  const digest = buildPairwiseSetupDigestForHints(s) ?? "";
  assert.match(digest, /Upper inner shims: front and rear axles raised/);
  assert.doesNotMatch(digest, /Upper inner shims FF:/);
  assert.doesNotMatch(digest, /anti-dive|anti-squat/);
});

test("pairwise digest groups front and rear spring changes by direction", () => {
  const s = {
    ...baseSummary(),
    setupChanges: [
      { key: "front_spring_rate_gf_mm", label: "Spring rate Front", before: "23", after: "21", rankReason: "", severity: "major" },
      { key: "rear_spring_rate_gf_mm", label: "Spring rate Rear", before: "24", after: "22", rankReason: "", severity: "major" },
    ],
  };
  const digest = buildPairwiseSetupDigestForHints(s) ?? "";
  assert.match(digest, /Spring rate: front and rear softened/);
});

test("pairwise digest does not flatten opposing front and rear spring changes", () => {
  const s = {
    ...baseSummary(),
    setupChanges: [
      { key: "front_spring_rate_gf_mm", label: "Spring rate Front", before: "23", after: "21", rankReason: "", severity: "major" },
      { key: "rear_spring_rate_gf_mm", label: "Spring rate Rear", before: "22", after: "24", rankReason: "", severity: "major" },
    ],
  };
  const digest = buildPairwiseSetupDigestForHints(s) ?? "";
  assert.doesNotMatch(digest, /front and rear softened|front and rear stiffened/);
  assert.match(digest, /Spring rate Front: 23 → 21/);
  assert.match(digest, /Spring rate Rear: 22 → 24/);
});

test("BetweenRunHintPayloadV2 shape for API / dashboard compatibility", () => {
  const sample: BetweenRunHintPayloadV2 = {
    version: 2,
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
    recentSessions: [],
    driverContextPack: { combinedNotesAndHandling: "", currentSetupLines: [] },
  };
  const keys = Object.keys(sample).sort();
  assert.deepEqual(keys, [
    "avoidRepeating",
    "basedOnRunIds",
    "bullets",
    "driverContextPack",
    "engineerHref",
    "headline",
    "recentSessions",
    "scope",
    "signals",
    "sourcesNote",
    "version",
  ]);
});

test("BetweenRunHintPayloadV1 remains defined for legacy rows", () => {
  const legacy: BetweenRunHintPayloadV1 = {
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
  const keys = Object.keys(legacy).sort();
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

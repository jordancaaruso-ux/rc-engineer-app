/**
 * Run: `npx tsx src/lib/engineerPhase5/engineeringRead.test.ts`
 *
 * Focused tests on the deterministic engineering read. We feed `buildEngineeringReadV1`
 * synthetic anchor + reference runs and assert that:
 *   1. The required car rating drives runQuality (and `celebrate` mode when high).
 *   2. Phase balance chips are read per-phase (entry/mid/exit) and tracked toward / away
 *      from neutral vs the previous run.
 *   3. Pace metrics are interpreted fluidly — peak vs repeatability — not by hard-coded
 *      "avg top 3 = peak" / "avg top 10 = repeatability" labels.
 *   4. Pace vs feel disagreement is surfaced rather than hidden.
 *   5. Tire choice changes are treated as a fundamental setup choice in `hypotheses`.
 *   6. The recommendation strategy switches mode (celebrate / verify / diagnose) based on
 *      the rating + pace shape + chip evidence — not on free-text notes.
 *   7. The fingerprint is stable across logically-equivalent runs.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEngineeringReadV1,
  summarizeEngineeringReadAsLines,
  type EngineeringReadRunInput,
} from "./engineeringRead";

type HandlingV3 = {
  version: 3;
  balanceByPhase?: { entry?: number; mid?: number; exit?: number };
  feelVsLastRun?: number;
};

function makeRun(overrides: Partial<EngineeringReadRunInput> & { id: string }): EngineeringReadRunInput {
  return {
    id: overrides.id,
    sortAtIso: overrides.sortAtIso ?? "2026-05-15T10:00:00.000Z",
    trackId: overrides.trackId ?? "track-a",
    eventId: overrides.eventId ?? "event-a",
    tireSetId: overrides.tireSetId ?? "tire-set-1",
    tireLabel: overrides.tireLabel ?? "Sweep 32R · set 1",
    tireCompoundLabel: overrides.tireCompoundLabel ?? null,
    tireRunNumber: overrides.tireRunNumber ?? 2,
    carRating: overrides.carRating ?? null,
    handlingAssessmentJson: overrides.handlingAssessmentJson ?? null,
    notes: overrides.notes ?? null,
    driverNotes: overrides.driverNotes ?? null,
    handlingProblems: overrides.handlingProblems ?? null,
    lapTimes: overrides.lapTimes ?? [],
    lapSession: overrides.lapSession ?? null,
    setupSnapshotData: overrides.setupSnapshotData ?? {},
  };
}

function handling(v: HandlingV3): unknown {
  return v;
}

test("runQuality + recommendation strategy celebrate when car rated high and pace agrees", () => {
  const ref = makeRun({
    id: "ref",
    sortAtIso: "2026-05-14T10:00:00.000Z",
    carRating: 6,
    lapTimes: [13.5, 13.45, 13.6, 13.55, 13.5, 13.52, 13.54, 13.48, 13.6, 13.7, 13.55],
    handlingAssessmentJson: handling({ version: 3, balanceByPhase: { entry: 1, mid: 1, exit: 1 } }),
  });
  const cur = makeRun({
    id: "cur",
    sortAtIso: "2026-05-15T10:00:00.000Z",
    carRating: 9,
    lapTimes: [13.3, 13.2, 13.35, 13.3, 13.28, 13.31, 13.33, 13.27, 13.4, 13.5, 13.32],
    handlingAssessmentJson: handling({
      version: 3,
      balanceByPhase: { entry: 0, mid: 0, exit: 0 },
      feelVsLastRun: 2,
    }),
  });
  const read = buildEngineeringReadV1({ anchor: cur, reference: ref });
  assert.equal(read.runQuality.carRating, 9);
  assert.equal(read.runQuality.confidence, "high");
  assert.match(read.runQuality.summary, /excellent|good/);
  assert.equal(read.recommendationStrategy.mode, "celebrate");
  assert.equal(read.recommendationStrategy.strength, "soft");
  assert.equal(read.paceRead.peakPace.direction, "improved");
  assert.equal(read.paceRead.repeatability.direction, "improved");
  assert.equal(read.paceRead.paceFeelAgreement, "agree");
});

test("phase balance is read per-phase and tracks moved-toward-neutral", () => {
  const ref = makeRun({
    id: "ref",
    handlingAssessmentJson: handling({ version: 3, balanceByPhase: { entry: -2, mid: -1, exit: 2 } }),
  });
  const cur = makeRun({
    id: "cur",
    sortAtIso: "2026-05-15T11:00:00.000Z",
    carRating: 7,
    handlingAssessmentJson: handling({ version: 3, balanceByPhase: { entry: -1, mid: -1, exit: 3 } }),
  });
  const read = buildEngineeringReadV1({ anchor: cur, reference: ref });
  assert.equal(read.feelRead.phaseBalance.entry.direction, "more_understeer");
  assert.equal(read.feelRead.phaseBalance.entry.movedTowardNeutral, true, "entry: |-1| < |-2|");
  assert.equal(read.feelRead.phaseBalance.mid.movedTowardNeutral, false, "mid: same magnitude");
  assert.equal(read.feelRead.phaseBalance.exit.direction, "more_oversteer");
  assert.equal(read.feelRead.phaseBalance.exit.movedTowardNeutral, false, "exit: |3| > |2|");
});

test("pace read is fluid — peak improves while repeatability worsens flags the inconsistency", () => {
  const refLaps = [13.5, 13.55, 13.6, 13.55, 13.5, 13.52, 13.54, 13.48, 13.6, 13.7, 13.55];
  // Three flier-fast laps push avg top 3 down, but the rest of the run is much slower than ref
  // so median + avg top 10 both worsen substantially.
  const curLaps = [13.0, 13.05, 13.1, 13.9, 13.95, 13.9, 14.0, 13.85, 13.92, 14.05, 13.9];
  const ref = makeRun({ id: "ref", lapTimes: refLaps });
  const cur = makeRun({
    id: "cur",
    carRating: 6,
    sortAtIso: "2026-05-15T11:00:00.000Z",
    lapTimes: curLaps,
  });
  const read = buildEngineeringReadV1({ anchor: cur, reference: ref });
  assert.equal(read.paceRead.peakPace.direction, "improved");
  assert.equal(read.paceRead.repeatability.direction, "regressed");
  assert.match(read.paceRead.interpretation, /peak.*improved.*usable.*regressed/i);
});

test("pace vs feel disagreement surfaces a verify recommendation", () => {
  const refLaps = [13.2, 13.25, 13.3, 13.22, 13.28, 13.27, 13.3, 13.26, 13.35, 13.4, 13.3];
  const curLaps = [13.5, 13.55, 13.6, 13.52, 13.58, 13.57, 13.6, 13.56, 13.65, 13.7, 13.6];
  const ref = makeRun({ id: "ref", lapTimes: refLaps });
  const cur = makeRun({
    id: "cur",
    carRating: 6,
    sortAtIso: "2026-05-15T11:00:00.000Z",
    lapTimes: curLaps,
    handlingAssessmentJson: handling({ version: 3, feelVsLastRun: 2 }),
  });
  const read = buildEngineeringReadV1({ anchor: cur, reference: ref });
  assert.equal(read.feelRead.betterWorse.direction, "better");
  assert.equal(read.paceRead.peakPace.direction, "regressed");
  assert.equal(read.paceRead.paceFeelAgreement, "disagree");
  assert.equal(read.recommendationStrategy.mode, "verify");
});

test("tire choice change shows up as a hypothesis and a known-fundamental signal", () => {
  const ref = makeRun({
    id: "ref",
    tireSetId: "tire-set-1",
    tireLabel: "Sweep 32R · set 1",
    tireCompoundLabel: "Sweep 32R",
  });
  const cur = makeRun({
    id: "cur",
    sortAtIso: "2026-05-15T11:00:00.000Z",
    carRating: 4,
    tireSetId: "tire-set-2",
    tireLabel: "Sweep 28R · set 2",
    tireCompoundLabel: "Sweep 28R",
    handlingAssessmentJson: handling({ version: 3, feelVsLastRun: -2 }),
  });
  const read = buildEngineeringReadV1({ anchor: cur, reference: ref });
  assert.equal(read.changeRead.tireChangeSignificance, "compound_change");
  assert.equal(read.changeRead.tireSetChanged, true);
  assert.equal(read.changeRead.tireLabelChanged, true);
  const causes = read.hypotheses.map((h) => h.cause);
  assert.ok(causes.includes("tire_choice"), `expected tire_choice hypothesis, got ${causes.join(",")}`);
  assert.ok(
    read.recommendationStrategy.mode === "diagnose" ||
      read.recommendationStrategy.mode === "suggest_compensation",
    `expected diagnose/suggest_compensation, got ${read.recommendationStrategy.mode}`
  );
});

test("low rating + strong worse chip + chassis-only change suggests compensation and points to chat", () => {
  const ref = makeRun({
    id: "ref",
    setupSnapshotData: { spring_rear: 55, toe_rear: 0.5 },
  });
  const cur = makeRun({
    id: "cur",
    sortAtIso: "2026-05-15T11:00:00.000Z",
    carRating: 3,
    handlingAssessmentJson: handling({ version: 3, feelVsLastRun: -3 }),
    setupSnapshotData: { spring_rear: 60, toe_rear: 1.0 },
  });
  const read = buildEngineeringReadV1({ anchor: cur, reference: ref });
  assert.equal(read.feelRead.betterWorse.magnitudeWord, "strong");
  assert.ok(read.changeRead.chassisChangedKeyCount >= 1);
  const topCause = read.hypotheses[0]?.cause;
  assert.ok(topCause === "chassis_setup_change" || topCause === "tire_choice");
  assert.ok(["diagnose", "suggest_compensation"].includes(read.recommendationStrategy.mode));
  assert.equal(read.recommendationStrategy.preferEngineerChat, true);
});

test("notes alone never invent a chip outcome (notes are descriptive context only)", () => {
  const ref = makeRun({ id: "ref" });
  const cur = makeRun({
    id: "cur",
    sortAtIso: "2026-05-15T11:00:00.000Z",
    carRating: 6,
    notes: "Car felt awful, was sliding everywhere, definitely worse than before.",
    handlingProblems: "Mid-corner push, exit looseness",
  });
  const read = buildEngineeringReadV1({ anchor: cur, reference: ref });
  assert.equal(read.feelRead.betterWorse.direction, "unknown", "no chip = unknown, regardless of notes");
  assert.ok(read.feelRead.notesContext.length > 0, "notes are surfaced as descriptive context");
});

test("fingerprint is stable across two equivalent reads", () => {
  const refA = makeRun({
    id: "ref",
    lapTimes: [13.5, 13.45, 13.6, 13.55, 13.5],
    handlingAssessmentJson: handling({ version: 3, balanceByPhase: { entry: 1 } }),
  });
  const refB = makeRun({
    id: "ref",
    lapTimes: [13.5, 13.45, 13.6, 13.55, 13.5],
    handlingAssessmentJson: handling({ version: 3, balanceByPhase: { entry: 1 } }),
  });
  const curA = makeRun({
    id: "cur",
    sortAtIso: "2026-05-15T11:00:00.000Z",
    carRating: 7,
    lapTimes: [13.3, 13.35, 13.4, 13.32, 13.33],
    handlingAssessmentJson: handling({ version: 3, feelVsLastRun: 1 }),
  });
  const curB = makeRun({
    id: "cur",
    sortAtIso: "2026-05-15T11:00:00.000Z",
    carRating: 7,
    lapTimes: [13.3, 13.35, 13.4, 13.32, 13.33],
    handlingAssessmentJson: handling({ version: 3, feelVsLastRun: 1 }),
  });
  const a = buildEngineeringReadV1({ anchor: curA, reference: refA, generatedAtIso: "2026-05-15T11:30:00.000Z" });
  const b = buildEngineeringReadV1({ anchor: curB, reference: refB, generatedAtIso: "2026-05-15T11:45:00.000Z" });
  assert.equal(a.fingerprint, b.fingerprint, "same inputs (different generated-at) must fingerprint identically");
});

test("summarizeEngineeringReadAsLines yields ordered, non-empty driver-prompt lines", () => {
  const ref = makeRun({ id: "ref", lapTimes: [13.6, 13.65, 13.7, 13.62] });
  const cur = makeRun({
    id: "cur",
    sortAtIso: "2026-05-15T11:00:00.000Z",
    carRating: 8,
    lapTimes: [13.3, 13.35, 13.4, 13.32],
    handlingAssessmentJson: handling({
      version: 3,
      balanceByPhase: { entry: -1 },
      feelVsLastRun: 2,
    }),
  });
  const read = buildEngineeringReadV1({ anchor: cur, reference: ref });
  const lines = summarizeEngineeringReadAsLines(read);
  assert.ok(lines.length >= 3, `expected ≥3 prompt lines, got ${lines.length}`);
  assert.match(lines[0]!, /^Run quality/);
  assert.ok(
    lines.some((l) => /Recommendation strategy/.test(l)),
    "must include recommendation strategy summary"
  );
});

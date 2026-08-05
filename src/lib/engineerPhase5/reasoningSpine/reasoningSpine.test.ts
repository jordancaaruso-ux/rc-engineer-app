/**
 * Run: node --conditions=react-server --import tsx src/lib/engineerPhase5/reasoningSpine/reasoningSpine.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEngineeringReadV1 } from "@/lib/engineerPhase5/engineeringRead";
import { buildReasoningSpineV1 } from "@/lib/engineerPhase5/reasoningSpine/buildReasoningSpine";
import { routeEngineerMessage } from "@/lib/engineerPhase5/reasoningSpine/routeMessage";

function makeRun(
  overrides: Partial<Parameters<typeof buildEngineeringReadV1>[0]["anchor"]> & { id: string }
) {
  return {
    id: overrides.id,
    sortAtIso: overrides.sortAtIso ?? "2026-05-15T10:00:00.000Z",
    trackId: overrides.trackId ?? "track-a",
    eventId: overrides.eventId ?? "event-a",
    tireStintId: overrides.tireStintId ?? "tire-set-1",
    tireLabel: overrides.tireLabel ?? "Sweep 32R · set 1",
    tireCompoundLabel: overrides.tireCompoundLabel ?? null,
    tireRunNumber: overrides.tireRunNumber ?? 2,
    carRating: overrides.carRating ?? 7,
    handlingAssessmentJson: overrides.handlingAssessmentJson ?? {
      version: 3,
      balanceByPhase: { entry: -2, mid: -1, exit: 0 },
      feelVsLastRun: -1,
    },
    notes: overrides.notes ?? null,
    driverNotes: overrides.driverNotes ?? null,
    handlingProblems: overrides.handlingProblems ?? null,
    lapTimes: overrides.lapTimes ?? [13.5, 13.45, 13.6, 13.55, 13.5, 13.52, 13.54, 13.48, 13.6, 13.7],
    lapSession: overrides.lapSession ?? null,
    setupSnapshotData: overrides.setupSnapshotData ?? { toe_rear: 1.5 },
  };
}

test("routeEngineerMessage classifies lap history", () => {
  assert.equal(routeEngineerMessage("what's my best lap at tftr"), "data_query");
});

test("routeEngineerMessage classifies setup advice", () => {
  assert.equal(
    routeEngineerMessage("car pushes mid corner need more front grip"),
    "setup_advice"
  );
});

test("empty catalog yields fallback tier", () => {
  const read = buildEngineeringReadV1({
    anchor: makeRun({ id: "cur" }),
    reference: makeRun({ id: "ref", sortAtIso: "2026-05-14T10:00:00.000Z" }),
  });
  const spine = buildReasoningSpineV1({
    userMessage: "need more rear grip",
    engineeringRead: read,
    parameterIntentMatches: {
      outcome: "rear_grip",
      direction: "increase",
      matchedPhrase: "rear grip",
      matches: [],
    },
  });
  assert.equal(spine.decisionTier, "grounded_reasoner_fallback");
  assert.equal(spine.gradedLevers.length, 0);
  assert.ok(spine.promptLines.some((l) => l.includes("catalog")));
});

test("engine_decides when catalog match + confident diagnosis", () => {
  const read = buildEngineeringReadV1({
    anchor: makeRun({ id: "cur" }),
    reference: makeRun({ id: "ref", sortAtIso: "2026-05-14T10:00:00.000Z" }),
  });
  const spine = buildReasoningSpineV1({
    userMessage: "need more rear grip",
    engineeringRead: read,
    parameterIntentMatches: {
      outcome: "rear_grip",
      direction: "increase",
      matchedPhrase: "rear grip",
      matches: [
        {
          parameterKey: "toe_rear",
          kbSource: "toe.md",
          kbSection: "rear-toe",
          effect: { dir: "+", hedge: false, strength: "strong" },
          recommendedMoveDirection: "up",
          userCurrent: 1.5,
          communityMedian: 2.0,
          positionBand: "mid",
          hedgedDirectionAtPosition: false,
        },
      ],
    },
  });
  assert.equal(spine.decisionTier, "engine_decides");
  assert.equal(spine.gradedLevers.length, 1);
  assert.equal(spine.gradedLevers[0]!.parameterKey, "toe_rear");
});

/** Spine for a run whose only interesting input is its per-phase balance chips. */
function spineForBalance(balanceByPhase: Record<string, number>) {
  const read = buildEngineeringReadV1({
    anchor: makeRun({ id: "cur", handlingAssessmentJson: { version: 3, balanceByPhase } }),
    reference: makeRun({ id: "ref", sortAtIso: "2026-05-14T10:00:00.000Z" }),
  });
  return buildReasoningSpineV1({
    userMessage: "fix my car",
    engineeringRead: read,
    parameterIntentMatches: null,
  });
}

test("whole-corner: every flagged phase survives, worst leads", () => {
  const spine = spineForBalance({ entry: 1, mid: 2, exit: 3 });
  const p = spine.problemStatement!;

  assert.equal(p.shape, "whole_corner");
  assert.equal(p.phase, "exit");
  assert.equal(p.severity, "severe");
  assert.equal(p.end, "rear");
  assert.equal(p.balanceSign, "oversteer");
  // The regression this whole change exists for: mid and entry are still there.
  assert.deepEqual(
    p.phaseProfile.map((e) => e.phase),
    ["exit", "mid", "entry"]
  );
  assert.deepEqual(
    p.phaseProfile.map((e) => e.severity),
    ["severe", "moderate", "mild"]
  );

  const joined = spine.promptLines.join("\n");
  assert.ok(joined.includes("lead exit +3 severe oversteer (rear)"));
  assert.ok(joined.includes("mid +2 moderate oversteer (rear)"));
  assert.ok(joined.includes("entry +1 mild oversteer (rear)"));
  assert.ok(joined.includes("WHOLE-CORNER PROBLEM"));
});

test("split: opposed phases name both ends and warn against a whole-corner lever", () => {
  const spine = spineForBalance({ entry: -2, exit: 3 });
  const p = spine.problemStatement!;

  assert.equal(p.shape, "split");
  assert.equal(p.phase, "exit");
  assert.equal(p.balanceSign, "mixed");
  // Was "unknown" — which told the lever filter to pass everything at the exact moment
  // we know precisely which end owns which phase.
  assert.equal(p.end, "both");
  assert.deepEqual(
    p.phaseProfile.map((e) => `${e.phase}:${e.end}`),
    ["exit:rear", "entry:front"]
  );

  const joined = spine.promptLines.join("\n");
  assert.ok(joined.includes("lead exit +3 severe oversteer (rear)"));
  assert.ok(joined.includes("entry -2 moderate understeer (front)"));
  assert.ok(joined.includes("SPLIT PROBLEM"));
});

test("localized: a single flagged phase is not a whole-corner problem", () => {
  const spine = spineForBalance({ entry: 0, mid: 0, exit: 3 });
  const p = spine.problemStatement!;

  assert.equal(p.shape, "localized");
  assert.equal(p.phase, "exit");
  assert.equal(p.end, "rear");
  assert.equal(p.phaseProfile.length, 1);
  assert.ok(spine.promptLines.join("\n").includes("LOCALIZED PROBLEM"));
});

test("all-neutral phases read as neutral, not understeer", () => {
  const p = spineForBalance({ entry: 0, mid: 0, exit: 0 }).problemStatement!;
  assert.equal(p.balanceSign, "neutral");
  assert.equal(p.shape, "unknown");
  assert.equal(p.phase, "unknown");
  assert.equal(p.severity, "unknown");
  assert.equal(p.end, "unknown");
  assert.equal(p.phaseProfile.length, 0);
});

test("equal magnitudes lead with the earlier phase in the corner", () => {
  const p = spineForBalance({ mid: 2, exit: 2 }).problemStatement!;
  assert.equal(p.phase, "mid");
  assert.equal(p.shape, "whole_corner");
});

test("severity tracks the lead phase, not the vs-last-run chip", () => {
  const read = buildEngineeringReadV1({
    anchor: makeRun({
      id: "cur",
      handlingAssessmentJson: {
        version: 3,
        // Mild balance problem, but "much worse than last run" — the old code read the
        // second number and reported severity=severe for a mild oversteer.
        balanceByPhase: { exit: 1 },
        feelVsLastRun: -3,
      },
    }),
    reference: makeRun({ id: "ref", sortAtIso: "2026-05-14T10:00:00.000Z" }),
  });
  const spine = buildReasoningSpineV1({
    userMessage: "fix my car",
    engineeringRead: read,
    parameterIntentMatches: null,
  });
  assert.equal(read.feelRead.betterWorse.magnitudeWord, "strong");
  assert.equal(spine.problemStatement!.severity, "mild");
});

test("diagnose mode forces fallback even with catalog", () => {
  const read = buildEngineeringReadV1({
    anchor: makeRun({ id: "cur", carRating: 3 }),
    reference: makeRun({
      id: "ref",
      sortAtIso: "2026-05-14T10:00:00.000Z",
      carRating: 8,
      handlingAssessmentJson: {
        version: 3,
        balanceByPhase: { entry: 0, mid: 0, exit: 0 },
      },
    }),
  });
  assert.equal(read.recommendationStrategy.mode, "diagnose");
  const spine = buildReasoningSpineV1({
    userMessage: "need more rear grip",
    engineeringRead: read,
    parameterIntentMatches: {
      outcome: "rear_grip",
      direction: "increase",
      matchedPhrase: "rear grip",
      matches: [
        {
          parameterKey: "toe_rear",
          kbSource: "toe.md",
          kbSection: "rear-toe",
          effect: { dir: "+", hedge: false, strength: "strong" },
          recommendedMoveDirection: "up",
          userCurrent: 1.5,
          communityMedian: 2.0,
          positionBand: "mid",
          hedgedDirectionAtPosition: false,
        },
      ],
    },
  });
  assert.equal(spine.decisionTier, "grounded_reasoner_fallback");
});

/**
 * The 2026-08-04 change: `diagnosisConfidence` scored certainty by counting reasons to
 * doubt, so a driver with no history tripped none of them and graded "high". These lock in
 * the replacement — a stated fact about what is on file, and never a grade.
 */

const NO_HISTORY_READ = () =>
  buildEngineeringReadV1({
    anchor: makeRun({
      id: "anchor",
      carRating: 5,
      handlingAssessmentJson: {
        version: 3,
        balanceByPhase: { entry: -2, mid: -2, exit: -2 },
      },
    }),
    reference: null,
  });

test("no comparable run says so plainly instead of implying familiarity", () => {
  const spine = buildReasoningSpineV1({
    userMessage: "fix my car",
    engineeringRead: NO_HISTORY_READ(),
    parameterIntentMatches: null,
    comparableRuns: [],
  });
  const joined = spine.promptLines.join("\n");
  assert.match(joined, /Nothing comparable on file/);
  assert.match(joined, /first read/);
  assert.deepEqual(spine.comparableRuns, []);
});

test("no certainty grade reaches the model any more", () => {
  const spine = buildReasoningSpineV1({
    userMessage: "fix my car",
    engineeringRead: NO_HISTORY_READ(),
    parameterIntentMatches: null,
    comparableRuns: [],
  });
  const joined = spine.promptLines.join("\n");
  assert.doesNotMatch(joined, /diagnosisConfidence/);
  assert.doesNotMatch(joined, /confidence=/);
  // The old blanket instruction is gone too — it softened every answer regardless.
  assert.doesNotMatch(joined, /hedge heavily/i);
});

test("a comparable run reaches the model with its closeness and the driver's rating", () => {
  const spine = buildReasoningSpineV1({
    userMessage: "fix my car",
    engineeringRead: NO_HISTORY_READ(),
    parameterIntentMatches: null,
    comparableRuns: [
      {
        runId: "run-good",
        whenIso: "2026-04-02T09:00:00.000Z",
        trackName: "Boronia",
        carRating: 9,
        comparability: { tyre: "same", grip: "same", layout: "adjacent", score: 7 },
        howClose: "same tyre, same grip level, layout one notch away",
      },
    ],
  });
  const joined = spine.promptLines.join("\n");
  assert.match(joined, /2026-04-02 at Boronia/);
  assert.match(joined, /same tyre, same grip level, layout one notch away/);
  assert.match(joined, /rated the car 9\/10/);
});

test("an unrated comparable run is reported as unrated, not silently dropped", () => {
  const spine = buildReasoningSpineV1({
    userMessage: "fix my car",
    engineeringRead: NO_HISTORY_READ(),
    parameterIntentMatches: null,
    comparableRuns: [
      {
        runId: "run-x",
        whenIso: "2026-04-02T09:00:00.000Z",
        trackName: null,
        carRating: null,
        comparability: { tyre: "same", grip: "same", layout: "same", score: 8 },
        howClose: "same tyre, same grip level, same layout style",
      },
    ],
  });
  assert.match(spine.promptLines.join("\n"), /he left it unrated/);
});

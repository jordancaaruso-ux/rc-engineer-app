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
    tireSetId: overrides.tireSetId ?? "tire-set-1",
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

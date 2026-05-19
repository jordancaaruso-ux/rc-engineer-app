/**
 * Run: `npx tsx src/lib/engineerPhase5/setupOutcomeMemory.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSetupOutcomeMemoryFromRuns,
  type SetupOutcomeMemoryRunInput,
} from "@/lib/engineerPhase5/setupOutcomeMemory";

function run(input: {
  id: string;
  order: number;
  setup: Record<string, unknown>;
  feelVsLastRun?: number;
  carRating?: number | null;
  notes?: string | null;
  laps?: number[];
  trackId?: string | null;
  tireSetId?: string | null;
  tireRunNumber?: number;
}): SetupOutcomeMemoryRunInput {
  return {
    id: input.id,
    sortAt: new Date(`2026-01-${String(input.order).padStart(2, "0")}T00:00:00.000Z`),
    trackId: input.trackId ?? "track-1",
    eventId: "event-1",
    tireSetId: input.tireSetId ?? "tire-1",
    tireRunNumber: input.tireRunNumber ?? 1,
    lapTimes: input.laps ?? [10, 10.1, 10.2, 10.3, 10.4],
    lapSession: null,
    notes: input.notes ?? null,
    driverNotes: null,
    handlingProblems: null,
    handlingAssessmentJson:
      input.feelVsLastRun == null ? null : { version: 5, feelVsLastRun: input.feelVsLastRun },
    carRating: input.carRating ?? null,
    setupSnapshot: { data: input.setup },
  };
}

test("chip-backed negative lower-arm change creates a clear caveat", () => {
  const memory = buildSetupOutcomeMemoryFromRuns({
    userId: "u1",
    carId: "c1",
    anchorRunId: "r2",
    runs: [
      run({
        id: "r1",
        order: 1,
        setup: { under_lower_arm_shims_ff: 2, under_lower_arm_shims_fr: 2 },
      }),
      run({
        id: "r2",
        order: 2,
        setup: { under_lower_arm_shims_ff: 1, under_lower_arm_shims_fr: 1 },
        feelVsLastRun: -2,
        laps: [10.2, 10.3, 10.4, 10.5, 10.6],
      }),
    ],
    candidates: [{ key: "under_lower_arm_shims_ff", before: "2", after: "1" }],
    generatedAtIso: "2026-01-03T00:00:00.000Z",
  });

  assert.equal(memory.rows[0]?.outcome, "negative");
  assert.equal(memory.rows[0]?.outcomeSource, "post_run_chip");
  assert.equal(memory.rows[0]?.suggestionEffect, "caveat_only");
  assert.match(memory.caveatLines[0] ?? "", /History caveat/);
  assert.match(memory.caveatLines[0] ?? "", /marked this worse/);
});

test("chip-backed positive matching direction is supporting context", () => {
  const memory = buildSetupOutcomeMemoryFromRuns({
    userId: "u1",
    carId: "c1",
    runs: [
      run({ id: "r1", order: 1, setup: { rear_spring_rate_gf_mm: 22 } }),
      run({
        id: "r2",
        order: 2,
        setup: { rear_spring_rate_gf_mm: 24 },
        feelVsLastRun: 1,
      }),
    ],
    candidates: [{ key: "rear_spring_rate_gf_mm", before: "22", after: "24" }],
    generatedAtIso: "2026-01-03T00:00:00.000Z",
  });

  assert.equal(memory.rows[0]?.outcome, "positive");
  assert.equal(memory.rows[0]?.outcomeSource, "post_run_chip");
  assert.match(memory.caveatLines[0] ?? "", /marked this better/);
});

test("notes and lap-only evidence creates a soft caveat, not a firm verdict", () => {
  const memory = buildSetupOutcomeMemoryFromRuns({
    userId: "u1",
    carId: "c1",
    runs: [
      run({ id: "r1", order: 1, setup: { damper_oil_front: 500 }, laps: [10, 10.1, 10.2, 10.3, 10.4] }),
      run({
        id: "r2",
        order: 2,
        setup: { damper_oil_front: 550 },
        notes: "Car was worse and harder to drive.",
        laps: [10.4, 10.5, 10.6, 10.7, 10.8],
      }),
    ],
    candidates: [{ key: "damper_oil_front", before: "500", after: "550" }],
    generatedAtIso: "2026-01-03T00:00:00.000Z",
  });

  assert.equal(memory.rows[0]?.outcomeSource, "notes_laps_only");
  assert.equal(memory.rows[0]?.confidence, "low");
  assert.match(memory.caveatLines[0] ?? "", /Soft history caveat/);
});

test("opposite direction does not match a prior caveat", () => {
  const memory = buildSetupOutcomeMemoryFromRuns({
    userId: "u1",
    carId: "c1",
    runs: [
      run({ id: "r1", order: 1, setup: { under_lower_arm_shims_ff: 2 } }),
      run({
        id: "r2",
        order: 2,
        setup: { under_lower_arm_shims_ff: 1 },
        feelVsLastRun: -1,
      }),
    ],
    candidates: [{ key: "under_lower_arm_shims_ff", before: "1", after: "2" }],
    generatedAtIso: "2026-01-03T00:00:00.000Z",
  });

  assert.equal(memory.rows.length, 0);
  assert.equal(memory.caveatLines.length, 0);
});

test("rating vs prior run infers positive outcome when chip unset", () => {
  const memory = buildSetupOutcomeMemoryFromRuns({
    userId: "u1",
    carId: "c1",
    runs: [
      run({ id: "r1", order: 1, carRating: 6, setup: { toe_gain_shims_rear: 2 } }),
      run({
        id: "r2",
        order: 2,
        carRating: 7,
        setup: { toe_gain_shims_rear: 1 },
      }),
    ],
    candidates: [{ key: "toe_gain_shims_rear", before: "2", after: "1" }],
    generatedAtIso: "2026-01-03T00:00:00.000Z",
  });

  assert.equal(memory.rows[0]?.outcome, "positive");
  assert.equal(memory.rows[0]?.outcomeSource, "prior_run_rating");
  assert.match(memory.caveatLines[0] ?? "", /car rating vs the prior run was better/);
});

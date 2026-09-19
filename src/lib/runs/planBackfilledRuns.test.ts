import test from "node:test";
import assert from "node:assert/strict";
import { planBackfilledRuns } from "@/lib/runs/planBackfilledRuns";

const at = (hhmm: string) => new Date(`2026-09-12T${hhmm}:00.000Z`);

test("sessions come out earliest first and copy from the nearest earlier logged run", () => {
  const run1 = { id: "run-1", instant: at("09:00"), tireStintId: "stint-a", tireRunNumber: 1 };
  const run4 = { id: "run-4", instant: at("11:30"), tireStintId: "stint-a", tireRunNumber: 4 };
  const plan = planBackfilledRuns({
    parent: run4,
    confirmedDayRuns: [run4, run1],
    sessions: [
      { id: "s-3", instant: at("10:40") },
      { id: "s-2", instant: at("09:50") },
      { id: "s-5", instant: at("12:20") },
    ],
  });
  assert.deepEqual(
    plan.map((p) => [p.sessionId, p.setupSourceRunId, p.tireRunNumber]),
    [
      ["s-2", "run-1", 2],
      ["s-3", "run-1", 3],
      ["s-5", "run-4", 5],
    ]
  );
});

test("with nothing logged earlier, earlier sessions copy the parent and count back on its rubber", () => {
  const parent = { id: "run-4", instant: at("11:30"), tireStintId: "stint-a", tireRunNumber: 4 };
  const plan = planBackfilledRuns({
    parent,
    confirmedDayRuns: [],
    sessions: [
      { id: "s-1", instant: at("09:00") },
      { id: "s-2", instant: at("09:50") },
      { id: "s-3", instant: at("10:40") },
      { id: "s-6", instant: at("13:00") },
    ],
  });
  assert.deepEqual(
    plan.map((p) => [p.sessionId, p.setupSourceRunId, p.tireRunNumber]),
    [
      ["s-1", "run-4", 1],
      ["s-2", "run-4", 2],
      ["s-3", "run-4", 3],
      ["s-6", "run-4", 5],
    ]
  );
});

test("the tyre count never drops below 1, and a source with no stint numbers every run 1", () => {
  const parent = { id: "run-2", instant: at("10:00"), tireStintId: "stint-a", tireRunNumber: 1 };
  const floored = planBackfilledRuns({
    parent,
    confirmedDayRuns: [parent],
    sessions: [
      { id: "s-a", instant: at("08:00") },
      { id: "s-b", instant: at("09:00") },
    ],
  });
  assert.deepEqual(floored.map((p) => p.tireRunNumber), [1, 1]);

  const noStint = planBackfilledRuns({
    parent: { ...parent, tireStintId: null, tireRunNumber: 3 },
    confirmedDayRuns: [],
    sessions: [{ id: "s-c", instant: at("11:00") }],
  });
  assert.deepEqual(noStint.map((p) => p.tireRunNumber), [1]);
});

test("a run logged later the same day is the source for sessions after it, not the parent", () => {
  const parent = { id: "run-2", instant: at("10:00"), tireStintId: "stint-a", tireRunNumber: 2 };
  const run5 = { id: "run-5", instant: at("13:00"), tireStintId: "stint-b", tireRunNumber: 1 };
  const plan = planBackfilledRuns({
    parent,
    confirmedDayRuns: [parent, run5],
    sessions: [
      { id: "s-3", instant: at("11:00") },
      { id: "s-6", instant: at("14:00") },
    ],
  });
  assert.deepEqual(
    plan.map((p) => [p.sessionId, p.setupSourceRunId, p.tireRunNumber]),
    [
      ["s-3", "run-2", 3],
      ["s-6", "run-5", 2],
    ]
  );
});

test("the sweep's stand-in parent: nothing logged today, so every session copies it (no rubber) until a logged run appears", () => {
  // `createBackfilledRuns` passes a synthetic parent one millisecond before the earliest session
  // when a track context has no logged run to anchor on.
  const synthetic = {
    id: "__no_logged_run__",
    instant: new Date(at("09:00").getTime() - 1),
    tireStintId: null,
    tireRunNumber: 1,
  };
  const loggedLater = { id: "run-3", instant: at("11:00"), tireStintId: "stint-a", tireRunNumber: 1 };
  const plan = planBackfilledRuns({
    parent: synthetic,
    confirmedDayRuns: [loggedLater],
    sessions: [
      { id: "s-1", instant: at("09:00") },
      { id: "s-2", instant: at("10:00") },
      { id: "s-4", instant: at("12:00") },
    ],
  });
  assert.deepEqual(
    plan.map((p) => [p.sessionId, p.setupSourceRunId, p.tireRunNumber]),
    [
      ["s-1", "__no_logged_run__", 1],
      ["s-2", "__no_logged_run__", 1],
      ["s-4", "run-3", 2],
    ]
  );
});

test("a front/rear car's front tyre counts on from its OWN number, by the same sessions", () => {
  // Rears are on their 1st run, fronts already on their 6th — they age apart (2026-09-19).
  const run1 = {
    id: "run-1",
    instant: at("09:00"),
    tireStintId: "rear-a",
    tireRunNumber: 1,
    frontTireStintId: "front-a",
    frontTireRunNumber: 6,
  };
  const plan = planBackfilledRuns({
    parent: run1,
    confirmedDayRuns: [run1],
    sessions: [
      { id: "s-2", instant: at("09:50") },
      { id: "s-3", instant: at("10:40") },
    ],
  });
  assert.deepEqual(
    plan.map((p) => [p.sessionId, p.tireRunNumber, p.frontTireRunNumber]),
    [
      ["s-2", 2, 7],
      ["s-3", 3, 8],
    ]
  );
});

test("counting back floors the front at 1 too, and a single-tyre source plans no front", () => {
  const parent = {
    id: "run-3",
    instant: at("11:00"),
    tireStintId: "rear-a",
    tireRunNumber: 3,
    frontTireStintId: "front-a",
    frontTireRunNumber: 1,
  };
  const back = planBackfilledRuns({
    parent,
    confirmedDayRuns: [parent],
    sessions: [{ id: "s-1", instant: at("09:00") }],
  });
  assert.deepEqual(back.map((p) => [p.tireRunNumber, p.frontTireRunNumber]), [[2, 1]]);

  const touring = { id: "run-9", instant: at("09:00"), tireStintId: "set-a", tireRunNumber: 2 };
  const single = planBackfilledRuns({
    parent: touring,
    confirmedDayRuns: [touring],
    sessions: [{ id: "s-2", instant: at("10:00") }],
  });
  assert.deepEqual(single.map((p) => [p.tireRunNumber, p.frontTireRunNumber]), [[3, null]]);
});

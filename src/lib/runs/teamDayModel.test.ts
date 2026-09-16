import test from "node:test";
import assert from "node:assert/strict";
import { buildTeamDayModel, type TeamDayRunSource } from "@/lib/runs/teamDayModel";

/**
 * The team day chart's x-axis is TIME OF DAY, and that is its whole reason to exist:
 * two drivers' runs are only comparable where they were the same twenty minutes of
 * the same track. It used to read `sortAt`, which is when the LOG was written — so a
 * driver who typed up the morning over lunch had every heat stacked at 1pm, and two
 * teammates out in the same heat sat an hour apart because one of them was slower at
 * paperwork. These tests hold the axis to the on-track stamp.
 *
 * `resolveRunDisplayInstant` is the rule being used, so its guards come along too: a
 * `sessionCompletedAt` LATER than the log is the known UTC-mangled import and is
 * refused, and the fortnight floor is lifted for a run the app filed at its own heat.
 */

const OPTS = { memberDisplayByUserId: { u1: "Jordan", u2: "Sam" }, zones: { viewerTimeZone: "UTC" } };

function run(over: Partial<TeamDayRunSource> & { id: string }): TeamDayRunSource {
  return {
    carId: "car_1",
    car: { name: "A800RR" },
    createdAt: new Date("2026-06-26T10:00:00Z"),
    lapTimes: [16.0, 16.2, 16.1, 16.4, 16.3, 16.5],
    userId: "u1",
    ...over,
  };
}

function pointsOf(model: ReturnType<typeof buildTeamDayModel>, userId: string) {
  return model!.drivers.find((d) => d.userId === userId)!.points;
}

test("a run sits at the time it was on track, not the time it was logged", () => {
  const model = buildTeamDayModel(
    [
      run({
        id: "r1",
        // Out at 09:25. Log started 18:40 that evening, finished 18:50.
        createdAt: new Date("2026-06-26T18:40:00Z"),
        sortAt: new Date("2026-06-26T18:40:00Z"),
        loggingCompletedAt: new Date("2026-06-26T18:50:00Z"),
        sessionCompletedAt: new Date("2026-06-26T09:25:00Z"),
      }),
    ],
    OPTS
  );
  assert.equal(pointsOf(model, "u1")[0]!.clock, "9:25");
});

test("two teammates out in the same heat land on the same minute, however late one logs it", () => {
  const model = buildTeamDayModel(
    [
      run({
        id: "r1",
        userId: "u1",
        createdAt: new Date("2026-06-26T10:15:00Z"),
        sortAt: new Date("2026-06-26T10:15:00Z"),
        sessionCompletedAt: new Date("2026-06-26T10:40:00Z"),
        loggingCompletedAt: new Date("2026-06-26T10:45:00Z"),
      }),
      run({
        id: "r2",
        userId: "u2",
        // Same heat, typed up four hours later.
        createdAt: new Date("2026-06-26T14:30:00Z"),
        sortAt: new Date("2026-06-26T14:30:00Z"),
        sessionCompletedAt: new Date("2026-06-26T10:40:00Z"),
        loggingCompletedAt: new Date("2026-06-26T14:35:00Z"),
      }),
    ],
    OPTS
  );
  assert.equal(pointsOf(model, "u1")[0]!.minute, pointsOf(model, "u2")[0]!.minute);
  assert.equal(pointsOf(model, "u2")[0]!.clock, "10:40");
});

test("a run logged the next day is drawn in the day it was driven, not the day it was typed", () => {
  const model = buildTeamDayModel(
    [
      run({
        id: "r1",
        // Sunday's main, saved Monday evening.
        createdAt: new Date("2026-06-29T18:00:00Z"),
        sortAt: new Date("2026-06-29T18:00:00Z"),
        loggingCompletedAt: new Date("2026-06-29T18:10:00Z"),
        sessionCompletedAt: new Date("2026-06-28T14:20:00Z"),
      }),
    ],
    OPTS
  );
  const point = pointsOf(model, "u1")[0]!;
  assert.equal(point.dayKey, "2026-06-28");
  assert.equal(point.clock, "14:20");
  assert.deepEqual(
    model!.days.map((d) => d.key),
    ["2026-06-28"]
  );
});

test("the line is ordered by when the car ran, so it never doubles back", () => {
  // Logged out of order: the 14:00 heat was typed up first.
  const model = buildTeamDayModel(
    [
      run({
        id: "afternoon",
        createdAt: new Date("2026-06-26T16:00:00Z"),
        sortAt: new Date("2026-06-26T16:00:00Z"),
        loggingCompletedAt: new Date("2026-06-26T16:05:00Z"),
        sessionCompletedAt: new Date("2026-06-26T14:00:00Z"),
      }),
      run({
        id: "morning",
        createdAt: new Date("2026-06-26T17:00:00Z"),
        sortAt: new Date("2026-06-26T17:00:00Z"),
        loggingCompletedAt: new Date("2026-06-26T17:05:00Z"),
        sessionCompletedAt: new Date("2026-06-26T09:30:00Z"),
      }),
    ],
    OPTS
  );
  const points = pointsOf(model, "u1");
  assert.deepEqual(
    points.map((p) => p.runId),
    ["morning", "afternoon"]
  );
  assert.ok(points[0]!.minute < points[1]!.minute);
});

test("a sessionCompletedAt later than the log is the mangled import, and is refused", () => {
  // The known bug: a 09:25 practice wall clock stored as if it were UTC → 19:25.
  const model = buildTeamDayModel(
    [
      run({
        id: "r1",
        createdAt: new Date("2026-06-26T09:20:00Z"),
        sortAt: new Date("2026-06-26T09:20:00Z"),
        loggingCompletedAt: new Date("2026-06-26T09:40:00Z"),
        sessionCompletedAt: new Date("2026-06-26T19:25:00Z"),
      }),
    ],
    OPTS
  );
  // Falls back to the log's own finish, not to an evening the driver never raced.
  assert.equal(pointsOf(model, "u1")[0]!.clock, "9:40");
});

test("a run the app filed at its heat keeps that heat's clock however late it was saved", () => {
  const heat = new Date("2026-05-10T10:05:00Z");
  const model = buildTeamDayModel(
    [
      run({
        id: "r1",
        // Saved a month after the day — past the fortnight floor. sortAt === the
        // stamp is the app's own signature, so the floor doesn't apply.
        createdAt: new Date("2026-06-14T05:38:00Z"),
        sortAt: heat,
        sessionCompletedAt: heat,
      }),
    ],
    OPTS
  );
  assert.equal(pointsOf(model, "u1")[0]!.dayKey, "2026-05-10");
  assert.equal(pointsOf(model, "u1")[0]!.clock, "10:05");
});

test("a run with no on-track stamp still falls back to when it was logged", () => {
  const model = buildTeamDayModel(
    [run({ id: "r1", createdAt: new Date("2026-06-26T11:15:00Z"), sortAt: new Date("2026-06-26T11:15:00Z") })],
    OPTS
  );
  assert.equal(pointsOf(model, "u1")[0]!.clock, "11:15");
});

test("the clock is read in the driver's zone, not the reader's", () => {
  const model = buildTeamDayModel(
    [
      run({
        id: "r1",
        localTimeZone: "Australia/Sydney",
        createdAt: new Date("2026-06-26T00:30:00Z"),
        sortAt: new Date("2026-06-26T00:30:00Z"),
        loggingCompletedAt: new Date("2026-06-26T00:45:00Z"),
        // 10:40 AEST on the 26th.
        sessionCompletedAt: new Date("2026-06-26T00:40:00Z"),
      }),
    ],
    { ...OPTS, zones: { viewerTimeZone: "Pacific/Auckland" } }
  );
  const point = pointsOf(model, "u1")[0]!;
  assert.equal(point.clock, "10:40");
  assert.equal(point.dayKey, "2026-06-26");
});
